"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const {
  USERSCRIPT_PATH: userscriptPath,
  EXTENSION_PATH: extensionPath,
  readSource,
  extractFunction,
  extractConstants,
  extractObjectConstant,
} = require("./_source");

const userscriptSource = readSource(userscriptPath);

// Constants and STORAGE come from the userscript source, never hand-copied:
// extraction failure must fail this test instead of drifting from the code.
const SRC_CONSTANTS = extractConstants(userscriptSource, [
  "DEFAULT_LONG_VIDEO_EPISODE_OFFSET_SECONDS",
  "DEFAULT_EPISODE_DURATION_SECONDS",
  "LONG_VIDEO_MIN_DURATION_SECONDS",
  "LONG_VIDEO_DISPLAY_OVERFLOW_TOLERANCE_SECONDS",
  "LONG_VIDEO_AUTO_MARK_OVERFLOW_TOLERANCE_SECONDS",
  "AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS",
]);
const SRC_STORAGE = extractObjectConstant(userscriptSource, "STORAGE");

function readLogicBlock(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("  function parseLongVideoPartTitle(");
  const medianStart = source.indexOf("  function median(values)", start);
  const end = source.indexOf("\n  function ", medianStart + 1);
  assert.notEqual(start, -1, `Missing long-video logic start in ${filePath}`);
  assert.notEqual(medianStart, -1, `Missing long-video logic median helper in ${filePath}`);
  assert.notEqual(end, -1, `Missing long-video logic end in ${filePath}`);
  return source.slice(start, end).replace(/\r\n/g, "\n");
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
  const startNatural = source.indexOf("  function isNaturalAutoWatchTimeAdvance(");
  const start = startNatural !== -1 ? startNatural : source.indexOf("  function updateAutoWatchJumpState(");
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
  sort: index + 1,
  name: `Episode ${index + 1}`,
  duration_seconds: 24 * 60,
}));

const sandbox = {
  ...SRC_CONSTANTS,
  STORAGE: SRC_STORAGE,
  URL,
  state: {
    longVideoEpisodeGuessEnabled: false, // default: prompt; enable for auto-accept tests
    longVideoEpisodeOffsets: { "mid:42": 2 * 60 * 60 },
    longVideoEpisodeVideoOffsets: {},
    longVideoEpisodeModes: { "bvid:BV1TEST": true },
    disabledAutoProgressVideos: {},
    rawTitle: "普通超长视频",
    subjectId: 1,
    bindings: {},
    episodes,
  },
  location: new URL("https://www.bilibili.com/video/BV1TEST"),
  window: { __INITIAL_STATE__: { videoData: { bvid: "BV1TEST" } } },
  getPageInitialState: () => sandbox.window.__INITIAL_STATE__ || {},
  document: { querySelectorAll: () => [] },
  getBvIdFromUrl: () => (sandbox.location.pathname.match(/\/video\/(BV[\w]+)/i) || [])[1] || "",
  getPrimaryDomOwnerInfo: () => ({ mid: 42, name: "测试 UP" }),
  getActiveVideoElement: () => null,
  mainEpisodeCount: 24,
  readJsonValue: (key, fallback) => key === SRC_STORAGE.bindings ? sandbox.state.bindings : fallback,
  getSubjectMainEpisodeCountForMapping: async () => sandbox.mainEpisodeCount,
  autoWatchThreshold: 50,
  getAutoWatchThreshold: () => sandbox.autoWatchThreshold,
  isOfficialBangumiPage: () => false,
  detectCurrentEpisodeNo: () => null,
  pad2: (value) => String(value).padStart(2, "0"),
  render: () => {},
  writeJsonValueAsync: async () => {},
  resetAutoWatchObservationState: () => {},
};

