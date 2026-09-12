"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction } = require("./_source");

const plain = (value) => JSON.parse(JSON.stringify(value));
const savedFields = { type: 2, rate: 8, tags: ["动画", "已看"], comment: "保存后的吐槽", private: true };
const oldFields = { type: 3, rate: 8, tags: ["旧标签"], comment: "原吐槽", private: false };
const apiError = (status) => Object.assign(new Error(`Bangumi API 返回 ${status}`), { status });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createHarness(sourcePath, behavior = {}) {
  const source = readSource(sourcePath);
  const extension = sourcePath === EXTENSION_PATH;
  const calls = [];
  const delays = [];
  const controls = {
    type: { value: String(savedFields.type) }, rate: { value: String(savedFields.rate) },
    tags: { value: savedFields.tags.join(" ") }, comment: { value: savedFields.comment },
    private: { checked: savedFields.private }, button: {},
  };
  const state = {
    subjectId: 101, token: "TOKEN_A", username: "account_A", pageKey: "page-A",
    collection: { ...plain(oldFields), ep_status: 4 }, pendingCollection: null,
    episodeCollections: [{ episode: { id: 1001 }, type: 1 }],
    collectionEditorOpen: true,
    collectionEditorContext: { subjectId: 101, pageKey: "page-A", routeSeq: 1, href: "https://www.bilibili.com/video/A" },
    message: "", error: "", busy: false,
  };
  const counts = { collection: 0, episodes: 0, write: 0, modalRemovals: 0, renders: 0 };
  const relayScope = {};
  const scope = {
    state, routeRefreshSeq: 1, subjectSearchSeq: 0, SETTINGS_ID: "settings", COLLECTION_COMMENT_MAX_LENGTH: 380,
    location: { href: "https://www.bilibili.com/video/A", hostname: "www.bilibili.com" },
    createBgmApiRelayScope: () => relayScope,
    parseTags: (value) => value.split(" "),
    removeModal: () => { counts.modalRemovals += 1; },
    render: () => { counts.renders += 1; },
    setBusy: (message) => { state.busy = true; state.message = message; state.error = ""; },
    sleep: async (ms) => { delays.push(ms); if (behavior.sleep) await behavior.sleep(ms, scope); },
    document: {
      querySelector: (query) => query.includes(".biligumi-collection-dialog")
        ? { querySelectorAll: () => Object.values(controls) }
        : controls[/edit-(type|rate|tags|comment|private)/.exec(query)?.[1]] || null,
    },
    bgmRequest: async (path, options) => {
      calls.push({ path, options });
      if (options.method === "POST" || options.method === "PATCH") {
        counts.write += 1;
        if (behavior.write) return behavior.write(counts.write, path, options, scope);
        return undefined;
      }
      assert.equal(path, "/v0/users/account_A/collections/101", "refresh only reads the saved user's collection");
      counts.collection += 1;
      return behavior.collection ? behavior.collection(counts.collection, scope) : plain(savedFields);
    },
    bgmRequestPagedData: async (path, options) => {
      calls.push({ path, options });
      assert.equal(path, "/v0/users/-/collections/101/episodes?episode_type=0");
      counts.episodes += 1;
      return behavior.episodes ? behavior.episodes(counts.episodes, scope)
        : { data: [{ episode: { id: 1001 }, type: 2 }] };
    },
  };
  const names = [
    "saveCollectionEditor", "setCollectionEditorSaving", "refreshCollectionAfterSave", "mergePendingCollection",
    "captureCollectionOperationContext", "isCollectionOperationContextCurrent", "getCollectionReadPath", "getCurrentUsername",
    "ensureToken", "hasCollection", "getCollectionType", "isRetryableApiError",
    ...(extension ? ["captureRouteContext", "isRouteContextCurrent", "ensureRouteContext"] : ["capturePageContext", "isCurrentPageContext"]),
  ];
  vm.createContext(scope);
  vm.runInContext(names.map((name) => extractFunction(source, name, {
    async: source.includes(`  async function ${name}(`),
  })).join("\n") + `\n;globalThis.api = { ${names.join(",")} };`, scope);
  return { scope, state, calls, delays, counts, controls, relayScope };
}

