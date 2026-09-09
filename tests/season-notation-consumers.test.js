"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");
const { loadParsingFixture } = require("./_parsing-fixture");

const names = ["getTitleSeasonNumber", "parseChineseTitleNumber", "getCollectionInferenceSeasonInfo", "getCurrentSeasonSearchKeyword", "getTitleSubdivisionInfo", "hasTitleSubdivisionConflict"];
const constants = [
  "EPISODE_PATTERNS", "EPISODE_NUMBER_SOURCE", "EPISODE_MARKER_SOURCE",
  "EPISODE_RANGE_MARKER_SOURCE", "LABELED_EPISODE_RANGE_SOURCE", "COMMON_RESOLUTIONS",
  "TITLE_PROPERTY_TAGS", "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN",
  "WHITELIST_NEWS_NON_MAIN_PATTERN",
];
const titleFunctions = [
  "getTitleBindingInfo", "resolveCurrentPageTitle", "normalizeBindingToken", "normalizeTitleMatchToken",
  "cleanTitle", "extractAnimeWorkTitle", "extractQuotedWorkTitle", "getNonMainTitleSource",
  "extractTitleBeforeEpisodeMarker", "extractTitleAfterJapaneseQuoteBeforeEpisode",
  "stripNonMainEdgeBracketTags", "stripNonMainMarkerTail", "stripNonMainPromoSuffix",
  "normalizeTitleText", "cleanupAnimeTitle", "stripEpisodeMarkersAtEdges", "isTitleMetaTag",
  "isTitlePropertyTag", "isSeasonMarker", "isEpisodeMarkerToken", "isCommonResolutionNumber",
  "isReleaseInfoTag", "isNonMainEpisodeTitle", "isWhitelistNewsNonMainTitle",
  "detectEpisodeNo", "isTotalEpisodeCountMatch", "isEpisodeRangeMatch", "hasEpisodeRangeMarker",
  "parseChineseNumber",
];

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);
  function setup() {
    const sandbox = {
      state: { rawTitle: "Example Anime 全四季" },
      collectionContext: { seasonNo: 4, title: "4.12.1" },
      videoPart: { seasonNo: null, title: "" },
      getCurrentCollectionPartContext: () => sandbox.collectionContext,
      getCurrentVideoPartContext: () => sandbox.videoPart,
      getPageTitle: () => sandbox.state.rawTitle,
      getSeriesTitle: () => "", getOfficialBangumiContextTitle: () => "", shouldUseRawTitleForPreview: () => false,
    };
    return loadParsingFixture(source, [...names, ...titleFunctions], sandbox, constants);
  }

  test(`${label}: explicit Chinese, Japanese, English and full-width season notations agree`, () => {
    const api = setup();
    for (const notation of ["第四季", "第4期", "第４季", "第4シーズン", "4季", "四季", "S04", "Ｓ０４", "S04E12", "4th Season", "Fourth Season", "Season Four", "Season IV", "Season Ⅳ", "IV Season", "シーズン4"]) {
      const title = "Example Anime " + notation;
      assert.equal(api.getTitleSeasonNumber(title), 4, notation);
      const inferred = api.getCollectionInferenceSeasonInfo(title);
      assert.equal(inferred?.seasonNo, 4, notation);
      assert.equal(inferred?.base, "exampleanime", notation);
    }
    assert.equal(api.getCollectionInferenceSeasonInfo("某部动画Season IV").base, "某部动画", "an English marker must not consume the preceding Chinese title character");
    assert.equal(api.getCollectionInferenceSeasonInfo("【Season IV】Example Anime").base, "exampleanime");
  });

  test(`${label}: actual season evidence outranks subdivision labels without promoting subdivisions to inference`, () => {
    const api = setup();
    for (const title of ["Example Anime Part 2 Season 4", "Example Anime 第四季 第1部", "Example Anime Season IV 2nd cour"]) {
      assert.equal(api.getTitleSeasonNumber(title), 4, title);
      assert.equal(api.getCollectionInferenceSeasonInfo(title)?.seasonNo, 4, title);
    }
    for (const title of ["Example Anime Part 2", "Example Anime 2nd cour", "Example Anime 第2部"]) {
      assert.equal(api.getTitleSeasonNumber(title), 2, "legacy subdivision binding isolation remains available");
      assert.equal(api.getCollectionInferenceSeasonInfo(title), null, "a subdivision is insufficient for same-season offsets");
    }
    assert.equal(api.getCollectionInferenceSeasonInfo("Example Anime Season 4 Part 1-2")?.seasonNo, 4);
  });

  test(`${label}: multi-season ranges, lists and counts never become a single season`, () => {
    const api = setup();
    for (const notation of ["全1-4季", "全四季", "第一至第四季", "第1季至第4季", "第1、2、3、4季", "S1-S4", "S1/S4", "Seasons 1-4", "Season I-IV", "Seasons One to Four", "1st-4th Seasons", "All Four Seasons", "S4 Season 3"]) {
      const title = "Example Anime " + notation;
      assert.equal(api.getTitleSeasonNumber(title), 0, notation);
      assert.equal(api.getCollectionInferenceSeasonInfo(title), null, notation);
    }
    for (const title of ["22/7", "86", "4月新番", "4.12.1", "4.12", "2.5", "1080P", "OS4", "Season IIII", "Season IVX", "Season 0"]) {
      assert.equal(api.getTitleSeasonNumber(title), 0, title);
      assert.equal(api.getCollectionInferenceSeasonInfo("Example Anime " + title), null, title);
    }
  });

  test(`${label}: search uses the active qualified part after removing collection-wide season labels`, () => {
    const api = setup();
    for (const title of ["Example Anime 全四季", "Example Anime 第1-4季", "Example Anime 第一至第四季", "Example Anime S1-S4", "Example Anime Seasons One to Four", "Example Anime 1st-4th Seasons", "Example Anime 第一季 第二季 第三季 第四季", "Example Anime Season IV"]) {
      api.state.rawTitle = title;
      assert.equal(api.getCurrentSeasonSearchKeyword(), "Example Anime 第4季", title);
    }
    api.collectionContext = { seasonNo: 1, title: "1.1.1" };
    api.state.rawTitle = "Example Anime 第一至第四季";
    assert.equal(api.getCurrentSeasonSearchKeyword(), "Example Anime", "season one searches the base work name");
    api.collectionContext = { seasonNo: 4, title: "4.12.1" };
    api.state.rawTitle = "【某部动画 第1-4季】4K超清未删减完整版";
    assert.equal(api.getCurrentSeasonSearchKeyword(), "某部动画 第4季");
  });

  test(`${label}: short unqualified lists can use explicit season labels but cannot guess from decimals or cour numbers`, () => {
    const api = setup();
    api.collectionContext = null;
    for (const title of ["第4期 第12集", "Season IV EP12", "Fourth Season EP12", "Ｓ０４Ｅ１２"]) {
      api.videoPart = { seasonNo: null, title };
      assert.equal(api.getCurrentSeasonSearchKeyword(), "Example Anime 第4季", title);
    }
    for (const title of ["4.12.1", "4.12", "Part 2", "2nd cour", "Season Unknown Part 2"]) {
      api.videoPart = { seasonNo: null, title };
      assert.equal(api.getCurrentSeasonSearchKeyword(), "", title);
    }
  });

  test(`${label}: bracketed season metadata preserves the work name and binding's real season`, () => {
    const api = setup();
    for (const marker of ["Season IV", "Season Four", "Fourth Season", "第４期", "シーズン4"]) {
      api.state.rawTitle = `[${marker}] Example Anime`;
      const info = api.getTitleBindingInfo();
      assert.equal(info.cleanedTitle, "Example Anime", marker);
      assert.equal(info.seasonNo, 4, marker);
    }
    for (const title of ["Four Seasons", "Season IIII", "4.12.1", "Season Unknown"]) {
      assert.equal(api.isSeasonMarker(title), false, title);
    }
  });

  test(`${label}: a numerical work title is not consumed as the beginning of a reversed season range`, () => {
    const api = setup();
    for (const [title, seasonNo, expected] of [
      ["22/7 Season 4", 4, "22/7 第4季"],
      ["【22/7 Season 4】", 4, "22/7 第4季"],
      ["86 - 2nd Season", 2, "86 第2季"],
      ["【86 - 2nd Season】", 2, "86 第2季"],
    ]) {
      api.state.rawTitle = title;
      api.collectionContext = { seasonNo, title: `S${seasonNo}E12` };
      assert.equal(api.getTitleSeasonNumber(title), seasonNo, title);
      assert.equal(api.getCurrentSeasonSearchKeyword(), expected, title);
    }
    assert.equal(api.getCollectionInferenceSeasonInfo("22/7 Season 4")?.seasonNo, 4);
    // A short numeric title may still lack identity evidence for relation inference.
    assert.equal(api.getTitleSeasonNumber("86 - 2nd Season"), 2);
  });

  test(`${label}: adjacent Roman subdivision and season labels keep separate meaning and search text`, () => {
    const api = setup();
    api.collectionContext = null;
    for (const subdivision of ["Part II", "Cour II", "Part Fourth"]) {
      const title = "Example Anime " + subdivision + " Season IV";
      api.state.rawTitle = title;
      api.videoPart = { seasonNo: null, title: title + " EP12" };
      assert.equal(api.getTitleSeasonNumber(title), 4, title);
      assert.equal(api.getCollectionInferenceSeasonInfo(title)?.seasonNo, 4, title);
      assert.equal(api.getCurrentSeasonSearchKeyword(), "Example Anime " + subdivision + " 第4季", title);
    }
    assert.equal(api.getCollectionInferenceSeasonInfo("JoJo Part IV Season II")?.base, "jojopartiv");
    assert.equal(api.getCollectionInferenceSeasonInfo("JoJo Part III Season II")?.base, "jojopartiii");
    api.videoPart = { seasonNo: null, title: "Example Anime Part II Season EP12" };
    assert.equal(api.getCurrentSeasonSearchKeyword(), "");
  });

  test(`${label}: leading season markers cannot turn episode or subdivision metadata into a work identity`, () => {
    const api = setup();
    for (const title of ["作品 第4シーズン 第12話", "86 Season IV Part One", "Season-IV EP12", "Season IV 第12集", "Season IV 第十二話", "Season IV Part1", "Season IV cour2", "Season IV Part One", "Season IV 123", "Season IV EP12 Part1"]) {
      assert.equal(api.getCollectionInferenceSeasonInfo(title), null, title);
    }
    assert.equal(api.getCollectionInferenceSeasonInfo("[Season IV] Example Anime")?.base, "exampleanime");
  });

  test(`${label}: subdivision identity remains separate from explicit season identity`, () => {
    const api = setup();
    for (const marker of ["Part 2", "Part Two", "Part II", "2nd cour", "第二部", "Ｐａｒｔ ２"]) {
      const title = `Example Anime Season Four ${marker}`;
      assert.equal(api.getTitleSeasonNumber(title), 4, marker);
      assert.equal(api.getTitleSubdivisionInfo(title).number, 2, marker);
      assert.equal(api.hasTitleSubdivisionConflict(title, "Example Anime Season 4 Part 1"), true, marker);
      assert.equal(api.hasTitleSubdivisionConflict(title, ["Example Anime Season 4", "Example Anime Season 4 Part 2"]), false, marker);
    }
    assert.equal(api.getTitleSubdivisionInfo("22/7 Season 4").explicit, false);
    assert.equal(api.getTitleSubdivisionInfo("86 - 2nd Season").explicit, false);
    assert.equal(api.getTitleSubdivisionInfo("Example Anime Season IV Part II").number, 2);
    assert.equal(api.getTitleSubdivisionInfo("Example Anime Season 4th Part 2").ambiguous, false);
    assert.equal(api.hasTitleSubdivisionConflict("Example Anime Season 4 Part 2", "Example Anime Season 4"), true);
    assert.equal(api.hasTitleSubdivisionConflict("Example Anime Season 4", "Example Anime Season 4"), false);
    assert.equal(api.hasTitleSubdivisionConflict("Part 2", ["Part 1", "Part 2"]), true);
    assert.equal(api.getCollectionInferenceSeasonInfo("Example Anime Part 2"), null);
  });
}

test("season-notation consumers remain mirrored across both distribution variants", () => {
  const userscript = readSource(USERSCRIPT_PATH);
  const extension = readSource(EXTENSION_PATH);
  for (const name of [...names, "isSeasonMarker"]) assert.equal(extractFunction(userscript, name), extractFunction(extension, name), name);
});