// Real implementations replace former hand-written stubs; extraction is strict.
const realHelpers = [
  extractFunction(userscriptSource, "getNormalEpisodes"),
  extractFunction(userscriptSource, "escapeHtml"),
  extractFunction(userscriptSource, "getCurrentPartNoFromUrl"),
  extractFunction(userscriptSource, "stripTrailingDurationText"),
  extractFunction(userscriptSource, "parseChineseNumber"),
].join("\n");
const rangeGroupProposalSource = extractFunction(userscriptSource, "buildLongVideoRangeGroupBindingProposal", { async: true });

vm.createContext(sandbox);
vm.runInContext(`${userscriptLogic}\n${userscriptBindingKeys}\n${rangeGroupProposalSource}\n${realHelpers}\n;globalThis.logic = {
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
  getLongVideoBindReadiness,
  parseLongVideoPartTitle,
  isExplicitLongVideoPartRange,
  selectLongVideoEpisodeSegment,
  getCurrentVideoPartContext,
  getCurrentLongVideoPartBindingKey,
  getCurrentLongVideoRangeGroupContext,
  getCurrentLongVideoRangeGroupKey,
  getCurrentLongVideoBindingSource,
  applyLongVideoRangeGroupBinding,
  getDirectBindingKeysForCurrentPage,
  getBindingKeysForCurrentPage,
  buildLongVideoRangeGroupBindingProposal,
  getLongVideoDecisionKey,
  getCurrentVideoProgressKey,
  getEffectiveLongVideoOffsetSeconds,
  getLongVideoVideoOffsetSeconds,
  isCurrentVideoAutoProgressDisabled,
  setLongVideoVideoOffsetSeconds,
  clearLongVideoVideoOffset,
  setCurrentVideoAutoProgressDisabled,
  clearLongVideoEpisodeModeDecision,
  renderLongVideoEpisodeHint,
  getNormalEpisodes,
  escapeHtml,
  getCurrentPartNoFromUrl,
  stripTrailingDurationText,
};`, sandbox);

