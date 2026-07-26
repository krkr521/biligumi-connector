"use strict";

// Episode air-status + hover-tooltip tests: the Bangumi episode airdate drives
// the grid cell color — dates past the on-air window render gray ("unaired"),
// dates inside the window render green ("onair"), past dates keep the default
// light blue, and missing/malformed dates stay "unknown" so they are never
// mis-colored. Hovering a cell shows a Bangumi-style card with the episode
// name, Chinese title, airdate and duration instead of a native title tooltip.
//
// Japanese late-night anime airs past midnight, so like Bangumi the on-air
// window covers both today and tomorrow.
//
// All production code under test is extracted from the userscript source; the
// extraction helpers fail loudly when an anchor disappears, so these tests can
// never silently degrade into testing stale hand-copied logic.

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);

// ---------------------------------------------------------------------------
// Anti-drift: the air-status logic, tooltip logic and grid rendering must stay
// byte-identical between the userscript and the extension content script.
// ---------------------------------------------------------------------------

const IDENTICAL_FUNCTIONS = [
  "getLocalDateString",
  "getTodayDateString",
  "getTomorrowDateString",
  "getEpisodeAirState",
  "renderEpisodeGrid",
  "getEpisodeDisplayDurationSeconds",
  "renderEpisodeTooltipContent",
  "ensureEpisodeTooltip",
  "hideEpisodeTooltip",
  "showEpisodeTooltip",
  "restoreEpisodeTooltipIfNeeded",
];
for (const name of IDENTICAL_FUNCTIONS) {
  const userscriptBlock = extractFunction(userscriptSource, name);
  const extensionBlock = extractFunction(extensionSource, name);
  assert.equal(extensionBlock, userscriptBlock, `${name} must stay identical between userscript and extension`);
}

// The render path must wire the air state into the cell class list and leave
// the hover text to the Bangumi-style tooltip (no native title attribute).
{
  const renderBlock = extractFunction(userscriptSource, "renderEpisodeGrid");
  assert.ok(renderBlock.includes("getEpisodeAirState(ep)"), "renderEpisodeGrid must call getEpisodeAirState");
  assert.ok(renderBlock.includes('"unaired"'), "renderEpisodeGrid must assign the unaired class");
  assert.ok(renderBlock.includes('"onair"'), "renderEpisodeGrid must assign the onair class");
  assert.ok(renderBlock.indexOf('done ? "watched"') !== -1, "watched episodes must bypass air coloring so dark blue wins");
  assert.ok(!renderBlock.includes("title="), "episode cells must not set a native title; the hover tooltip replaces it");
  assert.ok(!userscriptSource.includes("function getEpisodeButtonTitle"), "getEpisodeButtonTitle was superseded by the tooltip and must be removed");
  assert.ok(!extensionSource.includes("function getEpisodeButtonTitle"), "getEpisodeButtonTitle was superseded by the tooltip and must be removed");
}

// Tooltip wiring must cover keyboard focus and re-render restore, not just mouse hover.
{
  for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
    assert.ok(source.includes('episodeGrid.addEventListener("focusin"'), `${label} must show the tip on keyboard focus`);
    assert.ok(source.includes('episodeGrid.addEventListener("focusout"'), `${label} must hide the tip on blur`);
    assert.ok(source.includes("restoreEpisodeTooltipIfNeeded(episodeGrid)"), `${label} must restore the tip after re-render`);
    assert.ok(source.includes('window.addEventListener("scroll", hideEpisodeTooltip, true)'), `${label} must hide the tip on page scroll`);
    assert.ok(source.includes('window.addEventListener("resize", hideEpisodeTooltip)'), `${label} must hide the tip on resize`);
    assert.ok(source.includes(".biligumi-episode.unaired:hover"), `${label} must keep hover feedback on unaired cells`);
    assert.ok(source.includes(".biligumi-episode.onair:hover"), `${label} must keep hover feedback on onair cells`);
    assert.ok(source.includes(".biligumi-episode.done:hover"), `${label} must keep hover feedback on watched cells`);
  }
}

// ---------------------------------------------------------------------------
// Behavior: classify airdates against a fixed today/tomorrow on-air window.
// ---------------------------------------------------------------------------

