"use strict";

const assert = require("node:assert/strict");
const {
  USERSCRIPT_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

const source = readSource(USERSCRIPT_PATH);
const functionSource = (name, async = false) => extractFunction(source, name, async ? { async: true } : {});

const sandbox = {
  Date,
  state: { collectionMappings: {} },
  stripTrailingDurationText: (text) => String(text || "")
    .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim(),
  getBvIdFromUrl: () => "BV15H3M65EED",
};

runInSandbox([
  functionSource("normalizeCollectionMappings"),
  functionSource("normalizeCollectionMappingRule"),
  functionSource("normalizeCollectionSegmentProgress"),
  functionSource("parseCollectionPartTitle"),
  functionSource("parseChineseNumber"),
  functionSource("parseCollectionFragment"),
  functionSource("getCollectionMappingRules"),
  functionSource("getCollectionMappingResolution"),
  functionSource("getCollectionMappingRule"),
  functionSource("getCollectionMappedEpisodeNo"),
  functionSource("putCollectionMappingRule"),
  functionSource("removeCollectionMappingRule"),
  functionSource("buildCollectionRangeBindingProposal", true),
  functionSource("getCollectionSegmentProgressKey"),
  functionSource("recordCurrentCollectionSegmentProgressIfNeeded", true),
].join("\n") + `
;globalThis.api = {
  normalizeCollectionMappings,
  parseCollectionPartTitle,
  getCollectionMappingResolution,
  getCollectionMappedEpisodeNo,
  putCollectionMappingRule,
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
assert.equal(sandbox.api.parseCollectionPartTitle("1080P"), null);
assert.equal(sandbox.api.parseCollectionPartTitle("4K超清"), null);

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
  sandbox.state.collectionMappings = {};
  let proposal = await sandbox.api.buildCollectionRangeBindingProposal(1001);
  assert.deepEqual(plain(proposal.rule), {
    bvid, id: "default:1-11", seasonKey: "default", sourceStart: 1, sourceEnd: 11,
    targetStart: 1, subjectId: 1001, segmentCount: 2, autoProgress: true,
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

  const progress = {};
  const splitRule = {
    id: "default:1-11", seasonKey: "default", sourceStart: 1, sourceEnd: 11,
    targetStart: 1, subjectId: 1001, segmentCount: 2, autoProgress: true,
  };
  sandbox.getCollectionMappingRule = () => splitRule;
  sandbox.updateStoredCollectionSegmentProgress = async (update) => update(progress);
  currentContext = {
    bvid, seasonKey: "default", episodeNo: 1, segmentCount: 2, fragmentIndex: 1,
  };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  currentContext = { ...currentContext, fragmentIndex: 2 };
  assert.equal(await sandbox.api.recordCurrentCollectionSegmentProgressIfNeeded(), true);

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
  const collectionNodes = collectionTitles.map((title, index) => ({
    className: index === 0 ? "active" : "",
    textContent: title,
    getAttribute: (name) => name === "title" ? title : "",
    querySelectorAll: () => [],
  }));
  let currentPartNo = 1;
  const collectionDomSandbox = {
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
    functionSource("parseLongVideoPartTitle"),
    functionSource("getVideoPartListNodes"),
    functionSource("isActiveVideoPartNode"),
    functionSource("getVideoPartNodeTitle"),
    functionSource("getCurrentVideoPartContext"),
    functionSource("getCollectionPartRows"),
    functionSource("getCurrentCollectionPartContext"),
  ].join("\n") + ";globalThis.readCollectionContext = getCurrentCollectionPartContext;", collectionDomSandbox);
  let liveContext = collectionDomSandbox.readCollectionContext();
  assert.equal(collectionNodes.length, 76);
  assert.equal(liveContext.episodeNo, 1);
  assert.equal(liveContext.segmentCount, 2);
  assert.equal(liveContext.groupEnd, 23);
  assert.equal(liveContext.parsedPartCount, 75);
  currentPartNo = 47;
  liveContext = collectionDomSandbox.readCollectionContext();
  assert.equal(liveContext.episodeNo, 0);
  assert.equal(liveContext.seasonKey, "season:2");
  assert.equal(liveContext.groupEnd, 24);
  currentPartNo = 72;
  liveContext = collectionDomSandbox.readCollectionContext();
  assert.equal(liveContext.seasonKey, "season:3");
  assert.equal(liveContext.episodeNo, 1);
  assert.equal(liveContext.groupEnd, 4);

  console.log("collection range mapping tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
