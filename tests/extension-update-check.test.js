"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  EXTENSION_PATH,
  repoRoot,
  readSource,
  extractFunction,
  extractConstants,
} = require("./_source");

const extensionSource = readSource(EXTENSION_PATH);
const backgroundSource = fs.readFileSync(path.join(repoRoot, "extension", "background.js"), "utf8");
const optionsSource = fs.readFileSync(path.join(repoRoot, "extension", "options.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(repoRoot, "extension", "options.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "extension", "manifest.json"), "utf8"));

const constants = extractConstants(extensionSource, [
  "SCRIPT_VERSION",
  "EXTENSION_UPDATE_CHECK_MESSAGE",
  "EXTENSION_UPDATE_OPEN_MESSAGE",
]);
assert.equal(constants.SCRIPT_VERSION, manifest.version, "content and manifest versions must stay aligned");
assert.equal(constants.EXTENSION_UPDATE_CHECK_MESSAGE, "biligumi-check-extension-update");
assert.equal(constants.EXTENSION_UPDATE_OPEN_MESSAGE, "biligumi-open-extension-update");

for (const permission of [
  "https://raw.githubusercontent.com/krkr521/biligumi-connector/master/extension/manifest.json",
  "https://api.gitcode.com/api/v5/repos/krkr521/biligumi-connector/branches/master",
  "https://api.gitcode.com/api/v5/repos/krkr521/biligumi-connector/raw/extension/manifest.json",
]) {
  assert.ok(manifest.host_permissions.includes(permission), `missing update host permission: ${permission}`);
}

const pureSandbox = {};
vm.createContext(pureSandbox);
vm.runInContext([
  extractFunction(backgroundSource, "isValidExtensionVersion"),
  extractFunction(backgroundSource, "compareExtensionVersions"),
  extractFunction(backgroundSource, "parseExtensionUpdateManifest"),
  ";globalThis.updatePure = { isValidExtensionVersion, compareExtensionVersions, parseExtensionUpdateManifest };",
].join("\n"), pureSandbox);

assert.equal(pureSandbox.updatePure.isValidExtensionVersion("0.3.18"), true);
assert.equal(pureSandbox.updatePure.isValidExtensionVersion("65535.0.1.2"), true);
assert.equal(pureSandbox.updatePure.isValidExtensionVersion("65536.0"), false);
assert.equal(pureSandbox.updatePure.isValidExtensionVersion("1.2.3.4.5"), false);
assert.equal(pureSandbox.updatePure.isValidExtensionVersion("01.2"), false);
assert.equal(pureSandbox.updatePure.compareExtensionVersions("0.3.9", "0.3.10"), -1);
assert.equal(pureSandbox.updatePure.compareExtensionVersions("0.3.17", "0.3.17"), 0);
assert.equal(pureSandbox.updatePure.compareExtensionVersions("1.0", "0.99.99"), 1);
assert.equal(
  pureSandbox.updatePure.parseExtensionUpdateManifest(JSON.stringify({
    manifest_version: 3,
    name: "Biligumi Connector",
    version: "0.3.18",
  })).version,
  "0.3.18",
);
assert.throws(
  () => pureSandbox.updatePure.parseExtensionUpdateManifest(JSON.stringify({
    manifest_version: 3,
    name: "Other Extension",
    version: "99.0.0",
  })),
  /invalid extension manifest/,
);
assert.throws(
  () => pureSandbox.updatePure.parseExtensionUpdateManifest(JSON.stringify({
    manifest_version: 3,
    name: "Biligumi Connector",
    version: "65536.0",
  })),
  /invalid extension manifest/,
);

const senderSandbox = {
  chrome: {
    runtime: {
      id: "test-extension",
      getURL: (resource) => `chrome-extension://test-extension/${resource}`,
    },
  },
  isBilibiliVideoUrl: (url) => /^https:\/\/www\.bilibili\.com\/(?:video|bangumi\/play)\//.test(url),
};
vm.createContext(senderSandbox);
vm.runInContext(`${extractFunction(backgroundSource, "isAllowedExtensionUpdateSender")}\n;globalThis.allowed = isAllowedExtensionUpdateSender;`, senderSandbox);
assert.equal(senderSandbox.allowed({ id: "test-extension", frameId: 0, url: "chrome-extension://test-extension/options.html" }), true);
assert.equal(senderSandbox.allowed({ id: "test-extension", frameId: 0, url: "chrome-extension://test-extension/other.html" }), false);
assert.equal(senderSandbox.allowed({
  id: "test-extension",
  frameId: 0,
  url: "https://www.bilibili.com/video/BV1test",
  tab: { id: 7, url: "https://www.bilibili.com/video/BV1test" },
}), true);
assert.equal(senderSandbox.allowed({
  id: "test-extension",
  frameId: 2,
  url: "https://www.bilibili.com/video/BV1test",
  tab: { id: 7, url: "https://www.bilibili.com/video/BV1test" },
}), false);
assert.throws(
  () => pureSandbox.updatePure.parseExtensionUpdateManifest(JSON.stringify({
    manifest_version: 3,
    name: "Biligumi Connector",
    version: "0.3.18-beta",
  })),
  /invalid extension manifest/,
);

