"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, extractObjectConstant, canonicalizeAdapterSyntax } = require("./_source");

const noop = () => {};
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sandbox(source, extension, names, extra = {}) {
  const timers = [];
  const state = {
    subjectId: 101, pageKey: "page-A", token: "TOKEN_A", username: "account_A",
    subject: { id: 101, name: "A" }, collection: { type: 3, rate: 4, comment: "A" },
    pendingCollection: null, episodes: [{ id: 1001, type: 0, sort: 1 }, { id: 1002, type: 0, sort: 2 }],
    episodeCollections: [], syncHistory: {},
  };
  const scope = {
    state, timers, routeRefreshSeq: 1, subjectSearchSeq: 0, location: { href: "https://www.bilibili.com/video/A", hostname: "www.bilibili.com" },
    window: { setTimeout: (callback) => timers.push(callback) },
    document: { querySelector: () => ({ value: "1" }), getElementById: () => null },
    PANEL_ID: "panel", SETTINGS_ID: "settings", STORAGE: extractObjectConstant(source, "STORAGE"),
    pendingRequests: new Map(), setBusy: noop, render: noop, showError: noop,
    writeJsonValue: noop, displaySubjectName: (subject) => subject.name,
    loadSubjectBundle: async () => {}, loadSubjectBundlePreservingLocal: async () => {},
    refreshSettingsTokenHelp: noop, shouldRenderFullPanel: () => false,
    ...extra,
  };
  const functions = [...new Set([
    "captureCollectionOperationContext", "isCollectionOperationContextCurrent", "setAccessTokenState",
    "ensureToken", "hasCollection", "getCollectionType", "ensureCollectionForEpisodeSync",
    "getNormalEpisodes", "getEpisodeCollectionType",
    ...(extension ? ["captureRouteContext", "isRouteContextCurrent", "ensureRouteContext"] : ["capturePageContext", "isCurrentPageContext"]),
    ...names,
  ])];
  vm.createContext(scope);
  vm.runInContext(functions.map((name) => extractFunction(source, name, {
    async: source.includes(`  async function ${name}(`),
  })).join("\n") + `\n;globalThis.api = { ${functions.join(",")} };`, scope);
  return scope;
}

function changeContext(scope, kind) {
  if (kind === "token") scope.api.setAccessTokenState("TOKEN_B");
  if (kind === "route") {
    scope.routeRefreshSeq += 1;
    scope.location.href = "https://www.bilibili.com/video/B";
    scope.state.pageKey = "page-B";
    scope.state.subjectId = 202;
    scope.state.subject = { id: 202, name: "B" };
    scope.state.episodes = [{ id: 2001, type: 0, sort: 1 }];
  }
  scope.state.collection = { type: 3, rate: 2, comment: "B" };
  scope.state.episodeCollections = [];
}

async function testProgress(source, extension) {
  for (const kind of ["success", "token", "route"]) {
    const gate = deferred();
    const calls = [];
    const scope = sandbox(source, extension, ["saveProgressFromInput", "patchEpisodes", "recordEpisodeSync", "pruneSyncHistory", "applyLocalEpisodeProgress"], {
      bgmRequest: async (path, options) => { calls.push({ path, options }); if (calls.length === 1) await gate.promise; },
    });
    scope.state.episodeCollections = [{ episode: scope.state.episodes[1], type: 2 }];
    const task = scope.api.saveProgressFromInput();
    assert.equal(calls.length, 1);
    if (kind !== "success") changeContext(scope, kind);
    gate.resolve();
    await task;
    assert.equal(calls.length, kind === "success" ? 2 : 1, `${kind}: cancel the second mutation when the operation expires`);
    assert.ok(calls.every(({ options }) => options.authToken === "TOKEN_A"));
    if (kind === "success") {
      assert.equal(scope.api.getEpisodeCollectionType(1001), 2);
      assert.equal(scope.api.getEpisodeCollectionType(1002), 0);
    } else {
      assert.equal(scope.state.collection.comment, "B");
      assert.equal(scope.state.episodeCollections.length, 0);
      assert.equal(scope.timers.length, 0);
    }
  }
}

