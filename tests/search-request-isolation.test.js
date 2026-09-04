"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function load(file) {
  const requests = [];
  const sandbox = {
    subjectSearchSeq: 0, routeRefreshSeq: 1, keyword: "A", renders: 0,
    location: { href: "https://www.bilibili.com/video/BV1A" },
    state: { pageKey: "A", subjectId: 101, token: "token-a", searchResults: [], busy: false, error: "" },
    clearLongVideoBindingPrompt() {},
    getSearchKeywordFromInput: () => sandbox.keyword,
    parseBangumiSubjectId: (value) => value === "123" ? 123 : null,
    bindSubjectFromDirectInput: async (id) => { sandbox.bound = id; },
    setBusy: (message) => { sandbox.state.busy = true; sandbox.state.message = message; },
    bgmRequest: () => { const d = deferred(); requests.push(d); return d.promise; },
    render: () => { sandbox.renders += 1; },
    checkAutoWatchProgress: async () => {},
    showError: (error) => { sandbox.state.error = error.message; },
  };
  const source = readSource(file);
  runInSandbox(extractFunction(source, "searchSubjects", { async: true }) + extractFunction(source, "clearSearchResults"), sandbox);
  return { api: sandbox, requests };
}

function loadDirectSearch(file) {
  const harness = load(file);
  const { api } = harness;
  api.rememberedSubjects = [];
  api.displaySubjectName = (subject) => subject.name;
  api.rememberBindingSubject = async (subject) => { api.rememberedSubjects.push(subject.id); };
  api.requestBindSubject = async (id) => { api.bound = id; api.state.subjectId = id; };
  api.captureRouteContext = () => ({ pageKey: api.state.pageKey, routeSeq: api.routeRefreshSeq });
  api.isCurrentPageContext = api.isRouteContextCurrent = (context) => (
    context.pageKey === api.state.pageKey && context.routeSeq === api.routeRefreshSeq
  );
  api.ensureRouteContext = (context) => {
    if (!api.isRouteContextCurrent(context)) throw new Error("route changed");
  };
  runInSandbox(extractFunction(readSource(file), "bindSubjectFromDirectInput", { async: true }), api);
  return harness;
}

function loadReadinessSearch(file) {
  const harness = loadDirectSearch(file);
  const { api } = harness;
  api.state.subject = { id: 101, name: "bound subject" };
  const readiness = deferred();
  api.LONG_VIDEO_BIND_WAIT_TIMEOUT_MS = 8000;
  api.getActiveVideoElement = () => ({});
  api.readinessStarted = false;
  api.getLongVideoBindReadinessForSubject = () => {
    api.readinessStarted = true;
    return readiness.promise;
  };
  api.bindingActions = [];
  api.showLongVideoBindingPrompt = () => { api.bindingActions.push("prompt"); };
  api.beginLongVideoBindingWait = () => { api.bindingActions.push("wait"); };
  api.setLongVideoEpisodeModeDecision = async () => { api.bindingActions.push("save-auto"); };
  api.bindSubject = async (id) => {
    api.bindingActions.push("bind");
    api.bound = id;
    api.state.subjectId = id;
  };
  runInSandbox(extractFunction(readSource(file), "requestBindSubject", { async: true }), api);
  return { ...harness, readiness };
}