const targetSandbox = { URL };
vm.createContext(targetSandbox);
vm.runInContext(`${extractFunction(backgroundSource, "classifyHttpTarget")}\n;globalThis.classify = classifyHttpTarget;`, targetSandbox);
assert.equal(
  targetSandbox.classify("https://raw.githubusercontent.com/krkr521/biligumi-connector/master/extension/manifest.json"),
  "",
  "generic authenticated HTTP proxy must not gain access to update hosts",
);
assert.equal(
  targetSandbox.classify("https://api.gitcode.com/api/v5/repos/krkr521/biligumi-connector/branches/master"),
  "",
  "generic HTTP proxy must not gain access to the GitCode branch API",
);

assert.ok(backgroundSource.includes("const MSG_CHECK_EXTENSION_UPDATE = \"biligumi-check-extension-update\";"));
assert.ok(backgroundSource.includes("const MSG_OPEN_EXTENSION_UPDATE = \"biligumi-open-extension-update\";"));
assert.ok(backgroundSource.includes("credentials: \"omit\""), "update requests must never send credentials");
assert.ok(backgroundSource.includes("redirect: \"error\""), "update requests must reject redirects");
assert.ok(backgroundSource.includes("/^[a-f0-9]{40}$/i.test(commit)"), "GitCode updates must resolve a full commit id or sha");
assert.ok(backgroundSource.includes("manifestUrl: `${source.rawUrl}?ref=${commit}`"));
assert.ok(backgroundSource.includes("const response = await fetch(url,"), "update URLs must not be mutated with cache-busting parameters");
assert.ok(backgroundSource.includes("EXTENSION_UPDATE_MAX_RESPONSE_BYTES = 64 * 1024"));
assert.ok(!backgroundSource.includes("eval("));
assert.ok(!backgroundSource.includes("new Function("));

assert.ok(extensionSource.includes("if (isExtensionUpdateCheckActive()) checkExtensionUpdate().catch(() => {});"));
assert.ok(extensionSource.includes("checkExtensionUpdate({ force: true })"));
assert.ok(extensionSource.includes("canPreservePrevious"));
assert.ok(extractFunction(extensionSource, "remountSettingsDialog").includes("syncSettingsExtensionUpdateUi();"));
assert.ok(extensionSource.includes("renderExtensionUpdateBanner()"));
assert.ok(extensionSource.includes("下载后覆盖原扩展目录，并在扩展管理页重新加载"));
assert.ok(optionsSource.includes("checkExtensionUpdate(false)"));
assert.ok(optionsSource.includes("biligumi-check-extension-update"));
assert.ok(optionsHtml.includes("已解压扩展不能自行替换代码"));

