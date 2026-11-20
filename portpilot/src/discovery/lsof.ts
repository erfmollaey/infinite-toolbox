import {
  isMissingCommand,
  isPermissionError,
  isTimeout,
  runCommand,
} from "../utils/exec";
import type { RawListener, DiscoveryOutcome } from "./types";

/** Parse `lsof -F pcPn` field output into listening endpoints. */
export function parseLsofOutput(
  output: string,
  filterPort?: number,
): RawListener[] {
  const listeners: RawListener[] = [];
  let current: { pid: number; name?: string } | null = null;

  for (const line of output.split("\n")) {
    if (line.length < 2) {
      continue;
    }

    const field = line[0];
    const value = line.slice(1);

    if (field === "p") {
      const pid = Number.parseInt(value, 10);
      current = Number.isInteger(pid) && pid > 0 ? { pid } : null;
      continue;
    }

    if (!current) {
      continue;
    }

    if (field === "c") {
      current.name = value.trim();
      continue;
    }

    if (field !== "n" || value.includes("->")) {
      continue;
    }

    const endpoint = parseLsofAddress(value);
    if (!endpoint) {
      continue;
    }
    if (filterPort !== undefined && endpoint.port !== filterPort) {
      continue;
    }

    listeners.push({
      pid: current.pid,
      name: current.name,
      localAddress: `${endpoint.address}:${endpoint.port}`,
      port: endpoint.port,
      protocol: "TCP",
    });
  }

  return dedupeListeners(listeners);
}

export function parseLsofAddress(
  value: string,
): { address: string; port: number } | null {
  const match = /^(.*):(\d{1,5})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const address = match[1];
  const port = Number.parseInt(match[2], 10);
  if (!address || port < 1 || port > 65535) {
    return null;
  }

  return { address, port };
}

export function dedupeListeners(listeners: RawListener[]): RawListener[] {
  const seen = new Set<string>();
  return listeners.filter((listener) => {
    const key = `${listener.pid ?? "?"}|${listener.protocol}|${listener.localAddress}|${listener.port}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Query lsof for TCP listeners. Used by both macOS and Linux, with each
 * platform deciding how to fall back when lsof is missing or restricted.
 */
export async function findWithLsof(port?: number): Promise<DiscoveryOutcome> {
  const args = ["-nP", port === undefined ? "-iTCP" : `-iTCP:${port}`];
  args.push("-sTCP:LISTEN", "-F", "pcPn");

  const result = await runCommand("lsof", args);

  if (!result.ok) {
    if (isMissingCommand(result)) {
      return {
        listeners: [],
        errors: [
          {
            code: "unavailable",
            message: "lsof is not installed or not on PATH",
          },
        ],
      };
    }
    if (isTimeout(result)) {
      return {
        listeners: [],
        errors: [
          { code: "timeout", message: "lsof timed out while scanning ports" },
        ],
      };
    }

    const listeners = parseLsofOutput(result.stdout, port);
    if (listeners.length > 0) {
      return { listeners, errors: [] };
    }

    if (isPermissionError(result)) {
      return {
        listeners: [],
        errors: [
          {
            code: "permission",
            message:
              "lsof was denied access to some processes; results may be incomplete",
          },
        ],
      };
    }

    // lsof exits 1 when nothing matches, which is not an error.
    if (result.code === 1 && result.stdout.trim() === "") {
      return { listeners: [], errors: [] };
    }

    return {
      listeners: [],
      errors: [
        {
          code: "unknown",
          message: `lsof failed: ${result.stderr.trim() || result.message}`,
        },
      ],
    };
  }

  return { listeners: parseLsofOutput(result.stdout, port), errors: [] };
}
