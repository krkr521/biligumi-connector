"use strict";

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

function loadStabilizer(filePath) {
  const source = readSource(filePath);
  const functionSource = extractFunction(source, "stabilizePanelReserve");
  const sandbox = { window: {} };
  runInSandbox(`${functionSource}\n;globalThis.stabilizePanelReserve = stabilizePanelReserve;`, sandbox);
  return sandbox;
}

function panelWith(...classes) {
  const classNames = new Set(classes);
  return {
    classList: {
      contains(name) {
        return classNames.has(name);
      },
    },
  };
}

for (const [label, filePath] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const sandbox = loadStabilizer(filePath);
  const loadingPanel = panelWith("biligumi-panel-loading");
  const collapsedLoadingPanel = panelWith("biligumi-panel-loading", "biligumi-panel-collapsed");

  assert.equal(sandbox.stabilizePanelReserve(loadingPanel, 480), 480, `${label}: loading reserve starts at measured height`);
  assert.equal(sandbox.stabilizePanelReserve(loadingPanel, 72), 480, `${label}: expanded loading panel keeps its peak reserve`);
  assert.equal(sandbox.stabilizePanelReserve(collapsedLoadingPanel, 72), 72, `${label}: collapsed panel releases the old loading reserve`);
  assert.equal(sandbox.window.__biligumiStableReserve, 72, `${label}: collapsed measured height becomes the new reserve`);
}

assert.equal(
  extractFunction(readSource(EXTENSION_PATH), "stabilizePanelReserve"),
  extractFunction(readSource(USERSCRIPT_PATH), "stabilizePanelReserve"),
  "panel reserve stabilization must stay identical between userscript and extension",
);

console.log("panel collapse reserve tests passed");
