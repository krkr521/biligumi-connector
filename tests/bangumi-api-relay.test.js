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

assert.ok(userscriptSource.includes("// @connect      api.bangumi.pro"));
assert.ok(userscriptSource.includes("// @connect      bgmapi.anibt.net"));
assert.ok(manifest.host_permissions.includes("https://api.bangumi.pro/*"));
assert.ok(manifest.host_permissions.includes("https://bgmapi.anibt.net/*"));
assert.ok(userscriptSource.includes("const BGM_API_REQUEST_TIMEOUT_MS = 10000;"));
assert.ok(userscriptSource.includes("timeout: BGM_API_REQUEST_TIMEOUT_MS,"));
assert.ok(userscriptSource.includes("不会自动选择或记住中继"));
assert.ok(userscriptSource.includes("Bangumi Access Token"));
assert.ok(userscriptSource.includes("color: #bd2441;"));
assert.ok(userscriptSource.includes("class=\"biligumi-button danger\""));
assert.equal(userscriptSource.includes("writeValue(STORAGE.apiRelay"), false, "relay choice must not be persisted");

const requestSandbox = {
  API_BASE: "https://api.bgm.tv",
  BGM_API_RELAYS: Object.freeze({
    "api.bangumi.pro": "https://api.bangumi.pro",
    "bgmapi.anibt.net": "https://bgmapi.anibt.net",
  }),
  state: { token: "secret-token" },
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
  requestSandbox.choice = "api.bangumi.pro";
  const result = await requestSandbox.api.bgmRequest("/v0/me", { auth: true, dedup: false });
  assert.equal(requestSandbox.calls[0].url, "https://api.bgm.tv/v0/me", "official API is always attempted first");
  assert.equal(requestSandbox.calls[1].url, "https://api.bangumi.pro/v0/me", "relay is used only after explicit choice");
  assert.equal(requestSandbox.calls[1].options.authToken, "secret-token");
  assert.equal(result.url, "https://api.bangumi.pro/v0/me");

  requestSandbox.calls.length = 0;
  requestSandbox.choice = "official";
  await requestSandbox.api.bgmRequest("/v0/subjects/1", { dedup: false });
  assert.deepEqual(requestSandbox.calls.map((call) => call.url), [
    "https://api.bgm.tv/v0/subjects/1",
    "https://api.bgm.tv/v0/subjects/1",
  ]);

  assert.throws(
    () => requestSandbox.api.buildBgmApiUrl("https://evil.example/v0/me", "https://api.bangumi.pro"),
    /Blocked Bangumi API target/,
  );

  const transportError = vm.runInContext(
    "(() => { const e = new Error('x'); e.status = 0; e.transportKind = 'timeout'; e.isTransportFailure = true; return e; })()",
    requestSandbox,
  );
  assert.equal(requestSandbox.api.isRelayEligibleTransportError(transportError), true);
  assert.equal(requestSandbox.api.isRelayEligibleTransportError({ status: 503 }), false, "HTTP 5xx must not expose relay choice");
  assert.equal(requestSandbox.api.isRelayEligibleTransportError({ status: 401 }), false, "auth errors must not expose relay choice");
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("https://api.bangumi.pro/v0/me", "https://api.bangumi.pro/v0/me"), true);
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("https://evil.example/v0/me", "https://api.bangumi.pro/v0/me"), false);
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("", "https://api.bgm.tv/v0/me"), true, "official responses may omit finalUrl");
  assert.equal(requestSandbox.api.isExpectedBgmApiFinalUrl("", "https://api.bangumi.pro/v0/me"), false, "relay responses must fail closed when finalUrl is unavailable");

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
    url: "https://api.bangumi.pro/v0/me",
    method: "GET",
    headers: { Authorization: "Bearer secret", Cookie: "forbidden", Origin: "forbidden" },
  });
  assert.equal(normalized.redirect, "error");
  assert.equal(normalized.credentials, "omit");
  assert.equal(normalized.headers.Authorization, "Bearer secret");
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.headers, "Cookie"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.headers, "Origin"), false);
  assert.equal(bgSandbox.api.classifyHttpTarget("https://evil.example/v0/me"), "");
  assert.equal(bgSandbox.api.classifyHttpTarget("https://api.bangumi.pro/not-v0/me"), "");
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
  promptResolve("api.bangumi.pro");
  assert.equal(await siblingChoice, "api.bangumi.pro", "concurrent failures in the same prompt wave share the explicit choice");

  console.log("Bangumi API relay tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