function loadBindingSearch(file, pauseStage) {
  const harness = loadReadinessSearch(file);
  const { api } = harness;
  const source = readSource(file);
  const extension = file === EXTENSION_PATH;
  const gate = deferred();
  const entered = deferred();
  const bindingKey = "bili:md28224078|section:元祖迷你";
  const storage = { bindings: { [bindingKey]: 101 } };
  const writes = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const pause = async (stage) => { if (pauseStage === stage) { entered.resolve(); await gate.promise; } };
  Object.assign(api, {
    BINDINGS_LOCK_NAME: "binding-test", STORAGE: { bindings: "bindings" }, bindingsUpdateQueue: Promise.resolve(),
    navigator: { locks: { request: async (_name, _options, callback) => { await pause("lock"); return callback(); } } },
    getBindingKeysForCurrentPage: () => [bindingKey],
    buildCollectionRangeBindingProposal: async () => { await pause("collection-proposal"); return null; },
    buildLongVideoRangeGroupBindingProposal: async () => { await pause("range-proposal"); return null; },
    getCurrentCollectionPartContext: () => null,
    getStoredSubjectDeclaredTotalEpisodeCount: () => null,
    readJsonValue: (key, fallback) => clone(storage[key] || fallback),
    readJsonValueFresh: async (key, fallback) => { await pause("storage-read"); return clone(storage[key] || fallback); },
    writeJsonValue: (key, value) => { writes.push(clone(value)); storage[key] = clone(value); },
    writeJsonValueAsync: async (key, value) => { writes.push(clone(value)); storage[key] = clone(value); },
    refreshCurrentEpisodeRecognitionState() {}, loadSubjectBundle: async () => {},
  });
  api.state.bindings = {};
  const names = ["bindSubject", "resolveLongVideoBindingSubject", "withBindingsLock", ...(extension
    ? ["updateBindings", "captureRouteContext", "isRouteContextCurrent", "ensureRouteContext"]
    : ["updateStoredBindings", "capturePageContext", "isCurrentPageContext"])];
  runInSandbox(names.map((name) => extractFunction(source, name, { async: source.includes(`  async function ${name}(`) })).join("\n"), api);
  harness.readiness.resolve({ action: "bind" });
  return { ...harness, entered, gate, storage, writes, bindingKey };
}

function loadInteractiveBindingSearch(file, pauseStage = "none") {
  const harness = loadBindingSearch(file, pauseStage);
  const { api } = harness;
  const source = readSource(file);
  const modeGate = deferred();
  const modeEntered = deferred();
  const readinessRequests = [];
  let nextTimer = 1;
  Object.assign(api, {
    longVideoBindWaitSeq: 0, longVideoBindWaitTimer: 0, LONG_VIDEO_BIND_WAIT_POLL_MS: 100,
    clock: 0, Date: { now: () => api.clock },
    window: { setInterval: () => nextTimer++, clearInterval() {} },
    getActiveVideoElement: () => ({ addEventListener() {} }),
    getCurrentVideoPartContext: () => null,
    getLongVideoBindReadinessForSubject: () => { const request = deferred(); readinessRequests.push(request); return request.promise; },
    setLongVideoEpisodeModeDecision: () => { modeEntered.resolve(); return modeGate.promise; },
    refreshLongVideoEpisodeGuess() {},
  });
  const names = ["buildLongVideoBindingPromptState", "showLongVideoBindingPrompt", "clearLongVideoBindingPrompt",
    "stopLongVideoBindingWaitLoop", "beginLongVideoBindingWait", "retryLongVideoBindingWait",
    "resolveLongVideoBindingPrompt", "applyLongVideoAutoAccept"];
  runInSandbox(names.map((name) => extractFunction(source, name, { async: source.includes(`  async function ${name}(`) })).join("\n"), api);
  return { ...harness, modeGate, modeEntered, readinessRequests };
}

async function startInteractiveSearch(harness, action) {
  const { api, requests, readinessRequests } = harness;
  api.keyword = "123";
  const task = api.searchSubjects().catch(api.showError);
  requests[0].resolve({ id: 123, name: "direct candidate" });
  await new Promise(setImmediate);
  assert.equal(readinessRequests.length, 1);
  readinessRequests[0].resolve({ action, durationSeconds: 7200 });
  await task;
  assert.equal(api.state.longVideoBindingPrompt.phase, action === "wait" ? "waiting" : "prompt");
  assert.equal(api.state.subject.id, 101, "showing a candidate prompt does not replace the bound subject");
}

