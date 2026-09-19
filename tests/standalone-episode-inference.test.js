"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");
const { loadParsingFixture } = require("./_parsing-fixture");

const NOW = "2026-09-20T12:00:00";
const FIRST_ID = 547888;
const LAST_ID = 633836;
const EARLIER_ID = 510728;
const TITLE = "『Re：从零开始的异世界生活S4』第17话【中文字幕】";
const BV = "BV13aeA6mEPi";
const synchronous = [
  "getCollectionInferenceSeasonInfo", "getCollectionInferenceSubjectTitles",
  "getCollectionInferenceSubjectIdentity", "collectionInferenceTitlesMatch",
  "collectionInferenceSourceMatches", "getCollectionInferenceAirDay",
  "getCollectionInferenceEpisodeEvidence", "getEpisodeLabelLocalNo", "getNormalEpisodes",
  "getStandaloneEpisodeInferenceContext", "isStandaloneEpisodeInferenceContextCurrent", "getStandaloneEpisodeInferenceResult",
  "isCurrentEpisodeNumber", "getCurrentNormalEpisode",
  "detectEpisodeNo", "hasEpisodeRangeMarker", "normalizeTitleText", "isNonMainEpisodeTitle",
  "parseChineseNumber", "isCommonResolutionNumber", "isTotalEpisodeCountMatch", "isEpisodeRangeMatch",
];
const asynchronous = [
  "loadCollectionInferenceChain", "inferStandaloneEpisodeFromPrequels", "refreshStandaloneEpisodeInference",
];
const constants = [
  "EPISODE_PATTERNS", "EPISODE_NUMBER_SOURCE", "EPISODE_MARKER_SOURCE",
  "EPISODE_RANGE_MARKER_SOURCE", "LABELED_EPISODE_RANGE_SOURCE", "COMMON_RESOLUTIONS",
  "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN",
];

function subject(id, count, seasonNo = 4, suffix = "") {
  return {
    id, type: 2, total_episodes: count, eps: count,
    name: `Re:ゼロから始める異世界生活 ${seasonNo}th season ${suffix}`,
    name_cn: `Re：从零开始的异世界生活 第${seasonNo}季 ${suffix}`,
    infobox: [{ key: "话数", value: String(count) }],
  };
}

function relation(entry, direction = "前传") {
  return { id: entry.id, type: entry.type, name: entry.name, name_cn: entry.name_cn, relation: direction };
}

function episodes(id, count, firstSort, firstDate) {
  return {
    total: count,
    data: Array.from({ length: count }, (_, index) => ({
      id: id * 100 + index, type: 0, sort: firstSort + index, ep: index + 1,
      airdate: new Date(Date.parse(`${firstDate}T00:00:00Z`) + index * 7 * 86400000).toISOString().slice(0, 10),
    })),
  };
}

function fixture() {
  const first = subject(FIRST_ID, 11, 4, "丧失篇");
  const last = subject(LAST_ID, 8, 4, "夺还篇");
  const earlier = subject(EARLIER_ID, 8, 3, "反击篇");
  return {
    [`/v0/subjects/${FIRST_ID}`]: first,
    [`/v0/subjects/${LAST_ID}`]: last,
    [`/v0/episodes?subject_id=${FIRST_ID}&type=0`]: episodes(FIRST_ID, 11, 67, "2026-04-08"),
    [`/v0/episodes?subject_id=${LAST_ID}&type=0`]: episodes(LAST_ID, 8, 78, "2026-08-12"),
    [`/v0/subjects/${FIRST_ID}/subjects`]: [relation(earlier), relation(last, "续集")],
    [`/v0/subjects/${LAST_ID}/subjects`]: [relation(first)],
  };
}

