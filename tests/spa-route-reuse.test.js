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

function routeHarness(source, extension, extraNames = []) {
  const collectionRefreshContext = {};
  const bundle = { subjectId: 101, token: "token-a", collectionRefreshContext };
  const scope = {
    Promise,
    routeRefreshSeq: 1,
    episodeContextRefreshSeq: 1,
    subjectSearchSeq: 0,
    subjectBundleRequests: new Map(),
    panelLoadProgress: { loadId: 1 },
    PANEL_ID: "panel",
    location: { href: "https://www.bilibili.com/video/BV1A?p=1" },
    panel: { inert: false },
    fullPanel: true,
    paused: false,
    next: { pageKey: "video:B", rawTitle: "Series episode 2", subjectId: 101, episodeNo: 2 },
    timers: [],
    renders: [],
    injections: [],
    recognitions: [],
    repositionCount: 0,
    episodeScheduleCount: 0,
    state: {
      pageKey: "video:A", routeSelectionKey: "video:A:p1", rawTitle: "Series episode 1", pageTitle: "Series",
      subjectId: 101, token: "token-a", subject: { id: 101, name: "Series" },
      subjectBundleContext: bundle, collectionRefreshContext,
      subjectInfoLinks: { Studio: "/person/7" }, subjectInfoWebRows: [{ key: "Studio", value: "Studio" }],
      characters: [{ id: 7 }], characterError: "",
      collection: { type: 3, rate: 8 }, episodes: [{ id: 1001, sort: 1 }, { id: 1002, sort: 2 }],
      episodeCollections: [{ episode: { id: 1001 }, type: 2 }],
      currentEpisodeNo: 1, currentEpisodeNumberSource: "label",
      routeRefreshPending: false, routeSubjectReuse: null, collectionWriteCount: 0, collectionWriteVersion: 0,
      busy: false, error: "", message: "Synced", searchResults: [], pendingCollection: null,
      autoEpisodeSyncing: false, autoEpisodeSyncLastKey: "old-episode",
      autoWatchFailures: { old: { retryAt: 123 } }, autoWatchLastVideoKey: "old-video",
      autoWatchLastVideoTime: 700, autoWatchLastObservedAt: 500,
      autoWatchSawHiddenSinceLastObservation: true, autoWatchSeekStartTime: 690, autoWatchBlockedKey: "old-video",
      longVideoEpisodeGuess: { active: true }, longVideoEpisodeRenderKey: "old-guess",
      longVideoDetectionCache: {}, longVideoDetectionKeyMemo: {}, longVideoIdentifyDismissedKey: "old-part",
      inlineConfirm: null, longVideoBindingPrompt: null, apiRelayPrompt: null,
      bindingGuardMessage: "", standaloneSearchExpanded: false,
    },
    invalidatePageInitialState: noop,
    refreshPageInitialState: () => Promise.resolve(),
    removeModal: noop,
    removeBgmApiRelayPrompt: noop,
    settleInlineConfirm: noop,
    hideEpisodeTooltip: noop,
    clearLongVideoBindingPrompt: noop,
    finishPanelLoad: noop,
    refreshOpedSkipButton: noop,
    refreshDanmakuFavoriteButtons: noop,
    showError: (error) => { throw error; },
    refreshStandaloneEpisodeInference: async () => {},
    isVideoCollectionSelectionAheadOfRoute: () => false,
    normalizeBindingToken: (value) => String(value || "").toLowerCase(),
  };
  scope.window = { setTimeout: (callback, delay) => { scope.timers.push({ callback, delay }); return scope.timers.length; } };
  scope.document = { getElementById: () => scope.panel };
  scope.getPageTitle = () => scope.next.rawTitle;
  scope.getPageKey = () => scope.next.pageKey;
  scope.getCurrentRouteSelectionKey = () => scope.next.routeSelectionKey || `${scope.next.pageKey}:p1`;
  scope.getCurrentBinding = () => scope.next.subjectId;
  scope.shouldRenderFullPanel = () => scope.fullPanel;
  scope.isCurrentVideoAutoProgressDisabled = () => scope.paused;
  scope.detectCurrentEpisodeNo = () => {
    scope.recognitions.push({ subjectId: scope.state.subjectId, guess: scope.state.longVideoEpisodeGuess });
    scope.state.currentEpisodeNumberSource = "ordinal";
    return scope.next.episodeNo;
  };
  scope.refreshPageContext = () => {
    scope.state.pageKey = scope.next.pageKey;
    scope.state.routeSelectionKey = scope.getCurrentRouteSelectionKey();
    scope.state.rawTitle = scope.next.rawTitle;
    // Recognition must run again after binding resolution and player reset.
    scope.state.currentEpisodeNo = -1;
  };
  scope.render = (incremental = false) => { scope.renders.push(incremental); };
  scope.injectWhenReady = (force) => { scope.injections.push(force); };
  scope.repositionPanel = () => { scope.repositionCount += 1; };
  scope.scheduleEpisodeContextRefresh = () => { scope.episodeScheduleCount += 1; };
  const names = [
    "scheduleRouteRefresh", "refreshAfterRouteChange", "schedulePanelReposition", "resetAutoWatchObservationState",
    "refreshCurrentEpisodeRecognitionState", "trackCollectionWrite",
    "captureCollectionOperationContext", "isCollectionOperationContextCurrent",
    ...(extension ? ["captureRouteContext", "isRouteContextCurrent"] : ["capturePageContext", "isCurrentPageContext"]),
    ...extraNames,
  ];
  runInSandbox(functions(source, [...new Set(names)]), scope);
  return scope;
}