function loadSharedBundleSearch(file) {
  const harness = loadBindingSearch(file, "none");
  const { api } = harness;
  const source = readSource(file);
  const bundleGate = deferred();
  const bundleEntered = deferred();
  let subjectReads = 0;
  Object.assign(api, {
    subjectBundleRequests: new Map(),
    createBgmApiRelayScope: () => ({}), getCollectionReadPath: async () => "",
    beginPanelLoad: () => 1, advancePanelLoad() {}, finishPanelLoad() {}, refreshSubjectInfoLinksInBackground() {},
    loadSubjectCharacters: async () => ({ characters: [], error: "" }),
    bgmRequestPagedData: async () => ({ data: [] }),
    bgmRequest: async (path) => {
      if (path.includes("/search/subjects")) return { data: [{ id: 202 }] };
      assert.equal(path, "/v0/subjects/123");
      subjectReads += 1;
      if (subjectReads === 2) { bundleEntered.resolve(); await bundleGate.promise; }
      return { id: 123, name: "loaded subject" };
    },
  });
  const names = ["loadSubjectBundle", "loadSubjectBundleFresh", "mergePendingCollection", "showError"];
  runInSandbox(names.map((name) => extractFunction(source, name, { async: source.includes(`  async function ${name}(`) })).join("\n"), api);
  return { ...harness, bundleGate, bundleEntered, subjectReads: () => subjectReads };
}

async function supersedeDirectSearch(api, requests, cancellation) {
  if (cancellation === "search") {
    api.keyword = "new title";
    const latest = api.searchSubjects().catch(api.showError);
    requests[1].resolve({ data: [{ id: 202 }] });
    await latest;
  } else {
    api.state.token = "token-b";
    api.state.message = "current account";
    api.state.error = "";
    api.state.busy = false;
  }
}

