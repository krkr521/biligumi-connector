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
const constants = extractConstants(source, ["SCRIPT_VERSION", "SCRIPT_UPDATE_TIMEOUT_MS"]);
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
assert.equal(constants.SCRIPT_VERSION, "0.7.16");
assert.equal(constants.SCRIPT_UPDATE_TIMEOUT_MS, 10000);
assert.equal(constants.SCRIPT_UPDATE_SOURCES.length, 2);
assert.equal(constants.SCRIPT_UPDATE_SOURCES[0].id, "github");
assert.equal(constants.SCRIPT_UPDATE_SOURCES[1].id, "gitcode");
assert.ok(constants.SCRIPT_UPDATE_SOURCES.every((item) => new URL(item.url).pathname.endsWith(".user.js")), "installation URLs must keep the .user.js pathname suffix");
assert.ok(!constants.SCRIPT_UPDATE_SOURCES.some((item) => item.url.includes("_biligumi_update=")), "installation URLs must not include cache-busting query strings");
assert.match(constants.SCRIPT_UPDATE_SOURCES[1].url, /^https:\/\/api\.gitcode\.com\//);
assert.equal(constants.SCRIPT_UPDATE_SOURCES[1].url, constants.SCRIPT_UPDATE_SOURCES[1].checkUrl, "GitCode check and install URLs must pin the same branch");

assert.equal(pureSandbox.updatePure.parseUserscriptVersion("// ==UserScript==\n// @name Test\n// @version 1.2.3\n// ==/UserScript==\n// @version 9.9.9"), "1.2.3");
assert.equal(pureSandbox.updatePure.parseUserscriptVersion("// @version 1.2.3"), "");
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.7.9", "0.7.10"), -1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.7.10", "0.7.10"), 0);
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.8.0", "0.7.15"), 1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("1.0.0-beta.1", "1.0.0"), -1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("1.0.0-rc", "1.0.0-beta"), 1);
assert.equal(pureSandbox.updatePure.compareScriptVersions("0.7.15a", "0.7.15"), -1);

const renderSettingsDialog = extractFunction(source, "renderSettingsDialog");
assert.match(renderSettingsDialog, /data-action="open-script-update"/);
assert.match(renderSettingsDialog, /data-role="settings-update-status"/);
assert.match(renderSettingsDialog, /aria-live="polite"/);
assert.match(renderSettingsDialog, /当前版本 v\$\{SCRIPT_VERSION\}/);

const handlePanelClick = extractFunction(source, "handlePanelClick");
assert.match(handlePanelClick, /action === "check-script-update"/);
assert.match(handlePanelClick, /action === "open-script-update"/);

const checkScriptUpdate = extractFunction(source, "checkScriptUpdate", { async: true });
assert.match(checkScriptUpdate, /for \(const source of SCRIPT_UPDATE_SOURCES\)/);
assert.match(checkScriptUpdate, /fetchScriptSource\(source\)/);
assert.ok(!checkScriptUpdate.includes("remountSettingsDialog"), "update status must refresh in place without destroying settings drafts");

const openLatestUserscript = extractFunction(source, "openLatestUserscript", { async: true });
assert.match(openLatestUserscript, /GM_openInTab\(source\.url/);
assert.match(openLatestUserscript, /if \(!source\) throw new Error/);

const openSettings = extractFunction(source, "openSettings");
assert.match(openSettings, /checkScriptUpdate\(\)/);
assert.match(openSettings, /syncSettingsUpdateUi\(\)/);

console.log("script update check tests passed");
