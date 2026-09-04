"use strict";
const assert = require("node:assert/strict");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");
const names = ["capturePanelInputDrafts", "restorePanelInputDrafts", "bindPanelInputDrafts", "isPanelInputDraftContextCurrent"];
for (const name of names) assert.equal(extractFunction(readSource(USERSCRIPT_PATH), name), extractFunction(readSource(EXTENSION_PATH), name));
function input(value, defaultValue = "", options = {}) {
  return { value, defaultValue, selectionStart: 1, selectionEnd: 2, focusCalls: 0, selectionCalls: [],
    focus(options) { this.focusCalls += 1; this.focusOptions = options; },
    setSelectionRange(start, end) { this.selectionCalls.push([start, end]); }, ...options };
}
function load(file) {
  const sandbox = { state: { pageKey: "A", subjectId: 101, token: "token-a" }, routeRefreshSeq: 1,
    location: { href: "https://www.bilibili.com/video/BV1A" }, document: { activeElement: null }, panelInputDraftContexts: new WeakMap() };
  runInSandbox(names.map((name) => extractFunction(readSource(file), name)).join("\n"), sandbox);
  sandbox.panel = (inputs) => {
    const panel = { querySelector: (selector) => inputs[/data-role='([^']+)'/.exec(selector)?.[1]] || null };
    sandbox.bindPanelInputDrafts(panel);
    return panel;
  };
  return sandbox;
}
for (const file of [USERSCRIPT_PATH, EXTENSION_PATH]) {
  const api = load(file);
  // Untouched progress follows server changes, including while it has focus.
  for (const focused of [false, true]) {
    const old = input("0", "0"), oldPanel = api.panel({ progress: old });
    api.document.activeElement = focused ? old : null;
    const drafts = api.capturePanelInputDrafts(oldPanel), fresh = input("1", "1");
    api.restorePanelInputDrafts(api.panel({ progress: fresh }), drafts);
    assert.equal(fresh.value, "1");
    assert.equal(fresh.focusCalls, focused ? 1 : 0);
  }
  // Genuine edits survive multiple rebuilds, including blurred and empty drafts.
  for (const value of ["3", ""]) {
    api.document.activeElement = null;
    const drafts = api.capturePanelInputDrafts(api.panel({ progress: input(value, "1") }));
    const fresh = input("2", "2"), freshPanel = api.panel({ progress: fresh });
    api.restorePanelInputDrafts(freshPanel, drafts);
    assert.equal(fresh.value, value);
    assert.equal(fresh.focusCalls, 0);
    const next = input("2", "2");
    api.restorePanelInputDrafts(api.panel({ progress: next }), api.capturePanelInputDrafts(freshPanel));
    assert.equal(next.value, value);
  }
  // A saved edit stops being dirty once the server has caught up.
  const typedPanel = api.panel({ progress: input("3", "1") });
  const saved = input("3", "3"), savedPanel = api.panel({ progress: saved });
  api.restorePanelInputDrafts(savedPanel, api.capturePanelInputDrafts(typedPanel));
  assert.equal(api.capturePanelInputDrafts(savedPanel).length, 0);
  const search = input("药屋少女", "", { selectionStart: 2, selectionEnd: 4 });
  api.document.activeElement = search;
  const searchDrafts = api.capturePanelInputDrafts(api.panel({ "search-keyword": search }));
  const freshSearch = input("");
  api.restorePanelInputDrafts(api.panel({ "search-keyword": freshSearch }), searchDrafts);
  assert.equal(freshSearch.value, "药屋少女");
  assert.equal(freshSearch.focusOptions.preventScroll, true);
  assert.deepEqual(freshSearch.selectionCalls, [[2, 4]]);
  // Number inputs may lack selection support, or throw if it is invoked.
  for (const setSelectionRange of [undefined, () => { throw new Error("unsupported"); }]) {
    const old = input("12", "0"); api.document.activeElement = old;
    const drafts = api.capturePanelInputDrafts(api.panel({ progress: old }));
    const fresh = input("0", "0", { setSelectionRange });
    assert.doesNotThrow(() => api.restorePanelInputDrafts(api.panel({ progress: fresh }), drafts));
    assert.equal(fresh.value, "12"); assert.equal(fresh.focusCalls, 1);
  }
  // Old DOM cannot become a draft for a different route, subject or account.
  for (const change of [
    (s) => { s.state.pageKey = "B"; }, (s) => { s.routeRefreshSeq += 1; },
    (s) => { s.location.href += "?p=2"; }, (s) => { s.state.subjectId = 202; }, (s) => { s.state.token = "token-b"; },
  ]) {
    const scoped = load(file);
    const oldPanel = scoped.panel({ progress: input("9", "0"), "search-keyword": input("old", "") });
    const drafts = scoped.capturePanelInputDrafts(oldPanel); assert.equal(drafts.length, 2);
    change(scoped);
    assert.equal(scoped.capturePanelInputDrafts(oldPanel).length, 0);
    const fresh = input("1", "1");
    scoped.restorePanelInputDrafts(scoped.panel({ progress: fresh }), drafts);
    assert.equal(fresh.value, "1");
  }
  assert.equal(api.capturePanelInputDrafts(null).length, 0);
  assert.equal(api.capturePanelInputDrafts({}).length, 0);
  assert.doesNotThrow(() => api.restorePanelInputDrafts(null, searchDrafts));
  assert.doesNotThrow(() => api.restorePanelInputDrafts({}, []));
  assert.doesNotThrow(() => api.restorePanelInputDrafts(api.panel({}), searchDrafts));
  const source = readSource(file);
  assert.match(extractFunction(source, "bindPanelEvents"), /bindPanelInputDrafts\(panel\)/);
  const render = extractFunction(source, "render");
  assert.equal((render.match(/capturePanelInputDrafts\(/g) || []).length, 1);
  assert.equal((render.match(/restorePanelInputDrafts\(/g) || []).length, 3);
}
console.log("input draft restoration tests passed");
