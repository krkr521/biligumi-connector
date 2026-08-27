"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
} = require("./_source");

const repoRoot = path.resolve(__dirname, "..");
const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);
const backgroundSource = fs.readFileSync(path.join(repoRoot, "extension", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "extension", "manifest.json"), "utf8"));

for (const name of [
  "createBgmApiRelayScope",
  "requestBgmApiFallbackChoice",
  "renderBgmApiRelayPrompt",
  "mountBgmApiRelayPrompt",
  "handleBgmApiRelayKeydown",
  "settleBgmApiRelayPrompt",
  "removeBgmApiRelayPrompt",
  "bgmRequest",
  "buildBgmApiUrl",
  "makeNetworkError",
  "isRelayEligibleTransportError",
  "isExpectedBgmApiFinalUrl",
]) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    name + " must stay identical between userscript and extension",
  );
}

assert.ok(userscriptSource.includes("// @connect      api.bgmapi.com"));
assert.ok(manifest.host_permissions.includes("https://api.bgmapi.com/*"));
assert.ok(userscriptSource.includes("const BGM_API_REQUEST_TIMEOUT_MS = 10000;"));
assert.ok(userscriptSource.includes("timeout: BGM_API_REQUEST_TIMEOUT_MS,"));
assert.ok(userscriptSource.includes("不会自动选择或记住中继"));
assert.ok(userscriptSource.includes("官方 API 连接失败后自动使用 api.bgmapi.com"));
assert.ok(userscriptSource.includes('confirmLabel: "启用自动回退"'), "enabling persistent relay fallback must require explicit danger confirmation");
assert.ok(userscriptSource.includes("该站点不是 Bangumi 官方服务，可能读取或记录这些信息"));
assert.ok(userscriptSource.includes("apiRelayAutoFallback: \"biligumi.apiRelayAutoFallback\""));
assert.ok(userscriptSource.includes("readValue(STORAGE.apiRelayAutoFallback, \"0\") === \"1\""), "automatic relay fallback must be opt-in by default");
assert.ok(userscriptSource.includes("writeValue(STORAGE.apiRelayAutoFallback, state.apiRelayAutoFallbackEnabled ? \"1\" : \"0\")"));
assert.ok(extensionSource.includes("writeValueAsync(STORAGE.apiRelayAutoFallback, state.apiRelayAutoFallbackEnabled ? \"1\" : \"0\")"));
assert.ok(userscriptSource.includes("Bangumi Access Token"));
assert.ok(userscriptSource.includes("color: #bd2441;"));
assert.ok(userscriptSource.includes("class=\"biligumi-button danger\""));
assert.ok(userscriptSource.includes("const relayScope = createBgmApiRelayScope();"), "subject loads must share one temporary relay choice");
assert.ok(userscriptSource.includes("relayScope: options.relayScope || null"), "request fallback must receive the temporary load scope");

const requestSandbox = {
  API_BASE: "https://api.bgm.tv",
  BGM_API_RELAYS: Object.freeze({
    "api.bgmapi.com": "https://api.bgmapi.com",
  }),
  state: { token: "secret-token", apiRelayAutoFallbackEnabled: false },
  pendingRequests: new Map(),
  REQUEST_DEDUP_TTL: 500,
  URL,
  window: { setTimeout(callback) { callback(); } },
  calls: [],
  choice: "cancel",
  bgmRequestWithRetry(method, url, data, options) {
    requestSandbox.calls.push({ phase: "official", method, url, data, options });
    const error = new Error("offline");
    error.status = 0;
    error.transportKind = "timeout";
    error.isTransportFailure = true;
    return Promise.reject(error);
  },
  bgmRequestOnce(method, url, data, options) {
    requestSandbox.calls.push({ phase: "manual", method, url, data, options });
    return Promise.resolve({ ok: true, url });
  },
  requestBgmApiFallbackChoice() { return Promise.resolve(requestSandbox.choice); },
};
vm.createContext(requestSandbox);
vm.runInContext([
  extractFunction(userscriptSource, "bgmRequest"),
  extractFunction(userscriptSource, "buildBgmApiUrl"),
  extractFunction(userscriptSource, "isRelayEligibleTransportError"),
  extractFunction(userscriptSource, "isExpectedBgmApiFinalUrl"),
  "globalThis.api = { bgmRequest, buildBgmApiUrl, isRelayEligibleTransportError, isExpectedBgmApiFinalUrl };",
].join("\n"), requestSandbox);

