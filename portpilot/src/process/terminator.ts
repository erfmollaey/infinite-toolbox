import type {
  ProcessIdentity,
  TerminationReport,
  TerminationStatus,
} from "../types";
import { runCommand } from "../utils/exec";
import { detectPlatform } from "../utils/platform";
import { getProcessIdentity } from "./inspector";

export interface TerminationTarget {
  pid: number;
  name: string;
  /**
   * Start-time marker captured during inspection, or `undefined` when the
   * platform could not provide one. The property is required so every caller
   * states that marker explicitly; termination is refused when it is
   * undefined, because neither the PID nor the process name can rule out
   * reuse on its own.
   */
  startTime: string | undefined;
}

export interface ProcessOps {
  isAlive(pid: number): Promise<boolean>;
  /** Send SIGTERM (graceful) or SIGKILL / taskkill /F (force). */
  terminate(pid: number, force: boolean): Promise<void>;
  getIdentity(pid: number): Promise<ProcessIdentity | null>;
}

export interface TerminationOptions {
  /** Shown to the user before a graceful termination attempt. */
  confirm: (message: string) => Promise<boolean>;
  /** Shown only after graceful termination failed. */
  forceConfirm: (message: string) => Promise<boolean>;
  ops?: ProcessOps;
  graceTimeoutMs?: number;
  forceTimeoutMs?: number;
  pollIntervalMs?: number;
}

const PROTECTED_NAMES = new Set([
  "launchd",
  "kernel_task",
  "systemd",
  "init",
  "system",
  "smss",
  "csrss",
  "wininit",
  "winlogon",
  "services",
  "lsass",
  "svchost",
]);

function normalizedName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "");
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

/** Return a refusal reason for processes that must never be terminated. */
export function protectedReason(
  pid: number,
  name?: string,
  ownPid: number = process.pid,
): string | null {
  if (pid === 1) {
    return "PID 1 is the system init process and cannot be terminated";
  }
  if (pid === ownPid) {
    return "Refusing to terminate PortPilot itself";
  }
  if (name && PROTECTED_NAMES.has(normalizedName(name))) {
    return `"${name}" is a critical system process and will not be terminated`;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }

  if (detectPlatform() === "windows") {
    return true;
  }

  // A terminated child that has not been reaped is a zombie. kill(pid, 0)
  // still succeeds for zombies, but no code is running and its port is closed.
  const stat = await runCommand("ps", ["-p", String(pid), "-o", "stat="]);
  if (stat.ok) {
    return !/^Z/i.test(stat.stdout.trim());
  }

  return true;
}

async function terminate(pid: number, force: boolean): Promise<void> {
  if (detectPlatform() === "windows") {
    const args = ["/PID", String(pid)];
    if (force) {
      args.push("/F");
    }
    const result = await runCommand("taskkill", args);
    if (!result.ok) {
      if (
        /not found|no running instance/i.test(
          `${result.stdout}${result.stderr}`,
        )
      ) {
        throw Object.assign(new Error("Process is no longer running"), {
          code: "ESRCH",
        });
      }
      throw Object.assign(
        new Error(
          result.stderr.trim() ||
            result.stdout.trim() ||
            `taskkill failed for PID ${pid}`,
        ),
        { code: result.code },
      );
    }
    return;
  }

  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
}

export const systemOps: ProcessOps = {
  isAlive,
  terminate,
  getIdentity: getProcessIdentity,
};

async function waitForExit(
  pid: number,
  ops: ProcessOps,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!(await ops.isAlive(pid))) {
      return true;
    }
    await delay(intervalMs);
  }
  return !(await ops.isAlive(pid));
}

function namesCompatible(expected: string, actual: string): boolean {
  if (!expected || !actual) {
    return true;
  }
  const a = normalizedName(basename(expected));
  const b = normalizedName(basename(actual));
  return a === b || a.startsWith(b) || b.startsWith(a);
}

interface Revalidation {
  ok: boolean;
  status?: TerminationStatus;
  message?: string;
}

async function revalidate(
  target: TerminationTarget,
  ops: ProcessOps,
): Promise<Revalidation> {
  if (!(await ops.isAlive(target.pid))) {
    return {
      ok: false,
      status: "already-gone",
      message: `Process ${target.pid} is no longer running`,
    };
  }

  let identity: ProcessIdentity | null;
  try {
    identity = await ops.getIdentity(target.pid);
  } catch (error) {
    return {
      ok: false,
      status: "refused",
      message: `Could not verify process identity: ${(error as Error).message}`,
    };
  }

  if (!identity) {
    return {
      ok: false,
      status: "refused",
      message: `Could not verify that PID ${target.pid} still belongs to the original process`,
    };
  }

  if (/^<defunct>/i.test(identity.name)) {
    return {
      ok: false,
      status: "already-gone",
      message: `Process ${target.pid} has already exited (it remains as a zombie awaiting reaping)`,
    };
  }

  // Without a marker captured at inspection time there is nothing to compare
  // against, so a recycled PID would look identical to the original process.
  // This happens on Windows when the CIM lookup times out during inspection.
  if (!target.startTime) {
    return {
      ok: false,
      status: "refused",
      message: `Could not verify the identity of PID ${target.pid}: no start-time marker was captured (the Windows CIM lookup may have timed out). Refusing to terminate it. Stop the process manually, or re-run PortPilot once CIM is available.`,
    };
  }

  // The target was captured with a start-time marker, so reuse can only be
  // ruled out by comparing that marker. A fresh identity without one (for
  // example the tasklist fallback after a CIM timeout on Windows) is not
  // enough: the name alone cannot prove this is still the same process.
  if (!identity.startTime) {
    return {
      ok: false,
      status: "refused",
      message: `Could not verify the start time of PID ${target.pid}; refusing to terminate it`,
    };
  }

  if (target.startTime !== identity.startTime) {
    return {
      ok: false,
      status: "refused",
      message: `PID ${target.pid} has been reused by another process; refusing to terminate it`,
    };
  }

  if (!namesCompatible(target.name, identity.name)) {
    return {
      ok: false,
      status: "refused",
      message: `PID ${target.pid} now belongs to "${identity.name}", not "${target.name}"; refusing to terminate it`,
    };
  }

  return { ok: true };
}

