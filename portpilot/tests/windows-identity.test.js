"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");

const {
  getProcessIdentity,
  inspectProcess,
} = require("../dist/process/inspector.js");
const { terminateProcess } = require("../dist/process/terminator.js");

const PID = 4321;

/**
 * Simulate the Windows inspector with a CIM lookup that times out and a
 * tasklist fallback that still reports the process name.
 */
function fakeWindowsAfterCimTimeout() {
  const originalExecFile = childProcess.execFile;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const calls = [];

  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });

  childProcess.execFile = (file, args, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    calls.push({ file, args });

    if (file === "tasklist") {
      process.nextTick(() =>
        done(null, `"node.exe","${PID}","Console","1","12,345 K"\r\n`, ""),
      );
      return;
    }

    if (file === "powershell.exe") {
      const error = new Error("Command failed: powershell.exe");
      error.code = "ETIMEDOUT";
      error.killed = true;
      process.nextTick(() => done(error, "", ""));
      return;
    }

    const error = new Error(`unexpected command: ${file}`);
    error.code = "ENOENT";
    process.nextTick(() => done(error, "", ""));
  };

  return {
    calls,
    restore() {
      childProcess.execFile = originalExecFile;
      Object.defineProperty(process, "platform", originalPlatform);
    },
  };
}

test("inspection still succeeds when the CIM lookup times out", async () => {
  const fake = fakeWindowsAfterCimTimeout();
  try {
    const details = await inspectProcess({
      pid: PID,
      name: "PID 4321",
      localAddress: "127.0.0.1:3000",
      port: 3000,
      protocol: "TCP",
    });

    assert.equal(details.pid, PID);
    assert.equal(details.name, "node.exe");
    assert.equal(details.startTime, undefined);
    assert.equal(details.commandLine, undefined);
    assert.deepEqual(fake.calls.map((call) => call.file).sort(), [
      "powershell.exe",
      "tasklist",
    ]);
  } finally {
    fake.restore();
  }
});

test("the tasklist fallback has no start-time marker", async () => {
  const fake = fakeWindowsAfterCimTimeout();
  try {
    const identity = await getProcessIdentity(PID);

    assert.equal(identity.pid, PID);
    assert.equal(identity.name, "node.exe");
    assert.equal(identity.startTime, undefined);
  } finally {
    fake.restore();
  }
});

test("a CIM timeout cannot confirm a target that has a start-time marker", async () => {
  const fake = fakeWindowsAfterCimTimeout();
  let signals = 0;
  let confirmations = 0;

  try {
    const report = await terminateProcess(
      {
        pid: PID,
        name: "node.exe",
        startTime: "2026-11-20T10:00:00.000Z",
      },
      {
        confirm: async () => {
          confirmations += 1;
          return true;
        },
        forceConfirm: async () => true,
        ops: {
          isAlive: async () => true,
          getIdentity: () => getProcessIdentity(PID),
          terminate: async () => {
            signals += 1;
          },
        },
      },
    );

    assert.equal(report.status, "refused");
    assert.match(report.message, /start time/i);
    assert.equal(confirmations, 0);
    assert.equal(signals, 0);
  } finally {
    fake.restore();
  }
});

test("a target captured during a CIM timeout cannot be terminated", async () => {
  const fake = fakeWindowsAfterCimTimeout();
  let signals = 0;
  let confirmations = 0;

  try {
    const details = await inspectProcess({
      pid: PID,
      name: "PID 4321",
      localAddress: "127.0.0.1:3000",
      port: 3000,
      protocol: "TCP",
    });
    assert.equal(details.startTime, undefined);

    const report = await terminateProcess(
      { pid: details.pid, name: details.name, startTime: details.startTime },
      {
        confirm: async () => {
          confirmations += 1;
          return true;
        },
        forceConfirm: async () => true,
        ops: {
          isAlive: async () => true,
          getIdentity: () => getProcessIdentity(PID),
          terminate: async () => {
            signals += 1;
          },
        },
      },
    );

    assert.equal(report.status, "refused");
    assert.match(report.message, /no start-time marker/i);
    assert.match(report.message, /manually/i);
    assert.equal(confirmations, 0);
    assert.equal(signals, 0);
  } finally {
    fake.restore();
  }
});