function beginRoute(scope) {
  scope.scheduleRouteRefresh(scope.state.rawTitle, scope.state.pageKey);
  return scope.routeRefreshSeq;
}

function completeRoute(scope, seq = scope.routeRefreshSeq) {
  scope.refreshAfterRouteChange(seq, "Series episode 1", "video:A", true);
}

async function fireTimers(scope) {
  const timers = scope.timers.splice(0);
  timers.forEach(({ callback }) => callback());
  await Promise.resolve();
  await Promise.resolve();
}

function assertReloaded(scope, message) {
  assert.equal(scope.state.subject, null, message);
  assert.equal(scope.state.subjectBundleContext, null, message);
  for (const field of ["characters", "episodes", "episodeCollections"]) assert.equal(scope.state[field].length, 0, message);
  assert.equal(scope.state.collection, null, message);
  assert.deepEqual(scope.injections, [true], message);
  assert.equal(scope.renders.includes(true), false, message);
  assert.equal(scope.state.routeRefreshPending, false, message);
}

function bundleHarness(source, extension) {
  const scope = routeHarness(source, extension, ["loadSubjectBundle", "loadSubjectBundleFresh", "loadSubjectBundlePreservingLocal"]);
  scope.setBusy = (message) => { scope.state.busy = true; scope.state.message = message; };
  scope.createBgmApiRelayScope = () => ({});
  scope.getCollectionReadPath = async () => "/v0/users/account-a/collections/101";
  scope.beginPanelLoad = () => 2;
  scope.advancePanelLoad = noop;
  scope.bgmRequest = async (path) => path.startsWith("/v0/subjects/")
    ? { id: 101, name: "Loaded Series" } : { type: 3, rate: 9 };
  scope.bgmRequestPagedData = async (path) => ({ data: path.startsWith("/v0/episodes?")
    ? [{ id: 1001, sort: 1 }] : [{ episode: { id: 1001 }, type: 2 }] });
  scope.loadSubjectCharacters = async () => ({ characters: [{ id: 8 }], error: "" });
  scope.rememberBindingSubject = async () => {};
  scope.mergePendingCollection = (collection) => collection;
  scope.refreshSubjectInfoLinksInBackground = noop;
  scope.checkAutoWatchProgress = async () => {};
  scope.state.subjectBundleContext = null;
  return scope;
}

