import { isMissingCommand, runCommand } from "../../utils/exec";
import { dedupeListeners, findWithLsof } from "../lsof";
import type {
  DiscoveryProvider,
  RawListener,
  DiscoveryOutcome,
} from "../types";

/**
 * Parse macOS `netstat -an -p tcp` output. This fallback can identify
 * listening endpoints but not owning PIDs unless lsof is available.
 */
export function parseMacNetstatOutput(
  output: string,
  filterPort?: number,
): RawListener[] {
  const listeners: RawListener[] = [];

  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) {
      continue;
    }

    const [proto, , , local, , state] = parts;
    if (!/^tcp/.test(proto) || state.toUpperCase() !== "LISTEN") {
      continue;
    }

    const match = /^(.*)\.(\d{1,5})$/.exec(local);
    if (!match) {
      continue;
    }

    const address = match[1];
    const port = Number.parseInt(match[2], 10);
    if (port < 1 || port > 65535) {
      continue;
    }
    if (filterPort !== undefined && port !== filterPort) {
      continue;
    }

    const host = address.includes(":") ? `[${address}]` : address;
    listeners.push({
      pid: null,
      name: "unknown",
      localAddress: `${host}:${port}`,
      port,
      protocol: "TCP",
    });
  }

  return dedupeListeners(listeners);
}

export async function findWithMacNetstat(
  port?: number,
): Promise<DiscoveryOutcome> {
  const result = await runCommand("netstat", ["-an", "-p", "tcp"]);

  if (!result.ok) {
    if (isMissingCommand(result)) {
      return {
        listeners: [],
        errors: [
          {
            code: "unavailable",
            message: "Neither lsof nor netstat is available on this system",
          },
        ],
      };
    }
    return {
      listeners: [],
      errors: [
        {
          code: "unknown",
          message: `netstat failed: ${result.stderr.trim() || result.message}`,
        },
      ],
    };
  }

  return { listeners: parseMacNetstatOutput(result.stdout, port), errors: [] };
}

export const macosProvider: DiscoveryProvider = {
  name: "macOS (lsof)",

  async findListeners(port?: number): Promise<DiscoveryOutcome> {
    const lsof = await findWithLsof(port);
    if (lsof.listeners.length > 0 || lsof.errors.length === 0) {
      return lsof;
    }

    // lsof is missing, timed out, or restricted. netstat can still show
    // listening endpoints, but not reliably which process owns them.
    const fallback = await findWithMacNetstat(port);
    const errors = [...lsof.errors, ...fallback.errors].filter(
      (error, index, all) =>
        all.findIndex((candidate) => candidate.message === error.message) ===
        index,
    );

    return {
      listeners: fallback.listeners,
      errors: fallback.listeners.length > 0 ? fallback.errors : errors,
    };
  },
};