async function runAsyncAssertions() {
  const gitCodeSource = {
    id: "gitcode",
    label: "GitCode",
    branchUrl: "https://example.test/branch",
    rawUrl: "https://example.test/raw",
    pageUrl: "https://example.test/project",
  };
  for (const commitField of ["id", "sha"]) {
    const commit = commitField === "id" ? "a".repeat(40) : "b".repeat(40);
    const resolveSandbox = {
      fetchExtensionUpdateText: async () => JSON.stringify({ commit: { [commitField]: commit } }),
    };
    vm.createContext(resolveSandbox);
    vm.runInContext(`${extractFunction(backgroundSource, "resolveExtensionUpdateSource", { async: true })}\n;globalThis.resolveSource = resolveExtensionUpdateSource;`, resolveSandbox);
    const resolved = await resolveSandbox.resolveSource(gitCodeSource);
    assert.equal(resolved.manifestUrl, `https://example.test/raw?ref=${commit}`);
  }

  const invalidResolveSandbox = {
    fetchExtensionUpdateText: async () => JSON.stringify({ commit: { id: "short" } }),
  };
  vm.createContext(invalidResolveSandbox);
  vm.runInContext(`${extractFunction(backgroundSource, "resolveExtensionUpdateSource", { async: true })}\n;globalThis.resolveSource = resolveExtensionUpdateSource;`, invalidResolveSandbox);
  await assert.rejects(invalidResolveSandbox.resolveSource(gitCodeSource), /invalid commit/);

  const boundedSandbox = {
    EXTENSION_UPDATE_MAX_RESPONSE_BYTES: 16,
    TextEncoder,
    TextDecoder,
  };
  vm.createContext(boundedSandbox);
  vm.runInContext(`${extractFunction(backgroundSource, "readBoundedExtensionUpdateText", { async: true })}\n;globalThis.readBounded = readBoundedExtensionUpdateText;`, boundedSandbox);
  const makeResponse = (text, declaredLength = null) => ({
    headers: { get: () => declaredLength },
    body: null,
    text: async () => text,
  });
  assert.equal(await boundedSandbox.readBounded(makeResponse("small")), "small");
  await assert.rejects(boundedSandbox.readBounded(makeResponse("x".repeat(17))), /too large/);
  await assert.rejects(boundedSandbox.readBounded(makeResponse("small", "17")), /too large/);

  let readerIndex = 0;
  let readerCancelled = false;
  const streamedResponse = {
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => readerIndex++ === 0
          ? { done: false, value: new Uint8Array(17) }
          : { done: true, value: undefined },
        cancel: async () => { readerCancelled = true; },
      }),
    },
  };
  await assert.rejects(boundedSandbox.readBounded(streamedResponse), /too large/);
  assert.equal(readerCancelled, true);

  const sources = [
    { id: "github", label: "GitHub", manifestUrl: "https://example.test/github", pageUrl: "https://example.test/github-page" },
    { id: "gitcode", label: "GitCode", manifestUrl: "https://example.test/gitcode", pageUrl: "https://example.test/gitcode-page" },
  ];
  const fetchOrder = [];
  let storedCache = null;
  const checkSandbox = {
    chrome: { runtime: { getManifest: () => ({ version: "0.3.18" }) } },
    EXTENSION_UPDATE_SOURCES: sources,
    normalizeExtensionUpdateCache: (value) => value && value.normalized,
    getExtensionUpdateCache: async () => ({ normalized: { status: "current", currentVersion: "0.3.18" } }),
    resolveExtensionUpdateSource: async (source) => source,
    fetchExtensionUpdateText: async (url) => {
      fetchOrder.push(url);
      if (url.endsWith("github")) throw new Error("GitHub unavailable");
      return JSON.stringify({ manifest_version: 3, name: "Biligumi Connector", version: "0.3.19" });
    },
    parseExtensionUpdateManifest: (text) => ({ version: JSON.parse(text).version }),
    compareExtensionVersions: (left, right) => left === right ? 0 : 1,
    setExtensionUpdateCache: async (value) => { storedCache = value; },
  };
  vm.createContext(checkSandbox);
  vm.runInContext(`${extractFunction(backgroundSource, "checkExtensionUpdate", { async: true })}\n;globalThis.checkUpdate = checkExtensionUpdate;`, checkSandbox);
  const cachedResult = await checkSandbox.checkUpdate(false);
  assert.equal(cachedResult.status, "current");
  assert.deepEqual(fetchOrder, []);
  const forcedResult = await checkSandbox.checkUpdate(true);
  assert.deepEqual(fetchOrder, ["https://example.test/github", "https://example.test/gitcode"]);
  assert.equal(forcedResult.status, "available");
  assert.equal(forcedResult.source.id, "gitcode");
  assert.equal(storedCache.remoteVersion, "0.3.19");
  assert.equal(storedCache.sourceId, "gitcode");

  let openedUrl = "";
  const openSandbox = {
    EXTENSION_UPDATE_SOURCES: sources,
    tabsCreate: async ({ url }) => { openedUrl = url; },
  };
  vm.createContext(openSandbox);
  vm.runInContext(`${extractFunction(backgroundSource, "openExtensionUpdatePage", { async: true })}\n;globalThis.openUpdate = openExtensionUpdatePage;`, openSandbox);
  await openSandbox.openUpdate("gitcode");
  assert.equal(openedUrl, "https://example.test/gitcode-page");
  await openSandbox.openUpdate("untrusted-source");
  assert.equal(openedUrl, "https://example.test/github-page");

  console.log("extension update check tests passed");
}

runAsyncAssertions().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
