"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");

const RELAY = "https://api.bgmapi.com";
const CHARACTER_IMAGE = "https://lain.bgm.tv/r/400/pic/crt/l/1a/e3/77_crt_r11wF.jpg?r=1489157445";
const COVER_IMAGE = "https://lain.bgm.tv/r/400/pic/cover/l/c2/4c/253_jJJj9.jpg?r=1";
const sources = [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]
  .map(([label, path]) => [label, readSource(path)]);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function transportError() {
  return Object.assign(new Error("offline"), { isTransportFailure: true, transportKind: "connection", status: 0 });
}

function setup(source) {
  const api = {
    API_BASE: "https://api.bgm.tv", BGM_API_RELAYS: { "api.bgmapi.com": RELAY },
    BGM_WEB_BASE: "https://bgm.tv", BGM_API_AUTO_FALLBACK_PROBE_TIMEOUT_MS: 2000, REQUEST_DEDUP_TTL: 500,
    URL, pendingRequests: new Map(), calls: [], routeRefreshSeq: 1, subjectSearchSeq: 1,
    subject: { id: 253, name: "Series", images: { large: COVER_IMAGE } },
    character: { id: 77, name: "Character", images: { large: CHARACTER_IMAGE }, actors: [] },
    state: {
      pageKey: "video:A", subjectId: 253, subject: null, token: "", collectionRefreshContext: {},
      collectionWriteCount: 0, collectionWriteVersion: 0, apiRelayAutoFallbackEnabled: false,
      apiRelayRetryChoice: "", subjectImageRelayBase: "", previewImageRelayBase: "",
      characterStripEnabled: true, previewCharacterKey: "", previewCharacterBusy: false,
    },
    window: { setTimeout() {} },
    captureBgmApiRetryContext() { return {}; },
    captureRouteContext() { return { pageKey: api.state.pageKey, routeSeq: api.routeRefreshSeq }; },
    isCurrentPageContext(context) { return context.pageKey === api.state.pageKey && context.routeSeq === api.routeRefreshSeq; },
    isRouteContextCurrent(context) { return api.isCurrentPageContext(context); },
    requestBgmApiFallbackChoice() { return Promise.resolve("api.bgmapi.com"); },
    bgmRequestWithRetry(method, url, data, options) {
      const call = { method, url, data, options };
      api.calls.push(call);
      return Promise.resolve().then(() => api.respond(call));
    },
    respond({ url }) {
      if (url.includes("/characters")) return [api.character];
      if (url.includes("/search/")) return { data: [api.subject] };
      if (/\/v0\/subjects\/\d+$/.test(url)) return api.subject;
      return { data: [] };
    },
    bgmRequestPagedData(path, options) { return api.bgmRequest(path, options); },
    sortCharactersLikeBangumi(characters) { return characters; },
    getCollectionReadPath: async () => "",
    setBusy() { api.state.busy = true; },
    beginPanelLoad: () => 1, advancePanelLoad() {}, finishPanelLoad() {},
    rememberBindingSubject: async () => {}, mergePendingCollection: (value) => value,
    render() {}, showError(error) { throw error; },
    refreshSubjectInfoLinksInBackground() {}, refreshStandaloneEpisodeInference: async () => {},
    checkAutoWatchProgress: async () => {}, trackCollectionWrite: (promise) => promise,
    isOfficialBangumiPage: () => true, getOfficialBangumiCharacterKeyword: () => "Series",
    normalizeBindingToken: (value) => String(value).toLowerCase(), syncCharacterStrip() {},
    getDisplayCharacterActorGroups: () => [], escapeHtml: (value) => String(value),
  };
  const names = [
    "bgmRequest", "applyBgmApiRequestScope", "buildBgmApiUrl", "isRelayEligibleTransportError",
    "createBgmApiRelayScope", "getBgmImageUrl", "getBestCharacterImage", "getBgmCharacterCoverUrl",
    "normalizeBgmImageUrl", "getBestSubjectCover", "renderCharacterCard", "loadSubjectCharacters",
    "loadSubjectBundleFresh", "loadSubjectBundlePreservingLocal", "ensureOfficialCharacterStripPreview",
  ];
  runInSandbox(names.map((name) => extractFunction(source, name, {
    async: source.includes(`  async function ${name}(`),
  })).join("\n"), api);
  return api;
}

