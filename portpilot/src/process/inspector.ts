import type { ProcessIdentity, ProcessInfo } from "../types";
import { isMissingCommand, runCommand } from "../utils/exec";
import { detectPlatform } from "../utils/platform";

export class ProcessNotFoundError extends Error {
  constructor(pid: number) {
    super(`Process ${pid} is no longer running`);
    this.name = "ProcessNotFoundError";
  }
}

const LSTART = /(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})/;

function basename(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

function unixBasicRegex(): RegExp {
  return new RegExp(
    `^\\s*(\\d+)\\s+(\\d+)\\s+(\\S+)\\s+(\\S+)\\s+${LSTART.source}\\s+(.+)$`,
  );
}

async function inspectUnix(
  process: ProcessInfo,
  pid: number,
): Promise<ProcessInfo> {
  const basic = await runCommand("ps", [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,user=,stat=,lstart=,comm=",
  ]);

  if (!basic.ok) {
    if (isMissingCommand(basic)) {
      throw new Error(
        "The ps command is required for process inspection but was not found",
      );
    }
    throw new ProcessNotFoundError(pid);
  }

  const line = basic.stdout.trim().split("\n")[0]?.trim() ?? "";
  const match = unixBasicRegex().exec(line);
  if (!match) {
    throw new ProcessNotFoundError(pid);
  }

  const [, , parentPid, user, status, startTime, command] = match;

  const argsResult = await runCommand("ps", ["-p", String(pid), "-o", "args="]);
  const commandLine = argsResult.ok ? argsResult.stdout.trim() : undefined;

  return {
    ...process,
    pid,
    name: basename(command) || process.name,
    parentPid: Number.parseInt(parentPid, 10),
    user: user === "-" ? undefined : user,
    status,
    startTime,
    executablePath:
      command.includes("/") || command.includes("\\") ? command : undefined,
    commandLine: commandLine || undefined,
  };
}

interface WindowsCimProcess {
  ProcessId?: number;
  ParentProcessId?: number;
  Name?: string;
  CommandLine?: string | null;
  ExecutablePath?: string | null;
  CreationDate?: string | { toString(): string } | null;
}

async function inspectWindows(
  process: ProcessInfo,
  pid: number,
): Promise<ProcessInfo> {
  const tasklist = await runCommand("tasklist", [
    "/FI",
    `PID eq ${pid}`,
    "/FO",
    "CSV",
    "/NH",
  ]);

  if (tasklist.ok && /No tasks are running/i.test(tasklist.stdout)) {
    throw new ProcessNotFoundError(pid);
  }

  let name = process.name;
  if (tasklist.ok) {
    const nameMatch = /^"([^"]+)"/.exec(tasklist.stdout.trim());
    if (nameMatch) {
      name = nameMatch[1];
    }
  }

  const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress } else { 'null' }`;
  const cim = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);

  let details: WindowsCimProcess | null = null;
  if (cim.ok && cim.stdout.trim() !== "null") {
    try {
      details = JSON.parse(cim.stdout.trim()) as WindowsCimProcess;
    } catch {
      details = null;
    }
  }

  if (!details && (!tasklist.ok || tasklist.stdout.trim() === "")) {
    const alive = await systemIsAlive(pid);
    if (!alive) {
      throw new ProcessNotFoundError(pid);
    }
  }

  return {
    ...process,
    pid,
    name: details?.Name ?? name,
    parentPid: details?.ParentProcessId,
    executablePath: details?.ExecutablePath ?? undefined,
    commandLine: details?.CommandLine ?? undefined,
    startTime: details?.CreationDate ? String(details.CreationDate) : undefined,
  };
}

/** Enrich a discovered listener with details that require a second lookup. */
export async function inspectProcess(
  process: ProcessInfo,
): Promise<ProcessInfo> {
  if (process.pid === null) {
    return process;
  }

  const pid = process.pid;
  const platform = detectPlatform();

  if (platform === "windows") {
    return inspectWindows(process, pid);
  }

  return inspectUnix(process, pid);
}

async function systemIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function unixIdentity(pid: number): Promise<ProcessIdentity | null> {
  const result = await runCommand("ps", [
    "-p",
    String(pid),
    "-o",
    "pid=,lstart=,comm=",
  ]);

  if (!result.ok) {
    const alive = await systemIsAlive(pid);
    if (!alive) {
      return null;
    }
    throw new Error(
      result.stderr.trim() || "Could not verify the process identity with ps",
    );
  }

  const match =
    /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(
      result.stdout.trim(),
    );

  if (!match) {
    return { pid, name: "" };
  }

  return {
    pid,
    name: basename(match[3].trim()),
    startTime: match[2],
  };
}

async function windowsTasklistIdentity(
  pid: number,
): Promise<ProcessIdentity | null> {
  const result = await runCommand("tasklist", [
    "/FI",
    `PID eq ${pid}`,
    "/FO",
    "CSV",
    "/NH",
  ]);

  if (!result.ok || /No tasks are running/i.test(result.stdout)) {
    return null;
  }

  const match = /^"([^"]+)"/.exec(result.stdout.trim());
  return match ? { pid, name: match[1] } : null;
}

async function windowsIdentity(pid: number): Promise<ProcessIdentity | null> {
  const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p | Select-Object ProcessId,Name,CreationDate | ConvertTo-Json -Compress } else { 'null' }`;
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);

  if (result.ok && result.stdout.trim() === "null") {
    // CIM positively reports that the PID no longer exists.
    return null;
  }

  if (result.ok) {
    try {
      const parsed = JSON.parse(result.stdout.trim()) as {
        Name?: string;
        CreationDate?: string | { toString(): string };
      };
      return {
        pid,
        name: parsed.Name ?? "",
        startTime: parsed.CreationDate
          ? String(parsed.CreationDate)
          : undefined,
      };
    } catch {
      // Fall through to tasklist below.
    }
  }

  return windowsTasklistIdentity(pid);
}

/**
 * Snapshot identity used to detect PID reuse. Returns null when the process
 * no longer exists.
 */
export async function getProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | null> {
  if (detectPlatform() === "windows") {
    return windowsIdentity(pid);
  }
  return unixIdentity(pid);
}
