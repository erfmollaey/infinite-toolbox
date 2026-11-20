"use strict";

// Controlled listener used by integration tests. It only ever binds an
// ephemeral loopback port, so tests never touch unrelated services.
const net = require("node:net");

if (process.argv.includes("--ignore-term")) {
  process.on("SIGTERM", () => {
    // Deliberately ignore graceful termination to exercise force handling.
  });
}

const host = process.env.PORT_PILOT_TEST_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT_PILOT_TEST_PORT || "0", 10);

const server = net.createServer(() => {});
server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`${address.port}\n`);
});
