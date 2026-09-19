"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, extractConstants, runInSandbox } = require("./_source");

const names = [
  "normalizeTitleText", "isNonMainEpisodeTitle", "stripTrailingDurationText", "parseChineseNumber",
  "parseCollectionFragment", "parseCollectionPartTitle", "parseBareCollectionEpisodeTitle",
  "getCollectionPartRows", "getQualifiedCollectionPartRows", "getCurrentCollectionLayoutContext",
  "getCurrentCollectionPartContext", "getCollectionLogicalEpisodeCount", "isCollectionRangeMappingEligible",
  "getCollectionMappingRules", "getCollectionMappingResolution", "getCollectionMappingRule",
  "getCollectionMappedEpisodeNo", "normalizeCollectionMappingRule", "putCollectionMappingRule",
  "getCollectionInferenceSeasonInfo", "getCollectionInferenceSubjectTitles", "getCollectionInferenceSubjectIdentity",
  "collectionInferenceTitlesMatch", "collectionInferenceSourceMatches", "getCollectionInferenceSourceCount",
  "getCollectionInferenceAirDay", "getCollectionInferenceEpisodeEvidence",
  "inferCollectionRangeBindingStartFromEvidence", "loadCollectionInferenceChain", "inferCollectionRangeBindingStart",
  "getCollectionBindingStartOptions", "reviseCollectionRangeBindingProposal", "buildCollectionRangeBindingProposal",
  "getCollectionSegmentProgressKey", "recordCurrentCollectionSegmentProgressIfNeeded", "isCurrentCollectionPartAutoMarkEligible",
];

function setup(source, format = (episode, fragment) => `4.${episode}.${fragment}`, fragmentCount = 2) {
  const now = new Date("2026-09-09T12:00:00").getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let titles = ["S3E1", "S3E2", "S3E3", "S3E4"];
  for (let episode = 1; episode <= 15; episode += 1) {
    for (let fragment = 1; fragment <= fragmentCount; fragment += 1) titles.push(format(episode, fragment));
  }
  let nodes = titles.map((title) => ({ title }));
  let active = 4 + 14 * fragmentCount;
  const first = { id: 100, type: 2, name: "Sample Anime Season 4 Part 1", total_episodes: 11, eps: 11 };
  const last = { id: 200, type: 2, name: "Sample Anime Season 4 Part 2", total_episodes: 8, eps: 8 };
  const episodes = (id, count, start, date) => ({ total: count, data: Array.from({ length: count }, (_, index) => ({
    id: id * 100 + index, type: 0, sort: start + index, ep: index + 1,
    airdate: new Date(Date.parse(date) + index * 7 * 86400000).toISOString().slice(0, 10),
  })) });
  const responses = {
    "/v0/subjects/100": first, "/v0/subjects/200": last,
    "/v0/episodes?subject_id=100&type=0": episodes(100, 11, 67, "2026-04-08"),
    "/v0/episodes?subject_id=200&type=0": episodes(200, 8, 78, "2026-08-12"),
    "/v0/subjects/100/subjects": [{ ...last, relation: "续集" }],
    "/v0/subjects/200/subjects": [{ ...first, relation: "前传" }],
  };
  const progress = {};
  const api = {
    ...extractConstants(source, ["NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN", "MAX_COLLECTION_SEGMENTS", "MIN_COLLECTION_PARSED_PARTS"]),
    COLLECTION_PART_ROWS_CACHE_MS: 0, Date: FixedDate,
    state: { collectionMappings: {} },
    getBvIdFromUrl: () => "BVTEST", getVideoPartListNodes: () => nodes,
    getVideoPartNodeTitle: (node) => node.title, isActiveVideoPartNode: (node) => node === nodes[active - 1],
    getCurrentVideoPartContext: () => ({ bvid: "BVTEST", partCount: nodes.length, partNo: active, title: nodes[active - 1].title }),
    getPageTitle: () => "Sample Anime S1-S4 collection", parseLongVideoPartTitle: () => null,
    getSubjectDeclaredTotalEpisodeCountForMapping: async () => 8,
    getSubjectMainEpisodeInfoForMapping: async () => ({ episodeCount: 8, hasEpisodeZero: false }),
    isCurrentOrdinaryEpisodeCollection: () => false,
    updateStoredCollectionSegmentProgress: async (update) => update(progress),
    bgmRequest: async (path) => {
      assert.ok(Object.hasOwn(responses, path), path);
      return structuredClone(responses[path]);
    },
  };
  api.bgmRequestPagedData = api.bgmRequest;
  runInSandbox(names.map((name) => extractFunction(source, name, { async: source.includes(`  async function ${name}(`) })).join("\n"), api);
  return { api, progress, move: (partNo) => { active = partNo; }, append: (title) => {
    titles.push(title); nodes = titles.map((value) => ({ title: value })); active = nodes.length;
  } };
}

