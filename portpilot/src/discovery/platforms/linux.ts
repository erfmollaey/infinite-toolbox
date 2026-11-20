import { promises as fs } from "node:fs";

import { dedupeListeners, findWithLsof } from "../lsof";
import type {
  DiscoveryOutcome,
  DiscoveryProvider,
  RawListener,
} from "../types";

export interface ProcSocket {
  address: string;
  port: number;
  inode: string;
}

function reverseBytes(hex: string): string {
  const bytes = hex.match(/../g) ?? [];
  return bytes.reverse().join("");
}

/** Convert the hex address format used by /proc/net/tcp{,6}. */
export function formatProcAddress(hex: string, ipv6: boolean): string | null {
  if (!ipv6) {
    if (hex.length !== 8) {
      return null;
    }
    const reversed = reverseBytes(hex);
    return [0, 2, 4, 6]
      .map((offset) => Number.parseInt(reversed.slice(offset, offset + 2), 16))
      .join(".");
  }

  if (hex.length !== 32) {
    return null;
  }

  const groups: string[] = [];
  for (let offset = 0; offset < 32; offset += 8) {
    groups.push(reverseBytes(hex.slice(offset, offset + 8)));
  }

  const matched = groups.join("").match(/.{4}/g);
  return matched ? matched.join(":") : null;
}

/** Parse /proc/net/tcp or /proc/net/tcp6, returning only LISTEN sockets. */
export function parseProcNetTcp(content: string, ipv6: boolean): ProcSocket[] {
  const sockets: ProcSocket[] = [];

  for (const line of content.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) {
      continue;
    }

    const [localHex, portHex] = fields[1].split(":");
    const state = fields[3].toUpperCase();
    const inode = fields[9];

    if (state !== "0A") {
      continue;
    }

    const address = formatProcAddress(localHex, ipv6);
    const port = Number.parseInt(portHex, 16);
    if (!address || !Number.isInteger(port) || port < 1 || port > 65535) {
      continue;
    }

    sockets.push({ address, port, inode });
  }

  return sockets;
}

/**
 * Resolve listening sockets to PIDs by scanning /proc/<pid>/fd.
 *
 * Processes owned by other users generally cannot be read without elevated
 * privileges; those endpoints are still reported with an unknown PID rather
 * than being hidden or causing a failure.
 */
export async function findWithProc(port?: number): Promise<DiscoveryOutcome> {
  const errors: DiscoveryOutcome["errors"] = [];
  const sockets: ProcSocket[] = [];

  for (const [file, ipv6] of [
    ["/proc/net/tcp", false],
    ["/proc/net/tcp6", true],
  ] as const) {
    try {
      const content = await fs.readFile(file, "utf8");
      sockets.push(...parseProcNetTcp(content, ipv6));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        errors.push({
          code: code === "EACCES" ? "permission" : "unavailable",
          message: `Could not read ${file}: ${(error as Error).message}`,
        });
      }
    }
  }

  const wanted =
    port === undefined
      ? sockets
      : sockets.filter((socket) => socket.port === port);
  const byInode = new Map(wanted.map((socket) => [socket.inode, socket]));

  if (byInode.size === 0) {
    return { listeners: [], errors };
  }

  const resolved = new Map<string, RawListener>();
  let denied = false;
  let procEntries: string[] = [];

  try {
    procEntries = await fs.readdir("/proc");
  } catch (error) {
    errors.push({
      code: "unavailable",
      message: `Could not scan /proc: ${(error as Error).message}`,
    });
    return { listeners: [], errors };
  }

  const pids = procEntries.filter((entry) => /^\d+$/.test(entry));

  for (const pidEntry of pids) {
    const pid = Number.parseInt(pidEntry, 10);
    let fds: string[];

    try {
      fds = await fs.readdir(`/proc/${pidEntry}/fd`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EACCES") {
        denied = true;
      }
      continue;
    }

    let name: string | undefined;
    for (const fd of fds) {
      let target: string;
      try {
        target = await fs.readlink(`/proc/${pidEntry}/fd/${fd}`);
      } catch {
        continue;
      }

      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (!match) {
        continue;
      }

      const socket = byInode.get(match[1]);
      if (!socket) {
        continue;
      }

      if (name === undefined) {
        try {
          name = (await fs.readFile(`/proc/${pidEntry}/comm`, "utf8")).trim();
        } catch {
          denied = true;
          name = "unknown";
        }
      }

      const key = `${pid}|${socket.address}|${socket.port}`;
      if (resolved.has(key)) {
        continue;
      }

      resolved.set(key, {
        pid,
        name,
        localAddress: `${socket.address}:${socket.port}`,
        port: socket.port,
        protocol: "TCP",
      });
    }
  }

  const listeners = [...resolved.values()];

  for (const socket of wanted) {
    const known = listeners.some(
      (listener) =>
        listener.port === socket.port &&
        listener.localAddress === `${socket.address}:${socket.port}`,
    );
    if (!known) {
      listeners.push({
        pid: null,
        name: "unknown",
        localAddress: `${socket.address}:${socket.port}`,
        port: socket.port,
        protocol: "TCP",
      });
    }
  }

  if (denied) {
    errors.push({
      code: "permission",
      message:
        "Some processes could not be inspected due to permissions; their PIDs are shown as unknown",
    });
  }

  return { listeners: dedupeListeners(listeners), errors };
}

export const linuxProvider: DiscoveryProvider = {
  name: "Linux (lsof, /proc fallback)",

  async findListeners(port?: number): Promise<DiscoveryOutcome> {
    const lsof = await findWithLsof(port);
    if (lsof.listeners.length > 0 || lsof.errors.length === 0) {
      return lsof;
    }

    const fallback = await findWithProc(port);
    if (fallback.listeners.length > 0) {
      return fallback;
    }

    return {
      listeners: fallback.listeners,
      errors: [...lsof.errors, ...fallback.errors].filter(
        (error, index, all) =>
          all.findIndex((candidate) => candidate.message === error.message) ===
          index,
      ),
    };
  },
};