function context(episodeNo = 17) {
  return { seasonNo: 4, videoTitle: TITLE.replace("第17话", `第${episodeNo}话`), episodeNo };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(source, responses = fixture()) {
  const now = new Date(NOW).getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const api = {
    Date: FixedDate, requests: [], renders: 0, rawTitle: TITLE, routeRefreshSeq: 1,
    official: false, disabled: false, longVideoMode: false,
    part: { bvid: BV, partNo: 1, partCount: 1, title: TITLE }, nodes: [],
    initialState: { videoData: { bvid: BV, pages: [{ page: 1 }], videos: 1 } },
    location: { href: `https://www.bilibili.com/video/${BV}/`, pathname: `/video/${BV}/`, search: "" },
    state: {
      pageKey: `video:${BV}`, rawTitle: TITLE, token: "token-a", subjectId: LAST_ID,
      subject: structuredClone(responses[`/v0/subjects/${LAST_ID}`]),
      episodes: structuredClone(responses[`/v0/episodes?subject_id=${LAST_ID}&type=0`].data),
      currentEpisodeNo: 17, currentEpisodeNumberSource: "label", standaloneEpisodeInference: null,
      longVideoEpisodeGuess: null,
    },
  };
  api.getPageTitle = () => api.rawTitle;
  api.getPageKey = () => api.state.pageKey;
  api.getBvIdFromUrl = () => api.location.pathname.match(/\/video\/(BV[a-z0-9]+)/i)?.[1] || "";
  api.isOfficialBangumiPage = () => api.official;
  api.isCurrentVideoAutoProgressDisabled = () => api.disabled;
  api.getLongVideoEpisodeModeDecision = () => api.longVideoMode;
  api.getCurrentVideoPartContext = () => api.part;
  api.getPageInitialState = () => api.initialState;
  api.getVideoPartListNodes = () => api.nodes;
  api.getCurrentCollectionPartContext = () => null;
  api.getCurrentCollectionLayoutContext = () => null;
  api.isCurrentPageContext = (value) => value?.pageKey === api.state.pageKey && value?.routeSeq === api.routeRefreshSeq;
  api.render = () => { api.renders += 1; };
  api.resetAutoWatchObservationState = () => {};
  api.bgmRequest = async (path) => {
    api.requests.push(path);
    assert.ok(Object.hasOwn(responses, path), `Unexpected API path ${path}`);
    return structuredClone(responses[path]);
  };
  api.bgmRequestPagedData = api.bgmRequest;
  loadParsingFixture(source, synchronous, api, constants);
  runInSandbox(asynchronous.map((name) => extractFunction(source, name, { async: true })).join("\n"), api);
  return api;
}

function expected(episodeNo = 17) {
  return { sourceEpisodeNo: episodeNo, episodeNo: episodeNo - 11, episodeId: LAST_ID * 100 + episodeNo - 12, previousCount: 11 };
}

function assertInference(actual, wanted = expected()) {
  assert.ok(actual, "same-season prequel evidence should locate an episode");
  for (const [key, value] of Object.entries(wanted)) assert.equal(actual[key], value, key);
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);

  test(`${label}: standalone Re0 S4 episode 17 maps to the second part's episode 6 / global 83`, async () => {
    const api = setup(source);
    const result = await api.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW });
    assertInference(result);
    assert.equal(api.state.episodes.find((entry) => entry.id === result.episodeId).sort, 83);
    assert.equal(api.requests.some((path) => path.includes(String(EARLIER_ID))), false, "earlier seasons cannot inflate the offset");
    assert.equal(api.getEpisodeLabelLocalNo(17), null, "the existing label path alone cannot identify this video");
  });

  test(`${label}: an old standalone episode still resolves after the whole season finishes`, async () => {
    const api = setup(source);
    assertInference(await api.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: "2026-12-01T12:00:00" }));
    assertInference(await api.inferStandaloneEpisodeFromPrequels(context(12), LAST_ID, { now: NOW }), expected(12));
    assertInference(await api.inferStandaloneEpisodeFromPrequels(context(19), LAST_ID, { now: "2026-12-01T12:00:00" }), expected(19));
    for (const episodeNo of [0, 1, 6, 8, 11, 20, 83]) {
      assert.equal(await api.inferStandaloneEpisodeFromPrequels(context(episodeNo), LAST_ID, { now: "2026-12-01T12:00:00" }), null,
        `${episodeNo}: preserve existing local/global matches and reject out-of-range offsets`);
    }
  });

  test(`${label}: aired prequels are required and the target only permits the present broadcast window`, async () => {
    const api = setup(source);
    assert.equal(await api.inferStandaloneEpisodeFromPrequels(context(18), LAST_ID, { now: NOW }), null, "September 23 is too far away on September 20");
    assertInference(await api.inferStandaloneEpisodeFromPrequels(context(18), LAST_ID, { now: "2026-09-22T12:00:00" }), expected(18));
    assertInference(await api.inferStandaloneEpisodeFromPrequels(context(18), LAST_ID, { now: "2026-09-23T12:00:00" }), expected(18));
    const responses = fixture();
    responses[`/v0/episodes?subject_id=${FIRST_ID}&type=0`].data.forEach((entry) => { entry.airdate = "2026-09-20"; });
    responses[`/v0/episodes?subject_id=${LAST_ID}&type=0`] = episodes(LAST_ID, 8, 78, "2026-09-20");
    assert.equal(await setup(source, responses).inferStandaloneEpisodeFromPrequels(context(12), LAST_ID, { now: NOW }), null,
      "prequel episodes still in today's window cannot establish an already-aired offset");
  });

  test(`${label}: a loaded selected evidence object avoids fetching that subject and its episodes again`, async () => {
    const responses = fixture();
    const api = setup(source, responses);
    const selectedEvidence = api.getCollectionInferenceEpisodeEvidence(responses[`/v0/subjects/${LAST_ID}`], responses[`/v0/episodes?subject_id=${LAST_ID}&type=0`]);
    assertInference(await api.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW, selectedEvidence }));
    assert.equal(api.requests.includes(`/v0/subjects/${LAST_ID}`), false);
    assert.equal(api.requests.includes(`/v0/episodes?subject_id=${LAST_ID}&type=0`), false);
    assert.ok(api.requests.includes(`/v0/subjects/${FIRST_ID}`));
  });

  test(`${label}: the shared chain still traverses successors while standalone inference needs only prequels`, async () => {
    const wholeSeason = setup(source);
    const chain = await wholeSeason.loadCollectionInferenceChain(context(), FIRST_ID);
    assert.deepEqual(Array.from(chain, (entry) => entry.subjectId), [FIRST_ID, LAST_ID]);
    const responses = fixture();
    responses[`/v0/subjects/${LAST_ID}/subjects`].push(relation(subject(999, 12, 4, "未定篇"), "续集"));
    const standalone = setup(source, responses);
    assertInference(await standalone.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW }));
    assert.equal(standalone.requests.some((path) => path.includes("999")), false, "an unannounced future part cannot invalidate a known old video");
  });

  test(`${label}: uncertain source identity, incomplete metadata and ambiguous relation paths fail closed`, async () => {
    for (const input of [
      { ...context(), seasonNo: 3 },
      { ...context(), videoTitle: "Another show S4 第17话" },
      { ...context(), videoTitle: "第四季第17话" },
    ]) assert.equal(await setup(source).inferStandaloneEpisodeFromPrequels(input, LAST_ID, { now: NOW }), null);
    const mutations = [
      (data) => { data[`/v0/subjects/${FIRST_ID}`].total_episodes = 0; },
      (data) => { data[`/v0/episodes?subject_id=${FIRST_ID}&type=0`].data.pop(); },
      (data) => { data[`/v0/episodes?subject_id=${FIRST_ID}&type=0`].data[3].airdate = ""; },
      (data) => { data[`/v0/episodes?subject_id=${FIRST_ID}&type=0`].data[3].sort += 1; },
      (data) => { data[`/v0/episodes?subject_id=${LAST_ID}&type=0`].data.forEach((entry) => { entry.sort += 1; }); },
      (data) => { data[`/v0/subjects/${FIRST_ID}/subjects`] = []; },
      (data) => { data[`/v0/subjects/${LAST_ID}/subjects`] = []; },
      (data) => { data[`/v0/subjects/${LAST_ID}/subjects`].push(relation(subject(1234, 11))); },
      (data) => { data[`/v0/subjects/${LAST_ID}/subjects`][0].name_cn += " 总集篇"; },
      (data) => { data[`/v0/subjects/${FIRST_ID}/subjects`] = [relation(data[`/v0/subjects/${LAST_ID}`]), relation(data[`/v0/subjects/${LAST_ID}`], "续集")]; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const data = fixture();
      mutate(data);
      assert.equal(await setup(source, data).inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW }), null, `invalid evidence case ${index}`);
    }
  });

  test(`${label}: evidence fetching stops when its caller context expires and public failures return null`, async () => {
    const api = setup(source);
    const original = api.bgmRequest;
    let current = true;
    api.bgmRequest = async (path) => {
      const response = await original(path);
      if (path.endsWith("/subjects")) current = false;
      return response;
    };
    assert.equal(await api.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW, isCurrent: () => current }), null);
    assert.equal(api.requests.includes(`/v0/subjects/${FIRST_ID}`), false, "do not continue reading a prequel after cancellation");
    const initiallyStale = setup(source);
    assert.equal(await initiallyStale.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW, isCurrent: () => false }), null);
    assert.equal(initiallyStale.requests.length, 0);
    const failing = setup(source);
    failing.bgmRequest = async () => { throw new Error("offline"); };
    assert.equal(await failing.inferStandaloneEpisodeFromPrequels(context(), LAST_ID, { now: NOW }), null);
  });

  test(`${label}: page context accepts one BV episode and excludes existing recognition or conflicting page modes`, () => {
    const api = setup(source);
    const result = api.getStandaloneEpisodeInferenceContext();
    assert.ok(result);
    assert.equal(result.seasonNo, 4);
    assert.equal(result.episodeNo, 17);
    assert.equal(result.subjectId, LAST_ID);
    assert.equal(result.subject, api.state.subject);
    assert.equal(result.episodes, api.state.episodes);
    const cases = [
      ["local episode", (item) => { item.rawTitle = TITLE.replace("第17话", "第6话"); }],
      ["global episode", (item) => { item.rawTitle = TITLE.replace("第17话", "第83话"); }],
      ["episode zero", (item) => { item.rawTitle = TITLE.replace("第17话", "第0话"); }],
      ["fractional episode", (item) => { item.rawTitle = TITLE.replace("第17话", "第17.5话"); }],
      ["range", (item) => { item.rawTitle = TITLE.replace("第17话", "第12-19话"); }],
      ["special", (item) => { item.rawTitle += " 总集篇"; }],
      ["missing season", (item) => { item.rawTitle = TITLE.replace("S4", ""); }],
      ["conflicting seasons", (item) => { item.rawTitle += " S3"; }],
      ["wrong work", (item) => { item.rawTitle = "Another Show S4 第17话"; }],
      ["official", (item) => { item.official = true; }],
      ["non-BV route", (item) => { item.location.pathname = "/bangumi/play/ep123"; }],
      ["multiple P", (item) => { item.part = { ...item.part, partCount: 2 }; item.nodes = [{}, {}]; }],
      ["initial state multi-P before list arrival", (item) => { item.initialState.videoData.pages.push({ page: 2 }); }],
      ["initial state videos count before list arrival", (item) => { item.initialState.videoData.videos = 2; }],
      ["second P before list arrival", (item) => { item.part = { ...item.part, partNo: 2, partCount: 2 }; item.location.search = "?p=2"; item.location.href += "?p=2"; }],
      ["long-video mode", (item) => { item.longVideoMode = true; }],
      ["active long-video guess", (item) => { item.state.longVideoEpisodeGuess = { active: true }; }],
      ["disabled progress", (item) => { item.disabled = true; }],
      ["subject not loaded", (item) => { item.state.subject = null; }],
      ["episodes not loaded", (item) => { item.state.episodes = []; }],
    ];
    for (const [reason, mutate] of cases) {
      const item = setup(source);
      mutate(item);
      assert.equal(item.getStandaloneEpisodeInferenceContext(), null, reason);
    }
  });

  test(`${label}: context inference reaches the real current-episode consumer and preserves label/ordinal precedence`, async () => {
    const api = setup(source);
    assert.equal(api.getCurrentNormalEpisode(), null);
    await api.refreshStandaloneEpisodeInference();
    assertInference(api.getStandaloneEpisodeInferenceResult());
    assert.equal(api.getCurrentNormalEpisode().sort, 83);
    assert.equal(api.state.currentEpisodeNo, 17, "keep the source label for refresh and invalidation");
    assert.equal(api.state.currentEpisodeNumberSource, "label");
    api.state.currentEpisodeNo = 6;
    assert.equal(api.getStandaloneEpisodeInferenceResult(), null);
    assert.equal(api.getCurrentNormalEpisode().sort, 83, "the existing local label path remains usable");
    api.state.currentEpisodeNo = 17;
    api.state.currentEpisodeNumberSource = "ordinal";
    assert.equal(api.getStandaloneEpisodeInferenceResult(), null);
    assert.equal(api.getCurrentNormalEpisode(), null, "an ordinal source cannot borrow the inferred label result");
    api.state.currentEpisodeNo = 3;
    assert.equal(api.getCurrentNormalEpisode().sort, 80);
  });

  test(`${label}: repeated refreshes share one pending inference and reuse its completed result`, async () => {
    const api = setup(source);
    const pending = deferred();
    let calls = 0;
    api.inferStandaloneEpisodeFromPrequels = () => { calls += 1; return pending.promise; };
    const first = api.refreshStandaloneEpisodeInference();
    const second = api.refreshStandaloneEpisodeInference();
    assert.equal(calls, 1);
    pending.resolve(expected());
    await Promise.all([first, second]);
    assertInference(api.getStandaloneEpisodeInferenceResult());
    const renders = api.renders;
    await api.refreshStandaloneEpisodeInference();
    assert.equal(calls, 1);
    assert.equal(api.renders, renders, "a cached result does not render again");
    assert.ok(renders > 0);
  });

  test(`${label}: a failed or empty inference is cached until the loaded context changes`, async () => {
    for (const fail of [false, true]) {
      const api = setup(source);
      let calls = 0;
      api.inferStandaloneEpisodeFromPrequels = async () => { calls += 1; if (fail) throw new Error("offline"); return null; };
      await api.refreshStandaloneEpisodeInference();
      await api.refreshStandaloneEpisodeInference();
      assert.equal(calls, 1, "repeated renders must not become automatic API retries");
      assert.equal(api.renders, 0);
      assert.equal(api.getStandaloneEpisodeInferenceResult(), null);
      api.state.episodes = structuredClone(api.state.episodes);
      await api.refreshStandaloneEpisodeInference();
      assert.equal(calls, 2, "an explicit data reload permits another attempt");
    }
  });

  for (const [change, mutate] of [
    ["page", (api) => { api.state.pageKey = "video:BVOTHER"; api.location.pathname = "/video/BVOTHER/"; api.location.href = "https://www.bilibili.com/video/BVOTHER/"; }],
    ["route sequence", (api) => { api.routeRefreshSeq += 1; }],
    ["title", (api) => { api.rawTitle = TITLE.replace("第17话", "第16话"); api.state.currentEpisodeNo = 16; }],
    ["subject binding", (api) => { api.state.subjectId = 777; api.state.subject = { ...api.state.subject, id: 777 }; }],
    ["subject metadata", (api) => { api.state.subject = structuredClone(api.state.subject); }],
    ["token", (api) => { api.state.token = "token-b"; }],
    ["episode list", (api) => { api.state.episodes = structuredClone(api.state.episodes); }],
  ]) {
    test(`${label}: an unrefreshed ${change} change prevents a pending result from becoming visible`, async () => {
      const api = setup(source);
      const pending = deferred();
      api.inferStandaloneEpisodeFromPrequels = () => pending.promise;
      const first = api.refreshStandaloneEpisodeInference();
      mutate(api);
      pending.resolve(expected());
      await first;
      assert.equal(api.getStandaloneEpisodeInferenceResult(), null);
      assert.equal(api.state.standaloneEpisodeInference?.result, null);
      assert.equal(api.renders, 0, "context invalidation must work even before a replacement refresh starts");
    });
    for (const rejectOld of [false, true]) {
      test(`${label}: late ${rejectOld ? "failure" : "success"} cannot override inference after a ${change} change`, async () => {
        const api = setup(source);
        const requests = [];
        api.inferStandaloneEpisodeFromPrequels = () => { const request = deferred(); requests.push(request); return request.promise; };
        const first = api.refreshStandaloneEpisodeInference();
        assert.equal(requests.length, 1);
        mutate(api);
        assert.equal(api.getStandaloneEpisodeInferenceResult(), null);
        const second = api.refreshStandaloneEpisodeInference();
        assert.equal(requests.length, 2, "a changed context must start its own inference");
        const updated = expected(api.state.currentEpisodeNo);
        requests[1].resolve(updated);
        await second;
        const currentRecord = api.state.standaloneEpisodeInference;
        const renders = api.renders;
        if (rejectOld) requests[0].reject(new Error("old request failed"));
        else requests[0].resolve(expected());
        await first;
        assert.equal(api.state.standaloneEpisodeInference, currentRecord);
        assertInference(api.getStandaloneEpisodeInferenceResult(), updated);
        assert.equal(api.renders, renders, "stale completion must not rerender the new page");
      });
    }
  }

  test(`${label}: changing to an excluded mode drops a pending result without restarting it`, async () => {
    const api = setup(source);
    const pending = deferred();
    let calls = 0;
    api.inferStandaloneEpisodeFromPrequels = () => { calls += 1; return pending.promise; };
    const first = api.refreshStandaloneEpisodeInference();
    api.longVideoMode = true;
    await api.refreshStandaloneEpisodeInference();
    pending.resolve(expected());
    await first;
    assert.equal(calls, 1);
    assert.equal(api.getStandaloneEpisodeInferenceResult(), null);
    assert.equal(api.renders, 0);
  });
}
