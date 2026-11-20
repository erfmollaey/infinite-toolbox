export type PortProtocol = "TCP" | "UDP";

/**
 * A listening endpoint discovered from the operating system.
 *
 * `pid` is null when the platform can report the listening socket but not
 * the owning process (for example a netstat fallback without permissions).
 */
export interface ProcessInfo {
  pid: number | null;
  name: string;
  localAddress: string;
  port: number;
  protocol: PortProtocol;
  commandLine?: string;
  user?: string;
  parentPid?: number;
  executablePath?: string;
  status?: string;
  startTime?: string;
}

export type DiscoveryErrorCode =
  "permission" | "unavailable" | "timeout" | "unsupported" | "unknown";

export interface DiscoveryError {
  code: DiscoveryErrorCode;
  message: string;
}

export interface InspectionResult {
  /** Requested port, or null when listing all listeners. */
  port: number | null;
  listening: boolean;
  processes: ProcessInfo[];
  errors: DiscoveryError[];
}

export interface ValidationResult {
  valid: boolean;
  port?: number;
  error?: string;
}

export type TerminationStatus =
  | "terminated"
  | "force-terminated"
  | "cancelled"
  | "force-declined"
  | "already-gone"
  | "permission-denied"
  | "refused"
  | "failed";

export interface TerminationReport {
  pid: number;
  name: string;
  status: TerminationStatus;
  message: string;
}

export interface ProcessIdentity {
  pid: number;
  name: string;
  /** Opaque start marker used to detect PID reuse. */
  startTime?: string;
}
