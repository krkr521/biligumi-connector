"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, extractConstants, runInSandbox,
} = require("./_source");

const sources = [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]
  .map(([label, path]) => [label, readSource(path)]);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function timeout() {
  return Object.assign(new Error("Bangumi API 请求超时"), {
    status: 0, transportKind: "timeout", isTransportFailure: true,
  });
}

function setup(source) {
  const api = {
    ...extractConstants(source, ["REQUEST_MAX_RETRIES", "REQUEST_RETRY_BASE_MS", "REQUEST_DEDUP_TTL", "BGM_API_AUTO_FALLBACK_PROBE_TIMEOUT_MS"]),
    API_BASE: "https://api.bgm.tv", BGM_API_RELAYS: { "api.bgmapi.com": "https://api.bgmapi.com" },
    state: {
      pageKey: "video:A", subjectId: 100, token: "test-token", nonMainSearchSeq: 1,
      busy: true, error: "", subject: null, apiRelayAutoFallbackEnabled: false,
    },
    routeRefreshSeq: 1, subjectSearchSeq: 1, routeKey: "/video/BVA:p1",
    bgmApiRetryRequests: new Map(), pendingRequests: new Map(),
    URL, calls: [], delays: [], notices: [],
    getCurrentRouteSelectionKey() { return api.routeKey; },
    escapeHtml(value) { return String(value); },
    renderBgmApiRelayPrompt() { return "relay-prompt"; },
    renderBgmApiRelayRetryNotice() { return "relay-notice"; },
    renderScriptUpdateBanner() { return "update-banner"; },
    renderExtensionUpdateBanner() { return "update-banner"; },
    render() { api.notices.push(api.renderBgmApiRetryNotice()); },
    sleep(ms) { api.delays.push(ms); return Promise.resolve(); },
    requestBgmApiFallbackChoice() { return Promise.resolve("api.bgmapi.com"); },
    trackCollectionWrite(promise) { return promise; },
    window: { setTimeout() {} },
    bgmRequestOnce(method, url, data, options) {
      api.calls.push({ method, url, data, options });
      return api.respond(api.calls.at(-1));
    },
    respond() { return Promise.resolve({ ok: true }); },
  };
  runInSandbox([
    "bgmRequest", "applyBgmApiRequestScope", "buildBgmApiUrl", "isRelayEligibleTransportError", "renderPanelNoticeSlot",
    "renderBgmApiRetryNotice", "isBgmApiRetryContextCurrent", "captureBgmApiRetryContext", "isRetryableApiError", "isSubjectDataLoading",
  ].map((name) => extractFunction(source, name)).concat(
    extractFunction(source, "bgmRequestWithRetry", { async: true }),
  ).join("\n"), api);
  return api;
}

test("retry implementation and notice remain identical across both builds", () => {
  for (const name of ["renderBgmApiRetryNotice", "isBgmApiRetryContextCurrent", "captureBgmApiRetryContext", "bgmRequestWithRetry"]) {
    assert.equal(extractFunction(sources[0][1], name, { async: name === "bgmRequestWithRetry" }),
      extractFunction(sources[1][1], name, { async: name === "bgmRequestWithRetry" }));
  }
});