async function testAutomaticProgress(source, extension) {
  for (const kind of ["success", "token", "route"]) {
    const gate = deferred();
    const calls = [];
    const scope = sandbox(source, extension, ["checkAutoWatchProgress", "getAutoWatchProgressSample", "patchEpisodes", "recordEpisodeSync", "pruneSyncHistory", "applySingleEpisodeProgress"], {
      isSupportedWatchPage: () => true, isCurrentVideoAutoProgressDisabled: () => false,
      getActiveVideoElement: () => ({ duration: 100, currentTime: 90 }), maybeOfferLongVideoAutoIdentify: noop,
      refreshLongVideoEpisodeGuess: () => null, getLongVideoEpisodeModeDecision: () => false,
      isCurrentCollectionPartAutoMarkEligible: () => true, getAutoWatchScopeKey: () => "scope",
      updateAutoWatchJumpState: noop, getAutoWatchThreshold: () => 80,
      recordCurrentCollectionSegmentProgressIfNeeded: () => gate.promise, getAutoWatchFailureRecord: () => null,
      clearCurrentCollectionSegmentProgress: async () => {}, clearAutoWatchFailureRecord: noop,
      formatEpisodeSort: String, getEpisodeDisplayNo: (episode) => episode.sort,
      handleAutoWatchSyncFailure: (error) => { throw error; },
      bgmRequest: async (path, options) => { calls.push({ path, options }); },
    });
    scope.getCurrentNormalEpisode = () => scope.state.episodes[0];
    const first = scope.api.checkAutoWatchProgress();
    const overlapping = scope.api.checkAutoWatchProgress();
    if (kind !== "success") changeContext(scope, kind);
    gate.resolve(true);
    await Promise.all([first, overlapping]);
    assert.equal(calls.length, kind === "success" ? 1 : 0, "the storage await cannot resume into another route/account or duplicate the write");
    if (kind === "success") assert.equal(scope.api.getEpisodeCollectionType(1001), 2);
    else assert.equal(scope.state.collection.comment, "B");
  }
}

async function testBundle(source, extension) {
  for (const name of ["loadSubjectBundleFresh", "loadSubjectBundlePreservingLocal"]) {
    for (const kind of ["success", "token", "route", "route-error", "token-error", ...(name === "loadSubjectBundleFresh" ? ["search", "search-error"] : [])]) {
      const entered = deferred();
      const gate = deferred();
      const scope = sandbox(source, extension, [name, "mergePendingCollection"], {
        createBgmApiRelayScope: () => ({}), getCollectionReadPath: async () => "/v0/users/account_A/collections/101",
        beginPanelLoad: () => 1, advancePanelLoad: noop, finishPanelLoad: noop,
        refreshSubjectInfoLinksInBackground: noop, checkAutoWatchProgress: async () => {},
        bgmRequest: async (path) => path.startsWith("/v0/subjects/") ? { id: 101, name: "A" } : { type: 3, rate: 9, comment: "A response" },
        bgmRequestPagedData: async (path) => ({ data: path.startsWith("/v0/episodes?") ? [{ id: 1001, type: 0, sort: 1 }] : [] }),
        loadSubjectCharacters: async () => ({ characters: [], error: "" }),
        rememberBindingSubject: async () => { entered.resolve(); await gate.promise; },
      });
      const context = scope.api.captureCollectionOperationContext();
      const task = name === "loadSubjectBundleFresh"
        ? scope.api[name](101, "TOKEN_A", context.pageContext) : scope.api[name](null);
      await entered.promise;
      if (kind.startsWith("search")) {
        scope.subjectSearchSeq += 1;
        scope.state.searchResults = [{ id: 202 }];
        scope.state.message = "newer search";
        scope.state.error = "newer search error";
        scope.state.busy = true;
      } else if (kind !== "success") changeContext(scope, kind.startsWith("route") ? "route" : "token");
      if (kind.endsWith("-error")) gate.reject(new Error("late storage failure"));
      else gate.resolve();
      await task;
      assert.equal(scope.state.collection.comment, kind === "success" || kind === "search" ? "A response" : kind === "search-error" ? "A" : "B", `${name}: ${kind}`);
      if (kind.startsWith("route")) assert.equal(scope.state.episodes[0].id, 2001);
      if (kind.startsWith("search")) {
        assert.equal(scope.state.searchResults[0].id, 202);
        assert.equal(scope.state.message, "newer search");
        assert.equal(scope.state.error, "newer search error");
        assert.equal(scope.state.busy, true, "a valid bundle may refresh data without finishing a newer search's UI state");
      }
    }
  }
}