(async () => {
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
const parsedChineseSeasonRange = logic.parseLongVideoPartTitle("第一季1-12");
assert.equal(parsedChineseSeasonRange.seasonNo, 1);
assert.equal(parsedChineseSeasonRange.episodeStart, 1);
assert.equal(parsedChineseSeasonRange.episodeEnd, 12);
assert.equal(logic.isExplicitLongVideoPartRange(parsedChineseSeasonRange), true);
assert.equal(
  logic.isExplicitLongVideoPartRange(logic.parseLongVideoPartTitle("第二季1")),
  false,
  "a single episode title is not an explicit long-video range",
);
assert.equal(logic.parseLongVideoPartTitle("租借女友 第二季 1-12").seasonNo, 2);
assert.equal(logic.parseLongVideoPartTitle("第三季").seasonNo, 3);
assert.equal(logic.parseLongVideoPartTitle("租借女友 第1-5季"), null,
  "a whole-title season range must not be mistaken for the fifth part season");

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
assert.equal(logic.getLongVideoEpisodeModeDecision(), null,
  "an explicit ranged part requires its own decision instead of inheriting a BV-wide one");
assert.equal(logic.getCurrentLongVideoPartBindingKey(), "bili:BV1TEST:p3",
  "an explicit ranged part is binding-isolated before its long-video decision");
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

const chinesePartNodes = [
  ["第一季1-12", false],
  ["第二季1-12", true],
  ["第三季1-12", false],
  ["第四季1-12", false],
  ["第五季1-12", false],
].map(([title, active]) => ({
  className: `simple-base-item video-pod__item${active ? " active" : ""}`,
  textContent: `${title} 06:03:08`,
  getAttribute: (name) => name === "title" ? title : null,
  querySelectorAll: () => [],
}));
const chinesePartContainer = { children: chinesePartNodes };
chinesePartNodes.forEach((node) => {
  node.parentElement = chinesePartContainer;
  node.closest = (selector) => selector === ".video-pod__list" ? chinesePartContainer : null;
});
sandbox.document.querySelector = (selector) => selector.includes(".video-pod__list") ? chinesePartNodes[1] : null;
const chineseCurrentPart = logic.getCurrentVideoPartContext();
assert.equal(chineseCurrentPart.partNo, 2);
assert.equal(chineseCurrentPart.partCount, 5);
assert.equal(chineseCurrentPart.seasonNo, 2);
assert.equal(chineseCurrentPart.episodeStart, 1);
assert.equal(chineseCurrentPart.episodeEnd, 12);
assert.equal(logic.getLongVideoDecisionKey(), "bvid:BV1TEST:p2");
assert.equal(logic.getCurrentLongVideoPartBindingKey(), "bili:BV1TEST:p2",
  "a Chinese season change must isolate the next part binding");

const inheritedRangeNodes = [
  ["第一季01-08", false],
  ["第一季09-16", true],
  ["第一季17-24", false],
].map(([title, active]) => ({
  className: `simple-base-item video-pod__item${active ? " active" : ""}`,
  textContent: `${title} 05:02:57`,
  getAttribute: (name) => name === "title" ? title : null,
  querySelectorAll: () => [],
}));
const inheritedRangeContainer = { children: inheritedRangeNodes };
inheritedRangeNodes.forEach((node) => {
  node.parentElement = inheritedRangeContainer;
  node.closest = (selector) => selector === ".video-pod__list" ? inheritedRangeContainer : null;
});
sandbox.document.querySelector = (selector) => selector.includes(".video-pod__list") ? inheritedRangeNodes[1] : null;
const inheritedRangeContext = logic.getCurrentLongVideoRangeGroupContext();
assert.equal(inheritedRangeContext.groupStart, 1);
assert.equal(inheritedRangeContext.groupEnd, 24);
assert.equal(inheritedRangeContext.partCount, 3);
assert.equal(inheritedRangeContext.key, "bili:BV1TEST:range:s1:1-24");
assert.deepEqual(
  Array.from(logic.getDirectBindingKeysForCurrentPage()),
  ["bili:BV1TEST:p2", "bili:BV1TEST:range:s1:1-24"],
  "reads prefer an exact part override before the validated range group",
);
assert.deepEqual(
  Array.from(logic.getBindingKeysForCurrentPage()),
  ["bili:BV1TEST:p2"],
  "ordinary writes stay part-scoped until the range-group proposal is accepted",
);
sandbox.state.bindings = {};
sandbox.mainEpisodeCount = 24;
let inheritedRangeProposal = await logic.buildLongVideoRangeGroupBindingProposal(42);
assert.equal(inheritedRangeProposal.key, "bili:BV1TEST:range:s1:1-24");
assert.equal(inheritedRangeProposal.episodeCount, 24);
sandbox.mainEpisodeCount = 12;
assert.equal(
  await logic.buildLongVideoRangeGroupBindingProposal(42),
  null,
  "a 12-episode Bangumi entry cannot be inherited across a source range ending at episode 24",
);
sandbox.mainEpisodeCount = 24;
sandbox.state.bindings = { "bili:BV1TEST:range:s1:1-24": 77 };
assert.equal(
  await logic.buildLongVideoRangeGroupBindingProposal(42),
  null,
  "an existing conflicting range-group binding is never overwritten implicitly",
);
sandbox.state.bindings = {
  "bili:BV1TEST:p2": 42,
  "bili:BV1TEST:range:s1:1-24": 77,
};
const exactBindingSource = logic.getCurrentLongVideoBindingSource(42);
assert.equal(exactBindingSource.type, "part");
assert.equal(exactBindingSource.fallbackSubjectId, 77);
const racedBindings = { "bili:BV1TEST:range:s1:1-24": 77 };
assert.equal(
  logic.applyLongVideoRangeGroupBinding(
    racedBindings,
    { key: "bili:BV1TEST:range:s1:1-24" },
    ["bili:BV1TEST:p2"],
    42,
  ),
  "part-conflict",
  "a conflict introduced after the proposal must fall back inside the storage write",
);
assert.equal(racedBindings["bili:BV1TEST:range:s1:1-24"], 77, "the concurrent group binding is preserved");
assert.equal(racedBindings["bili:BV1TEST:p2"], 42, "only the current part is written after a race");

const gappedRangeNodes = [
  ["第一季01-08", true],
  ["第一季10-16", false],
  ["第一季17-24", false],
].map(([title, active]) => ({
  className: `simple-base-item video-pod__item${active ? " active" : ""}`,
  textContent: title,
  getAttribute: (name) => name === "title" ? title : null,
  querySelectorAll: () => [],
}));
const gappedRangeContainer = { children: gappedRangeNodes };
gappedRangeNodes.forEach((node) => {
  node.parentElement = gappedRangeContainer;
  node.closest = (selector) => selector === ".video-pod__list" ? gappedRangeContainer : null;
});
sandbox.document.querySelector = (selector) => selector.includes(".video-pod__list") ? gappedRangeNodes[0] : null;
assert.equal(logic.getCurrentLongVideoRangeGroupContext(), null, "a range gap disables inheritance");

const interleavedSeasonNodes = [
  ["第一季01-08", true],
  ["第二季01-08", false],
  ["第一季09-16", false],
].map(([title, active]) => ({
  className: `simple-base-item video-pod__item${active ? " active" : ""}`,
  textContent: title,
  getAttribute: (name) => name === "title" ? title : null,
  querySelectorAll: () => [],
}));
const interleavedSeasonContainer = { children: interleavedSeasonNodes };
interleavedSeasonNodes.forEach((node) => {
  node.parentElement = interleavedSeasonContainer;
  node.closest = (selector) => selector === ".video-pod__list" ? interleavedSeasonContainer : null;
});
sandbox.document.querySelector = (selector) => selector.includes(".video-pod__list") ? interleavedSeasonNodes[0] : null;
assert.equal(
  logic.getCurrentLongVideoRangeGroupContext(),
  null,
  "same-season ranges separated by another season cannot form an inherited group",
);

sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };
sandbox.state.bindings = {};

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

assert.equal(logic.getCurrentVideoProgressKey(), "bvid:BV1TEST");
assert.equal(logic.getEffectiveLongVideoOffsetSeconds("mid:42"), 7200, "No video offset should fall back to UP default");
sandbox.state.longVideoEpisodeVideoOffsets = { "bvid:BV1TEST": 100 };
assert.equal(logic.getLongVideoVideoOffsetSeconds().seconds, 100);
assert.equal(logic.getEffectiveLongVideoOffsetSeconds("mid:42"), 100, "Per-video offset should beat UP default");
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).timeline.startTime, 100);
sandbox.state.longVideoEpisodeVideoOffsets = { "bvid:BV1TEST": 100, "bvid:BV1TEST:p3": 200 };
sandbox.document.querySelector = (selector) => selector.startsWith(".multi-p .page-list") ? partNodes[2] : null;
sandbox.document.querySelectorAll = () => Array.from({ length: 225 }, () => partNodes[0]);
assert.equal(logic.getLongVideoDecisionKey(), "bvid:BV1TEST:p3");
assert.equal(logic.getCurrentVideoProgressKey(), "bvid:BV1TEST:p3");
assert.equal(logic.getLongVideoVideoOffsetSeconds().seconds, 200, "Part-specific video offset should beat BV-wide offset");
assert.equal(logic.getEffectiveLongVideoOffsetSeconds("mid:42"), 200);
sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];
sandbox.state.longVideoEpisodeVideoOffsets = {};
assert.equal(logic.getEffectiveLongVideoOffsetSeconds("mid:42"), 7200);
sandbox.state.disabledAutoProgressVideos = { "bvid:BV1TEST": true };
assert.equal(logic.isCurrentVideoAutoProgressDisabled(), true);
sandbox.state.disabledAutoProgressVideos = {};
assert.equal(logic.isCurrentVideoAutoProgressDisabled(), false);

