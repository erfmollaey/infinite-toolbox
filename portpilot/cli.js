#!/usr/bin/env node
"use strict";

const { main } = require("./dist/cli/app.js");

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(
      `Unexpected error: ${error && error.message ? error.message : error}`,
    );
    process.exitCode = 1;
  });