function errorStatus(error: unknown): {
  status: TerminationStatus;
  message: string;
} {
  const code = (error as NodeJS.ErrnoException).code;
  const message = (error as Error).message;

  if (
    code === "EPERM" ||
    code === "EACCES" ||
    /access is denied/i.test(message)
  ) {
    return {
      status: "permission-denied",
      message:
        "Permission denied. PortPilot does not escalate privileges; retry with the same user as the process or terminate it manually.",
    };
  }

  if (code === "ESRCH" || /no such process/i.test(message)) {
    return { status: "already-gone", message: "Process is no longer running" };
  }

  return { status: "failed", message: `Termination failed: ${message}` };
}

function report(
  target: TerminationTarget,
  status: TerminationStatus,
  message: string,
): TerminationReport {
  return { pid: target.pid, name: target.name, status, message };
}

/**
 * Terminate one already-identified process.
 *
 * The caller is responsible for displaying the target and collecting
 * confirmation; this function still revalidates the PID before every signal
 * so that a recycled PID is never signalled.
 */
export async function terminateProcess(
  target: TerminationTarget,
  options: TerminationOptions,
): Promise<TerminationReport> {
  const ops = options.ops ?? systemOps;
  const graceTimeout = options.graceTimeoutMs ?? 5000;
  const forceTimeout = options.forceTimeoutMs ?? 3000;
  const pollInterval = options.pollIntervalMs ?? 100;

  if (!Number.isInteger(target.pid) || target.pid < 1) {
    return report(target, "refused", "Invalid PID; nothing was terminated");
  }

  const refusal = protectedReason(target.pid, target.name);
  if (refusal) {
    return report(target, "refused", refusal);
  }

  const beforeConfirm = await revalidate(target, ops);
  if (!beforeConfirm.ok) {
    return report(
      target,
      beforeConfirm.status ?? "refused",
      beforeConfirm.message ?? "Process could not be revalidated",
    );
  }

  const confirmed = await options.confirm(
    `Terminate ${target.name} (PID ${target.pid})? [y/N] `,
  );
  if (!confirmed) {
    return report(target, "cancelled", "Cancelled; no signal was sent");
  }

  const beforeSignal = await revalidate(target, ops);
  if (!beforeSignal.ok) {
    return report(
      target,
      beforeSignal.status ?? "refused",
      beforeSignal.message ?? "Process could not be revalidated",
    );
  }

  let gracefulFailure: { status: TerminationStatus; message: string } | null =
    null;

  try {
    await ops.terminate(target.pid, false);
  } catch (error) {
    const failure = errorStatus(error);
    // Permission failures must stop here; escalation is never attempted.
    // Other failures (for example, Windows refusing a non-forced taskkill for
    // a console process) still allow the explicit force-confirmation path.
    if (
      failure.status === "permission-denied" ||
      failure.status === "already-gone"
    ) {
      return report(target, failure.status, failure.message);
    }
    gracefulFailure = failure;
  }

  if (
    !gracefulFailure &&
    (await waitForExit(target.pid, ops, graceTimeout, pollInterval))
  ) {
    return report(
      target,
      "terminated",
      `Process ${target.pid} exited after a graceful termination request`,
    );
  }

  const stillRunning = await revalidate(target, ops);
  if (!stillRunning.ok) {
    return report(
      target,
      stillRunning.status ?? "failed",
      stillRunning.message ?? "Process state could not be verified",
    );
  }

  const force = await options.forceConfirm(
    gracefulFailure
      ? `Graceful termination failed (${gracefulFailure.message}). Force terminate PID ${target.pid}? [y/N] `
      : `Process ${target.pid} did not exit after ${Math.round(graceTimeout / 1000)}s. Force terminate it? [y/N] `,
  );
  if (!force) {
    return report(
      target,
      "force-declined",
      "Graceful termination did not succeed and force termination was declined; the process is still running",
    );
  }

  const beforeForce = await revalidate(target, ops);
  if (!beforeForce.ok) {
    return report(
      target,
      beforeForce.status ?? "refused",
      beforeForce.message ?? "Process could not be revalidated",
    );
  }

  try {
    await ops.terminate(target.pid, true);
  } catch (error) {
    const failure = errorStatus(error);
    return report(target, failure.status, failure.message);
  }

  if (await waitForExit(target.pid, ops, forceTimeout, pollInterval)) {
    return report(
      target,
      "force-terminated",
      `Process ${target.pid} was force terminated`,
    );
  }

  return report(
    target,
    "failed",
    `Process ${target.pid} is still running after a force termination attempt`,
  );
}
