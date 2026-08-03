"use strict";

const assert = require("node:assert/strict");
const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  extractConstants,
  runInSandbox,
} = require("./_source");

const source = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);
const functionSource = (name, async = false) => extractFunction(source, name, async ? { async: true } : {});
const collectionConstants = extractConstants(source, [
  "MIN_COLLECTION_PARSED_PARTS",
  "MAX_COLLECTION_SEGMENTS",
  "COLLECTION_PART_ROWS_CACHE_MS",
  "COLLECTION_SEGMENT_PROGRESS_MAX_AGE_MS",
  "COLLECTION_SEGMENT_PROGRESS_MAX_ENTRIES",
]);
assert.deepEqual(
  { ...extractConstants(extensionSource, Object.keys(collectionConstants)) },
  { ...collectionConstants },
  "collection safety/cache constants must stay identical between userscript and extension",
);
assert.match(
  extractFunction(source, "updateStoredCollectionSegmentProgress"),
  /changed \|\| normalizedChanged/,
  "userscript must persist lazy cleanup even when the current segment was already recorded",
);
assert.match(
  extractFunction(extensionSource, "updateStoredCollectionSegmentProgress", { async: true }),
  /changed \|\| normalizedChanged/,
  "extension must persist lazy cleanup even when the current segment was already recorded",
);
for (const [label, currentBindingSource] of [
  ["userscript", extractFunction(source, "getCurrentBinding")],
  ["extension", extractFunction(extensionSource, "getCurrentBinding")],
]) {
  assert.match(currentBindingSource, /isOrdinaryEpisodeCollectionForTotal\(collectionContext, declaredTotalEpisodes\)/,
    `${label} may reuse a whole-BV binding only for a strict ordinary episode list`);
  assert.match(currentBindingSource, /if \(collectionLayout\) return null;/,
    `${label} must fail closed on long-range and non-content parts of a recognized mixed collection`);
}
let bindingReuseContext = {
  bvid: "BV1MB3W6HEZN",
  seasonKey: "default",
  episodeNo: 4,
  groupStart: 1,
  groupEnd: 5,
  groupLogicalEpisodeCount: 5,
  hasSplitEpisodes: false,
  segmentCount: 1,
};
const bindingReuseSandbox = {
  STORAGE: { bindings: "bindings", bindingSubjects: "bindingSubjects", collectionMappings: "collectionMappings" },
  state: {
    message: "",
    bindingGuardMessage: "",
    bindings: { direct: 622633 },
    bindingSubjects: { "622633": { totalEpisodes: 13 } },
    collectionMappings: {},
  },
  readJsonValue(key, fallback) {
    if (key === "bindings") return bindingReuseSandbox.state.bindings;
    if (key === "bindingSubjects") return bindingReuseSandbox.state.bindingSubjects;
    if (key === "collectionMappings") return bindingReuseSandbox.state.collectionMappings;
    return fallback;
  },
  normalizeCollectionMappings: (value) => value,
  getCurrentCollectionPartContext: () => bindingReuseContext,
  getCollectionMappingRule: () => null,
  getCollectionPartDirectBindingSubjectId: () => null,
  getCurrentDirectBindingSubjectId: () => 622633,
  getStoredSubjectDeclaredTotalEpisodeCount: () => 13,
};
runInSandbox([
  functionSource("getCollectionLogicalEpisodeCount"),
  functionSource("isOrdinaryEpisodeCollectionForTotal"),
  functionSource("getCurrentBinding"),
  "globalThis.readCurrentBinding = getCurrentBinding;",
].join("\n"), bindingReuseSandbox);
assert.equal(bindingReuseSandbox.readCurrentBinding(), 622633,
  "a plain ongoing 1-5 list may reuse its ordinary whole-BV binding");
bindingReuseContext = { ...bindingReuseContext, seasonKey: "season:2", seasonNo: 2 };
assert.equal(bindingReuseSandbox.readCurrentBinding(), null,
  "an incomplete second-season group must not inherit the first season's whole-BV binding");
bindingReuseContext = {
  ...bindingReuseContext,
  seasonKey: "default",
  seasonNo: null,
  hasSplitEpisodes: true,
  segmentCount: 2,
};
assert.equal(bindingReuseSandbox.readCurrentBinding(), null,
  "an incomplete split group remains isolated even though batch detection is deferred");
bindingReuseSandbox.getCollectionPartDirectBindingSubjectId = () => 731234;
assert.equal(bindingReuseSandbox.readCurrentBinding(), 731234,
  "an incomplete structured group may reload its explicit current-part binding");
const isolatedCollectionKeySandbox = {
  getCurrentCollectionPartContext: () => null,
  state: { bindings: { "bili:BV1MB3W6HEZN:p4": 731234 } },
};
runInSandbox([
  functionSource("getCollectionPartBindingKey"),
  functionSource("getCollectionPartDirectBindingSubjectId"),
  "globalThis.readCollectionPartKey = getCollectionPartBindingKey;",
  "globalThis.readCollectionPartSubject = getCollectionPartDirectBindingSubjectId;",
].join("\n"), isolatedCollectionKeySandbox);
const isolatedCollectionContext = { bvid: "bv1mb3w6hezn", partNo: 4 };
assert.equal(isolatedCollectionKeySandbox.readCollectionPartKey(isolatedCollectionContext), "bili:BV1MB3W6HEZN:p4");
assert.equal(isolatedCollectionKeySandbox.readCollectionPartSubject(isolatedCollectionContext), 731234);
const isolatedWriteSandbox = {
  getCurrentLongVideoPartBindingKey: () => "",
  getCurrentCollectionLayoutContext: () => ({ currentKind: "unmapped" }),
  getDirectBindingKeysForCurrentPage: () => ["bili:BV1V4XFBWEGT:p51"],
  getTitleBindingKey: () => {
    throw new Error("a non-content part must not write the shared title key");
  },
};
runInSandbox(
  `${functionSource("getBindingKeysForCurrentPage")};globalThis.readBindingKeys = getBindingKeysForCurrentPage;`,
  isolatedWriteSandbox,
);
assert.deepEqual(
  [...isolatedWriteSandbox.readBindingKeys()],
  ["bili:BV1V4XFBWEGT:p51"],
  "manual binding on an unmapped tail part stays isolated to that BV part",
);
const inheritedRangeHintSandbox = {
  state: { subjectId: 42 },
  getCurrentCollectionPartContext: () => null,
  getCurrentCollectionLayoutContext: () => ({
    currentKind: "long-range",
    part: { title: "第一季09-16" },
    currentLongVideo: { rangeLabel: "第1季 9-16" },
  }),
  getCurrentLongVideoBindingSource: () => ({
    type: "group",
    group: { seasonNo: 1, groupStart: 1, groupEnd: 24 },
  }),
  escapeHtml: (value) => String(value),
};
runInSandbox(
  `${functionSource("renderCollectionMappingHint")};globalThis.renderInheritedRangeHint = renderCollectionMappingHint;`,
  inheritedRangeHintSandbox,
);
assert.match(
  inheritedRangeHintSandbox.renderInheritedRangeHint(),
  /已继承第1季 1-24集连续范围组/,
  "an inherited long-video range explains that rebinding is not required",
);
let delayedLayoutReady = false;
const delayedLayoutSandbox = {
  STORAGE: {
    bindings: "bindings",
    bindingSubjects: "bindingSubjects",
    collectionMappings: "collectionMappings",
  },
  routeRefreshSeq: 0,
  state: {
    subjectId: 95225,
    bindings: { "bili:BV1V4XFBWEGT": 95225 },
    bindingSubjects: {},
    collectionMappings: {},
    subject: { id: 95225 },
    subjectInfoLinks: { old: true },
    subjectInfoWebRows: [{ old: true }],
    characters: [{ old: true }],
    characterError: "old",
    collection: { old: true },
    episodes: [{ old: true }],
    episodeCollections: [{ old: true }],
    busy: true,
    error: "old",
    message: "old",
    bindingGuardMessage: "",
    autoEpisodeSyncing: true,
    autoEpisodeSyncLastKey: "old",
    longVideoEpisodeGuess: { active: true },
    longVideoEpisodeRenderKey: "old",
    longVideoDetectionCache: { old: true },
    longVideoDetectionKeyMemo: "old",
  },
  readJsonValue(key, fallback) {
    if (key === "bindings") return delayedLayoutSandbox.state.bindings;
    if (key === "bindingSubjects") return {};
    if (key === "collectionMappings") return {};
    return fallback;
  },
  normalizeCollectionMappings: (value) => value,
  getCurrentCollectionPartContext: () => null,
  getCollectionMappingRule: () => null,
  getCurrentCollectionLayoutContext: () => delayedLayoutReady ? ({ currentKind: "long-range" }) : null,
  getDirectBindingKeysForCurrentPage: () => delayedLayoutReady
    ? ["bili:BV1V4XFBWEGT:p49"]
    : ["bili:BV1V4XFBWEGT"],
  canReuseOfficialDirectBinding: () => true,
  migrateCurrentBindingKeys: () => {},
  getCurrentLongVideoPartBindingKey: () => "",
  isOfficialBangumiPage: () => false,
  getOfficialBangumiBaseBindingKeys: () => [],
  getTitleBindingKey: () => "",
  canReuseTitleBinding: () => false,
  getCrossOwnerTitleBinding: () => null,
  getNonMainTitleBinding: () => null,
  getTitleBindingInfo: () => ({ lowConfidence: false, token: "" }),
  getTitleBindingSubjectIdsByToken: () => [],
  clearLongVideoBindingPrompt: () => {},
  finishPanelLoad: () => {},
  removeSubjectInfoPanel: () => {},
  removeCharacterStrip: () => {},
  recognitionRefreshes: 0,
  refreshCurrentEpisodeRecognitionState: () => {
    delayedLayoutSandbox.recognitionRefreshes += 1;
  },
  renders: 0,
  render: () => {
    delayedLayoutSandbox.renders += 1;
  },
  shouldRenderFullPanel: () => false,
  loadSubjectBundle: async () => {},
  showError: () => {},
};
runInSandbox(
  [
    functionSource("getCurrentBinding"),
    functionSource("refreshCurrentBindingIfChanged"),
    "globalThis.refreshSettledBinding = refreshCurrentBindingIfChanged;",
  ].join("\n"),
  delayedLayoutSandbox,
);
assert.equal(
  delayedLayoutSandbox.refreshSettledBinding(),
  false,
  "an early read before the 51P list appears leaves the existing binding untouched",
);
delayedLayoutReady = true;
assert.equal(
  delayedLayoutSandbox.refreshSettledBinding(),
  true,
  "the settled mixed layout triggers a binding re-read",
);
assert.equal(delayedLayoutSandbox.state.subjectId, null, "the stale whole-BV subject is removed after layout discovery");
assert.equal(delayedLayoutSandbox.state.subject, null, "the stale subject bundle is cleared");
assert.equal(delayedLayoutSandbox.state.episodes.length, 0, "stale first-season episodes are cleared");
assert.equal(delayedLayoutSandbox.routeRefreshSeq, 1, "in-flight requests for the stale subject are invalidated");
assert.equal(delayedLayoutSandbox.recognitionRefreshes, 1);
assert.equal(delayedLayoutSandbox.renders, 1);
for (const [label, bindSource] of [
  ["userscript", extractFunction(source, "bindSubject", { async: true })],
  ["extension", extractFunction(extensionSource, "bindSubject", { async: true })],
]) {
  const subjectAssignmentAt = bindSource.indexOf("state.subjectId = subjectId;");
  const refreshAt = bindSource.indexOf("refreshCurrentEpisodeRecognitionState();");
  const loadAt = bindSource.indexOf("await loadSubjectBundle();");
  assert.ok(
    subjectAssignmentAt >= 0 && refreshAt > subjectAssignmentAt && loadAt > refreshAt,
    `${label} must refresh the mapped current episode before the post-bind render`,
  );
}

