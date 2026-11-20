import type { InspectionResult, ProcessInfo } from "../types";
import { detectPlatform } from "../utils/platform";
import { linuxProvider } from "./platforms/linux";
import { macosProvider } from "./platforms/macos";
import { findOnWindows } from "./platforms/windows";
import type { DiscoveryProvider, RawListener } from "./types";

function toProcessInfo(listener: RawListener): ProcessInfo {
  return {
    pid: listener.pid,
    name: listener.name?.trim() || "unknown",
    localAddress: listener.localAddress,
    port: listener.port,
    protocol: listener.protocol,
  };
}

function sortProcesses(processes: ProcessInfo[]): ProcessInfo[] {
  return processes.sort((a, b) => {
    if (a.port !== b.port) {
      return a.port - b.port;
    }
    if (a.pid === b.pid) {
      return a.localAddress.localeCompare(b.localAddress);
    }
    if (a.pid === null) {
      return 1;
    }
    if (b.pid === null) {
      return -1;
    }
    return a.pid - b.pid;
  });
}

export function selectProvider(
  platform: NodeJS.Platform = process.platform,
): DiscoveryProvider | null {
  switch (detectPlatform(platform)) {
    case "macos":
      return macosProvider;
    case "linux":
      return linuxProvider;
    case "windows":
      return {
        name: "Windows (netstat / PowerShell)",
        findListeners: (port?: number) => findOnWindows(port),
      };
    default:
      return null;
  }
}

async function discover(port?: number): Promise<InspectionResult> {
  const provider = selectProvider();

  if (!provider) {
    return {
      port: port ?? null,
      listening: false,
      processes: [],
      errors: [
        {
          code: "unsupported",
          message: `Platform "${process.platform}" is not supported. PortPilot supports macOS, Linux, and Windows.`,
        },
      ],
    };
  }

  try {
    const outcome = await provider.findListeners(port);
    const filtered = outcome.listeners
      .filter((listener) => port === undefined || listener.port === port)
      .map(toProcessInfo);

    return {
      port: port ?? null,
      listening: filtered.length > 0,
      processes: sortProcesses(filtered),
      errors: outcome.errors,
    };
  } catch (error) {
    return {
      port: port ?? null,
      listening: false,
      processes: [],
      errors: [
        {
          code: "unknown",
          message: `Port discovery failed: ${(error as Error).message}`,
        },
      ],
    };
  }
}

/** Find TCP listeners on a specific port. */
export function findListenersOnPort(port: number): Promise<InspectionResult> {
  return discover(port);
}

/** List every TCP listening endpoint on the machine. */
export function listListeningPorts(): Promise<InspectionResult> {
  return discover(undefined);
}
