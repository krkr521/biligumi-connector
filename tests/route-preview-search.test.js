"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox,
} = require("./_source");

const noop = () => {};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function functions(source, names) {
  return names.map((name) => extractFunction(source, name, {
    async: source.includes(`  async function ${name}(`),
  })).join("\n");
}

// Exercise the real route scheduler, page-context refresh, render, and preview
// request lifecycle together. Only unrelated DOM markup/layout and the network
// boundary are substituted, so an extra render really can start another search.
function harness(source, mode = "inline") {
  const scope = {
    URL, Promise,
    routeRefreshSeq: 7,
    subjectBundleRequests: new Map(),
    nonMainPreviewRequests: new Map(),
    panelLoadProgress: { loadId: 1 },
    PANEL_ID: "panel", SCRIPT_VERSION: "test", EXTENSION_VERSION: "test",
    BGM_WEB_BASE: "https://bgm.tv",
    location: { href: "https://www.bilibili.com/video/BV1TEST?p=1&spm_id_from=old" },
    nextRawTitle: "第1话 示例动画",
    requests: [], timers: [], renderCount: 0, invalidationCount: 0,
    panel: { inert: false, className: "", innerHTML: "" },
    state: {
      pageKey: "", routeSelectionKey: "", rawTitle: "第1话 示例动画", pageTitle: "示例动画",
      subjectId: null, subject: null, subjectBundleContext: null,
      routeRefreshPending: false, routeSubjectReuse: null,
      busy: false, error: "", message: "", searchResults: [],
      nonMainKeyword: "", nonMainResults: [], nonMainBusy: false,
      nonMainError: "", nonMainSearched: false, nonMainSearchSeq: 3,
      standaloneSearchExpanded: false, inlineConfirm: null, longVideoBindingPrompt: null,
      bindingGuardMessage: "", token: "", autoEpisodeSyncing: false,
    },
    getOfficialBangumiSectionBindingKey: () => "",
    getStableBiliSubjectKey: () => "",
    isOfficialBangumiPage: () => false,
    isWhitelistedPage: () => mode === "inline",
    isNonMainPreviewPage: () => mode === "raw",
    shouldUseRawTitleForPreview: () => mode === "raw",
    isAutoPreviewTitle: () => true,
    isStandaloneBilibiliPartTitle: () => false,
    cleanTitle: (title) => String(title || "").replace(/^第\d+话\s*/, ""),
    isCurrentVideoAutoProgressDisabled: () => false,
    isVideoCollectionSelectionAheadOfRoute: () => false,
    detectCurrentEpisodeNo: () => 1,
    normalizeBindingToken: (title) => String(title || "").toLowerCase(),
    getCurrentBinding: () => null,
    resetAutoWatchObservationState: noop,
    refreshCurrentEpisodeRecognitionState: noop,
    refreshPageInitialState: () => Promise.resolve(),
    getProgressInfo: () => ({ summary: "" }),
    capturePanelInputDrafts: () => [],
    escapeHtml: (value) => String(value),
    displaySubjectName: () => "示例动画",
  };
  scope.window = {
    setTimeout: (callback, delay) => {
      scope.timers.push({ callback, delay });
      return scope.timers.length;
    },
  };
  scope.document = { getElementById: () => scope.panel };
  scope.getPageTitle = () => scope.nextRawTitle;
  scope.resolveCurrentPageTitle = scope.cleanTitle;
  scope.getCurrentSeasonSearchKeyword = () => "";
  scope.getBilibiliCollectionTitle = () => "";
  scope.invalidatePageInitialState = () => { scope.invalidationCount += 1; };
  scope.updatePanelHtml = (panel, html) => { panel.innerHTML = html; };
  scope.bgmRequest = (path, options) => {
    const request = deferred();
    scope.requests.push({ ...request, path, options });
    return request.promise;
  };
  for (const name of [
    "removeModal", "removeBgmApiRelayPrompt", "settleInlineConfirm", "hideEpisodeTooltip",
    "clearLongVideoBindingPrompt", "finishPanelLoad", "refreshOpedSkipButton", "refreshDanmakuFavoriteButtons",
    "updateCurrentWhitelistLabel", "syncSettingsDialog", "removeSubjectInfoPanel", "removeCharacterStrip",
    "bindPanelEvents", "restorePanelInputDrafts", "layoutPanelWithoutOwningBiliDom", "syncSubjectInfoPanel",
    "syncCharacterStrip", "repositionPanel", "schedulePanelReposition", "scheduleEpisodeContextRefresh",
  ]) scope[name] = noop;
  // Keep the real render's automatic-search calls while omitting unrelated HTML.
  for (const name of [
    "renderStandaloneSearchPanel", "renderPanelProgressSlot", "renderSearchOrSubject",
    "renderCollectionMappingHint", "renderInlineConfirm",
  ]) scope[name] = () => "<div>preview panel</div>";
  scope.isPanelLoadActive = () => scope.state.busy;
  runInSandbox(functions(source, [
    "scheduleRouteRefresh", "refreshAfterRouteChange", "refreshPageContext",
    "getPageKey", "getCurrentRouteSelectionKey", "getCurrentRouteKey", "getCurrentPartNoFromUrl",
    "getNonMainPreviewKeyword", "getInlineAutoPreviewKeyword", "shouldAutoShowOfficialBangumiPanel",
    "suggestSearchKeyword", "getCurrentPageSearchKeyword",
    "ensureNonMainPreviewSearch", "loadNonMainPreviewCandidates", "render", "shouldRenderFullPanel",
  ]), scope);
  scope.state.pageKey = scope.getPageKey();
  scope.state.routeSelectionKey = scope.getCurrentRouteSelectionKey();
  const realRender = scope.render;
  scope.render = (...args) => { scope.renderCount += 1; return realRender(...args); };
  scope.injectWhenReady = () => scope.render();
  return scope;
}

