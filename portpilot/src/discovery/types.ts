import type { DiscoveryError, PortProtocol } from "../types";

export interface RawListener {
  pid: number | null;
  name?: string;
  localAddress: string;
  port: number;
  protocol: PortProtocol;
}

export interface DiscoveryOutcome {
  listeners: RawListener[];
  errors: DiscoveryError[];
}

export interface DiscoveryProvider {
  readonly name: string;
  findListeners(port?: number): Promise<DiscoveryOutcome>;
}
