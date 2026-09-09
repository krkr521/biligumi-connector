"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

const functionNames = [
  "getCollectionInferenceSeasonInfo",
  "getCollectionInferenceSubjectTitles",
  "getCollectionInferenceSubjectIdentity",
  "collectionInferenceTitlesMatch",
  "collectionInferenceSourceMatches",
  "getCollectionInferenceSourceCount",
  "getCollectionInferenceAirDay",
  "getCollectionInferenceEpisodeEvidence",
  "inferCollectionRangeBindingStartFromEvidence",
  "inferCollectionRangeBindingStart",
];
const source = readSource(USERSCRIPT_PATH);
const extension = readSource(EXTENSION_PATH);
const functions = functionNames.map((name) => {
  const options = { async: name === "inferCollectionRangeBindingStart" };
  const implementation = extractFunction(source, name, options);
  assert.equal(implementation, extractFunction(extension, name, options), name + " must stay mirrored");
  return implementation;
}).join("\n");

function sandboxFor(responses = {}, overrides = {}) {
  const requests = [];
  const sandbox = {
    requests,
    bgmRequest: async (path) => {
      requests.push(path);
      if (!Object.prototype.hasOwnProperty.call(responses, path)) throw new Error("Unexpected API path " + path);
      return structuredClone(responses[path]);
    },
    bgmRequestPagedData: async (path) => {
      requests.push(path);
      if (!Object.prototype.hasOwnProperty.call(responses, path)) throw new Error("Unexpected episode path " + path);
      return structuredClone(responses[path]);
    },
    ...overrides,
  };
  runInSandbox(functions, sandbox);
  return sandbox;
}

function episodeResponse(id, count, firstSort, firstDate, firstEp = 1) {
  return {
    total: count,
    data: Array.from({ length: count }, (_, index) => ({
      id: id * 100 + index,
      type: 0,
      sort: firstSort + index,
      ep: firstEp + index,
      airdate: new Date(Date.parse(firstDate + "T00:00:00Z") + index * 7 * 86400000).toISOString().slice(0, 10),
    })),
  };
}

function subject(id, count, seasonNo = 4, suffix = "") {
  return {
    id,
    type: 2,
    name: "Re:ゼロから始める異世界生活 " + seasonNo + "th season " + suffix,
    name_cn: "Re：从零开始的异世界生活 第" + seasonNo + "季 " + suffix,
    total_episodes: count,
    eps: count,
    infobox: [{ key: "话数", value: String(count) }, { key: "别名", value: [{ v: "re0 第" + seasonNo + "季 " + suffix }] }],
  };
}

function relation(entry, relationName = "前传") {
  return { id: entry.id, type: entry.type, name: entry.name, name_cn: entry.name_cn, relation: relationName };
}

function fixture() {
  const first = subject(547888, 11, 4, "丧失篇");
  const last = subject(633836, 8, 4, "夺还篇");
  const earlier = subject(510728, 8, 3, "反击篇");
  return {
    "/v0/subjects/547888": first,
    "/v0/subjects/633836": last,
    "/v0/episodes?subject_id=547888&type=0": episodeResponse(first.id, 11, 67, "2026-04-08"),
    "/v0/episodes?subject_id=633836&type=0": episodeResponse(last.id, 8, 78, "2026-08-12"),
    "/v0/subjects/633836/subjects": [
      relation(first),
      { id: 638494, type: 2, relation: "衍生", name: "Re:ゼロから始める休憩時間 4th season", name_cn: "Re：从零开始的休息时间4" },
      { id: 121927, type: 1, relation: "书籍", name: "Re:ゼロから始める異世界生活" },
    ],
    "/v0/subjects/547888/subjects": [relation(earlier), relation(last, "续集")],
  };
}

function context(count = 15) {
  return {
    seasonKey: "season:4",
    seasonNo: 4,
    groupStart: 1,
    groupEnd: count,
    episodeNo: count,
    groupLogicalEpisodeCount: count,
    collectionTitle: "【Re：从零开始的异世界生活 全四季】4K超清未删减完整版",
    hasSplitEpisodes: false,
    segmentCount: 1,
    sourceEpisodes: Array.from({ length: count }, (_, index) => ({
      episodeNo: index + 1,
      partNo: 17 + index,
      fragmentIndex: 1,
      title: "第四季" + (index + 1),
    })),
  };
}