test("search request isolation through lookup, prompts and real binding storage", { timeout: 15000 }, async () => {
  for (const file of [USERSCRIPT_PATH, EXTENSION_PATH]) {
    for (const rejectOld of [false, true]) {
      const { api, requests } = load(file);
      const old = api.searchSubjects();
      api.keyword = "B";
      const latest = api.searchSubjects();
      requests[1].resolve({ data: [{ id: 202 }] });
      await latest;
      const renders = api.renders;
      if (rejectOld) requests[0].reject(new Error("old request failed"));
      else requests[0].resolve({ data: [{ id: 101 }] });
      await old;
      assert.equal(api.state.searchResults[0].id, 202);
      assert.equal(api.renders, renders, "stale success/error must not render over the current result");
      assert.equal(api.state.error, "");
    }

    for (const change of [
      (a) => { a.state.pageKey = "B"; },
      (a) => { a.routeRefreshSeq += 1; },
      (a) => { a.location.href += "?p=2"; },
      (a) => { a.state.subjectId = 202; },
      (a) => { a.state.token = "token-b"; },
      (a) => a.clearSearchResults(),
    ]) {
      const { api, requests } = load(file);
      const old = api.searchSubjects();
      change(api);
      api.state.message = "current operation";
      api.state.busy = true;
      requests[0].resolve({ data: [{ id: 101 }] });
      await old;
      assert.equal(api.state.searchResults.length, 0);
      assert.equal(api.state.message, "current operation");
      assert.equal(api.state.busy, true);
    }

    const { api, requests } = load(file);
    const failed = api.searchSubjects();
    requests[0].reject(new Error("current request failed"));
    await assert.rejects(failed, /current request failed/);
    api.keyword = "123";
    await api.searchSubjects();
    assert.equal(api.bound, 123, "direct subject input retains binding behavior");
    api.bindSubjectFromDirectInput = async () => { api.state.subjectId = 123; throw new Error("binding load failed"); };
    await assert.rejects(api.searchSubjects(), /binding load failed/);

    // Use the real direct-ID reader with the real search wrapper. A newer text
    // search supersedes both successful and failed responses from an older ID.
    for (const rejectOld of [false, true]) {
      const { api: direct, requests: directRequests } = loadDirectSearch(file);
      direct.keyword = "123";
      const oldDirect = direct.searchSubjects().catch(direct.showError);
      direct.keyword = "new title";
      const latestText = direct.searchSubjects().catch(direct.showError);
      directRequests[1].resolve({ data: [{ id: 202 }] });
      await latestText;
      const latestMessage = direct.state.message;
      if (rejectOld) directRequests[0].reject(new Error("old direct lookup failed"));
      else directRequests[0].resolve({ id: 123, name: "old direct subject" });
      await oldDirect;
      assert.equal(direct.state.searchResults[0].id, 202, "a superseded direct lookup must not clear newer text results");
      assert.equal(direct.state.subjectId, 101);
      assert.equal(direct.state.subject, undefined);
      assert.equal(direct.bound, undefined);
      assert.equal(direct.state.message, latestMessage);
      assert.equal(direct.state.error, "", "a superseded direct lookup failure must not reach showError");
      assert.equal(direct.rememberedSubjects.length, 0);
    }

    // The direct lookup can also be superseded while its metadata write awaits
    // storage. Finishing that write must not resume binding or replace the view.
    for (const rejectStorage of [false, true]) {
      const { api: direct, requests: directRequests } = loadDirectSearch(file);
      const storageWrite = deferred();
      let remembering = false;
      direct.rememberBindingSubject = () => { remembering = true; return storageWrite.promise; };
      direct.keyword = "123";
      const oldDirect = direct.searchSubjects().catch(direct.showError);
      directRequests[0].resolve({ id: 123, name: "old direct subject" });
      await new Promise(setImmediate);
      assert.equal(remembering, true);
      direct.keyword = "new title";
      const latestText = direct.searchSubjects().catch(direct.showError);
      directRequests[1].resolve({ data: [{ id: 202 }] });
      await latestText;
      const latestMessage = direct.state.message;
      if (rejectStorage) storageWrite.reject(new Error("old metadata write failed"));
      else storageWrite.resolve();
      await oldDirect;
      assert.equal(direct.state.searchResults[0].id, 202);
      assert.equal(direct.state.subjectId, 101);
      assert.equal(direct.state.subject, undefined, "metadata storage must finish and context remain current before changing the subject");
      assert.equal(direct.bound, undefined);
      assert.equal(direct.state.message, latestMessage);
      assert.equal(direct.state.error, "");
    }

    // Direct-ID cancellation remains active inside the real requestBindSubject,
    // while video readiness is pending. No late branch may start a prompt,
    // duration-wait loop, auto-mode save or binding for the obsolete request.
    for (const cancellation of ["search", "token"]) {
      for (const action of ["prompt", "wait", "auto", "bind", "error"]) {
        const { api: direct, requests: directRequests, readiness } = loadReadinessSearch(file);
        direct.keyword = "123";
        const oldDirect = direct.searchSubjects().catch(direct.showError);
        directRequests[0].resolve({ id: 123, name: "old direct subject" });
        await new Promise(setImmediate);
        assert.equal(direct.readinessStarted, true);
        await supersedeDirectSearch(direct, directRequests, cancellation);
        const message = direct.state.message;
        if (action === "error") readiness.reject(new Error("old readiness failed"));
        else readiness.resolve({ action, durationSeconds: 7200 });
        await oldDirect;
        assert.deepEqual(direct.bindingActions, []);
        assert.equal(direct.bound, undefined);
        assert.equal(direct.state.subjectId, 101);
        assert.equal(direct.state.subject.id, 101, "a cancelled direct lookup cannot replace the still-bound subject metadata");
        assert.equal(direct.state.message, message);
        assert.equal(direct.state.error, "");
        if (cancellation === "search") assert.equal(direct.state.searchResults[0].id, 202);
      }

      // If cancellation happens after automatic mode persistence starts, its
      // completion (or failure) must not resume binding or report a stale error.
      for (const rejectModeSave of [false, true]) {
        const { api: direct, requests: directRequests, readiness } = loadReadinessSearch(file);
        const modeSave = deferred();
        direct.setLongVideoEpisodeModeDecision = () => {
          direct.bindingActions.push("save-auto");
          return modeSave.promise;
        };
        direct.keyword = "123";
        const oldDirect = direct.searchSubjects().catch(direct.showError);
        directRequests[0].resolve({ id: 123, name: "old direct subject" });
        readiness.resolve({ action: "auto" });
        await new Promise(setImmediate);
        assert.deepEqual(direct.bindingActions, ["save-auto"]);
        await supersedeDirectSearch(direct, directRequests, cancellation);
        const message = direct.state.message;
        if (rejectModeSave) modeSave.reject(new Error("old auto-mode save failed"));
        else modeSave.resolve();
        await oldDirect;
        assert.deepEqual(direct.bindingActions, ["save-auto"]);
        assert.equal(direct.bound, undefined);
        assert.equal(direct.state.subjectId, 101);
        assert.equal(direct.state.message, message);
        assert.equal(direct.state.error, "");
      }
    }

    for (const failureStage of ["readiness", "auto-save", "bind"]) {
      const { api: direct, requests: directRequests, readiness } = loadReadinessSearch(file);
      if (failureStage === "auto-save") {
        direct.setLongVideoEpisodeModeDecision = async () => { throw new Error("current auto-save failed"); };
      }
      if (failureStage === "bind") {
        direct.bindSubject = async (id) => { direct.state.subjectId = id; throw new Error("current bind failed"); };
      }
      direct.keyword = "123";
      const failure = assert.rejects(direct.searchSubjects(), new RegExp(`current ${failureStage} failed`));
      directRequests[0].resolve({ id: 123, name: "current direct subject" });
      if (failureStage === "readiness") readiness.reject(new Error("current readiness failed"));
      else readiness.resolve({ action: failureStage === "auto-save" ? "auto" : "bind" });
      await failure;
    }

    // Continue through the real bindSubject and the real storage transaction.
    // A cancellation guard only in requestBindSubject cannot protect its nested
    // proposal awaits or a lock held by another tab.
    for (const stage of ["collection-proposal", "range-proposal", "lock", ...(file === EXTENSION_PATH ? ["storage-read"] : [])]) {
      for (const cancellation of ["success", "search", "clear", "token", "route"]) {
        const { api: direct, requests: directRequests, entered, gate, storage, writes, bindingKey } = loadBindingSearch(file, stage);
        direct.keyword = "123";
        const oldDirect = direct.searchSubjects().catch(direct.showError);
        directRequests[0].resolve({ id: 123, name: "old direct subject" });
        await entered.promise;
        if (cancellation === "search") await supersedeDirectSearch(direct, directRequests, "search");
        if (cancellation === "clear") direct.clearSearchResults();
        if (cancellation === "token") direct.state.token = "token-b";
        if (cancellation === "route") {
          direct.routeRefreshSeq += 1;
          direct.location.href += "?p=2";
          direct.state.pageKey = "B";
          direct.state.subjectId = 202;
        }
        if (cancellation !== "success") direct.state.message = "latest operation";
        const message = direct.state.message;
        gate.resolve();
        await oldDirect;
        if (cancellation === "success") {
          assert.equal(storage.bindings[bindingKey], 123, `${stage}: current direct input must still persist its binding`);
          assert.equal(direct.state.subjectId, 123);
          assert.equal(direct.state.subject.id, 123);
          assert.equal(writes.length, 1);
        } else {
          assert.equal(storage.bindings[bindingKey], 101, `${stage}/${cancellation}: expired direct input cannot persist a binding`);
          assert.equal(writes.length, 0);
          assert.equal(direct.state.subjectId, cancellation === "route" ? 202 : 101);
          if (cancellation !== "route") assert.equal(direct.state.subject.id, 101);
          assert.equal(direct.state.message, message);
          assert.equal(direct.state.error, "");
          if (cancellation === "search") assert.equal(direct.state.searchResults[0].id, 202);
          if (cancellation === "clear") assert.equal(direct.state.searchResults.length, 0);
        }
      }
    }

    for (const cancellation of ["success", "search", "token"]) {
      for (const rejectModeSave of [false, true]) {
        const harness = loadInteractiveBindingSearch(file);
        const { api: direct, modeGate, modeEntered, storage, bindingKey } = harness;
        await startInteractiveSearch(harness, "prompt");
        const confirm = direct.resolveLongVideoBindingPrompt(true).catch(direct.showError);
        await modeEntered.promise;
        if (cancellation !== "success") await supersedeDirectSearch(direct, harness.requests, cancellation);
        const message = direct.state.message;
        if (rejectModeSave) modeGate.reject(new Error("mode save failed"));
        else modeGate.resolve();
        await confirm;
        const committed = cancellation === "success" && !rejectModeSave;
        assert.equal(storage.bindings[bindingKey], committed ? 123 : 101);
        assert.equal(direct.state.subjectId, committed ? 123 : 101);
        assert.equal(direct.state.subject.id, committed ? 123 : 101);
        if (cancellation !== "success") {
          assert.equal(direct.state.message, message);
          assert.equal(direct.state.error, "", "an expired prompt's mode-save failure cannot overwrite the newer UI");
        } else if (rejectModeSave) assert.match(direct.state.error, /mode save failed/);
      }
    }

    for (const action of ["bind", "auto"]) {
      const harness = loadInteractiveBindingSearch(file, action === "bind" ? "lock" : "none");
      const { api: direct, readinessRequests, modeEntered, modeGate, entered, gate, storage, bindingKey } = harness;
      await startInteractiveSearch(harness, "wait");
      assert.equal(readinessRequests.length, 2);
      readinessRequests[1].resolve({ action });
      await (action === "auto" ? modeEntered.promise : entered.promise);
      await supersedeDirectSearch(direct, harness.requests, "search");
      if (action === "auto") modeGate.resolve();
      else gate.resolve();
      await new Promise(setImmediate);
      assert.equal(storage.bindings[bindingKey], 101, `wait→${action} keeps the original request predicate through persistence`);
      assert.equal(direct.state.subject.id, 101);
      assert.equal(direct.state.searchResults[0].id, 202);
      assert.equal(direct.state.error, "");
    }

    const waiting = loadInteractiveBindingSearch(file);
    await startInteractiveSearch(waiting, "wait");
    waiting.api.clock = 9000;
    waiting.readinessRequests[1].resolve({ action: "wait" });
    await new Promise(setImmediate);
    assert.equal(waiting.api.state.longVideoBindingPrompt.phase, "timeout");
    const originalPredicate = waiting.api.state.longVideoBindingPrompt.isCurrentRequest;
    waiting.api.retryLongVideoBindingWait();
    assert.equal(waiting.api.state.longVideoBindingPrompt.isCurrentRequest, originalPredicate, "timeout and retry retain the original search identity");
    assert.equal(waiting.readinessRequests.length, 3);
    await supersedeDirectSearch(waiting.api, waiting.requests, "search");
    waiting.readinessRequests[2].reject(new Error("old retry failed"));
    await new Promise(setImmediate);
    assert.equal(waiting.storage.bindings[waiting.bindingKey], 101);
    assert.equal(waiting.api.state.subject.id, 101);
    assert.equal(waiting.api.state.searchResults[0].id, 202);
    assert.equal(waiting.api.state.error, "", "a cancelled wait poll cannot surface its late failure");

    for (const cancellation of ["token", "clear"]) {
      const harness = loadBindingSearch(file, "collection-proposal");
      const { api: direct, entered, gate, storage, bindingKey } = harness;
      direct.state.searchResults = [{ id: 123, name: "clicked candidate" }];
      const click = direct.requestBindSubject(123).catch(direct.showError);
      await entered.promise;
      if (cancellation === "token") direct.state.token = "token-b";
      else direct.clearSearchResults();
      gate.resolve();
      await click;
      assert.equal(storage.bindings[bindingKey], 101, "candidate-button calls without an explicit predicate also capture their request/account context");
      assert.equal(direct.state.subject.id, 101);
      assert.equal(direct.state.error, "");
    }

    for (const mode of ["auto-identify", "prompt-identify"]) {
      const harness = loadInteractiveBindingSearch(file);
      const { api: direct, modeEntered, modeGate, writes } = harness;
      const context = file === EXTENSION_PATH ? direct.captureRouteContext() : direct.capturePageContext();
      if (mode === "prompt-identify") direct.showLongVideoBindingPrompt(101, context, { mode: "identify" });
      const identify = mode === "auto-identify"
        ? direct.applyLongVideoAutoAccept(101, context, "identify")
        : direct.resolveLongVideoBindingPrompt(true);
      await modeEntered.promise;
      direct.state.subjectId = 202;
      direct.state.subject = { id: 202, name: "new binding" };
      direct.state.message = "new binding";
      modeGate.resolve();
      await identify;
      assert.equal(writes.length, 0, "expired identify mode cannot fall through into binding its old subject");
      assert.equal(direct.state.subject.id, 202);
      assert.equal(direct.state.subjectId, 202);
      assert.equal(direct.state.message, "new binding");
    }

    const sameSubject = loadBindingSearch(file, "none");
    sameSubject.api.keyword = "101";
    sameSubject.api.parseBangumiSubjectId = () => 101;
    const sameBinding = sameSubject.api.searchSubjects();
    sameSubject.requests[0].resolve({ id: 101, name: "same subject refreshed" });
    await sameBinding;
    assert.equal(sameSubject.storage.bindings[sameSubject.bindingKey], 101);
    assert.equal(sameSubject.api.state.subject.id, 101);
    assert.equal(sameSubject.api.state.subject.name, "same subject refreshed");

    // Keep the actual shared bundle loader in the direct-ID flow: a new
    // same-ID consumer owns completion/error UI, whereas a newer text search
    // does not subscribe to (or get overwritten by) the old subject's load.
    for (const latestKind of ["same-id", "text"]) {
      for (const rejectBundle of [false, true]) {
        const harness = loadSharedBundleSearch(file);
        const { api: direct, bundleGate, bundleEntered } = harness;
        direct.keyword = "123";
        const old = direct.searchSubjects().catch(direct.showError);
        await bundleEntered.promise;
        direct.keyword = latestKind === "same-id" ? "123" : "new title";
        const latest = direct.searchSubjects().catch(direct.showError);
        await new Promise(setImmediate);
        assert.equal(direct.subjectBundleRequests.size, 1);
        assert.equal(harness.subjectReads(), latestKind === "same-id" ? 3 : 2, "a same-ID consumer must reuse the pending bundle, not start a fourth subject GET");
        const message = direct.state.message;
        if (rejectBundle) bundleGate.reject(new Error("shared bundle failed"));
        else bundleGate.resolve();
        await Promise.all([old, latest]);
        assert.equal(direct.subjectBundleRequests.size, 0);
        assert.equal(direct.state.busy, false, "a completed shared load cannot leave the latest same-ID binding busy forever");
        assert.equal(direct.state.subjectId, 123);
        assert.equal(direct.state.subject.id, 123);
        if (latestKind === "same-id") {
          assert.equal(direct.state.error, rejectBundle ? "shared bundle failed" : "");
        } else {
          assert.equal(direct.state.searchResults[0].id, 202);
          assert.equal(direct.state.message, message);
          assert.equal(direct.state.error, "", "an unsubscribed text search cannot receive an old bundle's error");
        }
      }
    }
  }
  for (const name of ["searchSubjects", "clearSearchResults"]) {
    assert.equal(extractFunction(readSource(USERSCRIPT_PATH), name, { async: name === "searchSubjects" }),
      extractFunction(readSource(EXTENSION_PATH), name, { async: name === "searchSubjects" }));
  }
  console.log("search request isolation tests passed");
});
