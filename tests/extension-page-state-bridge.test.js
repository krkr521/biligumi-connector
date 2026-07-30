"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { extractFunction, runInSandbox, EXTENSION_PATH } = require("./_source");

const repoRoot = path.resolve(__dirname, "..");
const backgroundPath = path.join(repoRoot, "extension", "background.js");
const manifestPath = path.join(repoRoot, "extension", "manifest.json");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");
const contentSource = fs.readFileSync(EXTENSION_PATH, "utf8");

function loadBackgroundApi(overrides = {}) {
  const sandbox = {
    URL,
    chrome: {
      scripting: {
        executeScript: async () => [],
      },
    },
    ...overrides,
  };
  const names = [
    "readBilibiliPublicPageState",
    "collectBilibiliPublicPageState",
    "normalizeBilibiliPublicPageState",
    "normalizeBilibiliStateHref",
    "normalizeNumericId",
    "normalizePublicText",
    "isBilibiliVideoUrl",
  ];
  runInSandbox(
    `${names.map((name) => extractFunction(backgroundSource, name, { async: name === "readBilibiliPublicPageState" })).join("\n")}
globalThis.api = { ${names.join(", ")} };`,
    sandbox,
  );
  return sandbox;
}

test("MAIN-world collector returns only the public page-state allowlist", () => {
  const sandbox = {
    location: { href: "https://www.bilibili.com/video/BV1PUBLIC" },
    window: {
      __INITIAL_STATE__: {
        token: "must-not-leak",
        season_id: 123,
        media_id: 456,
        bvid: "BV1PUBLIC",
        duration: 1440,
        mediaInfo: { title: "番名", season_title: "番名 第二季" },
        epInfo: { id: 789, title: "2", long_title: "第二话", share_copy: "番名 第二话" },
        videoData: {
          bvid: "BV1PUBLIC",
          duration: 1440,
          owner: { mid: 42, name: "UP 主", secret: "must-not-leak" },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction(backgroundSource, "collectBilibiliPublicPageState")}
globalThis.collect = collectBilibiliPublicPageState;`, sandbox);
  const result = JSON.parse(JSON.stringify(sandbox.collect()));
  assert.equal(result.href, sandbox.location.href);
  assert.equal(result.identity.seasonId, 123);
  assert.equal(result.titles.seasonTitle, "番名 第二季");
  assert.equal(result.owner.mid, 42);
  assert.equal(result.durationSeconds, 1440);
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
  assert.deepEqual(
    Object.keys(result).sort(),
    ["durationSeconds", "href", "identity", "owner", "schemaVersion", "titles"],
  );
});

test("background normalizes IDs, text, duration, and rejects foreign URLs", () => {
  const sandbox = loadBackgroundApi();
  const normalized = sandbox.api.normalizeBilibiliPublicPageState({
    schemaVersion: 99,
    href: "https://www.bilibili.com/bangumi/play/ep123",
    identity: {
      bvid: "BV1VALID",
      seasonId: "123",
      mediaId: "bad",
      episodeId: "456",
    },
    titles: {
      mediaTitle: `  ${"x".repeat(600)}  `,
    },
    owner: {
      mid: "42",
      name: ` ${"u".repeat(150)} `,
    },
    durationSeconds: Infinity,
    token: "must-not-leak",
  });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.identity.seasonId, "123");
  assert.equal(normalized.identity.mediaId, "");
  assert.equal(normalized.titles.mediaTitle.length, 500);
  assert.equal(normalized.owner.name.length, 100);
  assert.equal(normalized.durationSeconds, 0);
  assert.ok(!JSON.stringify(normalized).includes("must-not-leak"));
  assert.throws(
    () => sandbox.api.normalizeBilibiliPublicPageState({ href: "https://evil.example/video/BV1BAD" }),
    /Invalid page-state URL/,
  );
});

test("page-state read is fixed to the validated top-level sender tab and MAIN world", async () => {
  let execution = null;
  const sandbox = loadBackgroundApi({
    chrome: {
      scripting: {
        executeScript: async (options) => {
          execution = options;
          return [{
            result: {
              schemaVersion: 1,
              href: "https://www.bilibili.com/video/BV1VALID",
              identity: { bvid: "BV1VALID" },
            },
          }];
        },
      },
    },
  });
  const sender = {
    frameId: 0,
    url: "https://www.bilibili.com/video/BV1VALID",
    tab: { id: 17, url: "https://www.bilibili.com/video/BV1VALID" },
  };
  const result = await sandbox.api.readBilibiliPublicPageState(sender);
  assert.equal(result.identity.bvid, "BV1VALID");
  assert.deepEqual(JSON.parse(JSON.stringify(execution.target)), { tabId: 17, frameIds: [0] });
  assert.equal(execution.world, "MAIN");
  assert.equal(execution.func.name, "collectBilibiliPublicPageState");

  await assert.rejects(
    sandbox.api.readBilibiliPublicPageState({ ...sender, frameId: 1 }),
    /Blocked page-state sender/,
  );
  await assert.rejects(
    sandbox.api.readBilibiliPublicPageState({ ...sender, url: "http://www.bilibili.com/video/BV1VALID" }),
    /Blocked page-state sender/,
  );
  await assert.rejects(
    sandbox.api.readBilibiliPublicPageState({ ...sender, url: "https://bgm.tv/subject/1" }),
    /Blocked page-state sender/,
  );
});

test("isolated content consumes the bridge snapshot instead of page globals", () => {
  assert.doesNotMatch(contentSource, /window\.__INITIAL_STATE__/);
  const sandbox = { URL, location: { href: "https://www.bilibili.com/video/BV1VALID" } };
  runInSandbox(
    `${extractFunction(contentSource, "toInitialStateCompat")}
globalThis.convert = toInitialStateCompat;`,
    sandbox,
  );
  const compat = sandbox.convert({
    schemaVersion: 1,
    href: sandbox.location.href,
    identity: { bvid: "BV1VALID", seasonId: "12", mediaId: "34", episodeId: "56" },
    titles: { mediaTitle: "番名", seasonTitle: "番名 第二季", episodeLongTitle: "第二话" },
    owner: { mid: "42", name: "UP 主" },
    durationSeconds: 1440,
  });
  assert.equal(compat.mediaInfo.season_id, "12");
  assert.equal(compat.videoData.bvid, "BV1VALID");
  assert.equal(compat.videoData.owner.mid, "42");
  assert.equal(compat.epInfo.long_title, "第二话");
  assert.equal(compat.videoData.duration, 1440);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.convert({ schemaVersion: 1, href: "https://www.bilibili.com/video/BV1STALE" }))),
    {},
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.convert({
      schemaVersion: 1,
      href: sandbox.location.href,
      identity: { bvid: "BV1OLD" },
    }))),
    {},
    "a current href carrying an old SPA identity must fail closed",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.convert({
      schemaVersion: 1,
      href: "https://www.bilibili.com/bangumi/play/ep123",
      identity: { episodeId: "122" },
    }, "https://www.bilibili.com/bangumi/play/ep123"))),
    {},
    "an EP route carrying the previous episode identity must fail closed",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.convert({
      schemaVersion: 1,
      href: "https://www.bilibili.com/bangumi/play/ss456",
      identity: { seasonId: "455" },
    }, "https://www.bilibili.com/bangumi/play/ss456"))),
    {},
    "a season route carrying the previous season identity must fail closed",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.convert({
      schemaVersion: 1,
      href: "https://www.bilibili.com/bangumi/play/md789",
      identity: { mediaId: "788" },
    }, "https://www.bilibili.com/bangumi/play/md789"))),
    {},
    "a media route carrying the previous media identity must fail closed",
  );
});

test("bridge cache rejects a response from a stale SPA route", async () => {
  const callbacks = [];
  const sandbox = {
    URL,
    location: {
      hostname: "www.bilibili.com",
      href: "https://www.bilibili.com/video/BV1FIRST",
    },
    window: {
      setTimeout,
      clearTimeout,
    },
    chrome: {
      runtime: {
        id: "test-extension",
        lastError: null,
        sendMessage(_message, callback) {
          callbacks.push(callback);
        },
      },
    },
  };
  runInSandbox(
    `const PAGE_STATE_MESSAGE = "biligumi-read-page-state-v1";
let bridgedInitialState = {};
let bridgedInitialStateHref = "";
let bridgedInitialStateRequestSeq = 0;
${extractFunction(contentSource, "refreshBridgedInitialState")}
${extractFunction(contentSource, "invalidateBridgedInitialState")}
${extractFunction(contentSource, "getBridgedInitialState")}
${extractFunction(contentSource, "toInitialStateCompat")}
function isExtensionRuntimeAvailable() {
  return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
}
globalThis.api = { refreshBridgedInitialState, invalidateBridgedInitialState, getBridgedInitialState };`,
    sandbox,
  );

  const first = sandbox.api.refreshBridgedInitialState();
  sandbox.location.href = "https://www.bilibili.com/video/BV1SECOND";
  sandbox.api.invalidateBridgedInitialState();
  callbacks.shift()({
    ok: true,
    state: {
      schemaVersion: 1,
      href: "https://www.bilibili.com/video/BV1FIRST",
      identity: { bvid: "BV1FIRST" },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await first)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.api.getBridgedInitialState())), {});

  const second = sandbox.api.refreshBridgedInitialState();
  callbacks.shift()({
    ok: true,
    state: {
      schemaVersion: 1,
      href: sandbox.location.href,
      identity: { bvid: "BV1SECOND" },
    },
  });
  await second;
  assert.equal(sandbox.api.getBridgedInitialState().videoData.bvid, "BV1SECOND");
});

test("bridge retries when the first current-route snapshot is still stale", async () => {
  let attempts = 0;
  let cached = {};
  const valid = { videoData: { bvid: "BV1CURRENT" } };
  const sandbox = {
    location: {
      hostname: "www.bilibili.com",
      href: "https://www.bilibili.com/video/BV1CURRENT",
    },
    window: { setTimeout, clearTimeout },
    isExtensionRuntimeAvailable: () => true,
    refreshBridgedInitialState() {
      attempts += 1;
      if (attempts === 1) return Promise.resolve({});
      cached = valid;
      return Promise.resolve(valid);
    },
    getBridgedInitialState: () => cached,
  };
  runInSandbox(
    `${extractFunction(contentSource, "refreshBridgedInitialStateWithRetry")}
globalThis.retry = refreshBridgedInitialStateWithRetry;`,
    sandbox,
  );
  const result = await sandbox.retry([0, 0], 100);
  assert.equal(attempts, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), valid);
});

test("route refresh waits for the page-state bridge before consuming the new route", async () => {
  const timers = [];
  let resolvePageState;
  const sandbox = {
    Promise,
    state: { pageKey: "old-key" },
    window: {
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
      },
    },
    invalidatePageInitialState() {},
    refreshPageInitialState() {
      return new Promise((resolve) => {
        resolvePageState = resolve;
      });
    },
    removeModal() {},
    inlineConfirmSettles: 0,
    settleInlineConfirm() {
      sandbox.inlineConfirmSettles += 1;
    },
    render() {},
    routeRefreshCalls: [],
    refreshAfterRouteChange(...args) {
      sandbox.routeRefreshCalls.push(args);
    },
  };
  runInSandbox(
    `let routeRefreshSeq = 0;
${extractFunction(contentSource, "scheduleRouteRefresh")}
globalThis.schedule = scheduleRouteRefresh;`,
    sandbox,
  );

  sandbox.schedule("old title", "old-key");
  assert.equal(sandbox.inlineConfirmSettles, 1, "route refresh cancels any confirmation tied to the old route");
  assert.equal(timers.length, 4);
  timers[0].callback();
  await Promise.resolve();
  assert.equal(sandbox.routeRefreshCalls.length, 0, "the 350ms pass must wait while the bridge is pending");

  resolvePageState({});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sandbox.routeRefreshCalls.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.routeRefreshCalls[0])),
    [1, "old title", "old-key", false],
  );
});

test("manifest keeps content isolated and grants only the scripting bridge permission", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal(manifest.minimum_chrome_version, "95");
  assert.ok(!manifest.content_scripts[0].world || manifest.content_scripts[0].world === "ISOLATED");
  assert.ok(!manifest.web_accessible_resources);
});