const now = "2026-09-09T12:00:00";

test("live Re0 split season: fourth-season episode 12 / P28 starts the eight-episode second part", async () => {
  const api = fixture();
  const sandbox = sandboxFor(api);
  const result = await sandbox.inferCollectionRangeBindingStart(context(), 633836, { now });
  assert.equal(result.sourceStart, 12);
  assert.equal(result.expectedEnd, 19);
  assert.match(result.reason, /前篇共11集，本篇8集/);
  assert.match(result.reason, /已上传15集，已播15集、今明两天放送窗口1集/);
  assert.equal(sandbox.requests.some((path) => path.includes("510728")), false, "stop before requesting the previous season");
});

test("airing upload check allows at most one late episode and today's or tomorrow's optional upload", async () => {
  for (const count of [14, 15, 16]) {
    const sandbox = sandboxFor(fixture());
    assert.ok(await sandbox.inferCollectionRangeBindingStart(context(count), 633836, { now }), "September 9 accepts " + count);
  }
  for (const count of [12, 13, 17, 19]) {
    const sandbox = sandboxFor(fixture());
    assert.equal(await sandbox.inferCollectionRangeBindingStart(context(count), 633836, { now }), null, "September 9 rejects " + count);
  }
  const tomorrowWindow = sandboxFor(fixture());
  assert.ok(await tomorrowWindow.inferCollectionRangeBindingStart(context(15), 633836, { now: "2026-09-08T12:00:00" }));
  assert.ok(await tomorrowWindow.inferCollectionRangeBindingStart(context(16), 633836, { now: "2026-09-08T12:00:00" }));
  assert.equal(await tomorrowWindow.inferCollectionRangeBindingStart(context(16), 633836, { now: "2026-09-07T12:00:00" }), null);
});

test("a completed season must match its entire expected total", async () => {
  const sandbox = sandboxFor(fixture());
  const result = await sandbox.inferCollectionRangeBindingStart(context(19), 633836, { now: "2026-10-01T12:00:00" });
  assert.equal(result.sourceStart, 12);
  assert.match(result.reason, /全季正片数量与合集一致/);
  assert.equal(await sandbox.inferCollectionRangeBindingStart(context(18), 633836, { now: "2026-10-01T12:00:00" }), null);
});

test("source season and recognizable series title are both required", async () => {
  for (const input of [
    { ...context(), collectionTitle: "第四季14" },
    { ...context(), collectionTitle: "Another Show 第四季" },
    { ...context(), collectionTitle: "fire0foo 第四季" },
    { ...context(), seasonNo: 3, seasonKey: "season:3" },
  ]) {
    assert.equal(await sandboxFor(fixture()).inferCollectionRangeBindingStart(input, 633836, { now }), null);
  }
  assert.ok(await sandboxFor(fixture()).inferCollectionRangeBindingStart({ ...context(), collectionTitle: "【合集】re0 第3-4季" }, 633836, { now }));
});

test("Part and cour numbers never masquerade as season numbers", () => {
  const sandbox = sandboxFor();
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("Anime Part 2"), null);
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("Anime 2nd cour"), null);
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("Anime 第2部"), null);
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("Anime 4th season Part 2").seasonNo, 4);
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("Anime Season 4 Part 2").seasonNo, 4);
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("某部动画 第四季 第二部分").seasonNo, 4);
  assert.equal(sandbox.getCollectionInferenceSeasonInfo("Anime S4 Season 3"), null);
});