// Bug 1 regression: legacy BV pause fallback when current key is part-scoped.
sandbox.document.querySelector = (selector) => selector.startsWith(".multi-p .page-list") ? partNodes[2] : null;
sandbox.document.querySelectorAll = () => Array.from({ length: 225 }, () => partNodes[0]);
assert.equal(logic.getLongVideoDecisionKey(), "bvid:BV1TEST:p3");
sandbox.state.disabledAutoProgressVideos = { "bvid:BV1TEST": true };
assert.equal(logic.isCurrentVideoAutoProgressDisabled(), true, "Legacy BV pause should still apply when part key is active");
sandbox.state.disabledAutoProgressVideos = { "bvid:BV1TEST:p3": true };
assert.equal(logic.isCurrentVideoAutoProgressDisabled(), true, "Part-specific pause should be honored");
sandbox.state.disabledAutoProgressVideos = { "bvid:BV1TEST:p2": true };
assert.equal(logic.isCurrentVideoAutoProgressDisabled(), false, "Unrelated part pause should not leak");
sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];
sandbox.state.disabledAutoProgressVideos = {};

// Bug 2 regression: clear removes both part and legacy video-offset keys.
sandbox.state.longVideoEpisodeVideoOffsets = { "bvid:BV1TEST": 100, "bvid:BV1TEST:p3": 200 };
sandbox.document.querySelector = (selector) => selector.startsWith(".multi-p .page-list") ? partNodes[2] : null;
sandbox.document.querySelectorAll = () => Array.from({ length: 225 }, () => partNodes[0]);
assert.equal(logic.getLongVideoVideoOffsetSeconds().seconds, 200);
await logic.clearLongVideoVideoOffset();
assert.equal(logic.getLongVideoVideoOffsetSeconds(), null, "Clearing part offset must also clear legacy BV offset");
assert.equal(logic.getEffectiveLongVideoOffsetSeconds("mid:42"), 7200, "After dual clear, effective offset falls back to UP default");
sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];
sandbox.state.longVideoEpisodeVideoOffsets = {};

