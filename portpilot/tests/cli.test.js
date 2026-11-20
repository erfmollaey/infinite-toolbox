"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const root = path.join(__dirname, "..");
const cli = path.join(root, "cli.js");
const fixture = path.join(__dirname, "fixtures", "server.js");

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd: root, timeout: 20000, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function listen() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(() => {});
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function startServer(flags = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, ...flags], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`fixture did not start: ${output}`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = /^(\d+)/m.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve({ child, port: Number.parseInt(match[1], 10) });
      }
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function stopServer(child) {
  if (!isRunning(child)) {
    return;
  }
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

test("help and version are available", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /portpilot free <port>/);

  const version = await runCli(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("invalid ports fail with a clear message", async () => {
  const zero = await runCli(["0"]);
  assert.equal(zero.code, 1);
  assert.match(zero.stderr, /Port must be between 1 and 65535/);

  const malformed = await runCli(["3000abc"]);
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /Unknown command/);

  const missing = await runCli(["find"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Usage: portpilot find <port>/);
});

test("an available port is reported without listing processes", async () => {
  const server = await listen();
  const port = server.address().port;
  await close(server);

  const result = await runCli([String(port)]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /is available/);
});

test("list runs against the operating system", async () => {
  const result = await runCli(["list"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /TCP listeners|No TCP listeners found/);
});

test("occupied port is shown and does not prompt without a TTY", async () => {
  const server = await startServer();
  try {
    const result = await runCli([String(server.port)]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /is occupied/);
    assert.match(result.stdout, /Non-interactive input/);
    assert.equal(isRunning(server.child), true);
  } finally {
    await stopServer(server.child);
  }
});

test("free refuses to confirm without an interactive terminal", async () => {
  const server = await startServer();
  try {
    const result = await runCli(["free", String(server.port)]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /interactive terminal/);
    assert.equal(isRunning(server.child), true);
  } finally {
    await stopServer(server.child);
  }
});
