"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const userscriptPath = path.join(repoRoot, "userscript", "biligumi-connector.user.js");
const extensionPath = path.join(repoRoot, "extension", "content.js");

function readLogicBlock(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("  function parseLongVideoPartTitle(");
  const medianStart = source.indexOf("  function median(values)", start);
  const end = source.indexOf("\n  function ", medianStart + 1);
  assert.notEqual(start, -1, `Missing long-video logic start in ${filePath}`);
  assert.notEqual(medianStart, -1, `Missing long-video logic median helper in ${filePath}`);
  assert.notEqual(end, -1, `Missing long-video logic end in ${filePath}`);
  return source.slice(start, end);
}

const userscriptLogic = readLogicBlock(userscriptPath);
const extensionLogic = readLogicBlock(extensionPath);
assert.equal(extensionLogic, userscriptLogic, "Userscript and extension long-video logic must stay identical");

function readSearchRenderBlock(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("  function renderSearchOrSubject()");
  const end = source.indexOf("\n  function ", start + 1);
  assert.notEqual(start, -1, `Missing search render start in ${filePath}`);
  assert.notEqual(end, -1, `Missing search render end in ${filePath}`);
  return source.slice(start, end).replace(/\r\n/g, "\n");
}

const userscriptSearchRender = readSearchRenderBlock(userscriptPath);
const extensionSearchRender = readSearchRenderBlock(extensionPath);
assert.equal(extensionSearchRender, userscriptSearchRender, "Userscript and extension search layout must stay identical");
assert.ok(
  userscriptSearchRender.indexOf("renderInlineAutoPreview()") < userscriptSearchRender.indexOf("renderLongVideoBindingPrompt()")
    && userscriptSearchRender.indexOf("renderLongVideoBindingPrompt()") < userscriptSearchRender.indexOf("renderSearchResults()"),
  "Long-video confirmation must render between the automatic candidate and manual search results",
);

function readBindingKeyBlock(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("  function getBindingKeysForCurrentPage()");
  const end = source.indexOf("\n  async function loadSubjectBundle()", start);
  assert.notEqual(start, -1, `Missing binding-key logic in ${filePath}`);
  assert.notEqual(end, -1, `Missing binding-key logic end in ${filePath}`);
  return source.slice(start, end).replace(/\r\n/g, "\n");
}

const userscriptBindingKeys = readBindingKeyBlock(userscriptPath);
const extensionBindingKeys = readBindingKeyBlock(extensionPath);
assert.equal(extensionBindingKeys, userscriptBindingKeys, "Userscript and extension binding-key logic must stay identical");
assert.match(userscriptBindingKeys, /if \(longVideoPartKey\) return \[longVideoPartKey\];/, "Season-style long-video parts must use a part-scoped binding key");

function readAutoWatchStateBlock(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("  function updateAutoWatchJumpState(");
  const end = source.indexOf("  function getCurrentNormalEpisode()", start);
  assert.notEqual(start, -1, `Missing auto-watch state logic start in ${filePath}`);
  assert.notEqual(end, -1, `Missing auto-watch state logic end in ${filePath}`);
  return source.slice(start, end);
}

const userscriptAutoWatchState = readAutoWatchStateBlock(userscriptPath);
const extensionAutoWatchState = readAutoWatchStateBlock(extensionPath);
assert.equal(extensionAutoWatchState, userscriptAutoWatchState, "Userscript and extension auto-watch state logic must stay identical");

function readAutoWatchFlowBlock(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const checkStart = source.indexOf("  async function checkAutoWatchProgress()");
  const checkEnd = source.indexOf("\n  function ", checkStart + 1);
  const seekStart = source.indexOf("  function handleAutoWatchSeekEnd(");
  const seekEnd = source.indexOf("\n  function ", seekStart + 1);
  assert.notEqual(checkStart, -1, `Missing auto-watch progress logic in ${filePath}`);
  assert.notEqual(checkEnd, -1, `Missing auto-watch progress end in ${filePath}`);
  assert.notEqual(seekStart, -1, `Missing auto-watch seek logic in ${filePath}`);
  assert.notEqual(seekEnd, -1, `Missing auto-watch seek end in ${filePath}`);
  return `${source.slice(checkStart, checkEnd)}\n${source.slice(seekStart, seekEnd)}`.replace(/\r\n/g, "\n");
}