const recognitionSandbox = {
  state: {
    autoEpisodeSyncLastKey: "old-subject:old-episode",
    currentEpisodeNo: null,
    rawTitle: "合集标题",
  },
  disabled: false,
  resetCount: 0,
  isCurrentVideoAutoProgressDisabled: () => recognitionSandbox.disabled,
  resetAutoWatchObservationState: () => {
    recognitionSandbox.resetCount += 1;
  },
  detectCurrentEpisodeNo(title) {
    assert.equal(title, "合集标题");
    return 4;
  },
  getPageTitle() {
    throw new Error("stored raw title should be preferred");
  },
};
runInSandbox(
  `${functionSource("refreshCurrentEpisodeRecognitionState")};globalThis.refreshRecognition = refreshCurrentEpisodeRecognitionState;`,
  recognitionSandbox,
);
recognitionSandbox.refreshRecognition();
assert.equal(recognitionSandbox.state.currentEpisodeNo, 4, "new range mapping is recognized immediately after binding");
assert.equal(recognitionSandbox.state.autoEpisodeSyncLastKey, "", "stale episode sync state is cleared after remapping");
assert.equal(recognitionSandbox.resetCount, 1, "watch observation state is reset after remapping");
recognitionSandbox.disabled = true;
recognitionSandbox.refreshRecognition();
assert.equal(recognitionSandbox.state.currentEpisodeNo, null, "a paused video stays unrecognized after binding");

const sandbox = {
  ...collectionConstants,
  Date,
  state: { collectionMappings: {}, longVideoEpisodeGuess: null },
  getCurrentCollectionLayoutContext: () => null,
  getLongVideoEpisodeModeDecision: () => null,
  isCurrentOrdinaryEpisodeCollection: () => false,
  stripTrailingDurationText: (text) => String(text || "")
    .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim(),
  formatEpisodeSort: (value) => String(value),
  getBvIdFromUrl: () => "BV15H3M65EED",
};

runInSandbox([
  functionSource("normalizeCollectionMappings"),
  functionSource("normalizeCollectionMappingRule"),
  functionSource("normalizeCollectionSegmentProgress"),
  functionSource("parseCollectionPartTitle"),
  functionSource("parseBareCollectionEpisodeTitle"),
  functionSource("parseChineseNumber"),
  functionSource("parseCollectionFragment"),
  functionSource("getCollectionMappingRules"),
  functionSource("getCollectionMappingResolution"),
  functionSource("getCollectionMappingRule"),
  functionSource("getCollectionMappedEpisodeNo"),
  functionSource("getCollectionLogicalEpisodeCount"),
  functionSource("isCollectionRangeMappingEligible"),
  functionSource("isOrdinaryEpisodeCollectionForTotal"),
  functionSource("putCollectionMappingRule"),
  functionSource("removeCollectionMappingRule"),
  functionSource("formatCollectionTargetEpisodeLabel"),
  functionSource("formatCollectionTargetRange"),
  functionSource("formatCollectionRangeBindingPrompt"),
  functionSource("formatCollectionSourceRange"),
  functionSource("isCurrentCollectionPartAutoMarkEligible"),
  functionSource("buildCollectionRangeBindingProposal", true),
  functionSource("getCollectionSegmentProgressKey"),
  functionSource("recordCurrentCollectionSegmentProgressIfNeeded", true),
  functionSource("clearCollectionSegmentProgressForRule", true),
].join("\n") + `
;globalThis.api = {
  normalizeCollectionMappings,
  parseCollectionPartTitle,
  parseBareCollectionEpisodeTitle,
  getCollectionMappingResolution,
  getCollectionMappedEpisodeNo,
  getCollectionLogicalEpisodeCount,
  isCollectionRangeMappingEligible,
  isOrdinaryEpisodeCollectionForTotal,
  putCollectionMappingRule,
  formatCollectionTargetEpisodeLabel,
  formatCollectionTargetRange,
  formatCollectionRangeBindingPrompt,
  isCurrentCollectionPartAutoMarkEligible,
  buildCollectionRangeBindingProposal,
  recordCurrentCollectionSegmentProgressIfNeeded,
  clearCollectionSegmentProgressForRule,
  getCollectionSegmentProgressKey,
};`, sandbox);
sandbox.resolveLongVideoBindingSubject = () => ({ name: "Test Subject" });
sandbox.displaySubjectName = (subject) => subject.name;

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(sandbox.api.parseCollectionPartTitle("1.1")), {
  seasonKey: "default", seasonNo: null, episodeNo: 1, fragmentIndex: 1, fragmentCount: 2, label: "1.1",
});
assert.equal(sandbox.api.parseCollectionPartTitle("1.2").fragmentIndex, 2);
assert.deepEqual(plain(sandbox.api.parseCollectionPartTitle("1.3")), {
  seasonKey: "default", seasonNo: null, episodeNo: 1, fragmentIndex: 3, fragmentCount: 3, label: "1.3",
});
assert.deepEqual(plain(sandbox.api.parseCollectionPartTitle("第二季0")), {
  seasonKey: "season:2", seasonNo: 2, episodeNo: 0, fragmentIndex: 1, fragmentCount: 1, label: "第二季0",
});
assert.equal(sandbox.api.parseCollectionPartTitle("第三季4").episodeNo, 4);
assert.equal(sandbox.api.parseCollectionPartTitle("第1集上").fragmentIndex, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("第1集下").fragmentIndex, 2);
assert.equal(sandbox.api.parseCollectionPartTitle("EP01-A").fragmentIndex, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("EP01-B").fragmentIndex, 2);
assert.deepEqual(plain(sandbox.api.parseCollectionPartTitle("1.1.2")), {
  seasonKey: "season:1", seasonNo: 1, episodeNo: 1, fragmentIndex: 2,
  fragmentCount: 2, hierarchical: true, label: "1.1.2",
});
assert.equal(sandbox.api.parseCollectionPartTitle("1.24.1").episodeNo, 24);
assert.equal(sandbox.api.parseCollectionPartTitle("S2E13").seasonKey, "season:2");
assert.equal(sandbox.api.parseCollectionPartTitle("1.1 相遇").episodeNo, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("1.1 相遇").fragmentIndex, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("第二季1 开端").seasonKey, "season:2");
assert.equal(sandbox.api.parseCollectionPartTitle("第二季1 开端").episodeNo, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("S2E13 标题").episodeNo, 13);
assert.equal(sandbox.api.parseCollectionPartTitle("第1集上 前半").fragmentIndex, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("1080P"), null);
assert.equal(sandbox.api.parseCollectionPartTitle("4K超清"), null);
assert.equal(sandbox.api.parseBareCollectionEpisodeTitle("01 02:06:56").episodeNo, 1);
assert.equal(sandbox.api.parseBareCollectionEpisodeTitle("16").episodeNo, 16);
assert.equal(sandbox.api.parseBareCollectionEpisodeTitle("(13) 32:43").episodeNo, 13);
assert.equal(sandbox.api.parseBareCollectionEpisodeTitle("（13）").episodeNo, 13);
assert.equal(sandbox.api.parseBareCollectionEpisodeTitle("1080P"), null);
assert.equal(collectionConstants.MIN_COLLECTION_PARSED_PARTS, 4);
assert.equal(collectionConstants.MAX_COLLECTION_SEGMENTS, 8);

