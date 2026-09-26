"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, readSource, extractConstants, extractFunction, runInSandbox } = require("./_source");

const source = readSource(USERSCRIPT_PATH);
const constants = extractConstants(source, ["SCRIPT_UPDATE_TAB_ACTIVATION_MS", "SCRIPT_UPDATE_RETURN_TTL_MS"]);
const returnFlowSource = [
  `const SCRIPT_UPDATE_TAB_ACTIVATION_MS = ${constants.SCRIPT_UPDATE_TAB_ACTIVATION_MS};`,
  `const SCRIPT_UPDATE_RETURN_TTL_MS = ${constants.SCRIPT_UPDATE_RETURN_TTL_MS};`,
  "let scriptUpdateOpening = false;",
  "let scriptUpdateReturn = null;",
  extractFunction(source, "openLatestUserscript", { async: true }),
  extractFunction(source, "bindScriptUpdateReturnReload"),
  extractFunction(source, "handleScriptUpdateReturnVisibility"),
  extractFunction(source, "reloadAfterScriptUpdateReturn"),
  "globalThis.flow = { openLatestUserscript, bindScriptUpdateReturnReload, hasPending: () => Boolean(scriptUpdateReturn) };",
].join("\n");

assert.equal(constants.SCRIPT_UPDATE_TAB_ACTIVATION_MS, 10000);
assert.equal(constants.SCRIPT_UPDATE_RETURN_TTL_MS, 1800000);
assert.match(extractFunction(source, "init"), /bindScriptUpdateReturnReload\(\)/);

function createHarness({ openTab, resolveSource } = {}) {
  const clock = { now: 2000000000000 };
  const listeners = { visibilitychange: [], focus: [] };
  const openedUrls = [];
  const timers = [];
  let focused = true;
  let reloads = 0;
  const document = {
    visibilityState: "visible",
    hasFocus: () => focused,
    addEventListener(event, callback) { listeners[event].push(callback); },
  };
  const sandbox = {
    Date: { now: () => clock.now },
    document,
    location: { reload() { reloads += 1; } },
    window: {
      addEventListener(event, callback) { listeners[event].push(callback); },
      setTimeout(callback) { timers.push(callback); },
    },
    GM_openInTab(url, options) {
      openedUrls.push({ url, options });
      return openTab ? openTab(document) : { closed: false };
    },
    async resolvePreferredScriptUpdateSource() {
      if (resolveSource) return resolveSource();
      return { url: "https://raw.githubusercontent.com/krkr521/biligumi-connector/master/userscript/biligumi-connector.user.js" };
    },
    syncSettingsUpdateUi() {},
  };
  runInSandbox(returnFlowSource, sandbox);
  sandbox.flow.bindScriptUpdateReturnReload();
  return {
    flow: sandbox.flow,
    clock,
    openedUrls,
    get reloads() { return reloads; },
    setFocused(value) { focused = value; },
    visibility(state) {
      document.visibilityState = state;
      for (const callback of listeners.visibilitychange) callback();
    },
    focus() { for (const callback of listeners.focus) callback(); },
    flushTimers() { while (timers.length) timers.shift()(); },
  };
}

test("an opened update tab reloads the original page exactly once after the user returns", async () => {
  const browser = createHarness();
  browser.visibility("hidden");
  browser.visibility("visible");
  browser.focus();
  assert.equal(browser.reloads, 0, "ordinary tab switching must not reload");

  await browser.flow.openLatestUserscript();
  assert.equal(browser.openedUrls.length, 1);
  assert.equal(browser.openedUrls[0].options.active, true);
  browser.focus();
  assert.equal(browser.reloads, 0, "opening alone must not reload");

  browser.clock.now += 1000;
  browser.visibility("hidden");
  browser.setFocused(false);
  browser.clock.now += 5 * 60 * 1000;
  browser.visibility("visible");
  assert.equal(browser.reloads, 0, "a visible tab in an unfocused window has not been returned to");
  browser.setFocused(true);
  browser.focus();
  assert.equal(browser.reloads, 1);
  assert.equal(browser.flow.hasPending(), false, "clear the one-shot marker before reloading");
  browser.focus();
  browser.visibility("hidden");
  browser.visibility("visible");
  assert.equal(browser.reloads, 1);
});

test("a failed tab open or rejected update source never arms a later refresh", async () => {
  for (const openTab of [() => null, () => ({ closed: true }), () => { throw new Error("blocked"); }]) {
    const browser = createHarness({ openTab });
    await assert.rejects(browser.flow.openLatestUserscript());
    browser.visibility("hidden");
    browser.visibility("visible");
    browser.focus();
    assert.equal(browser.reloads, 0);
    assert.equal(browser.flow.hasPending(), false);
  }

  const rejected = createHarness({ resolveSource: () => { throw new Error("unsafe source"); } });
  await assert.rejects(rejected.flow.openLatestUserscript(), /unsafe source/);
  assert.equal(rejected.openedUrls.length, 0);
  rejected.visibility("hidden");
  rejected.visibility("visible");
  assert.equal(rejected.reloads, 0);
});

test("a failed second update attempt clears a pending refresh from the first attempt", async () => {
  const results = [{ closed: false }, null];
  const browser = createHarness({ openTab: () => results.shift() });
  await browser.flow.openLatestUserscript();
  browser.flushTimers();
  await assert.rejects(browser.flow.openLatestUserscript(), /未能打开用户脚本安装页/);
  browser.visibility("hidden");
  browser.visibility("visible");
  assert.equal(browser.reloads, 0);
});

test("a tab that never activates promptly cannot refresh the page on a later ordinary switch", async () => {
  const browser = createHarness();
  await browser.flow.openLatestUserscript();
  browser.clock.now += constants.SCRIPT_UPDATE_TAB_ACTIVATION_MS + 1;
  browser.visibility("hidden");
  browser.visibility("visible");
  assert.equal(browser.reloads, 0);
  assert.equal(browser.flow.hasPending(), false);
});

test("return refresh expires after 30 minutes and survives a synchronous hide during opening", async () => {
  const expired = createHarness();
  await expired.flow.openLatestUserscript();
  expired.visibility("hidden");
  expired.clock.now += constants.SCRIPT_UPDATE_RETURN_TTL_MS + 1;
  expired.visibility("visible");
  assert.equal(expired.reloads, 0);
  assert.equal(expired.flow.hasPending(), false);

  const immediatelyHidden = createHarness({
    openTab(document) {
      document.visibilityState = "hidden";
      return { closed: false };
    },
  });
  await immediatelyHidden.flow.openLatestUserscript();
  immediatelyHidden.visibility("visible");
  assert.equal(immediatelyHidden.reloads, 1);
});
