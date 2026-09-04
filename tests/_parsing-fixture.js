"use strict";

const assert = require("node:assert/strict");
const { extractFunction, runInSandbox } = require("./_source");

function loadParsingFixture(source, functions, sandbox, constants) {
  const declarations = constants.map((name) => {
    const marker = `  const ${name} = `;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Missing constant ${name}`);
    const lines = source.slice(start).split(/\r?\n/);
    const end = lines.findIndex((line) => line.trimEnd().endsWith(";"));
    assert.notEqual(end, -1, `Missing end of constant ${name}`);
    return lines.slice(0, end + 1).join("\n");
  });
  runInSandbox([
    ...declarations,
    ...functions.map((name) => extractFunction(source, name)),
  ].join("\n"), sandbox);
  return sandbox;
}

module.exports = { loadParsingFixture };