async function testRateAndDelete(source, extension) {
  for (const kind of ["success", "failure", "token", "route", "refresh-failure"]) {
    const gate = deferred();
    const calls = [];
    const scope = sandbox(source, extension, ["rateSubject"], {
      getRateLevel: () => "", bgmRequest: (path, options) => { calls.push({ path, options }); return gate.promise; },
      loadSubjectBundlePreservingLocal: async () => { if (kind === "refresh-failure") throw new Error("refresh failed"); },
    });
    const task = scope.api.rateSubject(9);
    if (kind === "token" || kind === "route") changeContext(scope, kind);
    if (kind === "success" || kind === "refresh-failure") gate.resolve();
    else gate.reject(new Error("request failed"));
    if (kind === "failure") await assert.rejects(task, /request failed/);
    else if (kind === "refresh-failure") await assert.rejects(task, /refresh failed/);
    else await task;
    assert.equal(scope.state.collection.rate, kind === "success" || kind === "refresh-failure" ? 9 : kind === "failure" ? 4 : 2);
    if (kind === "refresh-failure") assert.equal(scope.state.pendingCollection.rate, 9, "a committed rating survives a failed follow-up read");
    assert.equal(calls[0].options.authToken, "TOKEN_A");
    if (kind === "success") {
      changeContext(scope, "route");
      for (const callback of scope.timers) callback();
      assert.equal(scope.state.collection.comment, "B");
    }
  }
  for (const kind of ["success", "token", "route"]) {
    const entered = deferred();
    const gate = deferred();
    const scope = sandbox(source, extension, ["deleteCollection"], {
      getCurrentUsername: async () => "account_A",
      requestBangumiFirstPartyDelete: async (_subjectId, _username, token) => {
        assert.equal(token, "TOKEN_A"); entered.resolve(); await gate.promise;
      },
    });
    const task = scope.api.deleteCollection(101);
    await entered.promise;
    if (kind !== "success") changeContext(scope, kind);
    gate.resolve();
    await task;
    assert.equal(scope.state.collection && scope.state.collection.comment, kind === "success" ? null : "B");
  }
  const calls = [];
  const scope = sandbox(source, extension, ["tryConfirmCollectionDeletedViaApi"], {
    DELETE_VERIFY_ATTEMPTS: 1,
    bgmRequest: async (path, options) => { calls.push({ path, options }); return null; },
  });
  scope.api.setAccessTokenState("TOKEN_B");
  assert.equal(await scope.api.tryConfirmCollectionDeletedViaApi(101, "TOKEN_A", "account_A"), true);
  assert.equal(calls[0].path, "/v0/users/account_A/collections/101");
  assert.equal(calls[0].options.authToken, "TOKEN_A");
}

async function testEditor(source, extension) {
  for (const existing of [false, true]) {
  for (const kind of ["failure", "success", "route", "token", "refresh-failure"]) {
    const gate = deferred();
    const methods = [];
    const commentInput = { value: "draft", disabled: false };
    const controls = [commentInput, { disabled: false }];
    let removed = 0;
    const scope = sandbox(source, extension, ["saveCollectionEditor", "setCollectionEditorSaving", "mergePendingCollection"], {
      COLLECTION_COMMENT_MAX_LENGTH: 380, parseTags: () => [], removeModal: () => { removed += 1; },
      document: { querySelector: (query) => query.includes(".biligumi-collection-dialog") ? { querySelectorAll: () => controls }
        : query.includes("edit-type") ? { value: "3" } : query.includes("edit-rate") ? { value: "8" }
          : query.includes("edit-comment") ? commentInput : { value: "", checked: false } },
      bgmRequest: (_path, options) => { methods.push(options.method); return gate.promise; },
      loadSubjectBundlePreservingLocal: async () => { if (kind === "refresh-failure") throw new Error("refresh failed"); },
    });
    const previousCollection = existing ? { type: 3, rate: 4, comment: "saved comment" } : null;
    scope.state.collection = previousCollection;
    const editorContext = () => ({ ...scope.api.captureCollectionOperationContext().pageContext, subjectId: scope.state.subjectId });
    scope.state.collectionEditorContext = editorContext();
    scope.state.collectionEditorOpen = true;
    const task = scope.api.saveCollectionEditor();
    assert.equal(scope.state.collectionEditorOpen, true);
    assert.ok(controls.every((input) => input.disabled));
    await scope.api.saveCollectionEditor();
    assert.equal(methods.length, 1, "a second click cannot submit a duplicate write");
    if (kind === "route" || kind === "token") changeContext(scope, kind);
    if (kind === "success" || kind === "refresh-failure") gate.resolve();
    else gate.reject(new Error("request failed"));
    if (kind === "failure") {
      await assert.rejects(task, /request failed/);
      assert.equal(scope.state.collection, previousCollection, "failed create/update restores the previous saved state");
      assert.equal(scope.state.pendingCollection, null);
      assert.equal(scope.api.mergePendingCollection(null), null);
      assert.equal(scope.state.collectionEditorOpen, true);
      assert.equal(removed, 0, "failure preserves the original editor DOM");
      assert.equal(commentInput.value, "draft");
      assert.ok(controls.every((input) => !input.disabled));
      scope.bgmRequest = async (_path, options) => { methods.push(options.method); };
      await scope.api.saveCollectionEditor();
      assert.deepEqual(methods, existing ? ["PATCH", "PATCH"] : ["POST", "POST"]);
      assert.equal(scope.state.collection.comment, "draft");
      assert.equal(removed, 1);
    } else if (kind === "refresh-failure") {
      await assert.rejects(task, /refresh failed/);
      assert.equal(scope.state.collection.comment, "draft");
      assert.equal(scope.state.pendingCollection.comment, "draft", "a successful write cannot be rolled back by a failed follow-up read");
      assert.equal(scope.state.collectionEditorOpen, false);
      assert.equal(removed, 1);
      assert.equal(methods.length, 1);
    } else {
      await task;
      assert.equal(scope.state.collection.comment, kind === "success" ? "draft" : "B");
      if (kind === "token") {
        assert.equal(scope.state.collectionEditorOpen, false);
        assert.equal(scope.state.collectionEditorContext, null, "an old account's editor cannot be submitted under the new token");
      }
    }
  }
  }
}

