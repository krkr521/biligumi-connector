"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");

const functions = [
  "render", "updatePanelHtml", "renderStandaloneSearchPanel", "shouldRenderFullPanel", "isSubjectDataLoading",
  "isPanelLoadActive", "getPanelProgressState", "renderPanelProgressSlot", "updatePanelProgressBar",
  "beginPanelLoad", "advancePanelLoad", "finishPanelLoad",
];

function classList(value = "") {
  const classes = new Set(value.split(/\s+/).filter(Boolean));
  return {
    contains: (name) => classes.has(name),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
  };
}

// Only the progress-slot DOM is modeled. Actual render functions create its
// markup; subsequent progress callbacks update the same slot and bar objects.
function createPanel() {
  let html = "";
  return {
    className: "", slot: null,
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      const match = value.match(/class="(biligumi-progress-slot[^"]*)"/);
      if (!match) { this.slot = null; return; }
      const bar = { style: { width: value.match(/class="biligumi-load-bar" style="width:([^\"]+)/)?.[1] || "" } };
      this.slot = { classList: classList(match[1]), bar, querySelector: (selector) => selector === ".biligumi-load-bar" ? bar : null };
    },
    querySelector(selector) { return selector === ".biligumi-progress-slot" ? this.slot : null; },
  };
}

function setup(source) {
  const panel = createPanel();
  const api = {
    panel, whitelisted: false, official: false, nonMainPage: false, previewKeyword: "",
    state: {
      subjectId: 633836, subject: null, busy: false, nonMainBusy: false, error: "", message: "",
      panelCollapsed: false, standaloneSearchExpanded: false,
    },
    panelLoadProgress: { total: 0, done: 0, label: "", loadId: 0 },
    panelMarkupCache: new WeakMap(),
    PANEL_ID: "biligumi-panel", SCRIPT_VERSION: "test", EXTENSION_VERSION: "test", BGM_WEB_BASE: "https://bgm.tv",
    document: { getElementById: () => panel },
    escapeHtml: (value) => String(value),
    capturePanelInputDrafts: () => [], getProgressInfo: () => ({ summary: "" }),
    displaySubjectName: () => "Re0 第四季 夺还篇", getWhitelistHint: () => "当前页面标识：346671188",
    getInlineAutoPreviewKeyword: () => "",
  };
  api.isWhitelistedPage = () => api.whitelisted;
  api.isOfficialBangumiPage = () => api.official;
  api.isNonMainPreviewPage = () => api.nonMainPage;
  api.getNonMainPreviewKeyword = () => api.previewKeyword;
  // Unrelated layout, events, and panel content are outside the loading scope.
  for (const name of [
    "hideEpisodeTooltip", "updateCurrentWhitelistLabel", "syncSettingsDialog", "removeSubjectInfoPanel",
    "removeCharacterStrip", "bindPanelEvents", "restorePanelInputDrafts", "layoutPanelWithoutOwningBiliDom",
    "refreshOpedSkipButton", "syncSubjectInfoPanel", "syncCharacterStrip", "ensureNonMainPreviewSearch",
  ]) api[name] = () => {};
  for (const name of [
    "renderSearchOrSubject", "renderCollectionMappingHint", "renderInlineConfirm", "renderPanelNoticeSlot",
    "renderSearchForm", "renderInlineAutoPreview", "renderLongVideoBindingPrompt",
  ]) api[name] = () => "";
  runInSandbox(functions.map((name) => extractFunction(source, name)).join("\n"), api);
  return api;
}

function assertSlot(api, { active, indeterminate = false, width }) {
  assert.ok(api.panel.slot, "the actual panel markup must contain a progress slot");
  assert.equal(api.panel.slot.classList.contains("active"), active, "visible loading state");
  assert.equal(api.panel.slot.classList.contains("indeterminate"), indeterminate, "infinite animation state");
  if (width != null) assert.equal(api.panel.slot.bar.style.width, width);
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);

  test(`${label}: a non-whitelisted BV with an inherited binding renders an idle collapsed search bar`, () => {
    const api = setup(source);
    assert.equal(api.shouldRenderFullPanel(), false);
    api.render();
    assert.match(api.panel.className, /biligumi-free-search-panel/);
    assert.match(api.panel.className, /biligumi-panel-collapsed/);
    assert.doesNotMatch(api.panel.className, /biligumi-panel-loading/);
    assert.match(api.panel.innerHTML, /data-action="add-whitelist"/);
    assert.match(api.panel.innerHTML, /346671188/);
    assertSlot(api, { active: false, width: "0%" });
    assert.equal(api.state.subjectId, 633836, "rendering must not delete the inherited binding");
    api.finishPanelLoad();
    assertSlot(api, { active: false });
  });

  test(`${label}: expanded standalone search and inherited busy/progress state cannot activate subject loading`, () => {
    const api = setup(source);
    api.state.standaloneSearchExpanded = true;
    api.state.busy = true;
    api.panelLoadProgress.total = 4;
    api.panelLoadProgress.done = 2;
    for (const subject of [null, { id: 633836 }]) {
      api.state.subject = subject;
      api.render();
      assert.match(api.panel.className, /biligumi-free-search-panel/);
      assert.doesNotMatch(api.panel.className, /biligumi-panel-collapsed|biligumi-panel-loading/);
      assertSlot(api, { active: false });
    }
  });

  test(`${label}: whitelisted, official and bound-preview full panels preserve subject loading`, () => {
    for (const mode of ["whitelisted", "official", "nonMainPage"]) {
      const api = setup(source);
      api[mode] = true;
      assert.equal(api.shouldRenderFullPanel(), true, mode);
      api.render();
      assert.match(api.panel.className, /biligumi-panel-loading/);
      assert.doesNotMatch(api.panel.className, /biligumi-free-search-panel/);
      assertSlot(api, { active: true, indeterminate: true, width: "0%" });
      const loadId = api.beginPanelLoad(4, "读取条目");
      assertSlot(api, { active: true, width: "6%" });
      api.advancePanelLoad("已读取条目", loadId);
      assertSlot(api, { active: true, width: "25%" });
      api.state.subject = { id: 633836 };
      api.state.busy = true;
      api.render();
      assertSlot(api, { active: true, width: "25%" });
      api.state.busy = false;
      api.finishPanelLoad(loadId);
      api.render();
      assertSlot(api, { active: false, width: "0%" });
    }
  });

  test(`${label}: an unbound PV keeps its standalone preview animation until matching settles`, () => {
    const api = setup(source);
    api.nonMainPage = true;
    api.previewKeyword = "示例动画 PV";
    api.state.subjectId = null;
    api.state.nonMainBusy = true;
    assert.equal(api.shouldRenderFullPanel(), false);
    api.render();
    assert.match(api.panel.className, /biligumi-free-search-panel/);
    assert.match(api.panel.className, /biligumi-panel-loading/);
    assertSlot(api, { active: true, indeterminate: true });
    api.state.nonMainBusy = false;
    api.render();
    assert.doesNotMatch(api.panel.className, /biligumi-panel-loading/);
    assertSlot(api, { active: false });
  });

  test(`${label}: old progress callbacks cannot reactivate the search bar after leaving a whitelisted page`, () => {
    const api = setup(source);
    api.whitelisted = true;
    api.render();
    const oldId = api.beginPanelLoad(4, "旧页面加载");
    api.advancePanelLoad("旧页面已读取一项", oldId);
    assertSlot(api, { active: true, width: "25%" });

    api.whitelisted = false;
    api.state.subject = null;
    api.state.busy = false;
    api.render();
    const standaloneSlot = api.panel.slot;
    assertSlot(api, { active: false });
    api.advancePanelLoad("旧页面迟到数据", oldId);
    assert.equal(api.panel.slot, standaloneSlot, "exercise incremental updates without a compensating rerender");
    assertSlot(api, { active: false });
    api.finishPanelLoad(oldId);
    assertSlot(api, { active: false, width: "0%" });
    api.updatePanelProgressBar();
    assertSlot(api, { active: false });

    api.whitelisted = true;
    api.render();
    assertSlot(api, { active: true, indeterminate: true });
    const newId = api.beginPanelLoad(2, "重新加载");
    api.advancePanelLoad("当前页面数据", newId);
    assertSlot(api, { active: true, width: "50%" });
    api.advancePanelLoad("旧请求不能推进新进度", oldId);
    api.finishPanelLoad(oldId);
    assertSlot(api, { active: true, width: "50%" });
    assert.equal(api.panelLoadProgress.loadId, newId);
  });

  test(`${label}: a settled full-panel error does not leave the progress animation active`, () => {
    const api = setup(source);
    api.whitelisted = true;
    api.state.error = "读取失败";
    api.render();
    assertSlot(api, { active: false });
    api.updatePanelProgressBar();
    assertSlot(api, { active: false });
  });
}