// Bug 1 disable side effect: turning auto back on clears both keys.
sandbox.state.disabledAutoProgressVideos = { "bvid:BV1TEST": true, "bvid:BV1TEST:p3": true };
sandbox.document.querySelector = (selector) => selector.startsWith(".multi-p .page-list") ? partNodes[2] : null;
sandbox.document.querySelectorAll = () => Array.from({ length: 225 }, () => partNodes[0]);
await logic.setCurrentVideoAutoProgressDisabled(false);
assert.equal(logic.isCurrentVideoAutoProgressDisabled(), false, "After enable, no pause key remains");
assert.equal(Object.keys(sandbox.state.disabledAutoProgressVideos).length, 0, "Enable must delete both part and legacy pause keys");
sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];

// setLongVideoVideoOffsetSeconds round-trip.
await logic.setLongVideoVideoOffsetSeconds(150);
assert.equal(logic.getLongVideoVideoOffsetSeconds().seconds, 150);
assert.equal(logic.getEffectiveLongVideoOffsetSeconds("mid:42"), 150);
await logic.clearLongVideoVideoOffset();
assert.equal(logic.getLongVideoVideoOffsetSeconds(), null);

// Nit 7: unbind clears sibling part mode keys for the same BV.
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true, "bvid:BV1TEST:p1": true, "bvid:BV1TEST:p2": false, "bvid:BV2OTHER": true };
sandbox.document.querySelector = (selector) => selector.startsWith(".multi-p .page-list") ? partNodes[2] : null;
sandbox.document.querySelectorAll = () => Array.from({ length: 225 }, () => partNodes[0]);
await logic.clearLongVideoEpisodeModeDecision();
assert.equal(sandbox.state.longVideoEpisodeModes["bvid:BV1TEST"], undefined, "Legacy mode cleared");
assert.equal(sandbox.state.longVideoEpisodeModes["bvid:BV1TEST:p1"], undefined, "Sibling part mode cleared");
assert.equal(sandbox.state.longVideoEpisodeModes["bvid:BV1TEST:p2"], undefined, "Sibling part mode cleared");
assert.equal(sandbox.state.longVideoEpisodeModes["bvid:BV2OTHER"], true, "Unrelated BV untouched");
sandbox.document.querySelector = () => null;
sandbox.document.querySelectorAll = () => [];
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };

sandbox.state.episodes = oneMissing;
const missingDurationDetection = logic.getLongVideoDetection({ duration: 7 * 60 * 60 });
assert.equal(missingDurationDetection.active, true);
assert.equal(missingDurationDetection.autoMarkSafe, false);
sandbox.state.episodes = episodes;

const tenMinuteOverflow = logic.getLongVideoDetection({ duration: timeline.endTime - 10 * 60 });
assert.equal(tenMinuteOverflow.active, true);
assert.equal(tenMinuteOverflow.autoMarkSafe, false);
assert.equal(logic.getLongVideoDetection({ duration: timeline.endTime - 46 * 60 }).active, false);

sandbox.autoWatchThreshold = 80;
sandbox.state.longVideoEpisodeGuess = {
  active: true,
  stage: "episode",
  episode: { name: "Episode 3" },
  episodeNo: 3,
  episodePercent: 42,
  autoMarkSafe: true,
  segment: {},
};
assert.match(
  logic.renderLongVideoEpisodeHint(),
  /达到设置的 80% 后自动标记/,
  "the long-video hint exposes the shared automatic-mark threshold",
);

// An invalid default offset must not hide the control needed to correct it.
sandbox.getActiveVideoElement = () => ({ duration: timeline.endTime - 46 * 60, currentTime: 10 });
sandbox.state.longVideoEpisodeGuess = null;
sandbox.state.disabledAutoProgressVideos = {};
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };
const calibrationHint = logic.renderLongVideoEpisodeHint();
assert.match(calibrationHint, /实验推测暂不可用/);
assert.match(calibrationHint, /首集起点加全季时长已超过视频总长/);
assert.match(calibrationHint, /data-action="capture-long-video-video-offset"/,
  "inactive long-video detection must still expose the start-offset action");
sandbox.state.longVideoEpisodeModes = {};
assert.equal(logic.renderLongVideoEpisodeHint(), "",
  "unconfirmed long videos must not show calibration controls");
sandbox.getActiveVideoElement = () => null;

sandbox.state.longVideoEpisodeModes = {};
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, false);
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 2 * 60 * 60 }), false);
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 2 * 60 * 60 + 1 }), true);
assert.equal(logic.getLongVideoBindReadiness({ duration: 2 * 60 * 60 + 1 }).action, "prompt", "Default (auto-identify off) should prompt");
assert.equal(logic.getLongVideoBindReadiness({ duration: 90 * 60 }).action, "bind");
assert.equal(logic.getLongVideoBindReadiness({ duration: 0 }).action, "wait");
assert.equal(logic.getLongVideoBindReadiness({ duration: Number.NaN }).action, "wait");
assert.equal(logic.getLongVideoBindReadiness(null).action, "wait");
assert.match(logic.getLongVideoBindReadiness(null).statusText, /时长/);
sandbox.state.longVideoEpisodeGuessEnabled = true;
assert.equal(logic.getLongVideoBindReadiness({ duration: 7 * 60 * 60 }).action, "auto", "Enabled auto-identify should skip the multi-episode confirmation");
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 7 * 60 * 60 }), false, "Auto path should not surface the confirmation prompt");
sandbox.state.longVideoEpisodeGuessEnabled = false;
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": false };
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, false);
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 7 * 60 * 60 }), false);
assert.equal(logic.getLongVideoBindReadiness({ duration: 7 * 60 * 60 }).action, "bind", "Known false decision should bind without waiting");
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };
assert.equal(logic.getLongVideoDetection({ duration: 7 * 60 * 60 }).active, true);
assert.equal(logic.getLongVideoBindReadiness({ duration: 7 * 60 * 60 }).action, "bind", "Known true decision should bind without re-prompt");

