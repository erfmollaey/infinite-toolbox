"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePort,
  validatePort,
  validatePid,
} = require("../dist/utils/validator.js");

test("parsePort accepts valid ports", () => {
  for (const input of ["1", "80", "3000", "65535", " 8080 "]) {
    const result = parsePort(input);
    assert.equal(result.valid, true, `${input} should be valid`);
    assert.equal(typeof result.port, "number");
  }
});

test("parsePort rejects malformed and out-of-range values", () => {
  const invalid = [
    "0",
    "65536",
    "-1",
    "3000abc",
    "12.5",
    "0x10",
    "",
    "   ",
    null,
    undefined,
    {},
  ];

  for (const input of invalid) {
    const result = parsePort(input);
    assert.equal(result.valid, false, `${String(input)} should be invalid`);
    assert.ok(result.error);
  }
});

test("validatePort enforces the integer range", () => {
  assert.equal(validatePort(1).valid, true);
  assert.equal(validatePort(65535).valid, true);
  assert.equal(validatePort(0).valid, false);
  assert.equal(validatePort(65536).valid, false);
  assert.equal(validatePort(1.5).valid, false);
  assert.equal(validatePort(Number.NaN).valid, false);
});

test("validatePid rejects non-positive and non-integer values", () => {
  assert.equal(validatePid(1234).valid, true);
  assert.equal(validatePid(0).valid, false);
  assert.equal(validatePid(-5).valid, false);
  assert.equal(validatePid(1.2).valid, false);
  assert.equal(validatePid("1234").valid, false);
});