test("incomplete, duplicate and out-of-order source groups fall back before API requests", async () => {
  const cases = [];
  let input = context();
  input.sourceEpisodes[4].episodeNo = 6;
  cases.push(input);
  input = context();
  input.sourceEpisodes[4].episodeNo = 4;
  cases.push(input);
  input = context();
  [input.sourceEpisodes[4], input.sourceEpisodes[5]] = [input.sourceEpisodes[5], input.sourceEpisodes[4]];
  cases.push(input);
  input = context();
  input.sourceEpisodes[4].partNo += 1;
  cases.push(input);
  input = context();
  input.sourceEpisodes[4].fragmentIndex = 2;
  cases.push(input);
  cases.push({ ...context(), hasSplitEpisodes: true });
  cases.push({ ...context(), groupStart: 2 });
  cases.push({ ...context(), sourceEpisodes: [] });
  for (const malformed of cases) {
    const sandbox = sandboxFor(fixture());
    assert.equal(await sandbox.inferCollectionRangeBindingStart(malformed, 633836, { now }), null);
    assert.equal(sandbox.requests.length, 0);
  }
});

function fragmentedContext(count = 15) {
  const input = context(count);
  input.hasSplitEpisodes = true;
  input.segmentCount = 2;
  input.sourceEpisodes = input.sourceEpisodes.flatMap((row, index) => [
    { ...row, title: `4.${row.episodeNo}.1`, partNo: 17 + index * 2, fragmentIndex: 1, fragmentCount: 2 },
    { ...row, title: `4.${row.episodeNo}.2`, partNo: 18 + index * 2, fragmentIndex: 2, fragmentCount: 2 },
  ]);
  return input;
}

test("split uploads are counted as logical episodes and keep the one-episode airing allowance", async () => {
  for (const count of [14, 15, 16]) {
    const sandbox = sandboxFor(fixture());
    const input = fragmentedContext(count);
    assert.equal(sandbox.getCollectionInferenceSourceCount(input), count, "two P still count as one episode");
    const result = await sandbox.inferCollectionRangeBindingStart(input, 633836, { now });
    assert.equal(result.sourceStart, 12);
    assert.equal(result.expectedEnd, 19);
    assert.match(result.reason, new RegExp("已上传" + count + "集"));
  }
  assert.equal(await sandboxFor(fixture()).inferCollectionRangeBindingStart(fragmentedContext(13), 633836, { now }), null);
  const completed = sandboxFor(fixture());
  assert.ok(await completed.inferCollectionRangeBindingStart(fragmentedContext(19), 633836, { now: "2026-10-01T12:00:00" }));
  assert.equal(await completed.inferCollectionRangeBindingStart(fragmentedContext(18), 633836, { now: "2026-10-01T12:00:00" }), null);
});

test("variable split counts work, while missing, duplicate and reversed fragments require manual selection", async () => {
  const variable = fragmentedContext();
  variable.sourceEpisodes.splice(2, 0, { episodeNo: 1, fragmentIndex: 3, fragmentCount: 3, title: "4.1.3" });
  variable.sourceEpisodes.forEach((row, index) => { row.partNo = 17 + index; });
  assert.equal(sandboxFor().getCollectionInferenceSourceCount(variable), 15);
  assert.ok(await sandboxFor(fixture()).inferCollectionRangeBindingStart(variable, 633836, { now }));
  const mutations = [
    (input) => { input.sourceEpisodes.pop(); },
    (input) => { input.sourceEpisodes.splice(7, 1); },
    (input) => { input.sourceEpisodes[7].fragmentIndex = 1; },
    (input) => { input.sourceEpisodes[7].fragmentIndex = 3; },
    (input) => { input.sourceEpisodes[7].fragmentIndex = 0; },
    (input) => { input.sourceEpisodes[7].fragmentIndex = 9; },
    (input) => { input.sourceEpisodes[7].fragmentCount = 3; },
    (input) => { input.sourceEpisodes.reverse(); },
  ];
  for (const mutate of mutations) {
    const input = fragmentedContext();
    mutate(input);
    const sandbox = sandboxFor(fixture());
    assert.equal(await sandbox.inferCollectionRangeBindingStart(input, 633836, { now }), null);
    assert.equal(sandbox.requests.length, 0);
  }
});