for (const [label, file, extension] of [["userscript", USERSCRIPT_PATH, false], ["extension", EXTENSION_PATH, true]]) {
  const source = readSource(file);

  test(`${label}: route selection distinguishes P and ignores tracking parameters`, () => {
    const scope = { URL, location: { href: "https://www.bilibili.com/video/BV1SXTd6fEnC?p=1&spm_id_from=old" } };
    runInSandbox(functions(source, ["getCurrentRouteSelectionKey", "getCurrentRouteKey", "getCurrentPartNoFromUrl"]), scope);
    const first = scope.getCurrentRouteSelectionKey();
    scope.location.href = "https://www.bilibili.com/video/BV1SXTd6fEnC?p=2&spm_id_from=new";
    assert.notEqual(scope.getCurrentRouteSelectionKey(), first);
    const second = scope.getCurrentRouteSelectionKey();
    scope.location.href = "https://www.bilibili.com/video/BV1SXTd6fEnC?p=2&spm_id_from=other";
    assert.equal(scope.getCurrentRouteSelectionKey(), second);
  });

  test(`${label}: a sidebar BV or P selection ahead of the URL is recognized as a partial transition`, () => {
    let selected = [{ bvid: "BV1GfeJ6PEWC", activePart: 1, itemClass: "normal" }];
    const item = ({ bvid, activePart }) => ({
      getAttribute: () => bvid,
      querySelectorAll: () => Array.from({ length: 7 }, (_, index) => ({ active: index + 1 === activePart })),
    });
    const scope = {
      getBvIdFromUrl: () => "BV1D4bV6AE8p",
      getCurrentPartNoFromUrl: () => 2,
      isActiveVideoPartNode: (node) => node.active,
      document: { querySelectorAll: (selector) => selected.filter((record) => (
        !selector.includes(":is(.head, .normal)") || ["head", "normal"].includes(record.itemClass)
      )).map((record) => ({
        closest: () => item(record),
      })) },
    };
    runInSandbox(functions(source, ["isVideoCollectionSelectionAheadOfRoute"]), scope);
    assert.equal(scope.isVideoCollectionSelectionAheadOfRoute(), true);
    selected = [{ bvid: "BV1D4bV6AE8p", activePart: 3, itemClass: "head" }];
    assert.equal(scope.isVideoCollectionSelectionAheadOfRoute(), true, "same-BV P3 is ahead of the URL's P2");
    selected = [{ bvid: "BV1D4bV6AE8p", activePart: 2, itemClass: "head" }];
    assert.equal(scope.isVideoCollectionSelectionAheadOfRoute(), false);
    selected = [{ bvid: "BV1GfeJ6PEWC", activePart: 1, itemClass: "normal" }, { bvid: "BV1D4bV6AE8p", activePart: 2, itemClass: "page-item" }];
    assert.equal(scope.isVideoCollectionSelectionAheadOfRoute(), true, "a stale P active in the old BV cannot outvote the new single-P active item");
    selected = [{ bvid: "BV1D4bV6AE8p", activePart: 2, itemClass: "head" }, { bvid: "BV1GfeJ6PEWC", activePart: 1, itemClass: "normal" }];
    assert.equal(scope.isVideoCollectionSelectionAheadOfRoute(), false, "ambiguous active markers do not override the current route");
  });

  test(`${label}: a settled same-subject route preserves the complete bundle and resets episode observations`, () => {
    const scope = routeHarness(source, extension);
    const retained = Object.fromEntries([
      "subject", "subjectBundleContext", "subjectInfoLinks", "subjectInfoWebRows", "characters",
      "collection", "episodes", "episodeCollections",
    ].map((field) => [field, scope.state[field]]));
    const oldOperation = scope.captureCollectionOperationContext();
    const oldSeq = scope.routeRefreshSeq;
    const loadId = scope.panelLoadProgress.loadId;
    const seq = beginRoute(scope);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.panel.inert, true);
    assert.equal(scope.renders.length, 0, "the pending route must not replace the settled display with loading UI");
    assert.equal(scope.isCollectionOperationContextCurrent(oldOperation), false, "old writes expire as soon as navigation starts");
    completeRoute(scope, seq);
    for (const [field, value] of Object.entries(retained)) assert.equal(scope.state[field], value, `${field} is reused by identity`);
    assert.equal(scope.state.currentEpisodeNo, 2);
    assert.equal(scope.state.currentEpisodeNumberSource, "ordinal");
    assert.deepEqual(scope.recognitions, [{ subjectId: 101, guess: null }]);
    assert.equal(scope.state.autoEpisodeSyncLastKey, "");
    assert.equal(Object.keys(scope.state.autoWatchFailures).length, 0);
    assert.equal(scope.state.autoWatchLastVideoKey, "");
    assert.equal(scope.state.autoWatchLastVideoTime, 0);
    assert.equal(scope.state.autoWatchLastObservedAt, 0);
    assert.equal(scope.state.autoWatchSawHiddenSinceLastObservation, false);
    assert.equal(scope.state.autoWatchSeekStartTime, null);
    assert.equal(scope.state.autoWatchBlockedKey, "");
    for (const field of ["longVideoEpisodeGuess", "longVideoDetectionCache", "longVideoDetectionKeyMemo"]) assert.equal(scope.state[field], null);
    assert.equal(scope.state.longVideoIdentifyDismissedKey, "");
    assert.equal(scope.state.busy, false);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.equal(scope.state.routeSubjectReuse, null);
    assert.equal(scope.routeRefreshSeq, oldSeq + 2);
    assert.equal(scope.panelLoadProgress.loadId, loadId + 1, "old load-progress callbacks are invalidated");
    assert.deepEqual(scope.renders, [true]);
    assert.deepEqual(scope.injections, []);
    assert.equal(scope.repositionCount, 1);
    assert.equal(scope.episodeScheduleCount, 1);
    assert.equal(scope.isCollectionOperationContextCurrent(oldOperation), false);
    assert.equal(scope.isCollectionOperationContextCurrent(scope.captureCollectionOperationContext()), true);
  });

  test(`${label}: a reused panel follows a layout anchor that expands after navigation settles`, () => {
    const scope = routeHarness(source, extension, ["repositionPanel", "layoutPanelWithoutOwningBiliDom"]);
    let anchorBottom = 100;
    const anchor = { getBoundingClientRect: () => ({ bottom: anchorBottom }) };
    const rightColumn = {
      querySelector: () => ({ querySelector: () => anchor }),
      getBoundingClientRect: () => ({ left: 900, width: 340 }),
    };
    scope.document.body = {};
    Object.assign(scope.panel, {
      parentElement: scope.document.body,
      style: {},
      classList: { toggle: noop },
      getBoundingClientRect: () => ({ height: 400 }),
    });
    scope.findRightColumn = () => rightColumn;
    scope.findOfficialBangumiLayoutAnchor = () => null;
    scope.hasOverlappingBiliMusicOverlay = () => false;
    scope.isVisible = () => true;
    scope.reserveLayoutSpace = noop;
    scope.stabilizePanelReserve = (_panel, reserve) => reserve;
    const panel = scope.panel;
    const subject = scope.state.subject;
    beginRoute(scope);
    scope.timers.length = 0;
    completeRoute(scope);
    assert.equal(panel.style.top, "112px");
    const layoutTimers = scope.timers.splice(0).sort((left, right) => left.delay - right.delay);
    for (const timer of layoutTimers.filter(({ delay }) => delay < 600)) timer.callback();
    anchorBottom += 140;
    for (const timer of layoutTimers.filter(({ delay }) => delay >= 600)) timer.callback();
    assert.equal(panel.style.top, "252px", "late Bilibili layout changes must reposition the retained panel without scrolling");
    assert.equal(scope.panel, panel);
    assert.equal(scope.state.subject, subject);
    assert.deepEqual(scope.injections, [], "layout recovery must not remount or reload the subject");
  });

  test(`${label}: repeated route notifications and a rapid second navigation keep one reusable snapshot`, async () => {
    const scope = routeHarness(source, extension);
    const original = scope.state.subjectBundleContext;
    beginRoute(scope);
    const firstSeq = scope.routeRefreshSeq;
    beginRoute(scope);
    assert.equal(scope.state.routeSubjectReuse, original, "the duplicate must not recapture busy=true as a failed candidate");
    scope.next = { pageKey: "video:C", rawTitle: "Series episode 3", subjectId: 101, episodeNo: 3 };
    beginRoute(scope);
    completeRoute(scope, firstSeq);
    assert.equal(scope.state.pageKey, "video:A", "a superseded route callback must not consume the latest DOM");
    await fireTimers(scope);
    assert.equal(scope.state.pageKey, "video:C");
    assert.equal(scope.state.currentEpisodeNo, 3);
    assert.equal(scope.state.subjectBundleContext, original);
    assert.deepEqual(scope.renders, [true]);
    assert.equal(scope.episodeScheduleCount, 1);
    assert.deepEqual(scope.injections, []);
  });

  test(`${label}: route reuse waits for page-state readiness and ignores a superseded pending bridge`, async () => {
    const scope = routeHarness(source, extension);
    const oldBridge = deferred();
    const newBridge = deferred();
    scope.refreshPageInitialState = () => oldBridge.promise;
    beginRoute(scope);
    const firstTimers = scope.timers.splice(0);
    firstTimers[0].callback();
    await Promise.resolve();
    assert.equal(scope.state.pageKey, "video:A");
    scope.refreshPageInitialState = () => newBridge.promise;
    scope.next = { pageKey: "video:C", rawTitle: "Series episode 3", subjectId: 101, episodeNo: 3 };
    beginRoute(scope);
    scope.timers[0].callback();
    oldBridge.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(scope.state.pageKey, "video:A");
    assert.equal(scope.renders.length, 0);
    newBridge.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(scope.state.pageKey, "video:C");
    assert.deepEqual(scope.renders, [true]);
  });

  test(`${label}: a same-key and same-title route still settles at the forced pass`, () => {
    const scope = routeHarness(source, extension);
    scope.next.pageKey = scope.state.pageKey;
    scope.next.rawTitle = scope.state.rawTitle;
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.renders.length, 0);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, true);
    assert.equal(scope.state.currentEpisodeNo, 2);
    assert.deepEqual(scope.renders, [true]);
  });

  test(`${label}: a same-BV part switch settles on the first ready pass despite an unchanged H1`, () => {
    const scope = routeHarness(source, extension);
    scope.next.pageKey = scope.state.pageKey;
    scope.next.rawTitle = scope.state.rawTitle;
    scope.next.routeSelectionKey = "video:A:p2";
    const originalPanel = scope.panel;
    const originalBundle = scope.state.subjectBundleContext;
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.equal(scope.state.routeSelectionKey, "video:A:p2");
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    assert.equal(scope.panel, originalPanel);
    assert.equal(scope.state.currentEpisodeNo, 2);
    assert.deepEqual(scope.renders, [true]);
    assert.deepEqual(scope.injections, []);
  });

  test(`${label}: a P selection ahead of the URL leaves the old panel reusable`, () => {
    const scope = routeHarness(source, extension, ["refreshEpisodeContextIfChanged"]);
    const originalPanel = scope.panel;
    const originalBundle = scope.state.subjectBundleContext;
    scope.isVideoCollectionSelectionAheadOfRoute = () => true;
    scope.refreshCurrentBindingIfChanged = () => { scope.state.subject = null; scope.state.subjectBundleContext = null; };
    scope.refreshEpisodeContextIfChanged(scope.episodeContextRefreshSeq);
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    scope.isVideoCollectionSelectionAheadOfRoute = () => false;
    scope.next.pageKey = scope.state.pageKey;
    scope.next.rawTitle = scope.state.rawTitle;
    scope.next.routeSelectionKey = "video:A:p3";
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    assert.equal(scope.panel, originalPanel);
    assert.deepEqual(scope.renders, [true]);
    assert.deepEqual(scope.injections, []);
  });

  test(`${label}: official ep routes with an unchanged H1 and page key keep the existing settle delay`, () => {
    const scope = routeHarness(source, extension);
    scope.state.routeSelectionKey = "/bangumi/play/ep101";
    scope.next.pageKey = scope.state.pageKey;
    scope.next.rawTitle = scope.state.rawTitle;
    scope.next.routeSelectionKey = "/bangumi/play/ep102";
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, true);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, true);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.deepEqual(scope.renders, [true]);
  });

  test(`${label}: a new BV waits for its H1 before resolving the binding`, () => {
    const scope = routeHarness(source, extension);
    const originalPanel = scope.panel;
    const originalBundle = scope.state.subjectBundleContext;
    scope.next.rawTitle = scope.state.rawTitle;
    scope.next.subjectId = null; // The old H1 does not identify the new archive yet.
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    assert.equal(scope.state.subjectId, 101);
    assert.deepEqual(scope.injections, []);
    scope.next.rawTitle = "Series episode 2";
    scope.next.subjectId = 101;
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    assert.equal(scope.panel, originalPanel);
    assert.deepEqual(scope.renders, [true]);
    assert.deepEqual(scope.injections, []);
  });

  test(`${label}: a stable binding page key does not hide a cross-BV title transition`, () => {
    const scope = routeHarness(source, extension);
    scope.next.pageKey = scope.state.pageKey;
    scope.next.routeSelectionKey = "video:B:p1";
    scope.next.rawTitle = scope.state.rawTitle;
    scope.next.subjectId = null;
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, true);
    assert.equal(scope.state.subjectId, 101);
    scope.next.rawTitle = "Series episode 2";
    scope.next.subjectId = 101;
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, false);
    assert.deepEqual(scope.renders, [true]);
    assert.deepEqual(scope.injections, []);
  });

  test(`${label}: active sidebar BV, route, and H1 may settle in that order without dropping the panel`, () => {
    const scope = routeHarness(source, extension, ["refreshEpisodeContextIfChanged"]);
    const originalPanel = scope.panel;
    const originalBundle = scope.state.subjectBundleContext;
    let bindingChecks = 0;
    let sidebarAhead = true;
    scope.isVideoCollectionSelectionAheadOfRoute = () => sidebarAhead;
    scope.refreshCurrentBindingIfChanged = () => { bindingChecks += 1; scope.state.subject = null; };
    scope.next.pageKey = scope.state.pageKey;
    scope.next.rawTitle = scope.state.rawTitle;
    scope.next.subjectId = null;
    scope.refreshEpisodeContextIfChanged(scope.episodeContextRefreshSeq);
    assert.equal(bindingChecks, 0);
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    assert.equal(scope.state.subject?.id, 101);
    sidebarAhead = false;
    scope.next.pageKey = "video:B";
    const seq = beginRoute(scope);
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.routeRefreshPending, true, "the new BV still shows the previous H1");
    scope.next.rawTitle = "Series episode 2";
    scope.next.subjectId = 101;
    scope.refreshAfterRouteChange(seq, scope.state.rawTitle, scope.state.pageKey, false);
    assert.equal(scope.state.subjectBundleContext, originalBundle);
    assert.equal(scope.panel, originalPanel);
    assert.deepEqual(scope.injections, []);
    assert.deepEqual(scope.renders, [true]);
  });

  test(`${label}: changed subject, unbound page, token, and panel eligibility force a fresh bundle`, () => {
    const cases = [
      ["different subject", (scope) => { scope.next.subjectId = 202; }],
      ["unbound", (scope) => { scope.next.subjectId = null; }],
      ["changed token", (scope) => { scope.state.token = "token-b"; }],
      ["search-only panel", (scope) => { scope.fullPanel = false; }],
      ["new collection operation", (scope) => { scope.state.collectionRefreshContext = {}; }],
      ["replaced snapshot with the same values", (scope) => { scope.state.subjectBundleContext = { ...scope.state.subjectBundleContext }; }],
    ];
    for (const [name, change] of cases) {
      const scope = routeHarness(source, extension);
      beginRoute(scope);
      change(scope);
      completeRoute(scope);
      assertReloaded(scope, name);
      assert.equal(scope.recognitions[0].subjectId, scope.next.subjectId, `${name}: recognize only after resolving the new binding`);
    }
  });

  test(`${label}: incomplete or unconfirmed state cannot be captured for reuse`, () => {
    const cases = [
      ["busy", (scope) => { scope.state.busy = true; }],
      ["automatic episode mutation", (scope) => { scope.state.autoEpisodeSyncing = true; }],
      ["write count despite idle UI", (scope) => { scope.state.collectionWriteCount = 1; }],
      ["pending optimistic collection", (scope) => { scope.state.pendingCollection = { subjectId: 101, rate: 9 }; }],
      ["failed prior operation", (scope) => { scope.state.error = "Read failed"; }],
      ["unfinished initial load", (scope) => { scope.state.subject = null; }],
      ["no completed snapshot", (scope) => { scope.state.subjectBundleContext = null; }],
      ["loaded subject differs", (scope) => { scope.state.subject = { id: 202 }; }],
      ["snapshot subject differs", (scope) => { scope.state.subjectBundleContext.subjectId = 202; }],
      ["snapshot belongs to old token", (scope) => { scope.state.subjectBundleContext.token = "token-old"; }],
      ["snapshot predates latest write", (scope) => { scope.state.collectionRefreshContext = {}; }],
      ["in-flight bundle despite idle UI", (scope) => { scope.subjectBundleRequests.set("pending", {}); }],
      ["inline confirmation", (scope) => { scope.state.inlineConfirm = {}; }],
      ["long-video prompt", (scope) => { scope.state.longVideoBindingPrompt = {}; }],
      ["relay prompt", (scope) => { scope.state.apiRelayPrompt = {}; }],
      ["unresolved search", (scope) => { scope.state.searchResults = [{ id: 202 }]; }],
    ];
    for (const [name, change] of cases) {
      const scope = routeHarness(source, extension);
      change(scope);
      beginRoute(scope);
      assert.equal(scope.state.routeSubjectReuse, null, name);
      completeRoute(scope);
      assertReloaded(scope, name);
    }
  });

  test(`${label}: token A to B to A during pending navigation cannot revive the snapshot of cleared collection data`, () => {
    const scope = routeHarness(source, extension, ["setAccessTokenState"]);
    scope.pendingRequests = new Map();
    const original = scope.state.subjectBundleContext;
    beginRoute(scope);
    assert.equal(scope.state.routeSubjectReuse, original);
    assert.equal(scope.setAccessTokenState("token-b"), true);
    assert.equal(scope.state.subjectBundleContext, null);
    assert.equal(scope.state.collection, null);
    assert.equal(scope.state.episodeCollections.length, 0);
    assert.equal(scope.setAccessTokenState("token-a"), true);
    assert.equal(scope.state.token, original.token, "the token string alone matches the pre-navigation snapshot again");
    assert.equal(scope.state.subjectBundleContext, null, "switching back must require a clean account-data read");
    assert.equal(scope.state.routeSubjectReuse, original, "the earlier candidate cannot override snapshot invalidation");
    completeRoute(scope);
    assertReloaded(scope, "an account roundtrip must not preserve the cleared mutable bundle");
  });

  test(`${label}: paused episode tracking is recomputed without discarding a settled bundle`, () => {
    const scope = routeHarness(source, extension);
    const subject = scope.state.subject;
    scope.paused = true;
    beginRoute(scope);
    completeRoute(scope);
    assert.equal(scope.state.subject, subject);
    assert.equal(scope.state.currentEpisodeNo, null);
    assert.equal(scope.recognitions.length, 0);
    assert.deepEqual(scope.renders, [true]);
  });

  test(`${label}: a removed panel is mounted again even when subject data was reusable`, () => {
    const scope = routeHarness(source, extension);
    const subject = scope.state.subject;
    beginRoute(scope);
    scope.panel = null;
    completeRoute(scope);
    assert.equal(scope.state.subject, subject);
    assert.deepEqual(scope.injections, [true]);
    assert.equal(scope.renders.includes(true), false);
  });

  test(`${label}: collection writes invalidate captured snapshots on start, resolution, and rejection`, async () => {
    const scope = routeHarness(source, extension);
    const first = deferred();
    const second = deferred();
    beginRoute(scope);
    const firstTask = scope.trackCollectionWrite(first.promise);
    const secondTask = scope.trackCollectionWrite(second.promise);
    assert.equal(scope.state.collectionWriteCount, 2);
    assert.equal(scope.state.subjectBundleContext, null);
    scope.state.subjectBundleContext = { subjectId: 101, token: "token-a", collectionRefreshContext: scope.state.collectionRefreshContext };
    first.resolve("saved");
    assert.equal(await firstTask, "saved");
    assert.equal(scope.state.collectionWriteCount, 1);
    assert.equal(scope.state.subjectBundleContext, null, "a read racing the completed write cannot stay reusable");
    scope.state.subjectBundleContext = { subjectId: 101, token: "token-a", collectionRefreshContext: scope.state.collectionRefreshContext };
    const failed = assert.rejects(secondTask, /write rejected/);
    second.reject(new Error("write rejected"));
    await failed;
    assert.equal(scope.state.collectionWriteCount, 0);
    assert.equal(scope.state.subjectBundleContext, null);
    scope.state.busy = false;
    completeRoute(scope);
    assertReloaded(scope, "a captured candidate cannot revive after both writes finish");
  });

  test(`${label}: a fresh snapshot in a gap between writes cannot revive the captured route candidate`, async () => {
    const scope = routeHarness(source, extension);
    beginRoute(scope);
    const original = scope.state.routeSubjectReuse;
    await scope.trackCollectionWrite(Promise.resolve());
    scope.state.subjectBundleContext = { ...original };
    assert.equal(scope.state.collectionWriteCount, 0);
    completeRoute(scope);
    assertReloaded(scope, "equal values do not make a replacement snapshot the captured snapshot");
  });

  test(`${label}: a completed delayed progress refresh expires while its local progress remains available`, () => {
    const scope = routeHarness(source, extension);
    const completedProgress = scope.state.episodeCollections;
    const context = scope.captureCollectionOperationContext();
    let delayedReads = 0;
    const delayedRefresh = () => {
      if (scope.isCollectionOperationContextCurrent(context)) delayedReads += 1;
    };
    beginRoute(scope);
    completeRoute(scope);
    delayedRefresh();
    assert.equal(delayedReads, 0);
    assert.equal(scope.state.episodeCollections, completedProgress);
    assert.equal(scope.state.episodeCollections[0].type, 2);
  });

  test(`${label}: pending navigation and sidebar selection ahead of URL stop old-episode side effects`, async () => {
    const scope = routeHarness(source, extension, ["checkAutoWatchProgress", "handleAutoWatchSeekEnd", "refreshEpisodeContextIfChanged"]);
    let watchChecks = 0;
    let seekChecks = 0;
    let episodeChecks = 0;
    scope.isSupportedWatchPage = () => { watchChecks += 1; return false; };
    scope.isCurrentVideoAutoProgressDisabled = () => { seekChecks += 1; return true; };
    scope.refreshCurrentBindingIfChanged = () => { episodeChecks += 1; };
    scope.state.routeRefreshPending = true;
    await scope.checkAutoWatchProgress();
    scope.handleAutoWatchSeekEnd({ currentTime: 900 });
    scope.refreshEpisodeContextIfChanged(scope.episodeContextRefreshSeq);
    assert.equal(watchChecks, 0);
    assert.equal(seekChecks, 0);
    assert.equal(episodeChecks, 0);
    assert.equal(scope.state.autoWatchSeekStartTime, 690);
    scope.state.routeRefreshPending = false;
    scope.isVideoCollectionSelectionAheadOfRoute = () => true;
    await scope.checkAutoWatchProgress();
    scope.handleAutoWatchSeekEnd({ currentTime: 900 });
    scope.refreshEpisodeContextIfChanged(scope.episodeContextRefreshSeq);
    assert.equal(watchChecks, 0);
    assert.equal(seekChecks, 0);
    assert.equal(episodeChecks, 0);
    assert.equal(scope.state.autoWatchSeekStartTime, 690);
    scope.isVideoCollectionSelectionAheadOfRoute = () => false;
    scope.state.currentEpisodeNo = null;
    await scope.checkAutoWatchProgress();
    scope.handleAutoWatchSeekEnd({ currentTime: 900 });
    scope.refreshEpisodeContextIfChanged(scope.episodeContextRefreshSeq - 1);
    assert.equal(episodeChecks, 0, "old timer sequence remains invalid after the pending gate opens");
    scope.refreshEpisodeContextIfChanged(scope.episodeContextRefreshSeq);
    assert.equal(watchChecks, 1);
    assert.equal(seekChecks, 2);
    assert.equal(episodeChecks, 1);
    assert.equal(scope.state.autoWatchSeekStartTime, null);
  });

  test(`${label}: successful bundle reads record subject, token, and write context only when no write is pending`, async () => {
    for (const loader of ["loadSubjectBundle", "loadSubjectBundlePreservingLocal"]) {
      for (const writeCount of [0, 1]) {
        const scope = bundleHarness(source, extension);
        scope.state.collectionWriteCount = writeCount;
        await scope[loader](null);
        assert.equal(scope.state.subject.name, "Loaded Series");
        if (writeCount) assert.equal(scope.state.subjectBundleContext, null, loader);
        else {
          const context = scope.state.subjectBundleContext;
          assert.equal(context.subjectId, 101, loader);
          assert.equal(context.token, "token-a", loader);
          assert.equal(context.collectionRefreshContext, scope.state.collectionRefreshContext, loader);
        }
        assert.equal(scope.subjectBundleRequests.size, 0);
      }
    }
  });

  test(`${label}: a bundle completing after a route, token, or write-context change cannot create a reusable snapshot`, async () => {
    for (const loader of ["loadSubjectBundle", "loadSubjectBundlePreservingLocal"]) {
      for (const change of ["route", "token", "subject", "write-context"]) {
        const scope = bundleHarness(source, extension);
        const entered = deferred();
        const gate = deferred();
        scope.rememberBindingSubject = async () => { entered.resolve(); await gate.promise; };
        const task = scope[loader](null);
        await entered.promise;
        if (change === "route") scope.routeRefreshSeq += 1;
        if (change === "token") scope.state.token = "token-b";
        if (change === "subject") scope.state.subjectId = 202;
        if (change === "write-context") scope.state.collectionRefreshContext = {};
        const currentSubject = scope.state.subject;
        gate.resolve();
        await task;
        assert.equal(scope.state.subjectBundleContext, null, `${loader}: ${change}`);
        assert.equal(scope.state.subject, currentSubject, `${loader}: ${change}`);
        assert.equal(scope.subjectBundleRequests.size, 0);
      }
    }
  });

  test(`${label}: reads spanning a successful or failed write remain ineligible even after the write count returns to zero`, async () => {
    for (const loader of ["loadSubjectBundle", "loadSubjectBundlePreservingLocal"]) {
      for (const start of ["write already pending", "write starts during read"]) {
        for (const outcome of ["success", "failure"]) {
          const scope = bundleHarness(source, extension);
          const entered = deferred();
          const readGate = deferred();
          const writeGate = deferred();
          scope.rememberBindingSubject = async () => { entered.resolve(); await readGate.promise; };
          let writing;
          if (start === "write already pending") writing = scope.trackCollectionWrite(writeGate.promise);
          const loading = scope[loader](null);
          await entered.promise;
          if (start === "write starts during read") writing = scope.trackCollectionWrite(writeGate.promise);
          if (outcome === "failure") {
            const rejected = assert.rejects(writing, /write failed/);
            writeGate.reject(new Error("write failed"));
            await rejected;
          } else {
            writeGate.resolve();
            await writing;
          }
          assert.equal(scope.state.collectionWriteCount, 0);
          readGate.resolve();
          await loading;
          const scenario = `${loader}: ${start}, ${outcome}`;
          assert.equal(scope.state.subjectBundleContext, null, `${scenario}: finishing last must not certify the older read`);
          beginRoute(scope);
          assert.equal(scope.state.routeSubjectReuse, null, `${scenario}: the next episode must refetch mutable data`);
          completeRoute(scope);
          assertReloaded(scope, scenario);

          scope.rememberBindingSubject = async () => {};
          await scope[loader](null);
          assert.equal(scope.state.subjectBundleContext.subjectId, 101, `${scenario}: a subsequent clean read can restore reuse`);
          assert.equal(scope.state.subjectBundleContext.collectionRefreshContext, scope.state.collectionRefreshContext);
        }
      }
    }
  });

  test(`${label}: authenticated collection mutation requests engage the write tracker while reads and searches do not`, async () => {
    const cases = [
      ["POST", "/v0/users/-/collections/101", true, true],
      ["PATCH", "/v0/users/-/collections/101", true, true],
      ["PATCH", "/v0/users/-/collections/101/episodes", true, true],
      ["DELETE", "/v0/users/-/collections/101", true, true],
      ["GET", "/v0/users/-/collections/101", true, false],
      ["POST", "/v0/search/subjects", false, false],
    ];
    for (const [method, path, auth, tracked] of cases) {
      const scope = routeHarness(source, extension, ["bgmRequest"]);
      const gate = deferred();
      const context = scope.state.subjectBundleContext;
      scope.API_BASE = "https://example.invalid";
      scope.BGM_API_RELAYS = {};
      scope.pendingRequests = new Map();
      scope.REQUEST_DEDUP_TTL = 1000;
      scope.buildBgmApiUrl = (value, base) => `${base}${value}`;
      scope.bgmRequestWithRetry = () => gate.promise;
      scope.isRelayEligibleTransportError = () => false;
      const request = scope.bgmRequest(path, { method, auth });
      assert.equal(scope.state.collectionWriteCount, tracked ? 1 : 0, `${method} ${path}`);
      assert.equal(scope.state.subjectBundleContext, tracked ? null : context, `${method} ${path}`);
      gate.resolve({ ok: true });
      await request;
      assert.equal(scope.state.collectionWriteCount, 0);
      assert.equal(scope.state.subjectBundleContext, tracked ? null : context);
    }
  });
}