function previewState(scope) {
  return Object.fromEntries([
    "nonMainKeyword", "nonMainResults", "nonMainBusy", "nonMainError", "nonMainSearched", "nonMainSearchSeq",
  ].map((key) => [key, scope.state[key]]));
}

async function settle(request, response, reject = false) {
  if (reject) request.reject(response);
  else request.resolve(response);
  await new Promise(setImmediate);
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);

  test(`${label}: tracking-only URL updates unlock on bridge readiness without a delayed pass or another preview search`, async () => {
    const scope = harness(source);
    const bridge = deferred();
    scope.refreshPageInitialState = () => bridge.promise;
    scope.state.nonMainKeyword = "示例动画";
    scope.state.nonMainResults = [{ id: 101, name: "示例动画" }];
    scope.state.nonMainSearched = true;
    const preview = previewState(scope);
    const seq = scope.routeRefreshSeq;
    scope.location.href = "https://www.bilibili.com/video/BV1TEST?p=1&spm_id_from=new&from_spmid=tracking";
    scope.scheduleRouteRefresh(scope.state.rawTitle, scope.state.pageKey);
    assert.equal(scope.state.routeRefreshPending, true, "the bridge must still refresh its href-bound snapshot");
    assert.equal(scope.timers.length, 0, "tracking metadata does not need the 350/900/1800/3000ms DOM settle loop");
    assert.equal(scope.requests.length, 0);
    bridge.resolve();
    await new Promise(setImmediate);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.equal(scope.state.busy, false);
    assert.equal(scope.panel.inert, false);
    assert.equal(scope.routeRefreshSeq, seq + 2, "href-bound manual requests are expired even for tracking updates");
    assert.equal(scope.invalidationCount, 1);
    assert.equal(scope.timers.length, 0);
    assert.equal(scope.requests.length, 0);
    assert.deepEqual(previewState(scope), preview);
  });

  test(`${label}: a same-BV part change still locks the panel and waits for route settlement`, () => {
    const scope = harness(source);
    const seq = scope.routeRefreshSeq;
    scope.location.href = "https://www.bilibili.com/video/BV1TEST?p=2&spm_id_from=new";
    scope.scheduleRouteRefresh(scope.state.rawTitle, scope.state.pageKey);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.state.busy, true);
    assert.equal(scope.panel.inert, true);
    assert.equal(scope.routeRefreshSeq, seq + 1);
    assert.equal(scope.timers.length, 4);
    assert.equal(scope.invalidationCount, 1);
  });

  test(`${label}: a title change on the same route still uses the DOM settlement passes`, () => {
    const scope = harness(source);
    scope.location.href = "https://www.bilibili.com/video/BV1TEST?p=1&spm_id_from=new";
    scope.nextRawTitle = "第1话 新动画";
    scope.scheduleRouteRefresh(scope.state.rawTitle, scope.state.pageKey);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.timers.length, 4, "a title transition is not merely tracking metadata");
  });

  test(`${label}: a sidebar selection ahead of the URL prevents a tracking update from settling playback early`, () => {
    const scope = harness(source);
    scope.isVideoCollectionSelectionAheadOfRoute = () => true;
    scope.location.href = "https://www.bilibili.com/video/BV1TEST?p=1&spm_id_from=new";
    scope.scheduleRouteRefresh(scope.state.rawTitle, scope.state.pageKey);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.panel.inert, true);
    assert.equal(scope.timers.length, 4, "the new sidebar selection still needs the route and H1 to catch up");
    scope.render();
    assert.equal(scope.requests.length, 0, "the previous playback selection cannot start a preview during navigation");
  });

  test(`${label}: a sidebar navigation beginning while the metadata bridge awaits falls back to normal route settlement`, async () => {
    const scope = harness(source);
    const bridge = deferred();
    let sidebarAhead = false;
    scope.refreshPageInitialState = () => bridge.promise;
    scope.isVideoCollectionSelectionAheadOfRoute = () => sidebarAhead;
    const oldPageKey = scope.state.pageKey;
    const oldSelectionKey = scope.state.routeSelectionKey;
    scope.location.href = "https://www.bilibili.com/video/BV1TEST?p=1&spm_id_from=new";
    scope.scheduleRouteRefresh(scope.state.rawTitle, oldPageKey);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.timers.length, 0, "the initial metadata selection may wait directly on its bridge");
    sidebarAhead = true;
    bridge.resolve();
    await new Promise(setImmediate);
    assert.equal(scope.state.routeRefreshPending, true, "a newer sidebar selection must invalidate the bridge's original fast-path decision");
    assert.equal(scope.panel.inert, true);
    assert.equal(scope.state.pageKey, oldPageKey);
    assert.equal(scope.state.routeSelectionKey, oldSelectionKey);
    assert.equal(scope.requests.length, 0, "the obsolete selection cannot search or become bindable");
    assert.equal(scope.timers.length, 4, "the new navigation uses normal DOM settlement passes");
    const timers = scope.timers.splice(0).sort((left, right) => left.delay - right.delay);
    timers[0].callback();
    await new Promise(setImmediate);
    assert.equal(scope.state.routeRefreshPending, true, "the sidebar has changed but the route and H1 have not");
    scope.location.href = "https://www.bilibili.com/video/BV1NEXT?p=1";
    sidebarAhead = false;
    timers[1].callback();
    await new Promise(setImmediate);
    assert.equal(scope.state.routeRefreshPending, true, "a new BV route still displaying the old H1 cannot settle yet");
    assert.equal(scope.requests.length, 0);
    scope.nextRawTitle = "第1话 新动画";
    timers[2].callback();
    await new Promise(setImmediate);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.equal(scope.panel.inert, false);
    assert.equal(scope.state.pageKey, scope.getPageKey());
    assert.equal(scope.state.routeSelectionKey, scope.getCurrentRouteSelectionKey());
    assert.equal(scope.requests.length, 1);
    assert.equal(scope.requests[0].options.body.keyword, "新动画");
    await settle(scope.requests[0], { data: [{ id: 202, name: "新动画" }] });
    timers[3].callback();
    await new Promise(setImmediate);
    assert.equal(scope.requests.length, 1, "the final superseded pass cannot search again");
  });

  test(`${label}: repeated real renders during route waiting defer the preview until one settled search`, async () => {
    const scope = harness(source);
    const oldTitle = scope.state.rawTitle;
    const oldPageKey = scope.state.pageKey;
    scope.location.href = "https://www.bilibili.com/video/BV1TEST?p=2";
    scope.scheduleRouteRefresh(oldTitle, oldPageKey);
    const seq = scope.routeRefreshSeq;
    for (let count = 0; count < 5; count += 1) scope.render();
    assert.equal(scope.requests.length, 0, "waiting renders must not send an unusable preview request");
    assert.equal(scope.state.nonMainBusy, false);
    assert.equal(scope.state.nonMainSearchSeq, 3);
    scope.refreshAfterRouteChange(seq, oldTitle, oldPageKey, false);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.equal(scope.panel.inert, false);
    assert.equal(scope.requests.length, 1);
    assert.equal(scope.requests[0].options.body.keyword, "示例动画");
    for (let count = 0; count < 5; count += 1) scope.render();
    assert.equal(scope.requests.length, 1, "the in-flight settled search is reused");
    await settle(scope.requests[0], { data: [{ id: 101, name: "示例动画" }] });
    for (const { callback } of scope.timers.splice(0)) callback();
    await new Promise(setImmediate);
    scope.render();
    assert.equal(scope.requests.length, 1, "late route passes and completed-preview renders cannot search again");
    assert.equal(scope.state.nonMainResults[0].id, 101);
  });

  for (const mode of ["inline", "raw"]) {
    for (const status of ["complete", "busy", "error"]) {
      test(`${label}: ${mode} preview refresh preserves same-keyword ${status} state and reuses its search`, async () => {
        const scope = harness(source, mode);
        if (status === "busy") {
          scope.ensureNonMainPreviewSearch("示例动画");
        } else {
          scope.state.nonMainKeyword = "示例动画";
          scope.state.nonMainSearched = true;
          scope.state.nonMainResults = status === "complete" ? [{ id: 101, name: "示例动画" }] : [];
          scope.state.nonMainError = status === "error" ? "previous preview failure" : "";
        }
        const before = previewState(scope);
        const requestCount = scope.requests.length;
        scope.nextRawTitle = "第2话 示例动画";
        scope.refreshPageContext();
        assert.equal(scope.state.rawTitle, scope.nextRawTitle);
        assert.deepEqual(previewState(scope), before);
        assert.equal(scope.state.nonMainResults, before.nonMainResults, "retain already displayed candidates by identity");
        scope.render();
        assert.equal(scope.requests.length, requestCount);
        if (status === "busy") {
          await settle(scope.requests[0], { data: [{ id: 101, name: "示例动画" }] });
          assert.equal(scope.state.nonMainResults[0].id, 101, "the retained request can still complete");
          assert.equal(scope.state.nonMainBusy, false);
          scope.render();
          assert.equal(scope.requests.length, 1);
        }
      });
    }
  }

  test(`${label}: page preview preservation derives its title while the previous route's binding is still present`, () => {
    const scope = harness(source);
    scope.state.subjectId = 999;
    scope.state.subject = { id: 999, name: "previous bound series" };
    scope.displaySubjectName = (subject) => subject.name;
    scope.state.nonMainKeyword = "示例动画";
    scope.state.nonMainResults = [{ id: 101, name: "示例动画" }];
    scope.state.nonMainSearched = true;
    const before = previewState(scope);
    assert.equal(scope.getInlineAutoPreviewKeyword(), "", "the display helper is gated by the previous binding");
    assert.equal(scope.suggestSearchKeyword(), "previous bound series");
    scope.nextRawTitle = "第2话 示例动画";
    scope.refreshPageContext();
    assert.deepEqual(previewState(scope), before, "page refresh must derive the new title without the old subject gate");
  });

  for (const rejectOld of [false, true]) {
    test(`${label}: changed preview keyword expires an old ${rejectOld ? "failure" : "success"} before searching the new title`, async () => {
      const scope = harness(source);
      scope.ensureNonMainPreviewSearch("示例动画");
      const oldSeq = scope.state.nonMainSearchSeq;
      scope.nextRawTitle = "第1话 新动画";
      scope.refreshPageContext();
      assert.equal(scope.state.pageTitle, "新动画");
      assert.equal(scope.state.nonMainKeyword, "");
      assert.equal(scope.state.nonMainResults.length, 0);
      assert.equal(scope.state.nonMainError, "");
      assert.equal(scope.state.nonMainBusy, false);
      assert.equal(scope.state.nonMainSearched, false);
      assert.equal(scope.state.nonMainSearchSeq, oldSeq + 1);
      scope.render();
      assert.equal(scope.requests.length, 2);
      assert.equal(scope.requests[1].options.body.keyword, "新动画");
      await settle(scope.requests[1], { data: [{ id: 202, name: "新动画" }] });
      const latest = previewState(scope);
      const renders = scope.renderCount;
      await settle(scope.requests[0], rejectOld ? new Error("obsolete preview failed") : { data: [{ id: 101 }] }, rejectOld);
      assert.deepEqual(previewState(scope), latest);
      assert.equal(scope.state.nonMainResults[0].id, 202);
      assert.equal(scope.renderCount, renders, "an expired response cannot replace or rerender the latest preview");
      assert.equal(scope.nonMainPreviewRequests.size, 0);
      scope.render();
      assert.equal(scope.requests.length, 2);
    });
  }
}
