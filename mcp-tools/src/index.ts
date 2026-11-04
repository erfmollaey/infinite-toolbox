/**
 * Main entry point for the Infinity MCP Toolbox.
 * Starts the MCP server using stdio transport.
 */

import { startServer } from './server.js';
import { logger } from './utils/logger.js';

// Start the server
startServer().catch((err) => {
  logger.error('Failed to start MCP server', { error: String(err) });
  process.exit(1);
});