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
  state: { collectionMappings: {} },
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
  functionSource("putCollectionMappingRule"),
  functionSource("removeCollectionMappingRule"),
  functionSource("formatCollectionTargetEpisodeLabel"),
  functionSource("formatCollectionTargetRange"),
  functionSource("isCurrentCollectionPartAutoMarkEligible"),
  functionSource("buildCollectionRangeBindingProposal", true),
  functionSource("getCollectionSegmentProgressKey"),
  functionSource("recordCurrentCollectionSegmentProgressIfNeeded", true),
].join("\n") + `
;globalThis.api = {
  normalizeCollectionMappings,
  parseCollectionPartTitle,
  parseBareCollectionEpisodeTitle,
  getCollectionMappingResolution,
  getCollectionMappedEpisodeNo,
  putCollectionMappingRule,
  formatCollectionTargetEpisodeLabel,
  formatCollectionTargetRange,
  isCurrentCollectionPartAutoMarkEligible,
  buildCollectionRangeBindingProposal,
  recordCurrentCollectionSegmentProgressIfNeeded,
};`, sandbox);

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(sandbox.api.parseCollectionPartTitle("1.1")), {
  seasonKey: "default", seasonNo: null, episodeNo: 1, fragmentIndex: 1, fragmentCount: 2, label: "1.1",
});
assert.equal(sandbox.api.parseCollectionPartTitle("1.2").fragmentIndex, 2);
assert.deepEqual(plain(sandbox.api.parseCollectionPartTitle("第二季0")), {
  seasonKey: "season:2", seasonNo: 2, episodeNo: 0, fragmentIndex: 1, fragmentCount: 1, label: "第二季0",
});
assert.equal(sandbox.api.parseCollectionPartTitle("第三季4").episodeNo, 4);
assert.equal(sandbox.api.parseCollectionPartTitle("第1集上").fragmentIndex, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("第1集下").fragmentIndex, 2);
assert.equal(sandbox.api.parseCollectionPartTitle("EP01-A").fragmentIndex, 1);
assert.equal(sandbox.api.parseCollectionPartTitle("EP01-B").fragmentIndex, 2);
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
assert.equal(sandbox.api.parseBareCollectionEpisodeTitle("1080P"), null);
assert.equal(collectionConstants.MIN_COLLECTION_PARSED_PARTS, 4);
assert.equal(collectionConstants.MAX_COLLECTION_SEGMENTS, 8);

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
  sandbox.getSubjectMainEpisodeCountForMapping = async () => 11;
  sandbox.getSubjectMainEpisodeInfoForMapping = async (subjectId, inspectEpisodeZero) => ({
    episodeCount: await sandbox.getSubjectMainEpisodeCountForMapping(subjectId),
    hasEpisodeZero: Boolean(inspectEpisodeZero && sandbox.apiEpisodeZero),
  });
  sandbox.state.collectionMappings = {};
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
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(3001);
  assert.equal(proposal.rule.sourceStart, 5);
  assert.equal(proposal.rule.sourceEnd, 8);
  assert.equal(proposal.rule.targetStart, 5, "an ongoing collection must continue the same Bangumi episode numbering");

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

  // Incomplete splits: only fragment 1 exists → segmentCount 1 → single watch completes.
  progress["solo"] = undefined;
  sandbox.getCollectionMappingRule = () => splitRule;
  sandbox.getCollectionSegmentProgressKey = () => "solo-key";
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 2, segmentCount: 1, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true,
    "actual single-part episodes must auto-mark without waiting for a missing .2");

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
  sandbox.apiEpisodeZero = false;
  proposal = await sandbox.api.buildCollectionRangeBindingProposal(425998);
  assert.equal(proposal.rule.sourceStart, 1);
  assert.equal(proposal.rule.sourceEnd, 8,
    "a 16P numeric collection bound to an 8-episode subject proposes the first 1-8 batch");
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
    functionSource("getCurrentCollectionPartContext"),
  ].join("\n") + ";globalThis.readCollectionContext = getCurrentCollectionPartContext;", incompleteSandbox);
  const incompleteContext = incompleteSandbox.readCollectionContext();
  assert.equal(incompleteContext.episodeNo, 2);
  assert.equal(incompleteContext.segmentCount, 1, "missing .2 must not invent a second required segment");

  const failClosedSandbox = {
    getCurrentCollectionPartContext: () => ({ bvid, episodeNo: 1 }),
    getCollectionMappingRule: () => null,
    detectEpisodeNo: () => { throw new Error("legacy title fallback must not run"); },
  };
  runInSandbox(
    `${functionSource("detectCurrentEpisodeNo")};globalThis.readEpisode = detectCurrentEpisodeNo;`,
    failClosedSandbox,
  );
  assert.equal(failClosedSandbox.readEpisode("1.2"), null, "no-rule collection does not reinterpret 1.2 as episode 1");

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

  console.log("collection range mapping tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