const userscriptAutoWatchFlow = readAutoWatchFlowBlock(userscriptPath);
const extensionAutoWatchFlow = readAutoWatchFlowBlock(extensionPath);
assert.equal(extensionAutoWatchFlow, userscriptAutoWatchFlow, "Userscript and extension auto-watch flow must stay identical");
assert.match(
  userscriptAutoWatchFlow,
  /longVideoModeEnabled && \(!longVideoGuess \|\| !longVideoGuess\.active \|\| !longVideoGuess\.episode \|\| !longVideoGuess\.autoMarkSafe\)\) return;/,
  "Confirmed long-video mode must never fall back to whole-video auto-watch progress",
);

const episodes = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  type: 0,
  name: `Episode ${index + 1}`,
  duration_seconds: 24 * 60,
}));

const sandbox = {
  DEFAULT_LONG_VIDEO_EPISODE_OFFSET_SECONDS: 2 * 60 * 60,
  DEFAULT_EPISODE_DURATION_SECONDS: 24 * 60,
  LONG_VIDEO_MIN_DURATION_SECONDS: 2 * 60 * 60,
  LONG_VIDEO_DISPLAY_OVERFLOW_TOLERANCE_SECONDS: 45 * 60,
  LONG_VIDEO_AUTO_MARK_OVERFLOW_TOLERANCE_SECONDS: 5 * 60,
  STORAGE: { longVideoEpisodeModes: "biligumi.longVideoEpisodeModes" },
  state: {
    longVideoEpisodeGuessEnabled: true,
    longVideoEpisodeOffsets: { "mid:42": 2 * 60 * 60 },
    longVideoEpisodeModes: { "bvid:BV1TEST": true },
    rawTitle: "普通超长视频",
    subjectId: 1,
    episodes,
  },
  location: { pathname: "/video/BV1TEST" },
  window: { __INITIAL_STATE__: { videoData: { bvid: "BV1TEST" } } },
  document: { querySelectorAll: () => [] },
  getBvIdFromUrl: () => (sandbox.location.pathname.match(/\/video\/(BV[\w]+)/i) || [])[1] || "",
  getCurrentPartNoFromUrl: () => null,
  stripTrailingDurationText: (value) => String(value || "").replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/i, "").trim(),
  getPageOwnerInfo: () => ({ mid: 42, name: "测试 UP" }),
  getPrimaryDomOwnerInfo: () => ({ mid: 42, name: "测试 UP" }),
  getActiveVideoElement: () => null,
  getNormalEpisodes: () => sandbox.state.episodes,
  isOfficialBangumiPage: () => false,
  detectCurrentEpisodeNo: () => null,
  escapeHtml: (value) => String(value),
  pad2: (value) => String(value).padStart(2, "0"),
  render: () => {},
  writeJsonValueAsync: async () => {},
  resetAutoWatchObservationState: () => {},
};

vm.createContext(sandbox);
vm.runInContext(`${userscriptLogic}\n;globalThis.logic = {
  buildLongVideoEpisodeTimeline,
  getEpisodeDurationSeconds,
  parseEpisodeDurationText,
  inferLongVideoEpisode,
  parseTimecode,
  formatTimecode,
  getLongVideoDetection,
  getLongVideoEpisodeModeDecision,
  getLongVideoDurationSeconds,
  shouldOfferLongVideoBindingPrompt,
  parseLongVideoPartTitle,
  selectLongVideoEpisodeSegment,
  getCurrentVideoPartContext,
  getLongVideoDecisionKey,
};`, sandbox);

const logic = sandbox.logic;
const timeline = logic.buildLongVideoEpisodeTimeline(episodes, 2 * 60 * 60);
assert.equal(timeline.startTime, 7200);
assert.equal(timeline.endTime, 7200 + 12 * 1440);
assert.equal(timeline.knownDurationCount, 12);
assert.equal(timeline.safeForAutoMark, true);

const detection = { active: true, timeline, autoMarkSafe: true };
assert.equal(logic.inferLongVideoEpisode({ currentTime: 7199 }, detection).stage, "prelude");
assert.equal(logic.inferLongVideoEpisode({ currentTime: 7200 }, detection).episodeNo, 1);
assert.equal(logic.inferLongVideoEpisode({ currentTime: 7200 + 1440 }, detection).episodeNo, 2);
assert.equal(logic.inferLongVideoEpisode({ currentTime: timeline.endTime }, detection).stage, "outro");

