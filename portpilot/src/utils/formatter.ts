import type { ProcessInfo } from "../types";

const colorsEnabled =
  process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);

function paint(text: string, code: string): string {
  return colorsEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const style = {
  bold: (text: string) => paint(text, "1"),
  dim: (text: string) => paint(text, "2"),
  red: (text: string) => paint(text, "31"),
  green: (text: string) => paint(text, "32"),
  yellow: (text: string) => paint(text, "33"),
  blue: (text: string) => paint(text, "34"),
  cyan: (text: string) => paint(text, "36"),
};

export const symbols = {
  ok: "✓",
  fail: "✗",
  warn: "!",
  bullet: "•",
  arrow: "→",
};

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Render a simple left-aligned text table without external dependencies. */
export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return "";
  }

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );

  const headerLine = headers
    .map((header, index) => pad(header, widths[index]))
    .join("  ");
  const separator = widths.map((width) => "─".repeat(width)).join("  ");
  const body = rows
    .map((row) => row.map((cell, index) => pad(cell, widths[index])).join("  "))
    .join("\n");

  return [style.bold(headerLine), style.dim(separator), body].join("\n");
}

export function formatProcessName(process: ProcessInfo): string {
  return process.name || "unknown";
}

export function formatPid(process: ProcessInfo): string {
  return process.pid === null ? "?" : String(process.pid);
}

/** One-line description used by find/<port> output. */
export function formatProcessSummary(process: ProcessInfo): string {
  const pid = formatPid(process);
  return `${style.bold(formatProcessName(process))} ${style.dim(`(PID ${pid})`)}`.concat(
    `\n    ${process.protocol} ${process.localAddress}`,
  );
}

export function formatProcessDetails(process: ProcessInfo): string {
  const rows: Array<[string, string | undefined]> = [
    ["PID", formatPid(process)],
    ["Process", formatProcessName(process)],
    ["Port", String(process.port)],
    ["Protocol", process.protocol],
    ["Local address", process.localAddress],
    ["User", process.user],
    [
      "Parent PID",
      process.parentPid === undefined ? undefined : String(process.parentPid),
    ],
    ["Executable", process.executablePath],
    ["Status", process.status],
    ["Started", process.startTime],
    ["Command", process.commandLine],
  ];

  return rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([label, value]) => `  ${style.dim(pad(label, 14))}${value}`)
    .join("\n");
}

export function formatProcessTable(processes: ProcessInfo[]): string {
  return renderTable(
    ["PORT", "PID", "PROCESS", "ADDRESS"],
    processes.map((process) => [
      String(process.port),
      formatPid(process),
      formatProcessName(process),
      process.localAddress,
    ]),
  );
}