const plainFiveEpisodeContext = {
  bvid: "BV1MB3W6HEZN",
  seasonKey: "default",
  episodeNo: 4,
  groupStart: 1,
  groupEnd: 5,
  groupLogicalEpisodeCount: 5,
  parsedPartCount: 5,
  hasSplitEpisodes: false,
  segmentCount: 1,
};
assert.equal(sandbox.api.isCollectionRangeMappingEligible(plainFiveEpisodeContext, 0), false,
  "a missing declared total means the subject is unfinished and cannot enter range mapping");
assert.equal(sandbox.api.isCollectionRangeMappingEligible(plainFiveEpisodeContext, 13), false,
  "five uploaded episodes out of a declared thirteen remain an ordinary ongoing season");
assert.equal(sandbox.api.isCollectionRangeMappingEligible(plainFiveEpisodeContext, 5), false,
  "a complete one-part-per-episode season still uses ordinary binding");
assert.equal(sandbox.api.isOrdinaryEpisodeCollectionForTotal(plainFiveEpisodeContext, 0), true);
assert.equal(sandbox.api.isOrdinaryEpisodeCollectionForTotal(plainFiveEpisodeContext, 13), true);
assert.equal(sandbox.api.isCollectionRangeMappingEligible({
  ...plainFiveEpisodeContext,
  hasSplitEpisodes: true,
  segmentCount: 2,
}, 5), true, "a completed split season still needs range mapping");
assert.equal(sandbox.api.isCollectionRangeMappingEligible({
  ...plainFiveEpisodeContext,
  groupEnd: 16,
  groupLogicalEpisodeCount: 16,
}, 8), true, "a numeric list longer than the selected subject remains a multi-title collection");

const now = Date.now();
const progressFixture = {};
for (let index = 0; index < 205; index += 1) {
  progressFixture[`recent-${index}`] = { completed: [1, 9], updatedAt: now - index };
}
progressFixture.stale = {
  completed: [1],
  updatedAt: now - collectionConstants.COLLECTION_SEGMENT_PROGRESS_MAX_AGE_MS - 1,
};
const normalizedProgress = sandbox.normalizeCollectionSegmentProgress
  ? sandbox.normalizeCollectionSegmentProgress(progressFixture)
  : runInSandbox(
    `${functionSource("normalizeCollectionSegmentProgress")};globalThis.readProgress = normalizeCollectionSegmentProgress;`,
    { ...collectionConstants, Date },
  ).readProgress(progressFixture);
assert.equal(Object.keys(normalizedProgress).length, collectionConstants.COLLECTION_SEGMENT_PROGRESS_MAX_ENTRIES);
assert.equal(normalizedProgress.stale, undefined, "abandoned partial progress expires lazily");
assert.deepEqual(plain(normalizedProgress["recent-0"].completed), [1], "segment clamp uses the shared maximum");

const bvid = "BV15H3M65EED";
const mappings = {};
sandbox.api.putCollectionMappingRule(mappings, {
  bvid, seasonKey: "default", sourceStart: 1, sourceEnd: 11,
  targetStart: 1, subjectId: 1001, segmentCount: 2,
});
sandbox.api.putCollectionMappingRule(mappings, {
  bvid, seasonKey: "default", sourceStart: 12, sourceEnd: 23,
  targetStart: 1, subjectId: 1002, segmentCount: 2,
});
sandbox.api.putCollectionMappingRule(mappings, {
  bvid, seasonKey: "season:2", sourceStart: 0, sourceEnd: 0,
  targetStart: null, subjectId: 2000, autoProgress: false,
});
sandbox.api.putCollectionMappingRule(mappings, {
  bvid, seasonKey: "season:2", sourceStart: 1, sourceEnd: 12,
  targetStart: 1, subjectId: 2001,
});
sandbox.api.putCollectionMappingRule(mappings, {
  bvid, seasonKey: "season:2", sourceStart: 13, sourceEnd: 24,
  targetStart: 1, subjectId: 2002,
});
sandbox.state.collectionMappings = mappings;

function resolve(seasonKey, episodeNo) {
  return sandbox.api.getCollectionMappingResolution({ bvid, seasonKey, episodeNo });
}

assert.equal(resolve("default", 11).rule.subjectId, 1001);
assert.equal(resolve("default", 12).rule.subjectId, 1002);
assert.equal(sandbox.api.getCollectionMappedEpisodeNo({ bvid, seasonKey: "default", episodeNo: 23 }, resolve("default", 23).rule), 12);
assert.equal(resolve("season:2", 0).rule.autoProgress, false);
assert.equal(resolve("season:2", 12).rule.subjectId, 2001);
assert.equal(resolve("season:2", 13).rule.subjectId, 2002);
assert.equal(resolve("season:3", 1).rule, null);

const overlapping = sandbox.api.normalizeCollectionMappings({
  [bvid]: [
    { seasonKey: "default", sourceStart: 1, sourceEnd: 5, targetStart: 1, subjectId: 1 },
    { seasonKey: "default", sourceStart: 5, sourceEnd: 9, targetStart: 1, subjectId: 2 },
  ],
});
sandbox.state.collectionMappings = overlapping;
assert.equal(sandbox.api.getCollectionMappingResolution({ bvid, seasonKey: "default", episodeNo: 5 }).ambiguous, true);
assert.equal(sandbox.api.getCollectionMappingResolution({ bvid, seasonKey: "default", episodeNo: 5 }).rule, null);

