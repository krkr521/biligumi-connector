"use strict";

// Shared source-extraction helpers for connector tests.
// Every extraction is strict: a missing anchor must fail the test instead of
// silently falling back to a hand-copied constant or mock.

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const USERSCRIPT_PATH = path.join(repoRoot, "userscript", "biligumi-connector.user.js");
const EXTENSION_PATH = path.join(repoRoot, "extension", "content.js");

function readSource(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

// Extracts one top-level (two-space indented) function body from the connector IIFE.
// The end anchor is the next top-level function, so moved/renamed functions fail loudly.
function extractFunction(source, name, options = {}) {
  const marker = options.async ? `  async function ${name}(` : `  function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${name} in source`);
  const rest = source.slice(start + 1);
  const next = /\n  (?:async )?function [A-Za-z0-9_]+\(/.exec(rest);
  assert.ok(next, `Missing end of function ${name} in source`);
  return source.slice(start, start + 1 + next.index).replace(/\r\n/g, "\n");
}

// Evaluates `const NAME = <expression>;` lines in order inside a fresh vm context,
// so expressions referencing earlier constants still resolve. Only single-line
// literal-style constants are supported; anything else fails the test.
function extractConstants(source, names) {
  const sandbox = {};
  vm.createContext(sandbox);
  const lines = source.split(/\r?\n/);
  for (const name of names) {
    const prefix = `  const ${name} = `;
    const line = lines.find((row) => row.startsWith(prefix) && row.trimEnd().endsWith(";"));
    assert.ok(line, `Missing constant ${name} in source`);
    const expression = line.slice(prefix.length).trim().replace(/;$/, "");
    sandbox[name] = vm.runInContext(`(${expression})`, sandbox);
  }
  return sandbox;
}

// Evaluates a `const NAME = { ... };` object literal from source (e.g. STORAGE).
function extractObjectConstant(source, name) {
  const startMarker = `  const ${name} = {`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing object constant ${name} in source`);
  const end = source.indexOf("\n  };", start);
  assert.notEqual(end, -1, `Missing end of object constant ${name} in source`);
  const startBrace = source.indexOf("{", start);
  const literal = source.slice(startBrace, end + 4);
  const sandbox = {};
  vm.createContext(sandbox);
  return vm.runInContext(`(${literal})`, sandbox);
}

// Maps the extension-only route/storage adapters onto the userscript idioms so the
// long-video binding flow can be compared without demanding byte-identical files.
// Only intentional adapter differences are normalized; everything else must match.
function canonicalizeAdapterSyntax(source) {
  return source
    .replace(/\{ pageKey: state\.pageKey, routeSeq: routeRefreshSeq \}/g, "__ROUTE_CTX__()")
    .replace(/\bcaptureRouteContext\(\)/g, "__ROUTE_CTX__()")
    .replace(/\bcapturePageContext\(\)/g, "__ROUTE_CTX__()")
    .replace(/\bisRouteContextCurrent\(/g, "__IS_ROUTE_CTX_CURRENT__(")
    .replace(/\bisCurrentPageContext\(/g, "__IS_ROUTE_CTX_CURRENT__(")
    .replace(/\brouteContext\b/g, "__ctx")
    .replace(/\borigin\b/g, "__ctx")
    .replace(/\bcontext\b/g, "__ctx")
    .replace(/\bensureRouteContext\(__ctx, "[^"]*"\);/g, "if (!__IS_ROUTE_CTX_CURRENT__(__ctx)) return;")
    .replace(
      /( *)const bindingKeys = getBindingKeysForCurrentPage\(\);\n( *)if \(!__IS_ROUTE_CTX_CURRENT__\(__ctx\)\) return;/,
      "$2if (!__IS_ROUTE_CTX_CURRENT__(__ctx)) return;\n$1const bindingKeys = getBindingKeysForCurrentPage();",
    )
    .replace(/\bupdateStoredBindings\(/g, "updateBindings(")
    .replace(
      /let changed = false;\s+for \(const key of bindingKeys\) \{\s+if \(Number\(bindings\[key\]\) !== subjectId\) continue;\s+delete bindings\[key\];\s+changed = true;\s+\}\s+return changed;/,
      "__DELETE_MATCHED_KEYS__();",
    )
    .replace(
      /for \(const key of bindingKeys\) \{\s+if \(Number\(bindings\[key\]\) === subjectId\) delete bindings\[key\];\s+\}\s+return true;/,
      "__DELETE_MATCHED_KEYS__();",
    )
    .replace(/\r\n/g, "\n");
}

function runInSandbox(code, sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

module.exports = {
  repoRoot,
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  extractConstants,
  extractObjectConstant,
  canonicalizeAdapterSyntax,
  runInSandbox,
};
