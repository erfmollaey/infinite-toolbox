import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cmdFind, cmdFree, cmdInspect, cmdList, cmdPort } from "./commands";

function getVersion(): string {
  try {
    const raw = readFileSync(
      join(__dirname, "..", "..", "package.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function printHelp(): void {
  console.log(`
PortPilot ${getVersion()} — inspect and free TCP ports

Usage:
  portpilot <port>            Inspect a port and choose an action
  portpilot list              List all TCP listening endpoints
  portpilot find <port>       Show processes listening on a port
  portpilot inspect <port>    Show detailed process information
  portpilot free <port>       Safely terminate processes on a port

Options:
  -h, --help                  Show this help
  -v, --version               Show the version

Examples:
  portpilot 3000
  portpilot list
  portpilot inspect 3000
  portpilot free 3000

Termination is interactive and requires explicit confirmation. PortPilot
never escalates privileges and never kills a process it cannot revalidate.
`);
}

export function printVersion(): void {
  console.log(getVersion());
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    printVersion();
    return 0;
  }

  try {
    switch (command) {
      case "list":
        return await cmdList();
      case "find":
        return await cmdFind(rest[0]);
      case "inspect":
        return await cmdInspect(rest[0]);
      case "free":
        return await cmdFree(rest[0]);
      default:
        if (/^\d+$/.test(command)) {
          return await cmdPort(command);
        }
        console.error(`Unknown command: ${command}`);
        printHelp();
        return 1;
    }
  } catch (error) {
    console.error(`Unexpected error: ${(error as Error).message}`);
    return 1;
  }
}
