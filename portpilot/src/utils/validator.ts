import type { ValidationResult } from "../types";

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MAX_PID = 2147483647;

/** Parse a port argument, rejecting partial numbers such as "3000abc". */
export function parsePort(input: unknown): ValidationResult {
  if (typeof input === "number") {
    return validatePort(input);
  }

  if (typeof input !== "string") {
    return { valid: false, error: "Port must be a number" };
  }

  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return {
      valid: false,
      error: `Invalid port "${input}": expected a whole number`,
    };
  }

  return validatePort(Number.parseInt(trimmed, 10));
}

export function validatePort(port: number): ValidationResult {
  if (!Number.isInteger(port)) {
    return { valid: false, error: "Port must be an integer" };
  }

  if (port < MIN_PORT || port > MAX_PORT) {
    return {
      valid: false,
      port,
      error: `Port must be between ${MIN_PORT} and ${MAX_PORT}`,
    };
  }

  return { valid: true, port };
}

export function isValidPort(port: number): boolean {
  return validatePort(port).valid;
}

export function validatePid(pid: unknown): ValidationResult {
  if (
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    pid < 1 ||
    pid > MAX_PID
  ) {
    return { valid: false, error: "PID must be a positive integer" };
  }

  return { valid: true, port: pid };
}
