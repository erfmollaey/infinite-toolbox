import { findListenersOnPort, listListeningPorts } from "../discovery";
import { inspectProcess, ProcessNotFoundError } from "../process/inspector";
import {
  terminateProcess,
  type TerminationTarget,
} from "../process/terminator";
import type {
  DiscoveryError,
  InspectionResult,
  ProcessInfo,
  TerminationReport,
} from "../types";
import {
  formatProcessDetails,
  formatProcessSummary,
  formatProcessTable,
  style,
  symbols,
} from "../utils/formatter";
import { parsePort } from "../utils/validator";
import { createInteractivePrompter } from "./prompt";

function printErrors(errors: DiscoveryError[]): void {
  for (const error of errors) {
    console.error(`${style.yellow(symbols.warn)} ${error.message}`);
  }
}

function parsePortArgument(
  input: string | undefined,
  usage: string,
): number | null {
  if (input === undefined) {
    console.error(`${style.red(symbols.fail)} Missing port. Usage: ${usage}`);
    return null;
  }

  const result = parsePort(input);
  if (!result.valid || result.port === undefined) {
    console.error(`${style.red(symbols.fail)} ${result.error}`);
    return null;
  }

  return result.port;
}

/** Collapse multiple sockets owned by the same PID into one process entry. */
export function mergeProcesses(processes: ProcessInfo[]): ProcessInfo[] {
  const byPid = new Map<number, ProcessInfo>();
  const unknown: ProcessInfo[] = [];

  for (const process of processes) {
    if (process.pid === null) {
      if (
        !unknown.some((entry) => entry.localAddress === process.localAddress)
      ) {
        unknown.push(process);
      }
      continue;
    }

    const existing = byPid.get(process.pid);
    if (existing) {
      existing.localAddress = `${existing.localAddress}, ${process.localAddress}`;
    } else {
      byPid.set(process.pid, { ...process });
    }
  }

  return [...byPid.values(), ...unknown];
}

function printAvailability(port: number, result: InspectionResult): void {
  if (result.errors.length > 0) {
    console.log(
      `${style.yellow(symbols.warn)} No TCP listener found on port ${port}, but discovery was incomplete.`,
    );
    return;
  }

  console.log(`${style.green(symbols.ok)} Port ${port} is available.`);
}

function printListenerList(processes: ProcessInfo[]): void {
  for (const process of processes) {
    console.log(`  ${formatProcessSummary(process)}`);
  }

  if (processes.some((process) => process.pid === null)) {
    console.log(
      style.dim(
        "  Some listening sockets could not be mapped to a process (permissions or missing system tooling).",
      ),
    );
  }
}

function printOccupiedHeader(port: number, count: number): void {
  console.log(
    `${style.yellow(symbols.warn)} Port ${port} is occupied by ${count} process${count === 1 ? "" : "es"}:`,
  );
}

export async function cmdList(): Promise<number> {
  const result = await listListeningPorts();
  printErrors(result.errors);

  if (!result.listening) {
    if (result.errors.length > 0) {
      return 1;
    }
    console.log("No TCP listeners found.");
    return 0;
  }

  console.log(style.bold("\nTCP listeners\n"));
  console.log(formatProcessTable(result.processes));
  console.log(
    style.dim(
      `\n${result.processes.length} listening endpoint${result.processes.length === 1 ? "" : "s"} found.`,
    ),
  );

  return 0;
}

export async function cmdFind(portArg: string | undefined): Promise<number> {
  const port = parsePortArgument(portArg, "portpilot find <port>");
  if (port === null) {
    return 1;
  }

  const result = await findListenersOnPort(port);
  printErrors(result.errors);

  if (!result.listening) {
    printAvailability(port, result);
    return result.errors.length > 0 ? 1 : 0;
  }

  const processes = mergeProcesses(result.processes);
  printOccupiedHeader(port, processes.length);
  printListenerList(processes);
  return 0;
}

export async function cmdInspect(portArg: string | undefined): Promise<number> {
  const port = parsePortArgument(portArg, "portpilot inspect <port>");
  if (port === null) {
    return 1;
  }

  const result = await findListenersOnPort(port);
  printErrors(result.errors);

  if (!result.listening) {
    printAvailability(port, result);
    return result.errors.length > 0 ? 1 : 0;
  }

  const processes = mergeProcesses(result.processes);
  printOccupiedHeader(port, processes.length);

  let inspected = 0;
  let failures = 0;

  for (const process of processes) {
    if (process.pid === null) {
      console.log(
        `\n  ${style.bold("Unknown process")} ${style.dim(`(${process.protocol} ${process.localAddress})`)}`,
      );
      console.log(
        style.dim(
          "  The owning PID is not available with current permissions.",
        ),
      );
      continue;
    }

    try {
      const details = await inspectProcess(process);
      console.log(
        `\n  ${style.bold(`Process ${details.pid}`)} ${style.dim(`(${details.protocol} ${details.localAddress})`)}`,
      );
      console.log(formatProcessDetails(details));
      inspected += 1;
    } catch (error) {
      failures += 1;
      if (error instanceof ProcessNotFoundError) {
        console.log(
          `\n  ${style.yellow(symbols.warn)} PID ${process.pid} exited before its details could be read.`,
        );
      } else {
        console.log(
          `\n  ${style.red(symbols.fail)} Could not inspect PID ${process.pid}: ${(error as Error).message}`,
        );
      }
    }
  }

  console.log("");
  return failures > 0 && inspected === 0 ? 1 : 0;
}