for (const [label, path] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(path);

  test(`${label}: a rejected hierarchical list stays unmapped instead of falling back to ordinary-video progress`, async () => {
    const { api, progress } = setup(source);
    const nodes = ["4.1.1", "4.1.2", "4.2.1", "4.2.2", "4.3.1", "4.3.2", "4.4.1", "4.4.3"]
      .map((title) => ({ title }));
    api.getVideoPartListNodes = () => nodes;
    api.getCurrentVideoPartContext = () => ({ bvid: "BVTEST", partCount: nodes.length, partNo: 8, title: nodes[7].title });
    api.isActiveVideoPartNode = (node) => node === nodes[7];
    assert.equal(api.getCurrentCollectionPartContext(), null);
    assert.equal(api.getCurrentCollectionLayoutContext().currentKind, "unmapped");
    assert.equal(api.isCurrentCollectionPartAutoMarkEligible(), false);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    assert.deepEqual(progress, {});
    api.getCurrentVideoPartContext = () => ({ bvid: "BVTEST", partCount: 1, partNo: 1, title: "ordinary video" });
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), true, "ordinary standalone videos retain their existing path");
  });

  test(`${label}: one explicit logical episode split across several P never falls back to whole-video auto progress`, async () => {
    const { api, progress } = setup(source);
    const nodes = ["S4E1.1", "S4E1.2", "S4E1.3", "S4E1.4"].map((title) => ({ title }));
    api.getVideoPartListNodes = () => nodes;
    api.getCurrentVideoPartContext = () => ({ bvid: "BVTEST", partCount: nodes.length, partNo: 2, title: nodes[1].title });
    api.isActiveVideoPartNode = (node) => node === nodes[1];
    assert.equal(api.getCurrentCollectionPartContext(), null, "a single logical episode cannot establish a mapping");
    assert.equal(api.getCurrentCollectionLayoutContext().currentKind, "episode");
    assert.equal(api.isCurrentCollectionPartAutoMarkEligible(), false);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    assert.deepEqual(progress, {});
  });

  test(`${label}: season.episode.fragment flows from the P list through prequel inference into a reserved mapping`, async () => {
    const { api } = setup(source);
    const context = api.getCurrentCollectionPartContext();
    assert.equal(context.seasonNo, 4);
    assert.equal(context.episodeNo, 14);
    assert.equal(context.fragmentIndex, 2);
    assert.equal(context.segmentCount, 2);
    assert.equal(api.getCollectionInferenceSourceCount(context), 15);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    assert.equal(proposal.startConfirmed, true);
    assert.equal(proposal.rule.sourceStart, 12);
    assert.equal(proposal.rule.sourceEnd, 19);
    assert.equal(api.getCollectionBindingStartOptions(context).find((option) => option.sourceStart === 12).partNo, 27);
    assert.equal(api.getCollectionMappedEpisodeNo(context, proposal.rule), 3);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);
    assert.equal(api.getCollectionMappingRule().subjectId, 200);
  });

  test(`${label}: equivalent explicit season notations and mixed labels share one inference and mapping`, async () => {
    const formats = [
      (episode, fragment) => `S4-${episode}.${fragment}`,
      (episode, fragment) => `4x${episode} Part ${fragment}`,
      (episode, fragment) => `第4期第${episode}集${fragment === 1 ? "上半" : "下半"}`,
      (episode, fragment) => `Season IV Episode ${episode} Part ${fragment}`,
      (episode, fragment) => `Fourth Season EP${episode} 第${fragment}段`,
      (episode, fragment) => episode % 2 ? `4.${episode}.${fragment}` : `S4E${episode}.${fragment}`,
    ];
    for (const format of formats) {
      const { api } = setup(source, format);
      const proposal = await api.buildCollectionRangeBindingProposal(200);
      assert.ok(proposal?.startConfirmed, format(14, 2));
      assert.equal(proposal.rule.sourceStart, 12);
      assert.equal(proposal.rule.sourceEnd, 19);
      assert.equal(api.getCollectionMappedEpisodeNo(proposal.context, proposal.rule), 3);
      assert.equal(api.getCollectionBindingStartOptions(proposal.context).length, 15);
    }
  });

  test(`${label}: an unrecognized middle fragment cannot disappear from watched-completion checks`, async () => {
    const { api, append, move } = setup(source);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);
    append("S4E16 上篇");
    append("S4E16 中篇");
    append("S4E16 下篇");
    move(35);
    assert.equal(api.getCurrentCollectionPartContext().fragmentSequenceValid, false);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    move(37);
    assert.equal(api.getCurrentCollectionPartContext().fragmentSequenceValid, false);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
  });

  test(`${label}: repairing an invalid middle fragment cannot reuse its former last-fragment watch as the middle`, async () => {
    const { api, append, move } = setup(source);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);
    append("S4E16 上篇"); append("S4E16 中篇"); append("S4E16 下篇");
    move(35);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    move(37);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    const nodes = api.getVideoPartListNodes();
    nodes[35].title = "S4E16 第2段";
    nodes[36].title = "S4E16 第3段";
    assert.equal(api.getCurrentCollectionPartContext().fragmentSequenceValid, true);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false, "watching only the repaired last fragment must not complete the unseen middle");
    move(35);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    move(36);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), true);
  });

  test(`${label}: a later episode inherits the mapping and waits for its declared second fragment`, async () => {
    const { api, append } = setup(source);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);
    append("4.16.1");
    const firstHalf = api.getCurrentCollectionPartContext();
    assert.equal(firstHalf.segmentCount, 2, "an explicitly split season cannot complete on its first uploaded fragment");
    assert.equal(api.getCollectionMappedEpisodeNo(firstHalf), 5);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    append("4.16.2");
    assert.equal(api.getCollectionMappedEpisodeNo(api.getCurrentCollectionPartContext()), 5);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), true);
  });

  test(`${label}: three-fragment history keeps an unfinished future episode pending until its third fragment`, async () => {
    const { api, append } = setup(source, undefined, 3);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    assert.equal(proposal.rule.segmentCount, 3);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);

    append("4.16.1");
    let context = api.getCurrentCollectionPartContext();
    assert.equal(context.segmentCount, 3, "an unfinished tail must retain the known three-fragment minimum");
    assert.equal(api.getCollectionInferenceSourceCount(context), 0, "a partial tail must not be counted as a complete uploaded episode");
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);

    append("4.16.2");
    context = api.getCurrentCollectionPartContext();
    assert.equal(context.segmentCount, 3, "seeing two uploaded fragments does not prove the third is absent");
    assert.equal(api.getCollectionInferenceSourceCount(context), 0);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false, "the reserved mapping must not complete before fragment 3");

    append("4.16.3");
    context = api.getCurrentCollectionPartContext();
    assert.equal(context.segmentCount, 3);
    assert.equal(api.getCollectionInferenceSourceCount(context), 16);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), true);
  });

  test(`${label}: the next logical episode closes a shorter two-fragment episode without weakening the new tail`, async () => {
    const { api, append, move } = setup(source, undefined, 3);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);

    append("4.16.1");
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);
    append("4.16.2");
    const shorterEpisodeLastPart = api.getCurrentCollectionPartContext().partNo;
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false, "the two-fragment tail is still unconfirmed");

    append("4.17.1");
    assert.equal(api.getCurrentCollectionPartContext().segmentCount, 3, "the new tail still waits for its possible later fragments");
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), false);

    move(shorterEpisodeLastPart);
    const closedEpisode = api.getCurrentCollectionPartContext();
    assert.equal(closedEpisode.episodeNo, 16);
    assert.equal(closedEpisode.fragmentIndex, 2);
    assert.equal(closedEpisode.segmentCount, 2, "a following episode establishes the previous episode's actual shorter length");
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), true, "variable fragment counts must not permanently block completed shorter episodes");
  });

  test(`${label}: an explicit whole-episode title does not inherit the historical split count`, async () => {
    const { api, append } = setup(source, undefined, 3);
    const proposal = await api.buildCollectionRangeBindingProposal(200);
    api.putCollectionMappingRule(api.state.collectionMappings, proposal.rule);
    append("S4E16");
    const context = api.getCurrentCollectionPartContext();
    assert.equal(context.episodeNo, 16);
    assert.equal(context.segmentCount, 1);
    assert.equal(api.getCollectionInferenceSourceCount(context), 16);
    assert.equal(await api.recordCurrentCollectionSegmentProgressIfNeeded(), true);
  });


  test(`${label}: a missing first fragment still opens the manual first-P editor`, async () => {
    const { api } = setup(source);
    const nodes = Array.from({ length: 15 }, (_, index) => ({ title: `S4E${index + 1}${index === 13 ? ".2" : ""}` }));
    api.getVideoPartListNodes = () => nodes;
    api.getCurrentVideoPartContext = () => ({ bvid: "BVTEST", partCount: nodes.length, partNo: 14, title: nodes[13].title });
    api.isActiveVideoPartNode = (node) => node === nodes[13];
    const draft = await api.buildCollectionRangeBindingProposal(200);
    assert.equal(draft.startConfirmed, false);
    assert.equal(api.getCollectionBindingStartOptions(draft.context).some((option) => option.sourceStart === 14), false);
    const revised = api.reviseCollectionRangeBindingProposal(draft, 12);
    assert.equal(revised.rule.sourceStart, 12);
    assert.equal(revised.rule.sourceEnd, 19);
    assert.equal(revised.context.partNo, 14);
    assert.equal(revised.startConfirmed, true);
  });

  test(`${label}: missing relation evidence keeps the first-P selector and the complete target range`, async () => {
    const { api } = setup(source);
    api.bgmRequest = async () => { throw new Error("offline"); };
    api.bgmRequestPagedData = api.bgmRequest;
    const draft = await api.buildCollectionRangeBindingProposal(200);
    assert.equal(draft.startConfirmed, false);
    const revised = api.reviseCollectionRangeBindingProposal(draft, 12);
    assert.equal(revised.rule.sourceStart, 12);
    assert.equal(revised.rule.sourceEnd, 19);
    assert.equal(revised.context.partNo, 32);
    assert.equal(revised.context.fragmentIndex, 2);
  });
}
