"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const {
  findListenersOnPort,
  listListeningPorts,
} = require("../dist/discovery/index.js");
const { inspectProcess } = require("../dist/process/inspector.js");

const fixture = path.join(__dirname, "fixtures", "server.js");

function listen(host, port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(() => {});
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function portOf(server) {
  return server.address().port;
}

function startFixture(host, port = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT_PILOT_TEST_HOST: host,
        PORT_PILOT_TEST_PORT: String(port),
      },
    });

    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`fixture ${host}:${port} did not start: ${output}`));
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

async function stopFixture(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

test("discovers a real loopback listener and its PID", async () => {
  const server = await listen("127.0.0.1");
  try {
    const result = await findListenersOnPort(portOf(server));
    assert.equal(result.listening, true);
    assert.ok(result.processes.length >= 1);
    assert.ok(
      result.processes.some((entry) => entry.pid === process.pid),
      "expected the test process to be reported as the listener",
    );
  } finally {
    await close(server);
  }
});

test("reports a closed port as available", async () => {
  const server = await listen("127.0.0.1");
  const port = portOf(server);
  await close(server);

  const result = await findListenersOnPort(port);
  assert.equal(result.listening, false);
  assert.equal(result.processes.length, 0);
});

test("lists all listeners including the controlled server", async () => {
  const server = await listen("127.0.0.1");
  try {
    const result = await listListeningPorts();
    assert.equal(result.listening, true);
    assert.ok(
      result.processes.some(
        (entry) => entry.port === portOf(server) && entry.pid === process.pid,
      ),
    );
  } finally {
    await close(server);
  }
});

test("inspects a discovered process without modifying it", async () => {
  const server = await listen("127.0.0.1");
  try {
    const result = await findListenersOnPort(portOf(server));
    const listener = result.processes.find(
      (entry) => entry.pid === process.pid,
    );
    assert.ok(listener);

    const details = await inspectProcess(listener);
    assert.equal(details.pid, process.pid);
    assert.ok(details.name);
    assert.match(details.commandLine ?? "", /node/);

    // Inspection is read-only: the listener is still alive afterwards.
    assert.equal(server.listening, true);
  } finally {
    await close(server);
  }
});

test("reports multiple distinct processes listening on one port", async (t) => {
  const first = await startFixture("127.0.0.1");
  let second;

  try {
    second = await startFixture("::1", first.port);
  } catch (error) {
    await stopFixture(first.child);
    t.skip(`dual-stack listeners unavailable: ${error.message}`);
    return;
  }

  try {
    const result = await findListenersOnPort(first.port);
    const pids = new Set(result.processes.map((entry) => entry.pid));
    assert.equal(result.listening, true);
    assert.ok(pids.has(first.child.pid), "expected first fixture PID");
    assert.ok(pids.has(second.child.pid), "expected second fixture PID");
    assert.notEqual(first.child.pid, second.child.pid);
  } finally {
    await stopFixture(first.child);
    await stopFixture(second.child);
  }
});

test("reports a missing process during inspection", async () => {
  await assert.rejects(
    inspectProcess({
      pid: 2147483646,
      name: "missing",
      localAddress: "127.0.0.1:1",
      port: 1,
      protocol: "TCP",
    }),
    /no longer running|ps/i,
  );
});

test("Linux /proc fallback discovers a real listener", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux-only /proc discovery test");
    return;
  }

  const { findWithProc } = require("../dist/discovery/platforms/linux.js");
  const server = await listen("127.0.0.1");
  try {
    const result = await findWithProc(portOf(server));
    assert.ok(
      result.listeners.some((listener) => listener.pid === process.pid),
      "expected /proc fallback to resolve the test process",
    );
  } finally {
    await close(server);
  }
});
