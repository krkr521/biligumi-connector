"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractConstants, extractFunction, runInSandbox } = require("./_source");

function loadStyles(source) {
  const marker = "  GM_addStyle(`";
  const start = source.indexOf(marker);
  const end = source.indexOf("\n  `);", start);
  assert.ok(start >= 0 && end > start, "the actual injected stylesheet must be present");
  const template = source.slice(start + marker.length, end);
  const names = [...new Set([...template.matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]))];
  const constants = extractConstants(source, names);
  const css = template.replace(/\$\{(\w+)\}/g, (_match, name) => constants[name]).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /\$\{/, "new template expressions need explicit support in the test");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => {
    const declaration = [...match[2].matchAll(/(?:^|;)\s*z-index\s*:\s*([^;]+)/g)].at(-1);
    if (!declaration) return [];
    const value = declaration[1].trim();
    return match[1].trim().split(/\s*,\s*/).map((selector) => ({
      selector, zIndex: Number(value.replace(/\s*!important\s*$/, "")), important: /!important\s*$/.test(value),
    }));
  });
  return { constants, rules };
}

// A CSS contract check for standalone roots. This deliberately handles only
// ID/class selectors, specificity, importance and source order; it is not a
// browser renderer. Real stacking contexts/hit testing remain a release check.
function rootZIndex(rules, id = "", classes = []) {
  let winner = null;
  for (const rule of rules) {
    const match = /^(?:#([\w-]+))?((?:\.[\w-]+)*)$/.exec(rule.selector);
    if (!match || (!match[1] && !match[2])) continue;
    const requiredClasses = match[2].split(".").filter(Boolean);
    if ((match[1] && match[1] !== id) || requiredClasses.some((name) => !classes.includes(name))) continue;
    const specificity = (match[1] ? 100 : 0) + requiredClasses.length * 10;
    const candidate = { ...rule, specificity };
    if (!winner || Number(candidate.important) > Number(winner.important)
      || (candidate.important === winner.important && candidate.specificity >= winner.specificity)) winner = candidate;
  }
  assert.ok(winner && Number.isFinite(winner.zIndex), `missing numeric root z-index for ${id || classes.join(".")}`);
  return winner.zIndex;
}

const builds = [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]];
for (const [label, file] of builds) {
  const source = readSource(file);
  const { constants, rules } = loadStyles(source);
  const { PANEL_ID, SETTINGS_ID, CHARACTER_STRIP_ID, SUBJECT_INFO_ID } = constants;
  test(`${label}: all main-panel variants stay below the observed webpage mini-player stacking context`, () => {
    const playerAncestorZIndex = 3;
    for (const extra of [[], ["biligumi-panel-collapsed"], ["biligumi-panel-loading"],
      ["biligumi-free-search-panel"], ["biligumi-free-search-panel", "biligumi-panel-collapsed"]]) {
      const zIndex = rootZIndex(rules, PANEL_ID, ["biligumi-panel", ...extra]);
      assert.ok(zIndex >= 0 && zIndex < playerAncestorZIndex, `${extra.join(" ") || "normal"} must not cover the mini player's z-index 3 ancestor`);
    }
    assert.equal(rootZIndex(rules, PANEL_ID, ["biligumi-panel", "biligumi-panel-under-bili-overlay"]), 0, "the music-overlay override must still win the cascade");
  });

  test(`${label}: lowering the main panel preserves independent dialogs and auxiliary panels`, () => {
    assert.equal(rootZIndex(rules, CHARACTER_STRIP_ID), 20);
    assert.equal(rootZIndex(rules, SUBJECT_INFO_ID), 20);
    assert.equal(rootZIndex(rules, SETTINGS_ID), 2147483647);
    assert.equal(rootZIndex(rules, "", ["biligumi-episode-tip"]), 2147483646);
    let mounted = null;
    const scope = {
      SETTINGS_ID, removeModal() {}, bindModalEvents() {},
      document: { createElement: () => ({ dataset: {} }), body: { appendChild: (node) => { mounted = node; } } },
    };
    runInSandbox(extractFunction(source, "mountModal"), scope);
    scope.mountModal("close-settings", "settings fixture");
    assert.equal(mounted.id, SETTINGS_ID, "the settings dialog remains attached to body, outside the lowered panel's stacking context");
    assert.equal(mounted.dataset.action, "close-settings");
  });
}

test("userscript and extension inject the same root stacking rules", () => {
  const relevant = (file) => loadStyles(readSource(file)).rules.filter(({ selector }) => /biligumi-connector-(?:panel|settings|characters|subject-info)|^\.biligumi-episode-tip$/.test(selector));
  assert.deepEqual(relevant(USERSCRIPT_PATH), relevant(EXTENSION_PATH));
});