for (const [label, source] of sources) {
  test(`${label}: timeouts retry with backoff and clear the red notice on recovery`, async () => {
    const api = setup(source);
    api.respond = () => api.calls.length < 4 ? Promise.reject(timeout()) : Promise.resolve({ ok: true });
    assert.deepEqual(await api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/subjects/100", undefined, {}), { ok: true });
    assert.deepEqual(api.delays, [500, 1000, 2000]);
    assert.equal(api.calls.length, 4);
    assert.match(api.notices[0], /class="biligumi-notice error" role="status"/);
    assert.match(api.notices[0], /Bangumi API 请求超时，正在自动重试/);
    assert.equal(api.notices.at(-1), "");
    assert.equal(api.state.error, "", "temporary failures must not set the terminal error");
    assert.equal(api.state.busy, true);
    assert.equal(api.isSubjectDataLoading(), true, "retrying must preserve the loading skeleton");
  });

  test(`${label}: exhausted retries stop and preserve the actual final error`, async () => {
    const api = setup(source);
    const failure = timeout();
    api.respond = () => Promise.reject(failure);
    await assert.rejects(api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/me", undefined, {}), (error) => error === failure);
    assert.equal(api.calls.length, 4);
    assert.equal(api.bgmApiRetryRequests.size, 0);
    assert.equal(api.renderBgmApiRetryNotice(), "");
  });

  test(`${label}: the short official probe and client errors do not start retries`, async () => {
    for (const [status, options] of [[0, { maxRetries: 0 }], [401, {}], [403, {}], [404, {}], [429, {}]]) {
      const api = setup(source);
      api.respond = () => Promise.reject(Object.assign(timeout(), { status }));
      await assert.rejects(api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/me", undefined, options));
      assert.equal(api.calls.length, 1);
      assert.deepEqual(api.delays, []);
      assert.deepEqual(api.notices, []);
    }
  });

  test(`${label}: overlapping retries each own their notice until their request settles`, async () => {
    const api = setup(source);
    const first = deferred();
    const second = deferred();
    const waiting = deferred();
    const counts = new Map();
    api.respond = ({ url }) => {
      const count = (counts.get(url) || 0) + 1;
      counts.set(url, count);
      return count === 1 ? Promise.reject(timeout()) : Promise.resolve({ ok: true });
    };
    api.sleep = () => {
      const gate = api.bgmApiRetryRequests.size === 1 ? first : second;
      if (gate === second) waiting.resolve();
      return gate.promise;
    };
    const a = api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/subjects/100", undefined, {});
    const b = api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/episodes", undefined, {});
    await waiting.promise;
    assert.equal(api.bgmApiRetryRequests.size, 2);
    first.resolve();
    await a;
    assert.equal(api.bgmApiRetryRequests.size, 1);
    assert.match(api.renderPanelNoticeSlot(), /正在自动重试/);
    second.resolve();
    await b;
    assert.equal(api.renderBgmApiRetryNotice(), "");
  });

  test(`${label}: obsolete route, account, subject and search notices stay out of the current panel`, async () => {
    const api = setup(source);
    const gate = deferred();
    const waiting = deferred();
    api.respond = () => api.calls.length === 1 ? Promise.reject(timeout()) : Promise.resolve({ ok: true });
    api.sleep = () => { waiting.resolve(); return gate.promise; };
    const request = api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/subjects/100", undefined, {});
    await waiting.promise;
    for (const [object, key, value] of [
      [api.state, "pageKey", "video:B"], [api, "routeRefreshSeq", 2], [api, "routeKey", "/video/BVB:p1"],
      [api.state, "subjectId", 200], [api.state, "token", "replacement-token"],
      [api, "subjectSearchSeq", 2], [api.state, "nonMainSearchSeq", 2],
    ]) {
      const old = object[key];
      object[key] = value;
      assert.equal(api.renderBgmApiRetryNotice(), "", `${key} changed`);
      object[key] = old;
      assert.match(api.renderBgmApiRetryNotice(), /正在自动重试/);
    }
    gate.resolve();
    await request;
  });

  for (const mode of ["automatic", "manual", "forced"]) {
    test(`${label}: ${mode} relay requests retry timeouts with the original token and payload`, async () => {
      const api = setup(source);
      api.state.apiRelayAutoFallbackEnabled = mode === "automatic";
      let relayCalls = 0;
      api.respond = ({ url }) => {
        if (new URL(url).origin === api.API_BASE) return Promise.reject(timeout());
        relayCalls += 1;
        return relayCalls === 1 ? Promise.reject(timeout()) : Promise.resolve({ ok: true });
      };
      await api.bgmRequest("/v0/search/subjects?limit=8", {
        method: "POST", body: { keyword: "test" }, auth: true, dedup: false,
        ...(mode === "forced" ? { relayScope: { choice: "api.bgmapi.com" } } : {}),
      });
      assert.equal(relayCalls, 2);
      const official = api.calls.filter(({ url }) => new URL(url).origin === api.API_BASE);
      assert.equal(official.length, mode === "forced" ? 0 : mode === "automatic" ? 1 : 4);
      if (mode === "automatic") assert.equal(official[0].options.requestTimeoutMs, 2000);
      for (const call of api.calls) {
        assert.equal(call.options.authToken, "test-token");
        assert.equal(call.data, '{"keyword":"test"}');
      }
      assert.ok(api.notices.some((notice) => /Bangumi API 请求超时，正在自动重试/.test(notice)));
      assert.equal(api.notices.at(-1), "");
    });
  }

  test(`${label}: connection and server errors use an accurate temporary-failure notice`, async () => {
    for (const status of [0, 503]) {
      const api = setup(source);
      api.respond = () => api.calls.length === 1
        ? Promise.reject(Object.assign(new Error("unavailable"), { status })) : Promise.resolve({ ok: true });
      await api.bgmRequestWithRetry("GET", "https://api.bgm.tv/v0/me", undefined, {});
      assert.match(api.notices[0], /请求暂时失败，正在自动重试/);
      assert.doesNotMatch(api.notices[0], /请求超时/);
    }
  });

  test(`${label}: a late relay fallback retains the original page context`, async () => {
    const api = setup(source);
    api.state.apiRelayAutoFallbackEnabled = true;
    const probe = deferred();
    const gate = deferred();
    const waiting = deferred();
    let relayCalls = 0;
    api.respond = ({ url }) => {
      if (new URL(url).origin === api.API_BASE) return probe.promise.then(() => { throw timeout(); });
      relayCalls += 1;
      return relayCalls === 1 ? Promise.reject(timeout()) : Promise.resolve({ ok: true });
    };
    api.sleep = () => { waiting.resolve(); return gate.promise; };
    const request = api.bgmRequest("/v0/subjects/100", { dedup: false });
    api.state.pageKey = "video:B";
    api.routeRefreshSeq = 2;
    api.routeKey = "/video/BVB:p1";
    probe.resolve();
    await waiting.promise;
    assert.equal(api.bgmApiRetryRequests.size, 1, "old request is still settling");
    assert.equal(api.renderBgmApiRetryNotice(), "", "old relay retries must not claim the new panel");
    assert.equal(api.calls.at(-1).options.retryContext.pageKey, "video:A");
    gate.resolve();
    await request;
  });
}
