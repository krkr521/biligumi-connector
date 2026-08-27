"use strict";

const assert = require("node:assert/strict");
const {
  USERSCRIPT_PATH,
  readSource,
  extractFunction,
  extractConstants,
  runInSandbox,
} = require("./_source");

const source = readSource(USERSCRIPT_PATH);
const constants = extractConstants(source, ["SCRIPT_VERSION", "SCRIPT_UPDATE_TIMEOUT_MS", "SCRIPT_UPDATE_CACHE_TTL_MS"]);
const sourcesStart = source.indexOf("  const SCRIPT_UPDATE_SOURCES = [");
const sourcesEnd = source.indexOf("\n  ];", sourcesStart);
assert.notEqual(sourcesStart, -1, "missing SCRIPT_UPDATE_SOURCES");
assert.notEqual(sourcesEnd, -1, "missing end of SCRIPT_UPDATE_SOURCES");
const sourcesLiteral = source.slice(source.indexOf("[", sourcesStart), sourcesEnd + 4);
const sourceSandbox = {};
runInSandbox("globalThis.sources = " + sourcesLiteral, sourceSandbox);
constants.SCRIPT_UPDATE_SOURCES = sourceSandbox.sources;

const pureFunctions = [
  extractFunction(source, "parseUserscriptVersion"),
  extractFunction(source, "compareScriptVersions"),
].join("\n");
const pureSandbox = {};
runInSandbox(pureFunctions + "\n;globalThis.updatePure = { parseUserscriptVersion, compareScriptVersions };", pureSandbox);

assert.match(source, /^\/\/ @connect\s+raw\.githubusercontent\.com$/m);
assert.match(source, /^\/\/ @connect\s+api\.gitcode\.com$/m);
assert.match(source, /^\/\/ @connect\s+raw\.gitcode\.com$/m);
assert.equal(constants.SCRIPT_VERSION, "0.7.15");
assert.equal(constants.SCRIPT_UPDATE_TIMEOUT_MS, 10000);
assert.equal(constants.SCRIPT_UPDATE_CACHE_TTL_MS, 21600000);
assert.equal(constants.SCRIPT_UPDATE_SOURCES.length, 2);
assert.equal(constants.SCRIPT_UPDATE_SOURCES[0].id, "github");
assert.equal(constants.SCRIPT_UPDATE_SOURCES[1].id, "gitcode");
assert.ok(new URL(constants.SCRIPT_UPDATE_SOURCES[0].url).pathname.endsWith(".user.js"));
assert.match(constants.SCRIPT_UPDATE_SOURCES[1].branchUrl, /^https:\/\/api\.gitcode\.com\//);
assert.match(constants.SCRIPT_UPDATE_SOURCES[1].rawUrlPrefix, /^https:\/\/raw\.gitcode\.com\//);
assert.ok(constants.SCRIPT_UPDATE_SOURCES[1].rawUrlSuffix.endsWith(".user.js"));
assert.ok(!constants.SCRIPT_UPDATE_SOURCES[0].url.includes("_biligumi_update="));

assert.equal(pureSandbox.updatePure.parseUserscriptVersion("// ==UserScript==\n// @name Test\n// @version 1.2.3\n// ==/UserScript==\n// @version 9.9.9"), "1.2.3");
assert.equal(pureSandbox.updatePure.parseUserscriptVersion("// @version 1.2.3"), "");
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.7.9", "0.7.10"), -1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.7.10", "0.7.10"), 0);
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.8.0", "0.7.15"), 1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("1.0.0-beta.1", "1.0.0"), -1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);

const sourceValidationFunctions = [
  extractFunction(source, "normalizeScriptUpdateSource"),
  extractFunction(source, "readCachedScriptUpdateState"),
].join("\n");
const githubSource = constants.SCRIPT_UPDATE_SOURCES[0];
const gitcodeSource = constants.SCRIPT_UPDATE_SOURCES[1];
const validCommit = "a".repeat(40);
const validGitcodeUrl = gitcodeSource.rawUrlPrefix + validCommit + gitcodeSource.rawUrlSuffix;
const cacheNow = 2000000000000;
const cacheSandbox = {
  SCRIPT_UPDATE_SOURCES: constants.SCRIPT_UPDATE_SOURCES,
  SCRIPT_UPDATE_CACHE_TTL_MS: constants.SCRIPT_UPDATE_CACHE_TTL_MS,
  SCRIPT_VERSION: constants.SCRIPT_VERSION,
  STORAGE: { scriptUpdateCache: "update-cache" },
  Date: { now: () => cacheNow },
  compareScriptVersions: pureSandbox.updatePure.compareScriptVersions,
  cached: null,
  readJsonValue() { return cacheSandbox.cached; },
};
runInSandbox(sourceValidationFunctions + "\n;globalThis.updateCache = { normalizeScriptUpdateSource, readCachedScriptUpdateState };", cacheSandbox);
assert.equal(cacheSandbox.updateCache.normalizeScriptUpdateSource({ id: "github", url: githubSource.url }).url, githubSource.url);
assert.equal(cacheSandbox.updateCache.normalizeScriptUpdateSource({ id: "github", url: "https://evil.example/update.user.js" }), null);
assert.equal(cacheSandbox.updateCache.normalizeScriptUpdateSource({ id: "gitcode", url: validGitcodeUrl, checkUrl: validGitcodeUrl }).url, validGitcodeUrl);
assert.equal(cacheSandbox.updateCache.normalizeScriptUpdateSource({ id: "gitcode", url: gitcodeSource.rawUrlPrefix + "main" + gitcodeSource.rawUrlSuffix }), null);
cacheSandbox.cached = { remoteVersion: "0.7.16", sourceId: "github", url: githubSource.url, checkedAt: cacheNow - 1000 };
assert.equal(cacheSandbox.updateCache.readCachedScriptUpdateState().status, "available");
cacheSandbox.cached = { remoteVersion: "0.7.16", sourceId: "github", url: "https://evil.example/update.user.js", checkedAt: cacheNow - 1000 };
assert.equal(cacheSandbox.updateCache.readCachedScriptUpdateState().status, "idle");
cacheSandbox.cached = { remoteVersion: "0.7.16", sourceId: "github", url: githubSource.url, checkedAt: cacheNow + 1000 };
assert.equal(cacheSandbox.updateCache.readCachedScriptUpdateState().status, "idle");
cacheSandbox.cached = { remoteVersion: "0.7.16", sourceId: "github", url: githubSource.url, checkedAt: cacheNow - constants.SCRIPT_UPDATE_CACHE_TTL_MS - 1 };
assert.equal(cacheSandbox.updateCache.readCachedScriptUpdateState().status, "idle");