function assertSaved(harness) {
  for (const [key, value] of Object.entries(savedFields)) {
    assert.deepEqual(plain(harness.state.collection[key]), value, `the saved ${key} remains visible`);
  }
  assert.equal(harness.state.error, "", "a read failure must not become a save error");
  assert.equal(harness.state.busy, false);
  assert.equal(harness.state.collectionEditorOpen, false);
  assert.equal(harness.state.collectionEditorContext, null);
  assert.equal(harness.counts.modalRemovals, 1);
}

function assertReadOptions(harness) {
  for (const { path, options } of harness.calls.filter(({ options }) => !options.method)) {
    assert.equal(options.auth, true);
    assert.equal(options.authToken, "TOKEN_A");
    assert.equal(options.allow404, true);
    assert.equal(options.dedup, false, "a post-save refresh cannot reuse a read started before saving");
    assert.equal(options.relayScope, harness.relayScope);
    if (path.includes("/episodes?")) assert.equal(options.pageSize, 200);
  }
}

function replaceContext(harness, kind) {
  const { scope, state } = harness;
  if (kind === "route") {
    scope.routeRefreshSeq += 1;
    state.pageKey = "page-B";
  }
  if (kind === "subject") state.subjectId = 202;
  if (kind === "token") state.token = "TOKEN_B";
  if (kind === "newer edit" || kind === "completed newer edit") {
    state.collectionRefreshContext = scope.api.captureCollectionOperationContext();
  }
  state.pendingCollection = kind === "newer edit" ? { subjectId: 101, comment: "新一轮修改", createdAt: Date.now() } : null;
  state.collection = { type: 3, comment: "新页面或新一轮修改" };
  state.episodeCollections = [{ episode: { id: 2001 }, type: 1 }];
  state.message = "新操作进行中";
  state.error = "新操作的提示";
  state.busy = true;
}

