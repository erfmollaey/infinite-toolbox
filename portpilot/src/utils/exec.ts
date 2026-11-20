import { execFile } from "node:child_process";

export interface CommandFailure {
  ok: false;
  code: string | number | null;
  message: string;
  stdout: string;
  stderr: string;
}

export interface CommandSuccess {
  ok: true;
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface RunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

/**
 * Run an executable directly (never through a shell) with a hard timeout.
 *
 * Non-zero exit codes are returned as failures rather than thrown, because
 * tools such as lsof and netstat use exit code 1 for "no matches".
 */
export function runCommand(
  file: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const timeout = options.timeoutMs ?? 8000;
  const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, maxBuffer, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        const out = stdout ?? "";
        const err = stderr ?? "";

        if (!error) {
          resolve({ ok: true, code: 0, stdout: out, stderr: err });
          return;
        }

        const errorCode = (error as NodeJS.ErrnoException).code ?? null;
        resolve({
          ok: false,
          code: errorCode,
          message: error.message,
          stdout: out,
          stderr: err,
        });
      },
    );
  });
}

export function isMissingCommand(result: CommandResult): boolean {
  return !result.ok && result.code === "ENOENT";
}

export function isTimeout(result: CommandResult): boolean {
  return (
    !result.ok &&
    (result.code === "ETIMEDOUT" || /timed? ?out/i.test(result.message))
  );
}

export function isPermissionError(result: CommandResult): boolean {
  if (result.ok) {
    return false;
  }
  return (
    result.code === "EACCES" ||
    result.code === "EPERM" ||
    /permission denied|operation not permitted/i.test(
      `${result.message}\n${result.stderr}`,
    )
  );
}