function loadAirState(today, tomorrow) {
  const sandbox = {
    pad2: (value) => String(value).padStart(2, "0"),
    Date,
  };
  runInSandbox(extractFunction(userscriptSource, "getLocalDateString"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getTodayDateString"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getTomorrowDateString"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getEpisodeAirState"), sandbox);
  // Pin the window by overriding the global bindings the extracted code resolves.
  sandbox.getTodayDateString = () => today;
  sandbox.getTomorrowDateString = () => tomorrow;
  return (episode) => sandbox.getEpisodeAirState(episode);
}

// The on-air window covers both today and tomorrow (late-night broadcasts).
{
  const classify = loadAirState("2026-07-25", "2026-07-26");
  assert.equal(classify({ airdate: "2026-07-24" }), "aired");
  assert.equal(classify({ airdate: "1999-04-01" }), "aired");
  assert.equal(classify({ airdate: "2026-07-25" }), "onair");
  assert.equal(classify({ airdate: "2026-07-26" }), "onair", "tomorrow is inside the late-night on-air window");
  assert.equal(classify({ airdate: "2026-07-27" }), "unaired");
  assert.equal(classify({ airdate: "2027-01-01" }), "unaired");
}

// Missing or malformed airdates must stay "unknown" (default light blue).
{
  const classify = loadAirState("2026-07-25", "2026-07-26");
  assert.equal(classify({ airdate: "" }), "unknown");
  assert.equal(classify({}), "unknown");
  assert.equal(classify({ airdate: null }), "unknown");
  assert.equal(classify(null), "unknown");
  assert.equal(classify({ airdate: "2026-7-5" }), "unknown");
  assert.equal(classify({ airdate: "unknown" }), "unknown");
  assert.equal(classify({ airdate: " 2026-07-25 " }), "onair", "whitespace around a valid date is trimmed");
}

// The date helpers must produce zero-padded YYYY-MM-DD local dates so plain
// string comparison against Bangumi airdates stays valid.
{
  const sandbox = { pad2: (value) => String(value).padStart(2, "0"), Date };
  runInSandbox(extractFunction(userscriptSource, "getLocalDateString"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getTodayDateString"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getTomorrowDateString"), sandbox);
  assert.match(sandbox.getTodayDateString(), /^\d{4}-\d{2}-\d{2}$/, "today string must be zero-padded YYYY-MM-DD");
  assert.match(sandbox.getTomorrowDateString(), /^\d{4}-\d{2}-\d{2}$/, "tomorrow string must be zero-padded YYYY-MM-DD");
  assert.ok(sandbox.getTomorrowDateString() >= sandbox.getTodayDateString(), "tomorrow must not sort before today");
}

// ---------------------------------------------------------------------------
// Behavior: the hover tooltip renders the Bangumi-style info card.
// ---------------------------------------------------------------------------

function loadTooltipContent() {
  const sandbox = {
    pad2: (value) => String(value).padStart(2, "0"),
    DEFAULT_LONG_VIDEO_EPISODE_OFFSET_SECONDS: 0,
  };
  for (const name of [
    "escapeHtml",
    "formatEpisodeSort",
    "normalizeLongVideoOffsetSeconds",
    "formatTimecode",
    "parseEpisodeDurationText",
    "getEpisodeDurationSeconds",
    "getEpisodeDisplayDurationSeconds",
    "renderEpisodeTooltipContent",
  ]) {
    runInSandbox(extractFunction(userscriptSource, name), sandbox);
  }
  return (episode, localNo, done) => sandbox.renderEpisodeTooltipContent(episode, localNo, done);
}

{
  const renderTip = loadTooltipContent();
  const html = renderTip(
    { name: "行く年来る年", name_cn: "送旧迎新", airdate: "2026-07-19", duration: "00:24:06" },
    15,
    false,
  );
  assert.ok(html.includes("ep.15"), "header shows the cell number");
  assert.ok(html.includes("行く年来る年"), "header shows the original name");
  assert.ok(html.includes("中文标题: 送旧迎新"), "body shows the Chinese title");
  assert.ok(html.includes("首播: 2026-07-19"), "body shows the airdate");
  assert.ok(html.includes("时长: 00:24:06"), "body shows the formatted duration");
  assert.ok(html.includes("左键标记看过"), "footer hints left-click marks watched");
  assert.ok(html.includes("右键打开本集讨论"), "footer hints right-click opens the discussion");
}

{
  const renderTip = loadTooltipContent();
  const html = renderTip({ name: "ep", name_cn: "ep", airdate: "", duration: "" }, 3, true);
  assert.ok(html.includes("左键取消看过"), "watched episodes hint left-click unmarks watched");
  assert.ok(!html.includes("中文标题"), "Chinese title row is hidden when it duplicates the name");
  assert.ok(html.includes("首播: 未知"), "missing airdate falls back to 未知");
  assert.ok(html.includes("时长: 未知"), "missing duration falls back to 未知");
}

{
  const renderTip = loadTooltipContent();
  const html = renderTip({ name: "<b>x</b>", name_cn: "", airdate: "2026-07-19", duration_seconds: 1440 }, 1, false);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"), "episode names are HTML-escaped");
  assert.ok(html.includes("时长: 00:24:00"), "duration_seconds is formatted as a timecode");
}

// When Bangumi sort differs from the local grid cell, surface the mapping.
{
  const renderTip = loadTooltipContent();
  const html = renderTip(
    { name: "第三季第1话", name_cn: "", airdate: "2026-07-19", duration: "00:24:00", sort: 13 },
    1,
    false,
  );
  assert.ok(html.includes("ep.01"), "header still uses the local cell number");
  assert.ok(html.includes("Bangumi ep.13"), "body shows Bangumi sort when it differs from localNo");
}

{
  const renderTip = loadTooltipContent();
  const html = renderTip(
    { name: "same", name_cn: "", airdate: "2026-07-19", duration: "00:24:00", sort: 5 },
    5,
    false,
  );
  assert.ok(!html.includes("Bangumi ep."), "Bangumi sort row is omitted when it matches localNo");
}

// Tooltip duration must accept short/long values rejected by the long-video parser.
{
  const renderTip = loadTooltipContent();
  const shortHtml = renderTip({ name: "short", duration: "00:00:45" }, 1, false);
  assert.ok(shortHtml.includes("时长: 00:00:45"), "sub-minute durations still render in the tooltip");
  const longHtml = renderTip({ name: "film", duration_seconds: 4 * 60 * 60 }, 1, false);
  assert.ok(longHtml.includes("时长: 04:00:00"), "durations beyond 3h still render in the tooltip");
}

console.log("episode-air-status tests passed");