function settingsSandbox(source, extension, store, tokenInput) {
  const scope = sandbox(source, extension, ["applySettingsFromDialog", "clearSavedAccessToken", "getApiRelayAutoFallbackSetting", "normalizeAccessTokenInput", "isValidAccessToken", "syncAccessTokenFromStorage", "bindAccessTokenChanges", ...(extension ? ["queueClearSavedAccessToken", "bindStorageMirrorUpdates"] : [])], {
    BANGUMI_ACCESS_TOKEN_LENGTH: 40, requestInlineConfirm: async () => true,
    isSettingsDialogOpen: () => true, getLongVideoSettingsContext: () => ({ ownerKey: "" }),
    parseTimecode: () => 0, normalizeLongVideoOffsetSeconds: () => 0, normalizeAutoWatchThreshold: () => 80,
    normalizeOpedSkipSeconds: () => 90, normalizeHotkey: () => "", parseWhitelistInput: () => ({ items: [], labels: {} }),
    pruneWhitelistLabels: () => ({}), setAutoWatchThreshold: noop, updateAutoWatchThresholdPreview: noop,
    syncSubjectInfoPanel: noop, syncCharacterStrip: noop, layoutPanelWithoutOwningBiliDom: noop, refreshOpedSkipButton: noop,
    writeValue: (key, value) => { store[key] = value; }, writeValueAsync: async (key, value) => { store[key] = value; },
    writeListValue: noop, writeListValueAsync: async () => {}, writeJsonValueAsync: async () => {},
    settingsPersistQueue: Promise.resolve(),
  });
  Object.assign(scope.state, { token: "A".repeat(40), subjectId: null, characterStripEnabled: true,
    subjectInfoPanelEnabled: false, longVideoEpisodeGuessEnabled: false, longVideoEpisodeOffsets: {}, whitelist: [], whitelistLabels: {} });
  const settings = { querySelector: (query) => query.includes("settings-token") ? tokenInput
    : query.includes("settings-long-video-offset") ? { value: "0", setCustomValidity: noop }
      : query.includes("settings-oped-skip-hotkey") ? { value: "", dataset: {} } : { value: "", checked: false } };
  scope.document = { getElementById: () => settings };
  return scope;
}