const extendedFirst = episodes.map((episode, index) => ({
  ...episode,
  duration_seconds: index === 0 ? 48 * 60 : 24 * 60,
}));
const extendedTimeline = logic.buildLongVideoEpisodeTimeline(extendedFirst, 0);
assert.equal(logic.inferLongVideoEpisode({ currentTime: 47 * 60 }, { active: true, timeline: extendedTimeline }).episodeNo, 1);
assert.equal(logic.inferLongVideoEpisode({ currentTime: 48 * 60 }, { active: true, timeline: extendedTimeline }).episodeNo, 2);

const parsedSeasonRange = logic.parseLongVideoPartTitle("S2 13-15");
assert.equal(parsedSeasonRange.seasonNo, 2);
assert.equal(parsedSeasonRange.episodeStart, 13);
assert.equal(parsedSeasonRange.episodeEnd, 15);
assert.equal(logic.parseLongVideoPartTitle("Season 3").seasonNo, 3);

const fifteenEpisodes = Array.from({ length: 15 }, (_, index) => ({ ...episodes[index % episodes.length], id: index + 101 }));
const rangedSegment = logic.selectLongVideoEpisodeSegment(fifteenEpisodes, parsedSeasonRange);
assert.equal(rangedSegment.rangeApplied, true);
assert.equal(rangedSegment.firstEpisodeNo, 13);
assert.equal(rangedSegment.episodes.length, 3);
assert.equal(logic.buildLongVideoEpisodeTimeline(rangedSegment.episodes, 0, rangedSegment.firstEpisodeNo).items[0].localNo, 13);

const invalidRangeSegment = logic.selectLongVideoEpisodeSegment(episodes, parsedSeasonRange);
assert.equal(invalidRangeSegment.rangeApplied, false);
assert.equal(invalidRangeSegment.rangeFallback, true);
assert.equal(invalidRangeSegment.episodes.length, episodes.length);

const partNodes = [
  ["S1 1-12", false],
  ["S2 1-13", false],
  ["S2 13-15", true],
  ["S3 1-6", false],
].map(([title, active]) => ({
  className: `simple-base-item page-item${active ? " active" : ""}`,
  textContent: `${title} 06:36:55`,
  getAttribute: (name) => name === "title" ? title : null,
  querySelectorAll: () => [],
}));
const partContainer = { children: partNodes };
partNodes.forEach((node) => {
  node.parentElement = partContainer;
  node.closest = (selector) => selector === ".page-list" ? partContainer : null;
});
sandbox.document.querySelector = (selector) => selector.startsWith(".multi-p .page-list") ? partNodes[2] : null;
sandbox.document.querySelectorAll = () => Array.from({ length: 225 }, () => partNodes[0]);
const currentPart = logic.getCurrentVideoPartContext();
assert.equal(currentPart.partNo, 3);
assert.equal(currentPart.partCount, 4);
assert.equal(currentPart.seasonNo, 2);
assert.equal(currentPart.episodeStart, 13);
assert.equal(logic.getLongVideoDecisionKey(), "bvid:BV1TEST:p3");
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };
assert.equal(logic.getLongVideoEpisodeModeDecision(), true, "Legacy BV-wide decision should remain compatible");
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true, "bvid:BV1TEST:p3": false };
assert.equal(logic.getLongVideoEpisodeModeDecision(), false, "Part-specific decision should override a legacy BV-wide decision");
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST:p3": true };
const liveShapeFallback = logic.getLongVideoDetection({ duration: 7 * 60 * 60 });
assert.equal(liveShapeFallback.active, true);
assert.equal(liveShapeFallback.segment.rangeFallback, true);
assert.equal(liveShapeFallback.autoMarkSafe, false);
sandbox.state.episodes = fifteenEpisodes;
const implausiblyShortRange = logic.getLongVideoDetection({ duration: 7 * 60 * 60 });
assert.equal(implausiblyShortRange.active, true);
assert.equal(implausiblyShortRange.segment.rangeApplied, true);
assert.equal(implausiblyShortRange.rangeTimingMismatch, true);
assert.equal(implausiblyShortRange.autoMarkSafe, false);
sandbox.state.episodes = episodes;
sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };

const oneMissing = episodes.map((episode, index) => index === 4 ? { ...episode, duration_seconds: 0 } : episode);
const oneMissingTimeline = logic.buildLongVideoEpisodeTimeline(oneMissing, 0);
assert.equal(oneMissingTimeline.items[4].duration, 24 * 60);
assert.equal(oneMissingTimeline.items[4].durationEstimated, true);
assert.equal(oneMissingTimeline.safeForAutoMark, false);

const manyMissing = episodes.map((episode, index) => index < 6 ? { ...episode, duration_seconds: 0 } : episode);
assert.equal(logic.buildLongVideoEpisodeTimeline(manyMissing, 0).safeForAutoMark, false);

assert.equal(logic.parseEpisodeDurationText("24:30"), 1470);
assert.equal(logic.parseEpisodeDurationText("1小时 5分钟"), 3900);
assert.equal(logic.parseTimecode("02:00:00"), 7200);
assert.equal(logic.parseTimecode("120:00"), 7200);
assert.equal(logic.parseTimecode("120 分钟"), 7200);
assert.equal(logic.parseTimecode("bad"), null);
assert.equal(logic.formatTimecode(10800), "03:00:00");

assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, true);
assert.equal(logic.getLongVideoDetection({ duration: 110 * 60 }).active, false);
assert.equal(logic.getLongVideoDetection({ duration: 2 * 60 * 60 }).active, false);

sandbox.state.episodes = oneMissing;
const missingDurationDetection = logic.getLongVideoDetection({ duration: 7 * 60 * 60 });
assert.equal(missingDurationDetection.active, true);
assert.equal(missingDurationDetection.autoMarkSafe, false);
sandbox.state.episodes = episodes;

const tenMinuteOverflow = logic.getLongVideoDetection({ duration: timeline.endTime - 10 * 60 });
assert.equal(tenMinuteOverflow.active, true);
assert.equal(tenMinuteOverflow.autoMarkSafe, false);
assert.equal(logic.getLongVideoDetection({ duration: timeline.endTime - 46 * 60 }).active, false);

sandbox.state.longVideoEpisodeModes = {};
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, false);
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 2 * 60 * 60 }), false);
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 2 * 60 * 60 + 1 }), true);
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": false };
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, false);
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 7 * 60 * 60 }), false);
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, true);

sandbox.location.pathname = "/video/BV2TEST";
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 7 * 60 * 60 }), true, "Long-video decision must be scoped to the current BV");
sandbox.location.pathname = "/video/BV1TEST";

sandbox.state.longVideoEpisodeModes = {};
sandbox.window.__INITIAL_STATE__.videoData.duration = 8000;
assert.equal(logic.getLongVideoDurationSeconds(null), 8000);
assert.equal(logic.shouldOfferLongVideoBindingPrompt(null), true);
delete sandbox.window.__INITIAL_STATE__.videoData.duration;
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };

assert.equal(logic.getLongVideoDetection({ duration: 4 * 60 * 60 }).active, false);

const autoWatchSandbox = {
  AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS: 5 * 60,
  getAutoWatchThreshold: () => 80,
  state: {
    autoWatchLastVideoKey: "1:1:owner",
    autoWatchLastVideoTime: 4900,
    autoWatchSeekStartTime: 4800,
    autoWatchBlockedKey: "",
  },
};
vm.createContext(autoWatchSandbox);
vm.runInContext(`${userscriptAutoWatchState}\n;globalThis.autoWatchLogic = { updateAutoWatchJumpState, resetAutoWatchObservationState };`, autoWatchSandbox);
autoWatchSandbox.autoWatchLogic.resetAutoWatchObservationState();
autoWatchSandbox.autoWatchLogic.updateAutoWatchJumpState({ currentTime: 5000 }, "1:1:owner", 85);
assert.equal(autoWatchSandbox.state.autoWatchBlockedKey, "1:1:owner", "First observation past threshold must stay blocked after route/offset reset");
assert.equal(autoWatchSandbox.state.autoWatchLastVideoTime, 5000);

console.log("long-video logic tests passed");
