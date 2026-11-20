"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseLsofOutput,
  parseLsofAddress,
} = require("../dist/discovery/lsof.js");
const {
  parseMacNetstatOutput,
} = require("../dist/discovery/platforms/macos.js");
const {
  parseNetstatOutput,
  parseTasklistCsv,
  parsePowerShellConnections,
} = require("../dist/discovery/platforms/windows.js");
const {
  formatProcAddress,
  parseProcNetTcp,
} = require("../dist/discovery/platforms/linux.js");
const { protectedReason } = require("../dist/process/terminator.js");

test("parseLsofOutput handles multiple processes on one port", () => {
  const output = [
    "p100",
    "cnode",
    "PTCP",
    "n127.0.0.1:3000",
    "p200",
    "cpython3",
    "PTCP",
    "n[::1]:3000",
    "p300",
    "cother",
    "PTCP",
    "n*:4000",
  ].join("\n");

  const listeners = parseLsofOutput(output, 3000);
  assert.equal(listeners.length, 2);
  assert.deepEqual(
    listeners.map((listener) => [
      listener.pid,
      listener.name,
      listener.localAddress,
    ]),
    [
      [100, "node", "127.0.0.1:3000"],
      [200, "python3", "[::1]:3000"],
    ],
  );
});

test("parseLsofOutput skips established connections and deduplicates", () => {
  const output = [
    "p100",
    "cnode",
    "PTCP",
    "n127.0.0.1:3000",
    "n127.0.0.1:3000",
    "n127.0.0.1:3000->127.0.0.1:5555",
  ].join("\n");

  assert.equal(parseLsofOutput(output, 3000).length, 1);
  assert.equal(parseLsofOutput(output, 3000)[0].pid, 100);
});

test("parseLsofAddress validates endpoints", () => {
  assert.deepEqual(parseLsofAddress("[::1]:8080"), {
    address: "[::1]",
    port: 8080,
  });
  assert.equal(parseLsofAddress("not-a-socket"), null);
  assert.equal(parseLsofAddress("127.0.0.1:99999"), null);
});

test("parseMacNetstatOutput reads IPv4 and IPv6 listeners", () => {
  const output = [
    "Active Internet connections (including servers)",
    "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)",
    "tcp4       0      0  127.0.0.1.3000         *.*                    LISTEN",
    "tcp6       0      0  ::1.3000               *.*                    LISTEN",
    "tcp4       0      0  127.0.0.1.4000         *.*                    LISTEN",
    "udp4       0      0  *.5000                 *.*",
  ].join("\n");

  const listeners = parseMacNetstatOutput(output, 3000);
  assert.equal(listeners.length, 2);
  assert.deepEqual(
    listeners.map((listener) => listener.localAddress),
    ["127.0.0.1:3000", "[::1]:3000"],
  );
  assert.ok(listeners.every((listener) => listener.pid === null));
});

test("parseNetstatOutput reads Windows LISTENING sockets only", () => {
  const output = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000",
    "  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       4242",
    "  TCP    [::1]:3000             [::]:0                 LISTENING       4242",
    "  TCP    127.0.0.1:5000         127.0.0.1:6000         ESTABLISHED     9999",
  ].join("\r\n");

  const connections = parseNetstatOutput(output, 3000);
  assert.equal(connections.length, 2);
  assert.deepEqual(
    connections.map((connection) => connection.pid),
    [4242, 4242],
  );
  assert.equal(connections[1].address, "[::1]:3000");
});

test("parseTasklistCsv extracts PID and image name", () => {
  const output = [
    '"node.exe","4242","Console","1","120,000 K"',
    '"System Idle Process","0","Services","0","8 K"',
  ].join("\r\n");

  assert.deepEqual(parseTasklistCsv(output), [
    { pid: 4242, name: "node.exe" },
    { pid: 0, name: "System Idle Process" },
  ]);
});

test("parsePowerShellConnections handles arrays and single records", () => {
  const array = JSON.stringify([
    { LocalAddress: "0.0.0.0", LocalPort: 3000, OwningProcess: 4242 },
    { LocalAddress: "::", LocalPort: 3000, OwningProcess: 4242 },
  ]);
  const single = JSON.stringify({
    LocalAddress: "127.0.0.1",
    LocalPort: 3001,
    OwningProcess: 7,
  });

  assert.deepEqual(
    parsePowerShellConnections(array, 3000).map((entry) => entry.address),
    ["0.0.0.0:3000", "[::]:3000"],
  );
  assert.equal(parsePowerShellConnections(single).length, 1);
  assert.deepEqual(parsePowerShellConnections("not json"), []);
});

test("parseProcNetTcp reads LISTEN sockets and skips others", () => {
  const output = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0 100 0 0 10 0",
    "   1: 0100007F:0BB9 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 12346 1 0 100 0 0 10 0",
  ].join("\n");

  assert.deepEqual(parseProcNetTcp(output, false), [
    { address: "127.0.0.1", port: 3000, inode: "12345" },
  ]);
});

test("formatProcAddress decodes IPv4 and IPv6 /proc addresses", () => {
  assert.equal(formatProcAddress("0100007F", false), "127.0.0.1");
  assert.equal(formatProcAddress("00000000", false), "0.0.0.0");
  assert.equal(
    formatProcAddress("00000000000000000000000001000000", true),
    "0000:0000:0000:0000:0000:0000:0000:0001",
  );
  assert.equal(formatProcAddress("bad", false), null);
});

test("protectedReason blocks PID 1, PortPilot itself, and system processes", () => {
  assert.match(protectedReason(1, "init"), /PID 1/);
  assert.match(protectedReason(4242, "node", 4242), /PortPilot itself/);
  assert.match(protectedReason(99, "launchd"), /critical system process/);
  assert.match(protectedReason(99, "svchost.exe"), /critical system process/);
  assert.equal(protectedReason(99, "node", 4242), null);
});
