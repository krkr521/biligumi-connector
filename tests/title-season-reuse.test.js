"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource } = require("./_source");
const { loadParsingFixture } = require("./_parsing-fixture");

const constants = [
  "EPISODE_PATTERNS", "EPISODE_NUMBER_SOURCE", "EPISODE_MARKER_SOURCE",
  "EPISODE_RANGE_MARKER_SOURCE", "LABELED_EPISODE_RANGE_SOURCE", "COMMON_RESOLUTIONS",
  "TITLE_PROPERTY_TAGS", "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN",
  "WHITELIST_NEWS_NON_MAIN_PATTERN",
];
const functions = [
  "getCurrentBinding", "getTitleBindingKey", "getTitleBindingTitleToken",
  "getTitleBindingInfo", "canReuseTitleBinding", "canReuseOfficialDirectBinding",
  "doesCurrentTitleMatchSubjectEvidence", "isTitleEvidenceMatch", "hasTitleSeasonConflict",
  "getTitleSeasonNumber", "parseChineseTitleNumber", "getTitleBigramDice",
  "normalizeBindingToken", "normalizeTitleMatchToken", "resolveCurrentPageTitle",
  "cleanTitle", "extractAnimeWorkTitle", "extractQuotedWorkTitle", "getNonMainTitleSource",
  "extractTitleBeforeEpisodeMarker", "extractTitleAfterJapaneseQuoteBeforeEpisode",
  "stripNonMainEdgeBracketTags", "stripNonMainMarkerTail", "stripNonMainPromoSuffix",
  "normalizeTitleText", "cleanupAnimeTitle", "stripEpisodeMarkersAtEdges", "isTitleMetaTag",
  "isTitlePropertyTag", "isSeasonMarker", "isEpisodeMarkerToken", "isCommonResolutionNumber",
  "isReleaseInfoTag", "isNonMainEpisodeTitle", "isWhitelistNewsNonMainTitle",
  "detectEpisodeNo", "isTotalEpisodeCountMatch", "isEpisodeRangeMatch", "hasEpisodeRangeMarker",
  "parseChineseNumber",
];

function setup(source) {
  const sandbox = {
    rawTitle: "【第二季】葬送的芙莉莲 第1集", seriesTitle: "", officialContextTitle: "", official: false,
    state: {
      subjectId: null, message: "", bindingGuardMessage: "", pageTitle: "", bindings: {},
      bindingSubjects: { "111": { names: ["葬送的芙莉莲"], totalEpisodes: 28 } },
    },
    STORAGE: { bindings: "bindings", bindingSubjects: "bindingSubjects", collectionMappings: "collectionMappings" },
    getPageTitle: () => sandbox.rawTitle,
    getSeriesTitle: () => sandbox.seriesTitle,
    getOfficialBangumiContextTitle: () => sandbox.officialContextTitle,
    shouldUseRawTitleForPreview: () => false,
    getPageOwnerInfo: () => ({ mid: "42" }),
    readJsonValue: (key, fallback) => sandbox.state[key] || fallback,
    normalizeCollectionMappings: (value) => value,
    getCurrentCollectionPartContext: () => null,
    getCurrentCollectionLayoutContext: () => null,
    getDirectBindingKeysForCurrentPage: () => ["/video/BVNEW"],
    getCurrentLongVideoPartBindingKey: () => "",
    getOfficialBangumiBaseBindingKeys: () => [],
    isOfficialBangumiPage: () => sandbox.official,
    getCrossOwnerTitleBinding: () => null,
    getNonMainTitleBinding: () => null,
    getTitleBindingSubjectIdsByToken: () => [],
    migrations: [],
    migrateCurrentBindingKeys: (id) => sandbox.migrations.push(id),
  };
  return loadParsingFixture(source, functions, sandbox, constants);
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);
  test(`${label}: bracketed season metadata cannot inherit and migrate an older season`, () => {
    for (const rawTitle of ["【第二季】葬送的芙莉莲 第1集", "[S2] 葬送的芙莉莲 第1集"]) {
      const api = setup(source);
      api.rawTitle = rawTitle;
      api.state.bindings["title:42|葬送的芙莉莲"] = 111;
      assert.equal(api.getTitleBindingInfo().cleanedTitle, "葬送的芙莉莲");
      assert.equal(api.getTitleBindingInfo().seasonNo, 2);
      assert.equal(api.getCurrentBinding(), null);
      assert.deepEqual(api.migrations, []);
      assert.match(api.state.bindingGuardMessage, /季度/);
    }
  });

  test(`${label}: matching second-season evidence and ordinary first-season reuse still work`, () => {
    const api = setup(source);
    api.state.bindings["title:42|葬送的芙莉莲"] = 111;
    api.state.bindingSubjects["111"].names = ["葬送的芙莉莲", "葬送的芙莉莲 第二季"];
    assert.equal(api.getCurrentBinding(), 111);
    assert.deepEqual(api.migrations, [111]);
    api.rawTitle = "【第一季】葬送的芙莉莲 第2集";
    api.state.bindingSubjects["111"].names = ["葬送的芙莉莲"];
    assert.equal(api.getCurrentBinding(), 111);
    api.rawTitle = "葬送的芙莉莲 第3集";
    assert.equal(api.getCurrentBinding(), 111);
    api.state.bindingSubjects["111"].names = ["葬送的芙莉莲 第二季"];
    assert.equal(api.getCurrentBinding(), null, "an unseasoned title must not silently become season two");
  });

  test(`${label}: title-body priority survives extracting raw season evidence`, () => {
    const api = setup(source);
    api.rawTitle = "【第二季】TV动画《葬送的芙莉莲》 第1话《冒险的终点》";
    const info = api.getTitleBindingInfo();
    assert.equal(info.cleanedTitle, "葬送的芙莉莲");
    assert.equal(info.seasonNo, 2);
    api.officialContextTitle = "BanG Dream! 梦想协奏曲 第三季 元祖迷你";
    api.seriesTitle = "BanG Dream! 梦想协奏曲 第三季";
    api.rawTitle = "BanG Dream! 梦想协奏曲 第三季 第2集";
    assert.equal(api.getTitleBindingInfo().cleanedTitle, "BanG Dream! 梦想协奏曲 第三季 元祖迷你");
    assert.equal(api.getTitleBindingInfo().seasonNo, 3);
  });

  test(`${label}: English season guards run before punctuation and spaces are removed`, () => {
    const api = setup(source);
    api.official = true;
    api.rawTitle = "Example Anime Season 2 Episode 1";
    api.seriesTitle = "Example Anime Season 2";
    api.state.bindingSubjects["111"].names = ["Example Anime"];
    assert.equal(api.canReuseOfficialDirectBinding(111), false);
    api.state.bindingSubjects["111"].names = ["Example Anime Season 2"];
    assert.equal(api.canReuseOfficialDirectBinding(111), true);
    api.officialContextTitle = "Example Anime";
    api.seriesTitle = "[S2] Example Anime";
    api.rawTitle = "[S2] Example Anime Episode 1";
    api.state.bindingSubjects["111"].names = ["Example Anime"];
    assert.equal(api.canReuseOfficialDirectBinding(111), false, "a cleaned official context must retain its raw S2 evidence");
  });
}