(async () => {
  let currentContext = {
    bvid, seasonKey: "default", episodeNo: 1, groupStart: 1, groupEnd: 23,
    segmentCount: 2, fragmentIndex: 1,
  };
  sandbox.getCurrentCollectionPartContext = () => currentContext;
  sandbox.getSubjectDeclaredTotalEpisodeCountForMapping = async () => sandbox.declaredTotalEpisodes;
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 11;
  sandbox.getSubjectMainEpisodeInfoForMapping = async (subjectId, inspectEpisodeZero) => ({
    episodeCount: await sandbox.getSubjectMainEpisodeCountForMapping(subjectId),
    hasEpisodeZero: Boolean(inspectEpisodeZero && sandbox.apiEpisodeZero),
  });
  sandbox.state.collectionMappings = {};
  currentContext = { ...plainFiveEpisodeContext };
  sandbox.declaredTotalEpisodes = 13;
  assert.equal(await sandbox.api.buildCollectionRangeBindingProposal(622633), null,
    "the live five-of-thirteen shape never proposes P4-P5 as Bangumi episodes 1-2");
  sandbox.declaredTotalEpisodes = 0;
  assert.equal(await sandbox.api.buildCollectionRangeBindingProposal(622633), null,
    "a subject without total_episodes never enters range mapping");
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 1, groupStart: 1, groupEnd: 23,
    segmentCount: 2, fragmentIndex: 1,
  };
  sandbox.declaredTotalEpisodes = 11;
  let proposal = await sandbox.api.buildCollectionRangeBindingProposal(1001);
  assert.deepEqual(plain(proposal.rule), {
    bvid, id: "default:1-11", seasonKey: "default", sourceStart: 1, sourceEnd: 11,
    targetStart: 1, subjectId: 1001, targetEpisodeZero: false, segmentCount: 2, autoProgress: true,
  });

  sandbox.state.collectionMappings = {
    [bvid]: [{
      id: "default:1-11", seasonKey: "default", sourceStart: 1, sourceEnd: 11,
      targetStart: 1, subjectId: 1001, segmentCount: 2, autoProgress: true,
    }],
  };
  currentContext = { ...currentContext, episodeNo: 12 };
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 12;
  sandbox.declaredTotalEpisodes = 12;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(1002);
  assert.equal(proposal.rule.sourceStart, 12);
  assert.equal(proposal.rule.sourceEnd, 23);
  assert.equal(proposal.rule.targetStart, 1);

  // Source episode 0 defaults to the first Bangumi main episode and shifts later labels by one.
  sandbox.state.collectionMappings = {};
  currentContext = {
    bvid, seasonKey: "season:2", episodeNo: 0, groupStart: 0, groupEnd: 24,
    segmentCount: 1, fragmentIndex: 1,
  };
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 13;
  sandbox.declaredTotalEpisodes = 13;
  sandbox.apiEpisodeZero = false;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(373247);
  assert.equal(proposal.rule.sourceStart, 0);
  assert.equal(proposal.rule.sourceEnd, 12);
  assert.equal(proposal.rule.targetStart, 1);
  assert.equal(proposal.rule.targetEpisodeZero, false);
  assert.equal(sandbox.api.getCollectionMappedEpisodeNo({ ...currentContext, episodeNo: 0 }, proposal.rule), 1);
  assert.equal(sandbox.api.getCollectionMappedEpisodeNo({ ...currentContext, episodeNo: 1 }, proposal.rule), 2);
  assert.equal(sandbox.api.formatCollectionTargetRange(proposal.rule), "Bangumi 第1-13集");
  assert.equal(sandbox.api.formatCollectionTargetEpisodeLabel(1, proposal.rule), "Bangumi 第 1 集");

  // Bangumi subject 373247 is a real API shape: type=0 contains sort=0 while ep remains 1.
  sandbox.apiEpisodeZero = true;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(373247);
  assert.equal(proposal.rule.sourceStart, 0);
  assert.equal(proposal.rule.sourceEnd, 12);
  assert.equal(proposal.rule.targetStart, 1, "targetStart is the local main-episode ordinal");
  assert.equal(proposal.rule.targetEpisodeZero, true, "sort=0 metadata preserves the real EP0 label");
  assert.equal(sandbox.api.getCollectionMappedEpisodeNo({ ...currentContext, episodeNo: 0 }, proposal.rule), 1);
  assert.equal(sandbox.api.getCollectionMappedEpisodeNo({ ...currentContext, episodeNo: 1 }, proposal.rule), 2);
  assert.equal(sandbox.api.formatCollectionTargetRange(proposal.rule), "Bangumi EP0-EP12");
  assert.equal(sandbox.api.formatCollectionTargetEpisodeLabel(1, proposal.rule), "Bangumi EP0");

  sandbox.state.collectionMappings = {
    [bvid]: [{
      id: "season:3:1-4", seasonKey: "season:3", sourceStart: 1, sourceEnd: 4,
      targetStart: 1, subjectId: 3001, segmentCount: 1, autoProgress: true,
    }],
  };
  currentContext = {
    bvid, seasonKey: "season:3", episodeNo: 5, groupStart: 1, groupEnd: 8,
    segmentCount: 1, fragmentIndex: 1,
  };
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 12;
  sandbox.declaredTotalEpisodes = 12;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(3001);
  assert.equal(proposal, null, "an unfinished season never extends a range mapping");

  // Mid-range rebind must replace the covering rule wholesale, not orphan 1..N-1.
  sandbox.state.collectionMappings = {
    [bvid]: [{
      id: "default:1-11", seasonKey: "default", sourceStart: 1, sourceEnd: 11,
      targetStart: 1, subjectId: 1001, segmentCount: 2, autoProgress: true,
    }],
  };
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 5, groupStart: 1, groupEnd: 23,
    segmentCount: 2, fragmentIndex: 1,
  };
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 11;
  sandbox.declaredTotalEpisodes = 11;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(9001);
  assert.equal(proposal.rule.sourceStart, 1, "covering rule rebind keeps the original range start");
  assert.equal(proposal.rule.sourceEnd, 11);
  assert.equal(proposal.rule.targetStart, 1);
  assert.equal(proposal.replacesRule.sourceStart, 1);
  assert.equal(proposal.replacesRule.sourceEnd, 11);
  const remapped = {};
  sandbox.api.putCollectionMappingRule(remapped, { ...proposal.rule, bvid });
  assert.equal(remapped[bvid].length, 1);
  assert.equal(remapped[bvid][0].subjectId, 9001);
  assert.equal(remapped[bvid][0].sourceStart, 1);
  assert.equal(remapped[bvid][0].sourceEnd, 11);

  const progress = {};
  const splitRule = {
    id: "default:1-11", seasonKey: "default", sourceStart: 1, sourceEnd: 11,
    targetStart: 1, subjectId: 1001, segmentCount: 2, autoProgress: true,
  };
  sandbox.getCollectionMappingRule = () => splitRule;
  sandbox.getCollectionMappingRules = () => [splitRule];
  sandbox.updateStoredCollectionSegmentProgress = async (update) => update(progress);
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 1, segmentCount: 2, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  currentContext = { ...currentContext, fragmentIndex: 2 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true);

  // Hierarchical 1.1.1 / 1.1.2 / 1.1.3: three segments accumulate before complete.
  const threeSegRule = {
    id: "season:1:1-12", seasonKey: "season:1", sourceStart: 1, sourceEnd: 12,
    targetStart: 1, subjectId: 2001, segmentCount: 3, autoProgress: true,
  };
  sandbox.getCollectionMappingRule = () => threeSegRule;
  sandbox.getCollectionMappingRules = () => [threeSegRule];
  currentContext = {
    bvid, seasonKey: "season:1", episodeNo: 1, segmentCount: 3, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "1.1.1 alone must not complete a three-segment episode");
  currentContext = { ...currentContext, fragmentIndex: 2 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "1.1.1+1.1.2 still incomplete without 1.1.3");
  const threeSegKey = sandbox.api.getCollectionSegmentProgressKey(currentContext, threeSegRule);
  assert.deepEqual(plain(progress[threeSegKey].completed), [1, 2]);
  currentContext = { ...currentContext, fragmentIndex: 3 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "1.1.1+1.1.2+1.1.3 completes only after the third segment");
  assert.deepEqual(plain(progress[threeSegKey].completed), [1, 2, 3]);

  // Mixed per-episode segment counts: ep1 needs 3 parts, ep2 needs 2, independently.
  const mixedRule = {
    id: "default:1-8", seasonKey: "default", sourceStart: 1, sourceEnd: 8,
    targetStart: 1, subjectId: 3001, segmentCount: 3, autoProgress: true,
  };
  sandbox.getCollectionMappingRule = () => mixedRule;
  sandbox.getCollectionMappingRules = () => [mixedRule];
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 1, segmentCount: 3, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  currentContext = { ...currentContext, fragmentIndex: 2 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  currentContext = { ...currentContext, fragmentIndex: 3 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "episode 1 with three uploaded parts completes after 1+2+3");
  const ep1Key = sandbox.api.getCollectionSegmentProgressKey(
    { bvid, seasonKey: "default", episodeNo: 1 },
    mixedRule,
  );
  assert.deepEqual(plain(progress[ep1Key].completed), [1, 2, 3]);

  currentContext = {
    bvid, seasonKey: "default", episodeNo: 2, segmentCount: 2, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "episode 2 progress is independent of episode 1");
  currentContext = { ...currentContext, fragmentIndex: 2 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "episode 2 with only two uploaded parts completes after 1+2 without waiting for a third");
  const ep2Key = sandbox.api.getCollectionSegmentProgressKey(
    { bvid, seasonKey: "default", episodeNo: 2 },
    mixedRule,
  );
  assert.deepEqual(plain(progress[ep2Key].completed), [1, 2]);
  assert.deepEqual(plain(progress[ep1Key].completed), [1, 2, 3], "episode 1 progress stays isolated");

  // Missing middle segment (.1 and .3 without .2): never auto-complete.
  const gapRule = {
    id: "default:1-6", seasonKey: "default", sourceStart: 1, sourceEnd: 6,
    targetStart: 1, subjectId: 4001, segmentCount: 3, autoProgress: true,
  };
  sandbox.getCollectionMappingRule = () => gapRule;
  sandbox.getCollectionMappingRules = () => [gapRule];
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 4, segmentCount: 2, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  // Live list only has fragments 1 and 3 → size 2, but completion still requires contiguous 1..N.
  // Recording fragment 3 with segmentCount 2 can never satisfy [1,2].
  currentContext = { ...currentContext, fragmentIndex: 3 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "watching .1 and .3 without .2 must stay incomplete (fail closed)");
  const gapKey = sandbox.api.getCollectionSegmentProgressKey(
    { bvid, seasonKey: "default", episodeNo: 4 },
    gapRule,
  );
  assert.deepEqual(plain(progress[gapKey].completed), [1, 3]);
  assert.equal(plain(progress[gapKey].completed).includes(2), false);

  // With declared three-slot completion, gaps are also fail-closed.
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 5, segmentCount: 3, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  currentContext = { ...currentContext, fragmentIndex: 3 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "1+3 without 2 never reaches three-segment completion");
  currentContext = { ...currentContext, fragmentIndex: 2 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "only filling the missing middle finally completes");

  // Incomplete splits: only fragment 1 exists → segmentCount 1 → single watch completes.
  progress["solo"] = undefined;
  sandbox.getCollectionMappingRule = () => splitRule;
  sandbox.getCollectionMappingRules = () => [splitRule];
  sandbox.getCollectionSegmentProgressKey = () => "solo-key";
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 2, segmentCount: 1, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "actual single-part episodes must auto-mark without waiting for a missing .2");
  sandbox.getCollectionSegmentProgressKey = sandbox.api.getCollectionSegmentProgressKey;

  // Collection-shaped uploads require an explicit range mapping before auto-mark.
  sandbox.getCollectionMappingRule = () => null;
  sandbox.getCollectionMappingRules = () => [];
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 1, segmentCount: 2, fragmentIndex: 1,
  };
  assert.equal(sandbox.api.isCurrentCollectionPartAutoMarkEligible(), false);
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "collection-shaped multi-P without rules must fail closed");

  // Other ranges already mapped, current part unmapped → block.
  sandbox.getCollectionMappingRules = () => [splitRule];
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);

  const nodes = [
    { title: "1.1", active: true },
    { title: "1.2", active: false },
  ];
  const routeSandbox = {
    getBvIdFromUrl: () => bvid,
    getVideoPartListNodes: () => nodes,
    isActiveVideoPartNode: (node) => node.active,
    getCurrentPartNoFromUrl: () => 2,
    getVideoPartNodeTitle: (node) => node && node.title || "",
    parseLongVideoPartTitle: () => null,
  };
  runInSandbox(`${functionSource("getCurrentVideoPartContext")};globalThis.readPart = getCurrentVideoPartContext;`, routeSandbox);
  const part = routeSandbox.readPart();
  assert.equal(part.partNo, 2);
  assert.equal(part.title, "1.2", "the URL p parameter must win while the active DOM item is stale");

  const collectionTitles = [];
  for (let episode = 1; episode <= 23; episode += 1) {
    collectionTitles.push(`${episode}.1`, `${episode}.2`);
  }
  for (let episode = 0; episode <= 24; episode += 1) collectionTitles.push(`第二季${episode}`);
  for (let episode = 1; episode <= 4; episode += 1) collectionTitles.push(`第三季${episode}`);
  collectionTitles.push("点点关注不迷路");
  let collectionTitleReadCount = 0;
  const collectionNodes = collectionTitles.map((title, index) => ({
    className: index === 0 ? "active" : "",
    textContent: title,
    getAttribute: (name) => {
      collectionTitleReadCount += 1;
      return name === "title" ? title : "";
    },
    querySelectorAll: () => [],
  }));
  let currentPartNo = 1;
  const collectionDomSandbox = {
    ...collectionConstants,
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === ".multi-p .page-list .page-item" ? collectionNodes : [],
    },
    getBvIdFromUrl: () => bvid,
    getCurrentPartNoFromUrl: () => currentPartNo,
    stripTrailingDurationText: sandbox.stripTrailingDurationText,
  };
  runInSandbox([
    functionSource("parseChineseNumber"),
    functionSource("parseCollectionFragment"),
    functionSource("parseCollectionPartTitle"),
    functionSource("parseBareCollectionEpisodeTitle"),
    functionSource("parseLongVideoPartTitle"),
    functionSource("getVideoPartListNodes"),
    functionSource("isActiveVideoPartNode"),
    functionSource("getVideoPartNodeTitle"),
    functionSource("getCurrentVideoPartContext"),
    functionSource("getCollectionPartRows"),
    functionSource("getQualifiedCollectionPartRows"),
    functionSource("getCurrentCollectionLayoutContext"),
    functionSource("getCurrentCollectionPartContext"),
  ].join("\n") + ";globalThis.readCollectionContext = getCurrentCollectionPartContext;", collectionDomSandbox);
  let liveContext = collectionDomSandbox.readCollectionContext();
  const readsAfterInitialParse = collectionTitleReadCount;
  assert.equal(collectionNodes.length, 76);
  assert.equal(liveContext.episodeNo, 1);
  assert.equal(liveContext.segmentCount, 2);
  assert.equal(liveContext.groupEnd, 23);
  assert.equal(liveContext.parsedPartCount, 75);
  currentPartNo = 47;
  liveContext = collectionDomSandbox.readCollectionContext();
  assert.equal(collectionTitleReadCount - readsAfterInitialParse, 2,
    "short-lived row cache reads only the selected title instead of reparsing all 76 titles");
  assert.equal(liveContext.episodeNo, 0);
  assert.equal(liveContext.seasonKey, "season:2");
  assert.equal(liveContext.groupEnd, 24);
  currentPartNo = 72;
  liveContext = collectionDomSandbox.readCollectionContext();
  assert.equal(liveContext.seasonKey, "season:3");
  assert.equal(liveContext.episodeNo, 1);
  assert.equal(liveContext.groupEnd, 4);

  // Re:Zero-style lists use only "01", "02", ... labels. A contiguous run of
  // at least four plain numeric parts is collection-shaped, but shorter or
  // discontinuous numeric multi-P lists stay out of the mapping flow.
  function readBareNumericContext(titles, activeIndex = 0) {
    const numericNodes = titles.map((title, index) => ({
      className: index === activeIndex ? "page-item active" : "page-item",
      textContent: title,
      getAttribute: (name) => name === "title" ? title : "",
      querySelectorAll: () => [],
    }));
    const numericSandbox = {
      ...collectionConstants,
      document: {
        querySelector: () => null,
        querySelectorAll: (selector) => selector === ".multi-p .page-list .page-item" ? numericNodes : [],
      },
      getBvIdFromUrl: () => bvid,
      getCurrentPartNoFromUrl: () => activeIndex + 1,
      stripTrailingDurationText: sandbox.stripTrailingDurationText,
    };
    runInSandbox([
      functionSource("parseChineseNumber"),
      functionSource("parseCollectionFragment"),
      functionSource("parseCollectionPartTitle"),
      functionSource("parseBareCollectionEpisodeTitle"),
      functionSource("parseLongVideoPartTitle"),
      functionSource("getVideoPartListNodes"),
      functionSource("isActiveVideoPartNode"),
      functionSource("getVideoPartNodeTitle"),
      functionSource("getCurrentVideoPartContext"),
      functionSource("getCollectionPartRows"),
      functionSource("getQualifiedCollectionPartRows"),
      functionSource("getCurrentCollectionLayoutContext"),
      functionSource("getCurrentCollectionPartContext"),
    ].join("\n") + ";globalThis.readCollectionContext = getCurrentCollectionPartContext;", numericSandbox);
    return plain(numericSandbox.readCollectionContext());
  }

  const plainNumericContext = readBareNumericContext(
    Array.from({ length: 16 }, (_, index) => `${String(index + 1).padStart(2, "0")} ${index ? "29:59" : "02:06:56"}`),
  );
  assert.equal(plainNumericContext.episodeNo, 1);
  assert.equal(plainNumericContext.groupStart, 1);
  assert.equal(plainNumericContext.groupEnd, 16);
  assert.equal(plainNumericContext.parsedPartCount, 16);
  sandbox.state.collectionMappings = {};
  currentContext = plainNumericContext;
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 8;
  sandbox.declaredTotalEpisodes = 8;
  sandbox.apiEpisodeZero = false;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(425998);
  assert.equal(proposal.rule.sourceStart, 1);
  assert.equal(proposal.rule.sourceEnd, 8,
    "a 16P numeric collection bound to an 8-episode subject proposes the first 1-8 batch");
  const parenthesizedContext = readBareNumericContext(
    Array.from({ length: 51 }, (_, index) => `(${index + 1}) 32:43`),
    12,
  );
  assert.equal(parenthesizedContext.episodeNo, 13);
  assert.equal(parenthesizedContext.groupStart, 1);
  assert.equal(parenthesizedContext.groupEnd, 51);
  assert.equal(parenthesizedContext.parsedPartCount, 51);
  sandbox.state.collectionMappings = {};
  currentContext = parenthesizedContext;
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 12;
  sandbox.declaredTotalEpisodes = 12;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(338424);
  assert.equal(proposal.rule.sourceStart, 13);
  assert.equal(proposal.rule.sourceEnd, 24,
    "P13 in a 51-part parenthesized list starts the next 12-episode batch");
  assert.equal(readBareNumericContext(["01", "02", "03"]), null,
    "three plain numeric parts are too ambiguous to be a collection");
  assert.equal(readBareNumericContext(["01", "02", "04", "05"]), null,
    "four discontinuous numeric labels must not trigger range binding");

  // Incomplete decimal split list: only "2.1" for episode 2 → segmentCount is 1, not 2.
  const incompleteTitles = ["1.1", "1.2", "2.1", "3.1", "3.2"];
  const incompleteNodes = incompleteTitles.map((title, index) => ({
    className: index === 2 ? "active" : "",
    textContent: title,
    getAttribute: (name) => name === "title" ? title : "",
    querySelectorAll: () => [],
  }));
  const incompleteSandbox = {
    ...collectionConstants,
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === ".multi-p .page-list .page-item" ? incompleteNodes : [],
    },
    getBvIdFromUrl: () => bvid,
    getCurrentPartNoFromUrl: () => 3,
    stripTrailingDurationText: sandbox.stripTrailingDurationText,
  };
  runInSandbox([
    functionSource("parseChineseNumber"),
    functionSource("parseCollectionFragment"),
    functionSource("parseCollectionPartTitle"),
    functionSource("parseBareCollectionEpisodeTitle"),
    functionSource("parseLongVideoPartTitle"),
    functionSource("getVideoPartListNodes"),
    functionSource("isActiveVideoPartNode"),
    functionSource("getVideoPartNodeTitle"),
    functionSource("getCurrentVideoPartContext"),
    functionSource("getCollectionPartRows"),
    functionSource("getQualifiedCollectionPartRows"),
    functionSource("getCurrentCollectionLayoutContext"),
    functionSource("getCurrentCollectionPartContext"),
  ].join("\n") + ";globalThis.readCollectionContext = getCurrentCollectionPartContext;", incompleteSandbox);
  const incompleteContext = incompleteSandbox.readCollectionContext();
  assert.equal(incompleteContext.episodeNo, 2);
  assert.equal(incompleteContext.segmentCount, 1, "missing .2 must not invent a second required segment");

  function readSplitContext(titles, partNo) {
    const splitNodes = titles.map((title, index) => ({
      className: index === partNo - 1 ? "page-item active" : "page-item",
      textContent: title,
      getAttribute: (name) => name === "title" ? title : "",
      querySelectorAll: () => [],
    }));
    const splitSandbox = {
      ...collectionConstants,
      document: {
        querySelector: () => null,
        querySelectorAll: (selector) => selector === ".multi-p .page-list .page-item" ? splitNodes : [],
      },
      getBvIdFromUrl: () => bvid,
      getCurrentPartNoFromUrl: () => partNo,
      stripTrailingDurationText: sandbox.stripTrailingDurationText,
    };
    runInSandbox([
      functionSource("parseChineseNumber"),
      functionSource("parseCollectionFragment"),
      functionSource("parseCollectionPartTitle"),
      functionSource("parseBareCollectionEpisodeTitle"),
      functionSource("parseLongVideoPartTitle"),
      functionSource("getVideoPartListNodes"),
      functionSource("isActiveVideoPartNode"),
      functionSource("getVideoPartNodeTitle"),
      functionSource("getCurrentVideoPartContext"),
      functionSource("getCollectionPartRows"),
      functionSource("getQualifiedCollectionPartRows"),
      functionSource("getCurrentCollectionLayoutContext"),
      functionSource("getCurrentCollectionPartContext"),
    ].join("\n") + `
;globalThis.readCollectionContext = getCurrentCollectionPartContext;
globalThis.readLayout = getCurrentCollectionLayoutContext;`, splitSandbox);
    return {
      context: plain(splitSandbox.readCollectionContext()),
      layout: plain(splitSandbox.readLayout()),
    };
  }

  // Hierarchical 1.x.1/1.x.2/1.x.3: each episode exposes three contiguous segments.
  const hierarchicalThreeTitles = [];
  for (let episode = 1; episode <= 4; episode += 1) {
    hierarchicalThreeTitles.push(`1.${episode}.1`, `1.${episode}.2`, `1.${episode}.3`);
  }
  const hierarchicalEp1Part1 = readSplitContext(hierarchicalThreeTitles, 1);
  assert.equal(hierarchicalEp1Part1.context.seasonKey, "season:1");
  assert.equal(hierarchicalEp1Part1.context.episodeNo, 1);
  assert.equal(hierarchicalEp1Part1.context.fragmentIndex, 1);
  assert.equal(hierarchicalEp1Part1.context.segmentCount, 3, "1.1.1/1.1.2/1.1.3 yield three live segments");
  const hierarchicalEp1Part3 = readSplitContext(hierarchicalThreeTitles, 3);
  assert.equal(hierarchicalEp1Part3.context.episodeNo, 1);
  assert.equal(hierarchicalEp1Part3.context.fragmentIndex, 3);
  assert.equal(hierarchicalEp1Part3.context.segmentCount, 3);
  const hierarchicalEp2Part2 = readSplitContext(hierarchicalThreeTitles, 5);
  assert.equal(hierarchicalEp2Part2.context.episodeNo, 2);
  assert.equal(hierarchicalEp2Part2.context.fragmentIndex, 2);
  assert.equal(hierarchicalEp2Part2.context.segmentCount, 3);

  // Mixed live segment counts across episodes (decimal splits).
  const mixedSegmentTitles = [
    "1.1", "1.2", "1.3",
    "2.1", "2.2",
    "3.1", "3.2", "3.3",
    "4.1", "4.2",
  ];
  const mixedEp1 = readSplitContext(mixedSegmentTitles, 1);
  assert.equal(mixedEp1.context.episodeNo, 1);
  assert.equal(mixedEp1.context.segmentCount, 3, "episode 1 has three uploaded parts");
  assert.equal(mixedEp1.context.fragmentIndex, 1);
  const mixedEp1Last = readSplitContext(mixedSegmentTitles, 3);
  assert.equal(mixedEp1Last.context.episodeNo, 1);
  assert.equal(mixedEp1Last.context.fragmentIndex, 3);
  assert.equal(mixedEp1Last.context.segmentCount, 3);
  const mixedEp2 = readSplitContext(mixedSegmentTitles, 4);
  assert.equal(mixedEp2.context.episodeNo, 2);
  assert.equal(mixedEp2.context.segmentCount, 2, "episode 2 has only two uploaded parts");
  assert.equal(mixedEp2.context.fragmentIndex, 1);
  const mixedEp2Last = readSplitContext(mixedSegmentTitles, 5);
  assert.equal(mixedEp2Last.context.fragmentIndex, 2);
  assert.equal(mixedEp2Last.context.segmentCount, 2);
  const mixedEp3 = readSplitContext(mixedSegmentTitles, 6);
  assert.equal(mixedEp3.context.episodeNo, 3);
  assert.equal(mixedEp3.context.segmentCount, 3, "episode 3 again has three parts independent of episode 2");

  // Hierarchical mixed segment counts: ep1 three parts, ep2 two parts.
  const hierarchicalMixedTitles = [
    "1.1.1", "1.1.2", "1.1.3",
    "1.2.1", "1.2.2",
    "1.3.1", "1.3.2", "1.3.3",
    "1.4.1", "1.4.2",
  ];
  const hierarchicalMixedEp1 = readSplitContext(hierarchicalMixedTitles, 1);
  assert.equal(hierarchicalMixedEp1.context.episodeNo, 1);
  assert.equal(hierarchicalMixedEp1.context.segmentCount, 3,
    "hierarchical episode 1 keeps three live segments when later episodes have two");
  const hierarchicalMixedEp2 = readSplitContext(hierarchicalMixedTitles, 4);
  assert.equal(hierarchicalMixedEp2.context.episodeNo, 2);
  assert.equal(hierarchicalMixedEp2.context.segmentCount, 2,
    "hierarchical episode 2 completes with its own two segments");

  // Live progress through mixed DOM contexts uses each episode's actual segmentCount.
  const mixedDomProgress = {};
  sandbox.updateStoredCollectionSegmentProgress = async (update) => update(mixedDomProgress);
  sandbox.getCollectionMappingRule = () => mixedRule;
  sandbox.getCollectionMappingRules = () => [mixedRule];
  sandbox.getCurrentCollectionPartContext = () => mixedEp1.context;
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  sandbox.getCurrentCollectionPartContext = () => ({ ...mixedEp1Last.context, fragmentIndex: 2 });
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  sandbox.getCurrentCollectionPartContext = () => mixedEp1Last.context;
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "DOM-derived three-segment episode 1 completes after all three parts");
  sandbox.getCurrentCollectionPartContext = () => mixedEp2.context;
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  sandbox.getCurrentCollectionPartContext = () => mixedEp2Last.context;
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "DOM-derived two-segment episode 2 completes without a third part");

  // Missing middle hierarchical fragments fail closed (group not qualified).
  const hierarchicalGapTitles = [
    "1.1.1", "1.1.3",
    "1.2.1", "1.2.2", "1.2.3",
    "1.3.1", "1.3.2", "1.3.3",
    "1.4.1", "1.4.2", "1.4.3",
  ];
  const hierarchicalGap = readSplitContext(hierarchicalGapTitles, 1);
  assert.equal(hierarchicalGap.context, null,
    "hierarchical list missing 1.1.2 must not qualify as a collection episode");
  assert.ok(
    hierarchicalGap.layout == null || hierarchicalGap.layout.currentKind === "unmapped",
    "missing middle hierarchical segment is fail-closed (no episode context)",
  );

  // Missing middle decimal fragments: context may still form, but auto-mark never completes.
  const decimalGapTitles = [
    "1.1", "1.3",
    "2.1", "2.2",
    "3.1", "3.2",
    "4.1", "4.2",
  ];
  const decimalGapFirst = readSplitContext(decimalGapTitles, 1);
  assert.equal(decimalGapFirst.context.episodeNo, 1);
  assert.equal(decimalGapFirst.context.fragmentIndex, 1);
  assert.equal(decimalGapFirst.context.segmentCount, 2,
    "live fragment set size is 2 when only .1 and .3 exist");
  const decimalGapThird = readSplitContext(decimalGapTitles, 2);
  assert.equal(decimalGapThird.context.episodeNo, 1);
  assert.equal(decimalGapThird.context.fragmentIndex, 3);
  assert.equal(decimalGapThird.context.segmentCount, 2);
  const gapProgress = {};
  sandbox.updateStoredCollectionSegmentProgress = async (update) => update(gapProgress);
  sandbox.getCollectionMappingRule = () => gapRule;
  sandbox.getCollectionMappingRules = () => [gapRule];
  sandbox.getCurrentCollectionPartContext = () => decimalGapFirst.context;
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  sandbox.getCurrentCollectionPartContext = () => decimalGapThird.context;
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false,
    "DOM .1+.3 without .2 never reaches contiguous segment completion");
  const decimalGapKey = sandbox.api.getCollectionSegmentProgressKey(decimalGapFirst.context, gapRule);
  assert.deepEqual(plain(gapProgress[decimalGapKey].completed), [1, 3]);
  assert.equal(
    plain(gapProgress[decimalGapKey].completed).includes(2),
    false,
    "missing middle fragment index 2 is never recorded from the live list",
  );

  // Restore shared sandbox hooks used by later hybrid / eligibility tests.
  currentContext = null;
  sandbox.getCurrentCollectionPartContext = () => currentContext;
  sandbox.getCurrentCollectionLayoutContext = () => null;
  sandbox.updateStoredCollectionSegmentProgress = async (update) => update(progress);
  sandbox.getCollectionMappingRule = () => null;
  sandbox.getCollectionMappingRules = () => [];

  const hybridTitles = [];
  for (let episode = 1; episode <= 24; episode += 1) {
    hybridTitles.push(`1.${episode}.1`, `1.${episode}.2`);
  }
  hybridTitles.push("第二季1-12", "第二季13-24", "谢谢观看，点点关注不迷路");
  const hybridNodes = hybridTitles.map((title, index) => ({
    className: index === 0 ? "page-item active" : "page-item",
    textContent: title,
    getAttribute: (name) => name === "title" ? title : "",
    querySelectorAll: () => [],
  }));
  let hybridPartNo = 2;
  const hybridSandbox = {
    ...collectionConstants,
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === ".multi-p .page-list .page-item" ? hybridNodes : [],
    },
    getBvIdFromUrl: () => "BV1V4XFBWEGT",
    getCurrentPartNoFromUrl: () => hybridPartNo,
    stripTrailingDurationText: sandbox.stripTrailingDurationText,
  };
  runInSandbox([
    functionSource("parseChineseNumber"),
    functionSource("parseCollectionFragment"),
    functionSource("parseCollectionPartTitle"),
    functionSource("parseBareCollectionEpisodeTitle"),
    functionSource("parseLongVideoPartTitle"),
    functionSource("getVideoPartListNodes"),
    functionSource("isActiveVideoPartNode"),
    functionSource("getVideoPartNodeTitle"),
    functionSource("getCurrentVideoPartContext"),
    functionSource("getCollectionPartRows"),
    functionSource("getQualifiedCollectionPartRows"),
    functionSource("getCurrentCollectionLayoutContext"),
    functionSource("getCurrentCollectionPartContext"),
  ].join("\n") + `
;globalThis.readHybridLayout = getCurrentCollectionLayoutContext;
globalThis.readHybridContext = getCurrentCollectionPartContext;`, hybridSandbox);
  let hybridContext = hybridSandbox.readHybridContext();
  assert.equal(hybridNodes.length, 51);
  assert.equal(hybridContext.seasonKey, "season:1");
  assert.equal(hybridContext.episodeNo, 1);
  assert.equal(hybridContext.fragmentIndex, 2);
  assert.equal(hybridContext.segmentCount, 2);
  assert.equal(hybridContext.groupEnd, 24);
  assert.equal(hybridContext.parsedPartCount, 48);
  hybridPartNo = 49;
  let hybridLayout = hybridSandbox.readHybridLayout();
  assert.equal(hybridSandbox.readHybridContext(), null);
  assert.equal(hybridLayout.currentKind, "long-range");
  assert.equal(hybridLayout.currentLongVideo.seasonNo, 2);
  assert.equal(hybridLayout.currentLongVideo.episodeStart, 1);
  assert.equal(hybridLayout.currentLongVideo.episodeEnd, 12);
  hybridPartNo = 50;
  hybridLayout = hybridSandbox.readHybridLayout();
  assert.equal(hybridLayout.currentKind, "long-range");
  assert.equal(hybridLayout.currentLongVideo.episodeStart, 13);
  assert.equal(hybridLayout.currentLongVideo.episodeEnd, 24);
  hybridPartNo = 51;
  hybridLayout = hybridSandbox.readHybridLayout();
  assert.equal(hybridLayout.currentKind, "unmapped");
  assert.equal(hybridSandbox.readHybridContext(), null);
  currentContext = null;
  sandbox.getCurrentCollectionLayoutContext = () => ({ currentKind: "unmapped" });
  assert.equal(sandbox.api.isCurrentCollectionPartAutoMarkEligible(), false,
    "an unrecognized tail item in a confirmed collection must never auto-mark progress");
  sandbox.getCurrentCollectionLayoutContext = () => ({ currentKind: "long-range" });
  sandbox.getLongVideoEpisodeModeDecision = () => null;
  sandbox.state.longVideoEpisodeGuess = null;
  assert.equal(sandbox.api.isCurrentCollectionPartAutoMarkEligible(), false,
    "hybrid long-range parts must not auto-mark without long-video mode");
  sandbox.getLongVideoEpisodeModeDecision = () => true;
  sandbox.state.longVideoEpisodeGuess = { active: true, episode: { id: 1 }, autoMarkSafe: false };
  assert.equal(sandbox.api.isCurrentCollectionPartAutoMarkEligible(), false,
    "hybrid long-range parts with unsafe long-video guesses must not auto-mark");
  sandbox.state.longVideoEpisodeGuess = { active: true, episode: { id: 1 }, autoMarkSafe: true };
  assert.equal(sandbox.api.isCurrentCollectionPartAutoMarkEligible(), true,
    "hybrid long-range parts may auto-mark only with safe long-video inference");
  sandbox.getCurrentCollectionLayoutContext = () => null;
  sandbox.getLongVideoEpisodeModeDecision = () => null;
  sandbox.state.longVideoEpisodeGuess = null;

  assert.equal(readBareNumericContext(["1.2.3", "2.4.6", "3.6.7", "4.8.1"]), null,
    "isolated dotted version-like labels must not qualify without a complete hierarchical sequence");

  const failClosedSandbox = {
    getCurrentCollectionPartContext: () => ({ bvid, episodeNo: 1 }),
    isCurrentOrdinaryEpisodeCollection: () => false,
    getCollectionMappingRule: () => null,
    getCurrentCollectionLayoutContext: () => null,
    detectEpisodeNo: () => { throw new Error("legacy title fallback must not run"); },
  };
  runInSandbox(
    `${functionSource("detectCurrentEpisodeNo")};globalThis.readEpisode = detectCurrentEpisodeNo;`,
    failClosedSandbox,
  );
  assert.equal(failClosedSandbox.readEpisode("1.2"), null, "no-rule collection does not reinterpret 1.2 as episode 1");

  const residualSandbox = {
    getCurrentCollectionPartContext: () => null,
    getCurrentCollectionLayoutContext: () => ({ currentKind: "long-range" }),
    getOfficialBangumiProgressEpisodeNo: () => {
      throw new Error("long-range residual detection must not fall through to official progress");
    },
    detectEpisodeNo: () => 9,
  };
  runInSandbox(
    `${functionSource("detectCurrentEpisodeNo")};globalThis.readEpisode = detectCurrentEpisodeNo;`,
    residualSandbox,
  );
  assert.equal(residualSandbox.readEpisode("第一季09-16"), null,
    "long-range parts must clear residual single-episode recognition");

  const prompt = sandbox.api.formatCollectionRangeBindingPrompt({
    rule: {
      bvid, id: "default:1-2", seasonKey: "default", sourceStart: 1, sourceEnd: 2,
      targetStart: 1, subjectId: 1001, segmentCount: 2, autoProgress: true,
    },
    replacesRule: null,
  }, 1001);
  assert.match(prompt, /当前集检测到 2 段/, "split confirm copy refers to the current episode only");
  assert.doesNotMatch(prompt, /每集 2 段/);

  let storedProgress = {
    [`${bvid}|default:1-11|1001|1`]: { completed: [1], updatedAt: Date.now() },
    [`${bvid}|default:1-11|1001|2`]: { completed: [1, 2], updatedAt: Date.now() },
    [`${bvid}|default:12-23|1002|1`]: { completed: [1], updatedAt: Date.now() },
    ["BVOTHER|default:1-11|1001|1"]: { completed: [1], updatedAt: Date.now() },
  };
  sandbox.updateStoredCollectionSegmentProgress = async (mutator) => {
    const changed = mutator(storedProgress) !== false;
    return changed;
  };
  await sandbox.api.clearCollectionSegmentProgressForRule(bvid, "default:1-11");
  assert.equal(storedProgress[`${bvid}|default:1-11|1001|1`], undefined);
  assert.equal(storedProgress[`${bvid}|default:1-11|1001|2`], undefined);
  assert.ok(storedProgress[`${bvid}|default:12-23|1002|1`], "other rules on the same BV stay");
  assert.ok(storedProgress["BVOTHER|default:1-11|1001|1"], "same rule id on another BV stays");

  const episodeInfoSandbox = {
    state: { subjectId: null },
    getNormalEpisodes: () => [],
    getSubjectMainEpisodeCountForMapping: async () => 13,
    bgmRequestPagedData: async (path, options) => {
      assert.match(path, /subject_id=373247&type=0/);
      assert.equal(options.pageSize, 200);
      return {
        total: 13,
        data: [
          { id: 1212094, type: 0, sort: 0, ep: 1, name: "守護術師フィッツ" },
          { id: 1212095, type: 0, sort: 1, ep: 2 },
        ],
      };
    },
  };
  runInSandbox(
    `${functionSource("getSubjectMainEpisodeInfoForMapping", true)};globalThis.readEpisodeInfo = getSubjectMainEpisodeInfoForMapping;`,
    episodeInfoSandbox,
  );
  const explicitZeroInfo = await episodeInfoSandbox.readEpisodeInfo(373247, true);
  assert.deepEqual(plain(explicitZeroInfo), { episodeCount: 13, hasEpisodeZero: true });

  const declaredTotalSandbox = {
    state: { subject: null },
    nextSubject: { id: 622633, total_episodes: 0 },
    remembered: [],
    bgmRequest: async (path) => {
      assert.equal(path, "/v0/subjects/622633");
      return declaredTotalSandbox.nextSubject;
    },
    rememberBindingSubject: async (subject) => {
      declaredTotalSandbox.remembered.push(subject);
    },
  };
  runInSandbox(
    [
      functionSource("getDeclaredTotalEpisodeCount"),
      functionSource("getSubjectDeclaredTotalEpisodeCountForMapping", true),
      "globalThis.readDeclaredTotal = getSubjectDeclaredTotalEpisodeCountForMapping;",
    ].join("\n"),
    declaredTotalSandbox,
  );
  assert.equal(await declaredTotalSandbox.readDeclaredTotal(622633), 0,
    "an explicit zero total is unfinished even when episode records already exist");
  declaredTotalSandbox.nextSubject = { id: 622633, total_episodes: 13 };
  assert.equal(await declaredTotalSandbox.readDeclaredTotal(622633), 13,
    "a positive declared total enables the later completion comparison");
  declaredTotalSandbox.nextSubject = { id: 622633 };
  assert.equal(await declaredTotalSandbox.readDeclaredTotal(622633), 0,
    "a missing total_episodes field is also unfinished");
  assert.equal(declaredTotalSandbox.remembered.length, 3);
  assert.equal(declaredTotalSandbox.remembered[2].total_episodes, 0,
    "an authoritative missing total is persisted as unfinished evidence for reloads");

  let apiCalls = 0;
  const countEpisodes = [
    { id: 1, type: 0, sort: 1 },
    { id: 2, type: 0, sort: 2 },
    { id: 3, type: 1, sort: 3 },
  ];
  const countSandbox = {
    state: {
      subjectId: 42,
      episodes: countEpisodes,
    },
    getNormalEpisodes: () => countEpisodes.filter((ep) => Number(ep.type) === 0),
    resolveLongVideoBindingSubject: () => ({ eps: 99, total_episodes: 99 }),
    bgmRequest: async () => {
      apiCalls += 1;
      throw new Error("local type=0 list should be preferred");
    },
  };
  runInSandbox(
    `${functionSource("getSubjectMainEpisodeCountForMapping", true)};globalThis.readCount = getSubjectMainEpisodeCountForMapping;`,
    countSandbox,
  );
  assert.equal(await countSandbox.readCount(42), 2, "prefer already-loaded type=0 main episodes");
  assert.equal(apiCalls, 0);

  countSandbox.state.subjectId = 99;
  countSandbox.getNormalEpisodes = () => [];
  countSandbox.bgmRequest = async (path) => {
    apiCalls += 1;
    assert.match(path, /subject_id=99&type=0/);
    return { total: 12, data: [{ id: 1 }] };
  };
  apiCalls = 0;
  assert.equal(await countSandbox.readCount(99), 12, "fall back to type=0 episodes API total");
  assert.equal(apiCalls, 1);

  countSandbox.bgmRequest = async () => {
    apiCalls += 1;
    return { total: 0, data: [] };
  };
  apiCalls = 0;
  await assert.rejects(
    () => countSandbox.readCount(99),
    /正片话数/,
    "mapping must fail closed instead of using search-result eps",
  );
  assert.equal(apiCalls, 1);

  countSandbox.bgmRequest = async () => {
    apiCalls += 1;
    return { total: 0, data: [{ id: 1 }] };
  };
  apiCalls = 0;
  await assert.rejects(
    () => countSandbox.readCount(99),
    /正片话数/,
    "limit=1 response data must not be mistaken for the authoritative episode total",
  );
  assert.equal(apiCalls, 1);

  // Stale search-result eps must never create a mapping when the type=0 API fails.
  countSandbox.bgmRequest = async () => {
    apiCalls += 1;
    throw new Error("network down");
  };
  apiCalls = 0;
  await assert.rejects(
    () => countSandbox.readCount(99),
    /network down|正片话数/,
    "API failure fails closed without falling back to candidate.eps",
  );

  console.log("collection range mapping tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