sandbox.location.pathname = "/video/BV2TEST";
assert.equal(logic.shouldOfferLongVideoBindingPrompt({ duration: 7 * 60 * 60 }), true, "Long-video decision must be scoped to the current BV");
assert.equal(logic.getLongVideoBindReadiness({ duration: 0 }).action, "wait", "Unknown duration on a new BV should wait instead of binding as normal");
sandbox.state.longVideoEpisodeGuessEnabled = true;
assert.equal(logic.getLongVideoBindReadiness({ duration: 7 * 60 * 60 }).action, "auto");
sandbox.state.longVideoEpisodeGuessEnabled = false;
sandbox.location.pathname = "/video/BV1TEST";

sandbox.state.longVideoEpisodeModes = {};
sandbox.window.__INITIAL_STATE__.videoData.duration = 8000;
assert.equal(logic.getLongVideoDurationSeconds(null), 8000);
assert.equal(logic.shouldOfferLongVideoBindingPrompt(null), true);
assert.equal(logic.getLongVideoBindReadiness(null).action, "prompt");
sandbox.state.longVideoEpisodeGuessEnabled = true;
assert.equal(logic.getLongVideoBindReadiness(null).action, "auto");
sandbox.state.longVideoEpisodeGuessEnabled = false;
delete sandbox.window.__INITIAL_STATE__.videoData.duration;
sandbox.state.longVideoEpisodeModes = { "bvid:BV1TEST": true };

assert.equal(logic.getLongVideoDetection({ duration: 4 * 60 * 60 }).active, false);

// getNormalEpisodes is the real implementation: it filters type !== 0 and sorts by sort.
sandbox.state.episodes = [...episodes, { id: 999, type: 1, sort: 3, name: "SP", duration_seconds: 300 }];
const normalEpisodes = logic.getNormalEpisodes();
assert.equal(normalEpisodes.length, episodes.length, "getNormalEpisodes must filter non-main episodes");
assert.ok(normalEpisodes.every((ep) => Number(ep.type) === 0), "getNormalEpisodes keeps only type 0");
assert.deepEqual(normalEpisodes.map((ep) => ep.id), episodes.map((ep) => ep.id), "getNormalEpisodes must keep sort order");
sandbox.state.episodes = episodes.slice().reverse();
assert.deepEqual(logic.getNormalEpisodes().map((ep) => ep.id), episodes.map((ep) => ep.id), "getNormalEpisodes must sort a reversed list");
sandbox.state.episodes = episodes;

// escapeHtml is the real implementation and must neutralize markup.
assert.equal(logic.escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
assert.equal(logic.escapeHtml("a&b'c\"d"), "a&amp;b&#039;c&quot;d");
assert.ok(!logic.escapeHtml("<script>alert('x')</script>").includes("<"), "escaped output must not contain raw <");

// ?p= drives the current part number through the real getCurrentPartNoFromUrl.
sandbox.location = new URL("https://www.bilibili.com/video/BV1TEST?p=3");
assert.equal(logic.getCurrentPartNoFromUrl(), 3, "?p=3 must be read from the URL");
const urlDrivenPart = logic.getCurrentVideoPartContext();
assert.equal(urlDrivenPart.partNo, 3, "URL part number must win without part-list DOM");
assert.equal(urlDrivenPart.partCount, 3);
sandbox.location = new URL("https://www.bilibili.com/video/BV1TEST");
assert.equal(logic.getCurrentPartNoFromUrl(), null);

const autoWatchSandbox = {
  AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS: SRC_CONSTANTS.AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS,
  getAutoWatchThreshold: () => 80,
  Date,
  document: { visibilityState: "visible" },
  state: {
    autoWatchLastVideoKey: "1:1:owner",
    autoWatchLastVideoTime: 4900,
    autoWatchLastObservedAt: Date.now() - 1000,
    autoWatchSawHiddenSinceLastObservation: false,
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
})().catch((err) => { console.error(err); process.exit(1); });
