"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const { findListenersOnPort } = require("../dist/discovery/index.js");
const { inspectProcess } = require("../dist/process/inspector.js");
const { terminateProcess } = require("../dist/process/terminator.js");

const fixture = path.join(__dirname, "fixtures", "server.js");

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

async function waitForExit(child, timeoutMs = 3000) {
  if (!isRunning(child)) {
    return true;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopServer(child) {
  if (!isRunning(child)) {
    return;
  }
  child.kill("SIGKILL");
  await waitForExit(child);
}

async function targetFor({ child, port }) {
  const result = await findListenersOnPort(port);
  const listener = result.processes.find((entry) => entry.pid === child.pid);
  assert.ok(listener, `discovery should report PID ${child.pid} on ${port}`);
  const details = await inspectProcess(listener);
  return {
    pid: details.pid,
    name: details.name,
    startTime: details.startTime,
  };
}

test("terminates a controlled listener with explicit confirmation", async () => {
  const server = await startServer();
  try {
    const report = await terminateProcess(await targetFor(server), {
      confirm: async () => true,
      // Windows can refuse a non-forced taskkill for console processes, in
      // which case the workflow must ask again before forcing.
      forceConfirm: async () => process.platform === "win32",
      graceTimeoutMs: 3000,
      pollIntervalMs: 50,
    });

    assert.ok(
      report.status === "terminated" || report.status === "force-terminated",
      `unexpected status: ${report.status} (${report.message})`,
    );
    assert.equal(await waitForExit(server.child), true);
  } finally {
    await stopServer(server.child);
  }
});

test("a failed graceful signal still requires a second confirmation to force", async () => {
  let forced = false;
  let forceConfirmations = 0;

  const ops = {
    isAlive: async () => !forced,
    getIdentity: async (pid) => ({ pid, name: "node", startTime: "same" }),
    terminate: async (_pid, force) => {
      if (force) {
        forced = true;
        return;
      }
      throw new Error(
        "This process can only be terminated forcefully (with /F option)",
      );
    },
  };

  const report = await terminateProcess(
    { pid: 1234, name: "node", startTime: "same" },
    {
      confirm: async () => true,
      forceConfirm: async () => {
        forceConfirmations += 1;
        return true;
      },
      ops,
      graceTimeoutMs: 100,
      pollIntervalMs: 10,
    },
  );

  assert.equal(forceConfirmations, 1);
  assert.equal(report.status, "force-terminated");
  assert.equal(forced, true);
});

test("cancellation sends no signal", async () => {
  const server = await startServer();
  try {
    const report = await terminateProcess(await targetFor(server), {
      confirm: async () => false,
      forceConfirm: async () => true,
      graceTimeoutMs: 500,
      pollIntervalMs: 50,
    });

    assert.equal(report.status, "cancelled");
    assert.equal(isRunning(server.child), true);

    const stillListening = await findListenersOnPort(server.port);
    assert.equal(stillListening.listening, true);
  } finally {
    await stopServer(server.child);
  }
});

test("declining force termination leaves the process running", async () => {
  const server = await startServer(["--ignore-term"]);
  try {
    const report = await terminateProcess(await targetFor(server), {
      confirm: async () => true,
      forceConfirm: async () => false,
      graceTimeoutMs: 500,
      pollIntervalMs: 50,
    });

    if (process.platform === "win32") {
      // taskkill without /F may either close a console process or refuse it.
      assert.ok(
        report.status === "force-declined" || report.status === "terminated",
        `unexpected status: ${report.status} (${report.message})`,
      );
    } else {
      assert.equal(report.status, "force-declined");
    }
    assert.equal(isRunning(server.child), report.status === "force-declined");
  } finally {
    await stopServer(server.child);
  }
});

test("second confirmation allows force termination after graceful failure", async () => {
  const server = await startServer(["--ignore-term"]);
  try {
    const report = await terminateProcess(await targetFor(server), {
      confirm: async () => true,
      forceConfirm: async () => true,
      graceTimeoutMs: 500,
      forceTimeoutMs: 2000,
      pollIntervalMs: 50,
    });

    if (process.platform === "win32") {
      // Windows may complete the graceful request instead of needing force.
      assert.ok(
        report.status === "force-terminated" || report.status === "terminated",
        `unexpected status: ${report.status} (${report.message})`,
      );
    } else {
      assert.equal(report.status, "force-terminated");
    }
    assert.equal(await waitForExit(server.child), true);
  } finally {
    await stopServer(server.child);
  }
});

test("permission errors are reported without escalation", async () => {
  let confirmations = 0;
  const ops = {
    isAlive: async () => true,
    getIdentity: async (pid) => ({ pid, name: "node", startTime: "same" }),
    terminate: async () => {
      const error = new Error("Operation not permitted");
      error.code = "EPERM";
      throw error;
    },
  };

  const report = await terminateProcess(
    { pid: 1234, name: "node", startTime: "same" },
    {
      confirm: async () => {
        confirmations += 1;
        return true;
      },
      forceConfirm: async () => true,
      ops,
      graceTimeoutMs: 100,
      pollIntervalMs: 10,
    },
  );

  assert.equal(confirmations, 1);
  assert.equal(report.status, "permission-denied");
  assert.match(report.message, /does not escalate privileges/);
});

test("PID reuse is refused before any signal is sent", async () => {
  let signals = 0;
  const ops = {
    isAlive: async () => true,
    getIdentity: async (pid) => ({
      pid,
      name: "node",
      startTime: "different-start-time",
    }),
    terminate: async () => {
      signals += 1;
    },
  };

  const report = await terminateProcess(
    { pid: 1234, name: "node", startTime: "original-start-time" },
    {
      confirm: async () => true,
      forceConfirm: async () => true,
      ops,
    },
  );

  assert.equal(report.status, "refused");
  assert.match(report.message, /reused/);
  assert.equal(signals, 0);
});

test("exited processes are reported as already gone", async () => {
  let confirmations = 0;
  const ops = {
    isAlive: async () => false,
    getIdentity: async () => null,
    terminate: async () => {},
  };

  const report = await terminateProcess(
    { pid: 1234, name: "node" },
    {
      confirm: async () => {
        confirmations += 1;
        return true;
      },
      forceConfirm: async () => true,
      ops,
    },
  );

  assert.equal(report.status, "already-gone");
  assert.equal(confirmations, 0);
});

test("PID 1 and PortPilot itself are always refused", async () => {
  const ops = {
    isAlive: async () => true,
    getIdentity: async (pid) => ({ pid, name: "init" }),
    terminate: async () => {
      throw new Error("must not be called");
    },
  };

  const init = await terminateProcess(
    { pid: 1, name: "init" },
    { confirm: async () => true, forceConfirm: async () => true, ops },
  );
  assert.equal(init.status, "refused");

  const self = await terminateProcess(
    { pid: process.pid, name: "node" },
    { confirm: async () => true, forceConfirm: async () => true, ops },
  );
  assert.equal(self.status, "refused");
  assert.match(self.message, /PortPilot itself/);
});
