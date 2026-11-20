import { isMissingCommand, runCommand } from "../../utils/exec";
import { dedupeListeners } from "../lsof";
import type { RawListener, DiscoveryOutcome } from "../types";

export interface WindowsConnection {
  address: string;
  port: number;
  pid: number | null;
}

/** Parse `netstat -ano -p tcp` output, keeping only LISTENING sockets. */
export function parseNetstatOutput(
  output: string,
  filterPort?: number,
): WindowsConnection[] {
  const connections: WindowsConnection[] = [];

  for (const line of output.split("\n")) {
    const match = /^\s*TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!match) {
      continue;
    }

    const local = match[1];
    const endpoint = /^(.*):(\d+)$/.exec(local);
    if (!endpoint) {
      continue;
    }

    const port = Number.parseInt(endpoint[2], 10);
    if (port < 1 || port > 65535) {
      continue;
    }
    if (filterPort !== undefined && port !== filterPort) {
      continue;
    }

    const pid = Number.parseInt(match[3], 10);
    connections.push({
      address: `${endpoint[1]}:${port}`,
      port,
      pid: Number.isInteger(pid) ? pid : null,
    });
  }

  return connections;
}

export interface TasklistEntry {
  pid: number;
  name: string;
}

/** Parse `tasklist /FO CSV /NH` output. */
export function parseTasklistCsv(output: string): TasklistEntry[] {
  const entries: TasklistEntry[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith('"')) {
      continue;
    }

    const fields = line
      .slice(1, line.lastIndexOf('"'))
      .split('","')
      .map((field) => field.replace(/""/g, '"'));

    const pid = Number.parseInt(fields[1], 10);
    if (!Number.isInteger(pid) || !fields[0]) {
      continue;
    }

    entries.push({ pid, name: fields[0] });
  }

  return entries;
}

interface PowerShellConnection {
  LocalAddress?: string;
  LocalPort?: number;
  OwningProcess?: number;
}

/** Parse ConvertTo-Json output from Get-NetTCPConnection. */
export function parsePowerShellConnections(
  output: string,
  filterPort?: number,
): WindowsConnection[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: PowerShellConnection | PowerShellConnection[];
  try {
    parsed = JSON.parse(trimmed) as
      PowerShellConnection | PowerShellConnection[];
  } catch {
    return [];
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  const connections: WindowsConnection[] = [];

  for (const record of records) {
    const port = record.LocalPort;
    const rawAddress = record.LocalAddress;
    if (
      typeof port !== "number" ||
      port < 1 ||
      port > 65535 ||
      typeof rawAddress !== "string"
    ) {
      continue;
    }
    if (filterPort !== undefined && port !== filterPort) {
      continue;
    }

    const address = rawAddress.includes(":")
      ? `[${rawAddress}]:${port}`
      : `${rawAddress}:${port}`;

    connections.push({
      address,
      port,
      pid:
        typeof record.OwningProcess === "number" ? record.OwningProcess : null,
    });
  }

  return connections;
}

async function resolveProcessNames(): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  const result = await runCommand("tasklist", ["/FO", "CSV", "/NH"]);

  if (!result.ok) {
    return names;
  }

  for (const entry of parseTasklistCsv(result.stdout)) {
    names.set(entry.pid, entry.name);
  }

  return names;
}

async function findWithNetstat(
  filterPort?: number,
): Promise<DiscoveryOutcome | null> {
  const result = await runCommand("netstat", ["-ano", "-p", "tcp"]);
  if (!result.ok) {
    return null;
  }

  const names = await resolveProcessNames();
  const listeners: RawListener[] = parseNetstatOutput(
    result.stdout,
    filterPort,
  ).map((connection) => ({
    pid: connection.pid,
    name:
      connection.pid === null
        ? "unknown"
        : (names.get(connection.pid) ?? `PID ${connection.pid}`),
    localAddress: connection.address,
    port: connection.port,
    protocol: "TCP",
  }));

  return { listeners: dedupeListeners(listeners), errors: [] };
}

async function findWithPowerShell(
  filterPort?: number,
): Promise<DiscoveryOutcome | null> {
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress",
  ]);

  if (!result.ok) {
    return null;
  }

  const names = await resolveProcessNames();
  const listeners: RawListener[] = parsePowerShellConnections(
    result.stdout,
    filterPort,
  ).map((connection) => ({
    pid: connection.pid,
    name:
      connection.pid === null
        ? "unknown"
        : (names.get(connection.pid) ?? `PID ${connection.pid}`),
    localAddress: connection.address,
    port: connection.port,
    protocol: "TCP",
  }));

  return { listeners: dedupeListeners(listeners), errors: [] };
}

export async function findOnWindows(port?: number): Promise<DiscoveryOutcome> {
  const netstat = await findWithNetstat(port);
  if (netstat) {
    return netstat;
  }

  const powershell = await findWithPowerShell(port);
  if (powershell) {
    return powershell;
  }

  const probe = await runCommand("netstat", ["-ano", "-p", "tcp"]);
  const missing = isMissingCommand(probe)
    ? "netstat is not available"
    : "netstat failed";

  return {
    listeners: [],
    errors: [
      {
        code: "unavailable",
        message: `Could not enumerate TCP listeners: ${missing} and PowerShell Get-NetTCPConnection is unavailable`,
      },
    ],
  };
}