function printTerminationReport(report: TerminationReport): void {
  const label = `PID ${report.pid} (${report.name})`;

  switch (report.status) {
    case "terminated":
    case "already-gone":
      console.log(`${style.green(symbols.ok)} ${report.message}.`);
      break;
    case "force-terminated":
      console.log(`${style.green(symbols.ok)} ${label}: ${report.message}.`);
      break;
    case "cancelled":
    case "force-declined":
      console.log(`${style.yellow(symbols.warn)} ${report.message}.`);
      break;
    case "permission-denied":
    case "refused":
    case "failed":
      console.error(`${style.red(symbols.fail)} ${label}: ${report.message}`);
      break;
  }
}

const FAILURE_STATUSES = new Set(["permission-denied", "refused", "failed"]);

export async function cmdFree(portArg: string | undefined): Promise<number> {
  const port = parsePortArgument(portArg, "portpilot free <port>");
  if (port === null) {
    return 1;
  }

  const result = await findListenersOnPort(port);
  printErrors(result.errors);

  if (!result.listening) {
    if (result.errors.length > 0) {
      console.error(
        `${style.red(symbols.fail)} Could not determine what is using port ${port}. No changes were made.`,
      );
      return 1;
    }
    console.log(`${style.green(symbols.ok)} Port ${port} is already free.`);
    return 0;
  }

  const processes = mergeProcesses(result.processes);
  printOccupiedHeader(port, processes.length);
  printListenerList(processes);

  const targets = processes.filter(
    (process): process is ProcessInfo & { pid: number } => process.pid !== null,
  );

  if (targets.length === 0) {
    console.error(
      `${style.red(symbols.fail)} Port ${port} is occupied, but PortPilot could not identify the owning process. Refusing to guess.`,
    );
    return 1;
  }

  const prompter = createInteractivePrompter();
  if (!prompter) {
    console.log(
      `\n${style.yellow(symbols.warn)} Termination requires an interactive terminal for confirmation. No changes were made.`,
    );
    return 1;
  }

  let exitCode = 0;

  try {
    for (const process of targets) {
      let inspected: ProcessInfo;
      try {
        inspected = await inspectProcess(process);
      } catch (error) {
        console.log(
          `${style.yellow(symbols.warn)} Could not read full details for PID ${process.pid}: ${(error as Error).message}`,
        );
        inspected = process;
      }

      console.log(
        `\n${style.bold(`Target: ${inspected.name} (PID ${inspected.pid})`)}`,
      );
      console.log(formatProcessDetails(inspected));
      console.log("");

      const target: TerminationTarget = {
        pid: process.pid,
        name: inspected.name,
        startTime: inspected.startTime,
      };

      const report = await terminateProcess(target, {
        confirm: (question) => prompter.confirm(question),
        forceConfirm: (question) => prompter.confirm(question),
      });

      printTerminationReport(report);

      if (FAILURE_STATUSES.has(report.status)) {
        exitCode = 1;
      }
    }
  } finally {
    prompter.close();
  }

  const remaining = await findListenersOnPort(port);
  if (remaining.errors.length > 0) {
    printErrors(remaining.errors);
  }

  if (remaining.listening) {
    console.log(
      `\n${style.yellow(symbols.warn)} Port ${port} still has ${remaining.processes.length} listening endpoint${remaining.processes.length === 1 ? "" : "s"}.`,
    );
    exitCode = exitCode === 0 ? 1 : exitCode;
  } else {
    console.log(`\n${style.green(symbols.ok)} Port ${port} is now free.`);
  }

  return exitCode;
}

export async function cmdPort(portArg: string): Promise<number> {
  const port = parsePortArgument(portArg, "portpilot <port>");
  if (port === null) {
    return 1;
  }

  const result = await findListenersOnPort(port);
  printErrors(result.errors);

  if (!result.listening) {
    printAvailability(port, result);
    return result.errors.length > 0 ? 1 : 0;
  }

  const processes = mergeProcesses(result.processes);
  printOccupiedHeader(port, processes.length);
  printListenerList(processes);

  const prompter = createInteractivePrompter();
  if (!prompter) {
    console.log(
      `\n${style.dim(`Non-interactive input. Run "portpilot inspect ${port}" for details or "portpilot free ${port}" to terminate a process.`)}`,
    );
    return 0;
  }

  console.log(`\n${style.bold("What would you like to do?")}`);
  console.log("  1) Inspect process details");
  console.log("  2) Free the port");
  console.log("  3) Cancel");

  const answer = await prompter.ask("> ");
  prompter.close();

  switch ((answer ?? "").trim()) {
    case "1":
      return cmdInspect(String(port));
    case "2":
      return cmdFree(String(port));
    case "3":
    case "":
      console.log(
        `${style.yellow(symbols.warn)} Cancelled. Nothing was changed.`,
      );
      return 0;
    default:
      console.log(
        `${style.yellow(symbols.warn)} Unrecognized choice. Nothing was changed.`,
      );
      return 0;
  }
}