async function testTokenPersistence(source, extension) {
  const key = "biligumi.token";
  const store = { [key]: "A".repeat(40) };
  const a = settingsSandbox(source, extension, store, { value: "" });
  const inputB = { value: "" };
  const b = settingsSandbox(source, extension, store, inputB);
  await a.api.clearSavedAccessToken();
  assert.equal(store[key], "");
  // Even before a remote event is delivered, unrelated settings must not restore credentials.
  await b.api.applySettingsFromDialog();
  assert.equal(store[key], "");
  b.api.syncAccessTokenFromStorage("");
  assert.equal(b.state.token, "");
  assert.equal(b.state.collection, null);
  assert.equal(b.state.pendingCollection, null);
  assert.equal(b.state.episodeCollections.length, 0);
  assert.equal(b.state.autoWatchAuthBlocked, false);
  inputB.value = "B".repeat(40);
  await b.api.applySettingsFromDialog();
  assert.equal(store[key], "B".repeat(40));
  assert.equal(b.state.token, store[key]);
  assert.equal(inputB.value, "");
  let remoteToken;
  if (extension) {
    let listener;
    b.tokenStorageChangeHandler = null;
    b.storageCache = {};
    b.isChromeStorageAvailable = () => true;
    b.chrome = { storage: { onChanged: { addListener: (callback) => { listener = callback; } } } };
    b.api.bindAccessTokenChanges();
    b.api.bindStorageMirrorUpdates();
    assert.equal(typeof b.tokenStorageChangeHandler, "function");
    listener({ [key]: { newValue: "ignored" } }, "sync");
    assert.equal(b.state.token, "B".repeat(40), "events from other storage areas cannot replace the account");
    remoteToken = (value) => listener({ [key]: { newValue: value } }, "local");
    listener({ [key]: { newValue: "" } }, "local");
    assert.equal(b.storageCache[key], "");
  } else {
    let listener;
    b.GM_addValueChangeListener = (_key, callback) => { listener = callback; };
    b.api.bindAccessTokenChanges();
    remoteToken = (value) => listener(key, b.state.token, value, true);
    listener(key, store[key], "", true);
  }
  assert.equal(b.state.token, "");
  const replacement = "R".repeat(40);
  store[key] = replacement;
  remoteToken(replacement);
  assert.equal(b.state.token, replacement, "a replacement credential propagates through the actual storage listener");
  await b.api.applySettingsFromDialog();
  assert.equal(store[key], replacement, "saving unrelated settings cannot overwrite another tab's replacement token");
  const savedCollection = { type: 3, comment: "current account" };
  const editor = { subjectId: 101 };
  Object.assign(b.state, { collection: savedCollection, collectionEditorOpen: true, collectionEditorContext: editor });
  remoteToken(replacement);
  assert.equal(b.state.collection, savedCollection);
  assert.equal(b.state.collectionEditorContext, editor, "an unchanged-token event preserves the current editor");
  remoteToken("N".repeat(40));
  assert.equal(b.state.collection, null);
  assert.equal(b.state.collectionEditorOpen, false);
  assert.equal(b.state.collectionEditorContext, null, "a different account discards the old editor context");

  const c = settingsSandbox(source, extension, store, { value: "" });
  const confirmation = deferred();
  c.requestInlineConfirm = () => confirmation.promise;
  const clearTask = extension ? c.api.queueClearSavedAccessToken() : c.api.clearSavedAccessToken();
  await Promise.resolve();
  c.api.syncAccessTokenFromStorage("C".repeat(40));
  store[key] = "C".repeat(40);
  confirmation.resolve(true);
  await clearTask;
  assert.equal(c.state.token, "C".repeat(40), "a confirmation for the old token cannot clear a newly selected account");
  assert.equal(store[key], "C".repeat(40));
}

test("write, account and editor context isolation", { timeout: 15000 }, async () => {
  const userscriptSource = readSource(USERSCRIPT_PATH);
  const extensionSource = readSource(EXTENSION_PATH);
  for (const name of ["captureCollectionOperationContext", "isCollectionOperationContextCurrent"]) {
    assert.equal(canonicalizeAdapterSyntax(extractFunction(extensionSource, name)), canonicalizeAdapterSyntax(extractFunction(userscriptSource, name)), `${name}: keep account/subject/route guards aligned`);
  }
  for (const name of ["updateCollection", "rateSubject", "deleteCollection", "saveProgressFromInput", "patchEpisodes", "checkAutoWatchProgress", "setAccessTokenState", "syncAccessTokenFromStorage", "setCollectionEditorSaving"]) {
    const options = { async: userscriptSource.includes(`  async function ${name}(`) };
    assert.equal(extractFunction(extensionSource, name, options), extractFunction(userscriptSource, name, options), `${name}: keep write behavior aligned across both builds`);
  }
  for (const [label, path] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
    const source = readSource(path);
    const extension = label === "extension";
    await testProgress(source, extension);
    await testAutomaticProgress(source, extension);
    await testBundle(source, extension);
    await testRateAndDelete(source, extension);
    await testEditor(source, extension);
    await testTokenPersistence(source, extension);
  }
  console.log("write context isolation tests passed");
});