for (const [label, sourcePath] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  test(`${label}: collection mutations replace in-flight bundle reads without losing the new shared request`, async () => {
    const harness = createHarness(sourcePath);
    const freshCalls = [];
    const requests = new Map();
    harness.scope.subjectBundleRequests = requests;
    harness.scope.loadSubjectBundleFresh = (subjectId, token, pageContext, uiContext) => {
      const gate = deferred();
      freshCalls.push({ subjectId, token, pageContext, uiContext, gate });
      return gate.promise;
    };
    vm.runInContext(extractFunction(readSource(sourcePath), "loadSubjectBundle", { async: true })
      + "\n;globalThis.api.loadSubjectBundle = loadSubjectBundle;", harness.scope);

    const oldContext = harness.scope.api.captureCollectionOperationContext();
    harness.state.collectionRefreshContext = oldContext;
    const oldLoad = harness.scope.api.loadSubjectBundle();
    const oldSibling = harness.scope.api.loadSubjectBundle();
    assert.equal(freshCalls.length, 1, "same-mutation callers share the original network work");
    const oldEntry = [...requests.values()][0];
    assert.equal(oldEntry.collectionRefreshContext, oldContext);

    const newContext = harness.scope.api.captureCollectionOperationContext();
    harness.state.collectionRefreshContext = newContext;
    const newLoad = harness.scope.api.loadSubjectBundle();
    assert.equal(freshCalls.length, 2, "a changed mutation marker invalidates an otherwise identical bundle key");
    assert.equal(requests.size, 1);
    const newEntry = [...requests.values()][0];
    assert.notEqual(newEntry.promise, oldEntry.promise);
    assert.equal(newEntry.collectionRefreshContext, newContext);
    harness.scope.subjectSearchSeq += 1;
    const newSibling = harness.scope.api.loadSubjectBundle();
    assert.equal(freshCalls.length, 2);
    assert.equal([...requests.values()][0], newEntry);
    assert.equal(freshCalls[1].uiContext.searchSeq, harness.scope.subjectSearchSeq);
    assert.equal(freshCalls[1].subjectId, 101);
    assert.equal(freshCalls[1].token, "TOKEN_A");

    const oldResult = { source: "before save" };
    freshCalls[0].gate.resolve(oldResult);
    assert.equal(await oldLoad, oldResult);
    assert.equal(await oldSibling, oldResult);
    assert.equal(requests.size, 1, "the old promise's finally must not delete its replacement");
    assert.equal([...requests.values()][0], newEntry);
    const lateSibling = harness.scope.api.loadSubjectBundle();
    assert.equal(freshCalls.length, 2, "the replacement remains reusable after the old request settles");

    const newResult = { source: "after save" };
    freshCalls[1].gate.resolve(newResult);
    for (const result of await Promise.all([newLoad, newSibling, lateSibling])) assert.equal(result, newResult);
    assert.equal(requests.size, 0, "only the current request removes itself when finished");
  });

  test(`${label}: a completed rating mutation cancels an older editor refresh after pending data is cleared`, async () => {
    const entered = deferred();
    const release = deferred();
    const harness = createHarness(sourcePath, {
      collection: async () => { entered.resolve(); await release.promise; return plain(savedFields); },
    });
    harness.scope.getRateLevel = () => "";
    harness.scope.window = { setTimeout: () => 0 };
    harness.scope.loadSubjectBundlePreservingLocal = async () => {
      harness.state.pendingCollection = null;
      harness.state.busy = false;
    };
    vm.runInContext(extractFunction(readSource(sourcePath), "rateSubject", { async: true })
      + "\n;globalThis.api.rateSubject = rateSubject;", harness.scope);
    const editorTask = harness.scope.api.saveCollectionEditor();
    await entered.promise;
    const editorContext = harness.state.collectionRefreshContext;
    const ratingTask = harness.scope.api.rateSubject(9);
    assert.notEqual(harness.state.collectionRefreshContext, editorContext, "rateSubject must invalidate old reads before its first await");
    assert.equal(harness.state.collectionRefreshContext.subjectId, 101);
    assert.equal(harness.state.collectionRefreshContext.token, "TOKEN_A");
    await ratingTask;
    assert.equal(harness.state.pendingCollection, null);
    assert.equal(harness.state.collection.rate, 9);
    const afterRating = plain(harness.state);
    const renders = harness.counts.renders;
    release.resolve();
    await editorTask;
    assert.deepEqual(plain(harness.state), afterRating, "an older response cannot revive merely because the newer mutation cleared its pending fields");
    assert.equal(harness.counts.renders, renders);
    assert.equal(harness.counts.write, 2, "one editor write and one explicitly requested rating write");
    assert.deepEqual(harness.delays, []);
  });

  test(`${label}: matching rate alone cannot discard pending status, tags, comment or privacy`, () => {
    const harness = createHarness(sourcePath);
    for (const key of ["type", "tags", "comment", "private"]) {
      const pending = { subjectId: 101, ...plain(savedFields), createdAt: Date.now() };
      harness.state.pendingCollection = pending;
      const stale = { ...plain(savedFields), [key]: plain(oldFields[key]) };
      const merged = harness.scope.api.mergePendingCollection(stale);
      assert.equal(harness.state.pendingCollection, pending, `${key} is not acknowledged by an unchanged rate`);
      assert.deepEqual(plain(merged[key]), savedFields[key]);
    }
    harness.state.pendingCollection = { subjectId: 101, ...plain(savedFields), createdAt: Date.now() };
    const normalized = { ...plain(savedFields), type: "2", rate: "8", private: 1, tags: ["已看", "动画"] };
    assert.equal(harness.scope.api.mergePendingCollection(normalized), normalized);
    assert.equal(harness.state.pendingCollection, null, "equivalent API values acknowledge every written field");

    harness.state.pendingCollection = { subjectId: 101, rate: 8, createdAt: Date.now() };
    assert.equal(harness.scope.api.mergePendingCollection(oldFields), oldFields, "rating-only mutations compare only their written fields");
    assert.equal(harness.state.pendingCollection, null);
  });

  for (const existing of [false, true]) {
    test(`${label}: successful ${existing ? "PATCH" : "POST"} retries a 500 read without repeating the write`, async () => {
      const harness = createHarness(sourcePath, {
        collection: (attempt) => { if (attempt === 1) throw apiError(500); return plain(savedFields); },
      });
      if (!existing) harness.state.collection = null;
      await harness.scope.api.saveCollectionEditor();
      assertSaved(harness);
      assert.equal(harness.counts.write, 1);
      assert.equal(harness.calls[0].options.method, existing ? "PATCH" : "POST");
      assert.deepEqual(plain(harness.calls[0].options.body), savedFields);
      assert.equal(harness.calls[0].options.authToken, "TOKEN_A");
      assert.equal(harness.counts.collection, 2);
      assert.deepEqual(harness.delays, [800]);
      assert.equal(harness.state.pendingCollection, null);
      assert.equal(harness.state.episodeCollections[0].type, 2);
      assert.equal(harness.state.message, "记录已保存。");
      assertReadOptions(harness);
    });
  }

  test(`${label}: a transient episode-collection failure also reconciles after saving`, async () => {
    const harness = createHarness(sourcePath, {
      episodes: (attempt) => { if (attempt === 1) throw apiError(500); return { data: [{ episode: { id: 1001 }, type: 2 }] }; },
    });
    await harness.scope.api.saveCollectionEditor();
    assertSaved(harness);
    assert.equal(harness.counts.write, 1);
    assert.equal(harness.counts.episodes, 2);
    assert.equal(harness.state.pendingCollection, null);
    assert.equal(harness.state.episodeCollections[0].type, 2);
  });

  for (const status of [500, 0, 401]) {
    test(`${label}: read ${status} preserves committed edits and uses bounded eligible retries`, async () => {
      const harness = createHarness(sourcePath, { collection: () => { throw apiError(status); } });
      await harness.scope.api.saveCollectionEditor();
      assertSaved(harness);
      assert.equal(harness.counts.write, 1);
      assert.equal(harness.counts.collection, status === 401 ? 1 : 3);
      assert.deepEqual(harness.delays, status === 401 ? [] : [800, 1600]);
      assert.equal(harness.state.pendingCollection.comment, savedFields.comment);
      assert.match(harness.state.message, /记录已保存.*暂时无法刷新/);
      assertReadOptions(harness);
    });
  }

  test(`${label}: stale equal-rate data and a temporary 404 cannot roll back saved fields`, async () => {
    const harness = createHarness(sourcePath, {
      collection: (attempt) => attempt === 1 ? plain(oldFields) : attempt === 2 ? null : plain(savedFields),
      sleep: (_ms, scope) => {
        assert.deepEqual(plain(scope.state.collection.tags), savedFields.tags);
        assert.equal(scope.state.collection.comment, savedFields.comment);
        assert.ok(scope.state.pendingCollection);
      },
    });
    await harness.scope.api.saveCollectionEditor();
    assertSaved(harness);
    assert.equal(harness.counts.write, 1);
    assert.equal(harness.counts.collection, 3);
    assert.deepEqual(harness.delays, [800, 1600]);
    assert.equal(harness.state.pendingCollection, null);
  });

  test(`${label}: an API that remains stale leaves the confirmed local edit visible`, async () => {
    const harness = createHarness(sourcePath, { collection: () => plain(oldFields) });
    await harness.scope.api.saveCollectionEditor();
    assertSaved(harness);
    assert.equal(harness.counts.collection, 3);
    assert.ok(harness.state.pendingCollection);
    assert.match(harness.state.message, /记录已保存.*仍在同步/);
  });

  for (const kind of ["route", "token", "subject", "newer edit", "completed newer edit"]) {
    test(`${label}: ${kind} during retry sleep cancels old requests and status updates`, async () => {
      const entered = deferred();
      const release = deferred();
      const harness = createHarness(sourcePath, {
        collection: () => { throw apiError(500); },
        sleep: async () => { entered.resolve(); await release.promise; },
      });
      const task = harness.scope.api.saveCollectionEditor();
      await entered.promise;
      replaceContext(harness, kind);
      const nextState = plain(harness.state);
      const renders = harness.counts.renders;
      const calls = harness.calls.length;
      release.resolve();
      await task;
      assert.deepEqual(plain(harness.state), nextState);
      assert.equal(harness.counts.renders, renders);
      assert.equal(harness.calls.length, calls);
      assert.equal(harness.counts.write, 1);
    });
  }

  for (const phase of ["path resolution", "collection response"]) {
    test(`${label}: newer edit during ${phase} prevents stale results from taking ownership`, async () => {
      const entered = deferred();
      const release = deferred();
      const harness = createHarness(sourcePath, phase === "collection response" ? {
        collection: async () => { entered.resolve(); await release.promise; return plain(savedFields); },
      } : {});
      if (phase === "path resolution") harness.scope.getCurrentUsername = async () => {
        entered.resolve(); await release.promise; return "account_A";
      };
      const task = harness.scope.api.saveCollectionEditor();
      await entered.promise;
      replaceContext(harness, "newer edit");
      const nextState = plain(harness.state);
      const calls = harness.calls.length;
      const renders = harness.counts.renders;
      release.resolve();
      await task;
      assert.deepEqual(plain(harness.state), nextState);
      assert.equal(harness.calls.length, calls);
      assert.equal(harness.counts.renders, renders);
      assert.equal(harness.delays.length, 0);
    });
  }

  test(`${label}: a newer search keeps its status while a saved collection finishes refreshing`, async () => {
    const entered = deferred();
    const release = deferred();
    const harness = createHarness(sourcePath, {
      collection: async () => { entered.resolve(); await release.promise; return plain(savedFields); },
    });
    const task = harness.scope.api.saveCollectionEditor();
    await entered.promise;
    harness.scope.subjectSearchSeq += 1;
    Object.assign(harness.state, { message: "新搜索进行中", error: "新搜索提示", busy: true });
    release.resolve();
    await task;
    assert.equal(harness.state.message, "新搜索进行中");
    assert.equal(harness.state.error, "新搜索提示");
    assert.equal(harness.state.busy, true);
    assert.equal(harness.state.pendingCollection, null);
    assert.equal(harness.state.collection.comment, savedFields.comment);
  });

  test(`${label}: a search started during the write keeps its status throughout readback`, async () => {
    const entered = deferred();
    const release = deferred();
    const harness = createHarness(sourcePath, {
      write: async () => { entered.resolve(); await release.promise; },
      collection: (_attempt, scope) => {
        assert.equal(scope.state.message, "新搜索进行中", "readback must not replace a newer search's progress");
        assert.equal(scope.state.error, "新搜索提示");
        return plain(savedFields);
      },
    });
    const task = harness.scope.api.saveCollectionEditor();
    await entered.promise;
    harness.scope.subjectSearchSeq += 1;
    Object.assign(harness.state, { message: "新搜索进行中", error: "新搜索提示", busy: true });
    release.resolve();
    await task;
    assert.equal(harness.state.message, "新搜索进行中");
    assert.equal(harness.state.error, "新搜索提示");
    assert.equal(harness.state.busy, true);
    assert.equal(harness.state.pendingCollection, null);
    assert.equal(harness.state.collection.comment, savedFields.comment);
    assert.equal(harness.counts.write, 1);
  });

  for (const existing of [false, true]) {
    test(`${label}: failed ${existing ? "PATCH" : "POST"} preserves the editor and makes no refresh request`, async () => {
      const writeGate = deferred();
      const harness = createHarness(sourcePath, { write: () => writeGate.promise });
      if (!existing) harness.state.collection = null;
      const previousCollection = harness.state.collection;
      const previousPending = existing ? { subjectId: 101, rate: 8, createdAt: Date.now() } : null;
      harness.state.pendingCollection = previousPending;
      const task = harness.scope.api.saveCollectionEditor();
      assert.ok(Object.values(harness.controls).every((control) => control.disabled));
      await harness.scope.api.saveCollectionEditor();
      assert.equal(harness.counts.write, 1, "a repeated click cannot duplicate the save");
      writeGate.reject(apiError(500));
      await assert.rejects(task, /Bangumi API 返回 500/);
      assert.equal(harness.state.collection, previousCollection);
      assert.equal(harness.state.pendingCollection, previousPending);
      assert.equal(harness.state.collectionEditorOpen, true);
      assert.ok(harness.state.collectionEditorContext);
      assert.equal(harness.counts.modalRemovals, 0);
      assert.equal(harness.controls.comment.value, savedFields.comment);
      assert.ok(Object.values(harness.controls).every((control) => control.disabled === false));
      assert.equal(harness.state.busy, false);
      assert.equal(harness.calls.length, 1);
      assert.deepEqual(harness.delays, []);
    });
  }
}
