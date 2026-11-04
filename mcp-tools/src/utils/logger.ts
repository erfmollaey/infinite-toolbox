/**
 * Diagnostic logger that writes ONLY to process.stderr.
 * stdout is strictly reserved for MCP JSON-RPC protocol communication.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] [Infinity-MCP] ${message}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      process.stderr.write(`${formatMessage('debug', message)} ${args.length ? JSON.stringify(args) : ''}\n`);
    }
  },

  info(message: string, ...args: unknown[]): void {
    process.stderr.write(`${formatMessage('info', message)} ${args.length ? JSON.stringify(args) : ''}\n`);
  },

  warn(message: string, ...args: unknown[]): void {
    process.stderr.write(`${formatMessage('warn', message)} ${args.length ? JSON.stringify(args) : ''}\n`);
  },

  error(message: string, ...args: unknown[]): void {
    process.stderr.write(`${formatMessage('error', message)} ${args.length ? JSON.stringify(args) : ''}\n`);
  }
};