test("incomplete or inconsistent subject/episode metadata is not trusted", async () => {
  const mutations = [
    (api) => { api["/v0/subjects/547888"].total_episodes = 0; },
    (api) => { api["/v0/subjects/547888"].eps = 12; },
    (api) => { api["/v0/subjects/547888"].type = 1; },
    (api) => { api["/v0/subjects/547888"].infobox[0].value = "12"; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data.pop(); },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data[4] = null; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].total = 12; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data[4].airdate = ""; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data[4].airdate = "2026-02-30"; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data[4].type = 1; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data[4].id = api["/v0/episodes?subject_id=547888&type=0"].data[3].id; },
    (api) => { api["/v0/episodes?subject_id=547888&type=0"].data[4].sort += 1; },
  ];
  for (const mutate of mutations) {
    const api = fixture();
    mutate(api);
    assert.equal(await sandboxFor(api).inferCollectionRangeBindingStart(context(), 633836, { now }), null);
  }
});

test("a continuous global sort or ep boundary is required across split subjects", async () => {
  const resetBoth = fixture();
  resetBoth["/v0/episodes?subject_id=633836&type=0"].data.forEach((entry, index) => { entry.sort = index + 1; });
  assert.equal(await sandboxFor(resetBoth).inferCollectionRangeBindingStart(context(), 633836, { now }), null);
  const continuousEp = fixture();
  continuousEp["/v0/episodes?subject_id=633836&type=0"].data.forEach((entry, index) => { entry.sort = index + 1; entry.ep = 12 + index; });
  assert.ok(await sandboxFor(continuousEp).inferCollectionRangeBindingStart(context(), 633836, { now }));
});

test("unrelated, ambiguous, special, cyclic, or unclassified prequels never supply an offset", async () => {
  const mutations = [
    (api) => { api["/v0/subjects/633836/subjects"][0].name = "Other 4th season"; api["/v0/subjects/633836/subjects"][0].name_cn = ""; },
    (api) => { api["/v0/subjects/633836/subjects"].push(relation(subject(100, 11))); },
    (api) => { api["/v0/subjects/633836/subjects"][0].name_cn += " 总集篇"; },
    (api) => { api["/v0/subjects/547888/subjects"] = [relation(api["/v0/subjects/633836"])]; },
    (api) => { api["/v0/subjects/547888/subjects"][0].name = "Anime Part 2"; api["/v0/subjects/547888/subjects"][0].name_cn = ""; },
    (api) => { api["/v0/subjects/633836/subjects"] = []; },
  ];
  for (const mutate of mutations) {
    const api = fixture();
    mutate(api);
    assert.equal(await sandboxFor(api).inferCollectionRangeBindingStart(context(), 633836, { now }), null);
  }
});

test("public API errors and changed route context return null without further dependent work", async () => {
  const failing = sandboxFor(fixture(), { bgmRequest: async () => { throw new Error("offline"); } });
  assert.equal(await failing.inferCollectionRangeBindingStart(context(), 633836, { now }), null);
  let current = true;
  let reads = 0;
  const api = fixture();
  const stale = sandboxFor(api, {
    bgmRequest: async (path) => {
      reads += 1;
      if (path.endsWith("/subjects")) current = false;
      return structuredClone(api[path]);
    },
  });
  assert.equal(await stale.inferCollectionRangeBindingStart(context(), 633836, { now, isCurrent: () => current }), null);
  assert.equal(reads, 2, "changed route must stop before reading a prequel");
  const initiallyStale = sandboxFor(api);
  assert.equal(await initiallyStale.inferCollectionRangeBindingStart(context(), 633836, { now, isCurrent: () => false }), null);
  assert.equal(initiallyStale.requests.length, 0);
});

test("selecting the first part uses the whole same-season chain but returns only its own range", async () => {
  const sandbox = sandboxFor(fixture());
  const input = { ...context(), episodeNo: 5 };
  const result = await sandbox.inferCollectionRangeBindingStart(input, 547888, { now });
  assert.equal(result.sourceStart, 1);
  assert.equal(result.expectedEnd, 11);
  assert.match(result.reason, /本篇11集，全季共19集/);
  assert.match(result.reason, /已上传15集，已播15集/);
  assert.equal(sandbox.requests.filter((path) => path === "/v0/subjects/547888/subjects").length, 1, "reuse relations when switching traversal direction");
  assert.equal(sandbox.requests.some((path) => path.includes("510728")), false, "previous seasons must not inflate the upload count");
});