for (const [label, source] of sources) {
  test(`${label}: actual relay selection routes role images and covers without changing API data`, () => {
    const api = setup(source);
    api.state.apiRelayAutoFallbackEnabled = true;
    assert.equal(api.getBestCharacterImage(api.character), CHARACTER_IMAGE.replace("/r/400", "").replace("/crt/l/", "/crt/m/"));
    api.state.subjectImageRelayBase = RELAY;
    assert.equal(api.getBestCharacterImage(api.character), `${RELAY}/pic/crt/m/1a/e3/77_crt_r11wF.jpg?r=1489157445`);
    assert.match(api.renderCharacterCard(api.character), /src="https:\/\/api\.bgmapi\.com\/pic\/crt\/m\//);
    assert.equal(api.getBestSubjectCover(api.subject, api.state.subjectImageRelayBase), `${RELAY}/pic/cover/l/c2/4c/253_jJJj9.jpg?r=1`);
    assert.equal(api.getBestSubjectCover(api.subject), COVER_IMAGE, "other consumers keep their own route");
    assert.equal(api.character.images.large, CHARACTER_IMAGE);
    assert.equal(api.subject.images.large, COVER_IMAGE);
    api.state.subjectId = null;
    assert.equal(api.getBestCharacterImage(api.character).startsWith(RELAY), false, "preview must not inherit a bound panel's old relay");
    api.state.previewImageRelayBase = RELAY;
    assert.equal(api.getBestCharacterImage(api.character).startsWith(RELAY), true);
  });

  test(`${label}: image rewriting accepts only the supported relay and Bangumi picture paths`, () => {
    const api = setup(source);
    for (const url of ["", "bad url", "data:image/jpeg;base64,AA", "https://evil.example/pic/crt/l/x.jpg",
      "https://lain.bgm.tv.evil.example/pic/crt/l/x.jpg", "https://user:pass@lain.bgm.tv/pic/crt/l/x.jpg",
      "https://lain.bgm.tv:444/pic/crt/l/x.jpg", "https://lain.bgm.tv/v0/me", "https://lain.bgm.tv/img/icon.png"]) {
      assert.equal(api.getBgmImageUrl(url, RELAY), url);
    }
    assert.equal(api.getBgmImageUrl(CHARACTER_IMAGE, "https://evil.example"), CHARACTER_IMAGE);
    for (const size of [100, 200, 400]) {
      assert.equal(api.getBgmImageUrl(`https://lain.bgm.tv/r/${size}/pic/crt/l/x.jpg?x=1&y=2`, RELAY), `${RELAY}/pic/crt/l/x.jpg?x=1&y=2`);
    }
  });

  for (const mode of ["manual", "automatic", "forced"]) {
    test(`${label}: ${mode} relay success records the source in the load scope`, async () => {
      const api = setup(source);
      api.state.apiRelayAutoFallbackEnabled = mode === "automatic";
      const scope = mode === "forced" ? { choice: "api.bgmapi.com" } : {};
      const respond = api.respond;
      api.respond = (call) => call.url.startsWith(api.API_BASE) ? Promise.reject(transportError()) : respond(call);
      assert.equal(await api.bgmRequest("/v0/subjects/253", { relayScope: scope }), api.subject);
      assert.equal(scope.imageRelayBase, RELAY);
      assert.equal(api.calls.length, mode === "forced" ? 1 : 2);
    });
  }

  test(`${label}: official success, cancellation, and failed relay do not select an image relay`, async () => {
    const api = setup(source);
    api.state.apiRelayAutoFallbackEnabled = true;
    const official = {};
    await api.bgmRequest("/v0/subjects/253", { relayScope: official, dedup: false });
    assert.equal(official.imageRelayBase, undefined);
    api.state.apiRelayAutoFallbackEnabled = false;
    api.requestBgmApiFallbackChoice = () => Promise.resolve("cancel");
    api.respond = () => Promise.reject(transportError());
    const cancelled = {};
    await assert.rejects(api.bgmRequest("/v0/subjects/253", { relayScope: cancelled, dedup: false }));
    assert.equal(cancelled.imageRelayBase, undefined);
    const failed = { choice: "api.bgmapi.com" };
    await assert.rejects(api.bgmRequest("/v0/subjects/253", { relayScope: failed, dedup: false }));
    assert.equal(failed.imageRelayBase, undefined);
  });

  test(`${label}: concurrent and cached consumers inherit a shared request's source`, async () => {
    const api = setup(source);
    api.state.apiRelayAutoFallbackEnabled = true;
    const gate = deferred();
    api.respond = (call) => call.url.startsWith(api.API_BASE) ? Promise.reject(transportError()) : gate.promise;
    const firstScope = {}, secondScope = {}, cachedScope = {};
    const first = api.bgmRequest("/v0/subjects/253", { relayScope: firstScope });
    const second = api.bgmRequest("/v0/subjects/253", { relayScope: secondScope });
    gate.resolve(api.subject);
    await Promise.all([first, second]);
    await api.bgmRequest("/v0/subjects/253", { relayScope: cachedScope });
    assert.equal(api.calls.length, 2, "one official attempt and one shared relay attempt");
    for (const scope of [firstScope, secondScope, cachedScope]) assert.equal(scope.imageRelayBase, RELAY);
    assert.equal(api.state.subjectImageRelayBase, "", "transport completion alone must not change the active panel");
  });

  test(`${label}: explicit official and relay choices cannot reuse each other's cached result`, async () => {
    const api = setup(source);
    const relay = { choice: "api.bgmapi.com" }, official = { choice: "official" };
    await api.bgmRequest("/v0/subjects/253", { relayScope: relay });
    await api.bgmRequest("/v0/subjects/253", { relayScope: official });
    assert.deepEqual(api.calls.map((call) => new URL(call.url).origin), [RELAY, api.API_BASE]);
    assert.equal(relay.imageRelayBase, RELAY);
    assert.equal(official.imageRelayBase, undefined);
  });

  for (const loader of ["loadSubjectBundleFresh", "loadSubjectBundlePreservingLocal"]) {
    const load = (api) => loader === "loadSubjectBundleFresh"
      ? api[loader](253, "", { pageKey: api.state.pageKey, routeSeq: api.routeRefreshSeq }) : api[loader](null);

    test(`${label}: ${loader} uses any successful relay in the batch and later recovers to official images`, async () => {
      const api = setup(source);
      api.state.apiRelayAutoFallbackEnabled = true;
      const respond = api.respond;
      api.respond = (call) => call.url.startsWith(`${api.API_BASE}/v0/episodes?`) ? Promise.reject(transportError()) : respond(call);
      await load(api);
      assert.equal(api.state.subjectImageRelayBase, RELAY, "role API may succeed officially while another panel request needs relay");
      assert.equal(api.state.characters[0], api.character);
      assert.equal(api.getBestCharacterImage(api.character).startsWith(RELAY), true);
      api.pendingRequests.clear();
      api.respond = respond;
      await load(api);
      assert.equal(api.state.subjectImageRelayBase, "", "a new all-official load must clear the old relay");
      assert.equal(api.getBestCharacterImage(api.character).startsWith(RELAY), false);
    });

    test(`${label}: ${loader} ignores an old relay response after changing page or subject`, async () => {
      const api = setup(source);
      api.state.apiRelayRetryChoice = "api.bgmapi.com";
      const gate = deferred();
      const respond = api.respond;
      api.respond = (call) => /\/v0\/subjects\/253$/.test(call.url) ? gate.promise : respond(call);
      const pending = load(api);
      api.state.subjectId = 999;
      api.state.pageKey = "video:B";
      api.state.subject = { id: 999 };
      gate.resolve(api.subject);
      await pending;
      assert.equal(api.state.subject.id, 999);
      assert.equal(api.state.subjectImageRelayBase, "");
    });
  }

  test(`${label}: unbound official preview shares the search and role image relay scope`, async () => {
    const api = setup(source);
    api.state.subjectId = null;
    api.state.apiRelayAutoFallbackEnabled = true;
    const respond = api.respond;
    api.respond = (call) => call.url.startsWith(`${api.API_BASE}/v0/search/`) ? Promise.reject(transportError()) : respond(call);
    api.ensureOfficialCharacterStripPreview();
    for (let i = 0; i < 10 && api.state.previewCharacterBusy; i += 1) await new Promise(setImmediate);
    assert.equal(api.state.previewCharacterBusy, false);
    assert.equal(api.state.previewSubject, api.subject);
    assert.equal(api.state.previewImageRelayBase, RELAY);
    const scopes = api.calls.map((call) => call.options.relayScope);
    assert.ok(scopes.every((scope) => scope === scopes[0]));
    assert.equal(api.getBestCharacterImage(api.character).startsWith(RELAY), true);
  });
}

test("image relay helpers and request-source tracking stay identical in both builds", () => {
  for (const name of ["bgmRequest", "applyBgmApiRequestScope", "getBgmImageUrl", "getBestCharacterImage", "getBestSubjectCover", "ensureOfficialCharacterStripPreview"]) {
    assert.equal(extractFunction(sources[0][1], name), extractFunction(sources[1][1], name), name);
  }
});