(async () => {
  requestSandbox.choice = "api.bgmapi.com";
  const result = await requestSandbox.api.bgmRequest("/v0/me", { auth: true, dedup: false });
  assert.equal(requestSandbox.calls[0].url, "https://api.bgm.tv/v0/me", "official API is always attempted first");
  assert.equal(requestSandbox.calls[1].url, "https://api.bgmapi.com/v0/me", "relay is used only after explicit choice");
  assert.equal(requestSandbox.calls[1].options.authToken, "secret-token");
  assert.equal(result.url, "https://api.bgmapi.com/v0/me");

  requestSandbox.calls.length = 0;
  requestSandbox.state.apiRelayAutoFallbackEnabled = true;
  requestSandbox.choice = "cancel";
  const automaticResult = await requestSandbox.api.bgmRequest("/v0/me", { auth: true, dedup: false });
  assert.deepEqual(requestSandbox.calls.map((call) => call.url), [
    "https://api.bgm.tv/v0/me",
    "https://api.bgmapi.com/v0/me",
  ], "opt-in automatic fallback must still try the official API first");
  assert.equal(automaticResult.url, "https://api.bgmapi.com/v0/me");
  requestSandbox.state.apiRelayAutoFallbackEnabled = false;

  requestSandbox.calls.length = 0;
  requestSandbox.choice = "official";
  await requestSandbox.api.bgmRequest("/v0/subjects/1", { dedup: false });
  assert.deepEqual(requestSandbox.calls.map((call) => call.url), [
    "https://api.bgm.tv/v0/subjects/1",
    "https://api.bgm.tv/v0/subjects/1",
  ]);

  assert.throws(
    () => requestSandbox.api.buildBgmApiUrl("https://evil.example/v0/me", "https://api.bgmapi.com"),
    /Blocked Bangumi API target/,
  );

  const transportError = vm.runInContext(
    "(() => { const e = new Error('x'); e.status = 0; e.transportKind = 'timeout'; e.isTransportFailure = true; return e; })()",
    requestSandbox,
  );
  assert.equal(requestSandbox.api.isRelayEligibleTransportError(transportError), true);
  assert.equal(requestSandbox.api.isRelayEligibleTransportError({ status: 503 }), false, "HTTP 5xx must not expose relay choice");
  assert.equal(requestSandbox.api.isRelayEligibleTransportError({ status: 401 }), false, "auth errors must not expose relay choice");
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("https://api.bgmapi.com/v0/me", "https://api.bgmapi.com/v0/me"), true);
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("https://evil.example/v0/me", "https://api.bgmapi.com/v0/me"), false);
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("", "https://api.bgm.tv/v0/me"), true, "official responses may omit finalUrl");
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("", "https://api.bgmapi.com/v0/me"), false, "relay responses must fail closed when finalUrl is unavailable");

  const backgroundStart = backgroundSource.indexOf("  function normalizeHttpRequest(");
  const backgroundEnd = backgroundSource.indexOf("  function tryParseJson(", backgroundStart);
  assert.notEqual(backgroundStart, -1);
  assert.notEqual(backgroundEnd, -1);
  const backgroundBlock = backgroundSource.slice(backgroundStart, backgroundEnd);
  const bgSandbox = {
    URL, Set, Object, String, Number, Math, Error,
    isBilibiliVideoUrl: (url) => /^https:\/\/www\.bilibili\.com\/(?:video|bangumi\/play)\//.test(String(url || "")),
    isDeleteBridgeTabUrl: (url) => /^https:\/\/bgm\.tv\/subject\/\d+/.test(String(url || "")),
  };
  vm.createContext(bgSandbox);
  vm.runInContext(backgroundBlock + "\n;globalThis.api = { normalizeHttpRequest, classifyHttpTarget, filterRequestHeaders, isAllowedHttpSender };", bgSandbox);

  const normalized = bgSandbox.api.normalizeHttpRequest({
    url: "https://api.bgmapi.com/v0/me",
    method: "GET",
    headers: { Authorization: "Bearer secret", Cookie: "forbidden", Origin: "forbidden" },
  });
  assert.equal(normalized.redirect, "error");
  assert.equal(normalized.credentials, "omit");
  assert.equal(normalized.headers.Authorization, "Bearer secret");
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.headers, "Cookie"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.headers, "Origin"), false);
  assert.equal(bgSandbox.api.classifyHttpTarget("https://evil.example/v0/me"), "");
  assert.equal(bgSandbox.api.classifyHttpTarget("https://api.bgmapi.com/not-v0/me"), "");
  assert.equal(bgSandbox.api.isAllowedHttpSender({ frameId: 0, tab: { id: 1, url: "https://www.bilibili.com/video/BV1xx" } }), true);
  assert.equal(bgSandbox.api.isAllowedHttpSender({ frameId: 1, tab: { id: 1, url: "https://www.bilibili.com/video/BV1xx" } }), false);

  let promptResolve;
  const sharedPrompt = new Promise((resolve) => { promptResolve = resolve; });
  const concurrentState = { apiRelayPrompt: { authenticated: false, promise: sharedPrompt } };
  const concurrentSandbox = {
    state: concurrentState, Boolean, Promise,
    mountCalls: 0,
    mountBgmApiRelayPrompt() { concurrentSandbox.mountCalls += 1; },
  };
  vm.createContext(concurrentSandbox);
  vm.runInContext(
    extractFunction(userscriptSource, "requestBgmApiFallbackChoice") + "\n;globalThis.choose = requestBgmApiFallbackChoice;",
    concurrentSandbox,
  );
  const siblingChoice = concurrentSandbox.choose({ authenticated: true });
  assert.equal(concurrentState.apiRelayPrompt.authenticated, true, "an authenticated sibling must upgrade the shared warning");
  assert.equal(concurrentSandbox.mountCalls, 1, "the upgraded warning must be rendered before consent");
  promptResolve("api.bgmapi.com");
  assert.equal(await siblingChoice, "api.bgmapi.com", "concurrent failures in the same prompt wave share the explicit choice");

  const scopeSandbox = { state: { apiRelayPrompt: null }, Boolean, Promise };
  vm.createContext(scopeSandbox);
  vm.runInContext([
    extractFunction(userscriptSource, "createBgmApiRelayScope"),
    extractFunction(userscriptSource, "requestBgmApiFallbackChoice"),
    "globalThis.api = { createBgmApiRelayScope, requestBgmApiFallbackChoice };",
  ].join("\n"), scopeSandbox);
  const loadScope = scopeSandbox.api.createBgmApiRelayScope();
  loadScope.choice = "api.bgmapi.com";
  assert.equal(
    await scopeSandbox.api.requestBgmApiFallbackChoice({ authenticated: true, relayScope: loadScope }),
    "api.bgmapi.com",
    "later requests in one load batch must reuse the explicit choice without mounting a second dialog",
  );
  loadScope.choice = "official";
  assert.equal(
    await scopeSandbox.api.requestBgmApiFallbackChoice({ relayScope: loadScope }),
    "official",
    "retry-official choice must also be reused for the rest of one load batch",
  );

  console.log("Bangumi API relay tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
