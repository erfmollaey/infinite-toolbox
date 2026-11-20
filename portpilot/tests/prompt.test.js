"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");

const { createPrompter } = require("../dist/cli/prompt.js");

function ttyInput() {
  const input = new PassThrough();
  input.isTTY = true;
  return input;
}

function output() {
  const stream = new PassThrough();
  stream.resume();
  return stream;
}

test("no prompter is created without a TTY", () => {
  assert.equal(createPrompter(new PassThrough(), output()), null);
});

test("confirm accepts only explicit yes answers", async () => {
  for (const [answer, expected] of [
    ["y\n", true],
    ["yes\n", true],
    ["Y\n", true],
    ["n\n", false],
    ["\n", false],
    ["no\n", false],
    ["sure\n", false],
  ]) {
    const input = ttyInput();
    const prompter = createPrompter(input, output());
    assert.ok(prompter);

    const pending = prompter.confirm("Continue? ");
    input.write(answer);
    assert.equal(await pending, expected, `answer: ${JSON.stringify(answer)}`);
    prompter.close();
  }
});

test("EOF resolves as no confirmation", async () => {
  const input = ttyInput();
  const prompter = createPrompter(input, output());
  assert.ok(prompter);

  const pending = prompter.confirm("Continue? ");
  input.end();
  assert.equal(await pending, false);
  assert.equal(await prompter.ask("Another? "), null);
  prompter.close();
});

test("ask returns the entered text", async () => {
  const input = ttyInput();
  const prompter = createPrompter(input, output());
  assert.ok(prompter);

  const pending = prompter.ask("> ");
  input.write("2\n");
  assert.equal(await pending, "2");
  prompter.close();
});