const renderSettingsDialog = extractFunction(source, "renderSettingsDialog");
assert.match(renderSettingsDialog, /data-action="open-script-update"/);
assert.match(renderSettingsDialog, /data-action="open-script-update-gitcode"/);
assert.match(renderSettingsDialog, /data-role="settings-update-gitcode"/);
assert.match(renderSettingsDialog, /data-role="settings-update-status"/);
assert.match(renderSettingsDialog, /aria-live="polite"/);

const renderScriptUpdateBanner = extractFunction(source, "renderScriptUpdateBanner");
assert.match(source, /#\$\{PANEL_ID\} \.biligumi-update-banner \.biligumi-update-banner-actions \.biligumi-button \{[\s\S]*?border-radius: 6px;/);
assert.match(renderScriptUpdateBanner, /data-action="open-script-update"/);
assert.match(renderScriptUpdateBanner, /data-action="open-script-update-gitcode"/);
assert.match(renderScriptUpdateBanner, /使用 GitCode 更新/);
assert.match(renderScriptUpdateBanner, /data-action="dismiss-script-update"/);
assert.match(renderScriptUpdateBanner, /本次更新不再提醒/);
assert.match(renderScriptUpdateBanner, /isScriptUpdateNoticeVisible\(\)/);
const isScriptUpdateNoticeVisible = extractFunction(source, "isScriptUpdateNoticeVisible");
assert.match(isScriptUpdateNoticeVisible, /scriptUpdateState\.status !== "available"/);
assert.match(isScriptUpdateNoticeVisible, /STORAGE\.scriptUpdateDismissedVersion/);

const dismissScriptUpdateNotice = extractFunction(source, "dismissScriptUpdateNotice");
assert.match(dismissScriptUpdateNotice, /STORAGE\.scriptUpdateDismissedVersion/);
assert.match(dismissScriptUpdateNotice, /scriptUpdateState\.remoteVersion/);

const handlePanelClick = extractFunction(source, "handlePanelClick");
assert.match(handlePanelClick, /action === "check-script-update"/);
assert.match(handlePanelClick, /action === "open-script-update"/);
assert.match(handlePanelClick, /action === "open-script-update-gitcode"/);
assert.match(handlePanelClick, /openLatestUserscript\("gitcode"\)/);
assert.match(handlePanelClick, /action === "dismiss-script-update"/);

const resolveScriptUpdateSource = extractFunction(source, "resolveScriptUpdateSource", { async: true });
assert.match(resolveScriptUpdateSource, /branchUrl/);
assert.match(resolveScriptUpdateSource, /commit\.id/);
assert.match(resolveScriptUpdateSource, /rawUrlPrefix/);
assert.match(resolveScriptUpdateSource, /\^\[a-f0-9\]\{40\}\$/);

const checkScriptUpdate = extractFunction(source, "checkScriptUpdate", { async: true });
assert.match(checkScriptUpdate, /for \(const configuredSource of SCRIPT_UPDATE_SOURCES\)/);
assert.match(checkScriptUpdate, /resolveScriptUpdateSource\(configuredSource\)/);
assert.match(checkScriptUpdate, /cacheScriptUpdateState\(scriptUpdateState\)/);
assert.match(checkScriptUpdate, /render\(\)/);
assert.ok(!checkScriptUpdate.includes("remountSettingsDialog"));

const resolvePreferredScriptUpdateSource = extractFunction(source, "resolvePreferredScriptUpdateSource", { async: true });
assert.match(resolvePreferredScriptUpdateSource, /preferredSourceId === "gitcode"/);
assert.match(resolvePreferredScriptUpdateSource, /resolveScriptUpdateSource\(configuredSource\)/);
assert.match(resolvePreferredScriptUpdateSource, /fetchScriptSource\(source\)/);
assert.match(resolvePreferredScriptUpdateSource, /GitCode 尚未同步/);

const openLatestUserscript = extractFunction(source, "openLatestUserscript", { async: true });
assert.match(openLatestUserscript, /if \(scriptUpdateOpening\) return/);
assert.match(openLatestUserscript, /resolvePreferredScriptUpdateSource\(preferredSourceId\)/);
assert.match(openLatestUserscript, /GM_openInTab\(source\.url/);
assert.ok(!openLatestUserscript.includes("window.open"));

const closeSettings = extractFunction(source, "closeSettings");
assert.ok(!closeSettings.includes("scriptUpdateCheckSeq"), "closing settings must not cancel the page-level update check");
assert.ok(!closeSettings.includes("scriptUpdateCheckPromise"), "closing settings must not orphan the in-flight update promise");

const remountSettingsDialog = extractFunction(source, "remountSettingsDialog");
assert.match(remountSettingsDialog, /syncSettingsUpdateUi\(\)/);

console.log("script update check tests passed");