test("a complete single-subject season starts at one, with current episode containment required", async () => {
  const api = fixture();
  api["/v0/subjects/547888/subjects"] = [];
  const sandbox = sandboxFor(api);
  const result = await sandbox.inferCollectionRangeBindingStart({ ...context(11), episodeNo: 7 }, 547888, { now });
  assert.equal(result.sourceStart, 1);
  assert.equal(result.expectedEnd, 11);
  assert.match(result.reason, /正片列表/);
  assert.equal(sandbox.requests.some((path) => path.includes("633836")), false);
  for (const input of [
    { ...context(), episodeNo: 5 },
    { ...context(), episodeNo: 0 },
    { ...context(), episodeNo: 20 },
    { ...context(), episodeNo: undefined },
  ]) {
    assert.equal(await sandboxFor(fixture()).inferCollectionRangeBindingStart(input, 633836, { now }), null, "second part cannot be suggested for a current source episode outside 12-19");
  }
  assert.equal(await sandboxFor(fixture()).inferCollectionRangeBindingStart(context(), 547888, { now }), null, "first part cannot be suggested while the current source episode belongs to the second part");
});

test("sequel branches, unknown seasons, nonreciprocal links and cyclic sequels require manual selection", async () => {
  const mutations = [
    (api) => { api["/v0/subjects/547888/subjects"].push(relation(subject(100, 8), "续集")); },
    (api) => { api["/v0/subjects/633836/subjects"].push({ id: 100, type: 2, relation: "续集", name: "Anime Part 3" }); },
    (api) => { api["/v0/subjects/633836/subjects"] = []; },
    (api) => { api["/v0/subjects/633836/subjects"].push(relation(api["/v0/subjects/547888"], "续集")); },
  ];
  for (const mutate of mutations) {
    const api = fixture();
    mutate(api);
    assert.equal(await sandboxFor(api).inferCollectionRangeBindingStart({ ...context(), episodeNo: 5 }, 547888, { now }), null);
  }
  const nextSeason = fixture();
  nextSeason["/v0/subjects/633836/subjects"].push(relation(subject(777777, 12, 5), "续集"));
  const sandbox = sandboxFor(nextSeason);
  assert.ok(await sandbox.inferCollectionRangeBindingStart(context(), 633836, { now }));
  assert.equal(sandbox.requests.some((path) => path.includes("777777")), false, "next seasons are a boundary rather than extra episodes");
});

test("a middle part can use a five-part season; a sixth related part exceeds the confidence bound", async () => {
  function chainFixture(length) {
    const api = {};
    for (let index = 0; index < length; index += 1) {
      const id = 1000 + index;
      const entry = subject(id, 2, 4, "篇" + index);
      api["/v0/subjects/" + id] = entry;
      const airdate = new Date(Date.parse("2026-01-01T00:00:00Z") + index * 14 * 86400000).toISOString().slice(0, 10);
      api["/v0/episodes?subject_id=" + id + "&type=0"] = episodeResponse(id, 2, index * 2 + 1, airdate);
      api["/v0/subjects/" + id + "/subjects"] = [];
      if (index > 0) api["/v0/subjects/" + id + "/subjects"].push(relation(subject(id - 1, 2, 4, "篇" + (index - 1))));
      if (index < length - 1) api["/v0/subjects/" + id + "/subjects"].push(relation(subject(id + 1, 2, 4, "篇" + (index + 1)), "续集"));
    }
    return api;
  }
  const input = { ...context(10), episodeNo: 5 };
  const result = await sandboxFor(chainFixture(5)).inferCollectionRangeBindingStart(input, 1002, { now });
  assert.equal(result.sourceStart, 5);
  assert.equal(result.expectedEnd, 6);
  assert.equal(await sandboxFor(chainFixture(6)).inferCollectionRangeBindingStart({ ...context(12), episodeNo: 5 }, 1002, { now }), null);
});

test("pure inference and public API flow do not mutate supplied context or fixtures", async () => {
  const input = context();
  const api = fixture();
  const contextBefore = structuredClone(input);
  const apiBefore = structuredClone(api);
  await sandboxFor(api).inferCollectionRangeBindingStart(input, 633836, { now });
  assert.deepEqual(input, contextBefore);
  assert.deepEqual(api, apiBefore);
});
