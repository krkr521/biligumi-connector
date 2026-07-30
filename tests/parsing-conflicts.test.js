"use strict";

// Regression coverage for parser conflicts that can misidentify a season,
// episode, work title, or duration. Every implementation under test is
// extracted from the shipped userscript/extension source rather than copied
// into the fixture.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);

function extractConstantDeclaration(source, name) {
  const marker = `  const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing constant ${name} in source`);
  const lines = source.slice(start).split(/\r?\n/);
  const endLine = lines.findIndex((line) => line.trimEnd().endsWith(";"));
  assert.notEqual(endLine, -1, `Missing end of constant ${name} in source`);
  return lines.slice(0, endLine + 1).join("\n");
}

const CONSTANT_NAMES = [
  "EPISODE_PATTERNS",
  "EPISODE_NUMBER_SOURCE",
  "EPISODE_MARKER_SOURCE",
  "EPISODE_RANGE_MARKER_SOURCE",
  "LABELED_EPISODE_RANGE_SOURCE",
  "COMMON_RESOLUTIONS",
  "TITLE_PROPERTY_TAGS",
  "NON_MAIN_EPISODE_PATTERN",
  "NON_MAIN_KEYWORD_PATTERN",
  "WHITELIST_NEWS_NON_MAIN_PATTERN",
  "LONG_VIDEO_MIN_DURATION_SECONDS",
  "DEFAULT_LONG_VIDEO_EPISODE_OFFSET_SECONDS",
  "DEFAULT_EPISODE_DURATION_SECONDS",
  "LONG_VIDEO_DISPLAY_OVERFLOW_TOLERANCE_SECONDS",
  "LONG_VIDEO_AUTO_MARK_OVERFLOW_TOLERANCE_SECONDS",
  "MIN_COLLECTION_PARSED_PARTS",
];

const FUNCTION_NAMES = [
  "getTitleSeasonNumber",
  "parseChineseTitleNumber",
  "cleanTitle",
  "extractAnimeWorkTitle",
  "extractQuotedWorkTitle",
  "getNonMainTitleSource",
  "extractTitleBeforeEpisodeMarker",
  "extractTitleAfterJapaneseQuoteBeforeEpisode",
  "stripNonMainEdgeBracketTags",
  "stripNonMainMarkerTail",
  "stripNonMainPromoSuffix",
  "normalizeTitleText",
  "cleanupAnimeTitle",
  "stripEpisodeMarkersAtEdges",
  "getPageOwnerInfo",
  "getInitialOwnerInfo",
  "isTitleMetaTag",
  "isTitlePropertyTag",
  "isSeasonMarker",
  "isEpisodeMarkerToken",
  "isCommonResolutionNumber",
  "isReleaseInfoTag",
  "isNonMainEpisodeTitle",
  "isWhitelistNewsNonMainTitle",
  "detectEpisodeNo",
  "isTotalEpisodeCountMatch",
  "isEpisodeRangeMatch",
  "hasEpisodeRangeMarker",
  "parseLongVideoPartTitle",
  "parseChineseNumber",
  "selectLongVideoEpisodeSegment",
  "getLongVideoDetection",
  "buildLongVideoEpisodeTimeline",
  "getEpisodeDurationSeconds",
  "parseEpisodeDurationText",
  "normalizeLongVideoOffsetSeconds",
  "median",
  "getQualifiedCollectionPartRows",
  "getCurrentVideoPartEpisodeNo",
  "isCurrentEpisodeNumber",
];

function createImplementation(label, source) {
  const sandbox = {
    state: {
      subjectId: 1,
      currentEpisodeNo: null,
    },
    location: {
      pathname: "/video/BV1PARSERTEST",
    },
    currentPart: null,
    activeLongVideoPart: null,
    testEpisodes: [],
    testOffsetSeconds: 2 * 60 * 60,
    pageInitialState: {},
    domOwner: {},
    getPageInitialState: () => sandbox.pageInitialState,
    getPrimaryDomOwnerInfo: () => sandbox.domOwner,
    cleanOwnerName: (value) => String(value || "").trim(),
    findDomOwnerNameByMid: () => "",
    getCurrentCollectionPartContext: () => null,
    getCollectionMappingRule: () => null,
    getCollectionMappedEpisodeNo: () => null,
    getCurrentVideoPartContext: () => sandbox.currentPart,
    getCurrentPartNoFromUrl: () => null,
    isOfficialBangumiPage: () => false,
    getLongVideoDurationSeconds: (video) => Number(video && video.duration),
    getLongVideoEpisodeModeDecision: () => true,
    getLongVideoOwnerKey: () => "owner:parser-test",
    getNormalEpisodes: () => sandbox.testEpisodes,
    getEffectiveLongVideoOffsetSeconds: () => sandbox.testOffsetSeconds,
    getLongVideoEpisodeSegment: (episodes) => (
      sandbox.api.selectLongVideoEpisodeSegment(episodes, sandbox.activeLongVideoPart)
    ),
    formatTimecode: (seconds) => String(seconds),
  };

  const code = [
    ...CONSTANT_NAMES.map((name) => extractConstantDeclaration(source, name)),
    ...FUNCTION_NAMES.map((name) => extractFunction(source, name)),
    `globalThis.api = { ${FUNCTION_NAMES.join(", ")} };`,
  ].join("\n");
  runInSandbox(code, sandbox);
  return { label, source, sandbox, api: sandbox.api };
}

const implementations = [
  createImplementation("userscript", userscriptSource),
  createImplementation("extension", extensionSource),
];

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

test("userscript and extension keep the affected parser logic mirrored", () => {
  for (const name of CONSTANT_NAMES) {
    assert.equal(
      extractConstantDeclaration(extensionSource, name),
      extractConstantDeclaration(userscriptSource, name),
      `${name} must stay identical between userscript and extension`,
    );
  }
  for (const name of FUNCTION_NAMES) {
    assert.equal(
      extractFunction(extensionSource, name),
      extractFunction(userscriptSource, name),
      `${name} must stay identical between userscript and extension`,
    );
  }
});

for (const implementation of implementations) {
  const { label, api, sandbox } = implementation;

  test(`${label}: lowercase labels and production extras are non-main content`, () => {
    for (const title of [
      "ova 1",
      "pv 1",
      "op 1",
      "番名OVA 第2集",
      "番名SP 第3集",
      "制作花絮 第2集",
      "幕后 第3集",
      "总集篇 第4集",
    ]) {
      assert.equal(api.isNonMainEpisodeTitle(title), true, `${title} must not be treated as a main episode`);
      assert.equal(api.detectEpisodeNo(title), null, `${title} must not yield an episode number`);
    }
  });

  test(`${label}: spaced season spellings produce the same season number`, () => {
    assert.equal(api.getTitleSeasonNumber("Anime Season 2"), 2);
    assert.equal(api.getTitleSeasonNumber("Anime 2nd Season"), 2);
    assert.equal(api.getTitleSeasonNumber("Anime 第 2 季"), 2);
    assert.equal(api.getTitleSeasonNumber("Anime S2"), 2, "compact S2 remains supported");
  });

  test(`${label}: title cleaning distinguishes work titles from season and episode metadata`, () => {
    assert.equal(api.cleanTitle("[S2] 番名"), "番名");
    assert.equal(api.cleanTitle("[第二期] 番名"), "番名");
    assert.equal(api.cleanTitle("葬送的芙莉莲 第1话《冒险的终点》"), "葬送的芙莉莲");
    assert.equal(api.cleanTitle("葬送的芙莉莲 第1话《冒险的终点》【1080P】"), "葬送的芙莉莲");
    assert.equal(api.cleanTitle("TV动画《番名》 第1话《副标题》"), "番名");
    assert.equal(api.cleanTitle("转生 第1集 史莱姆"), "转生 史莱姆");
    assert.equal(api.cleanTitle("转生【第1集】史莱姆"), "转生 史莱姆");
    assert.equal(api.cleanTitle("Anime Season 2"), "Anime Season 2");
    assert.equal(api.isTitlePropertyTag("WEBSTER"), false);
    assert.equal(api.isTitlePropertyTag("字幕少女"), false);
    assert.equal(api.isTitlePropertyTag("WEBRIP 简中 1080P"), true);
    assert.equal(api.isTitlePropertyTag("4K超清"), true);
  });

  test(`${label}: total counts, years, and bare numeric work names are not episode numbers`, () => {
    assert.equal(api.detectEpisodeNo("共 12集"), null);
    assert.equal(api.detectEpisodeNo("总共 12集"), null);
    assert.equal(api.detectEpisodeNo("一共 12话"), null);
    assert.equal(api.detectEpisodeNo("12集全"), null);
    assert.equal(api.detectEpisodeNo("12集完结"), null);
    assert.equal(api.detectEpisodeNo("12集【完结】"), null);
    assert.equal(api.detectEpisodeNo("12集（全）"), null);
    assert.equal(api.detectEpisodeNo("更新至第12集"), null);
    assert.equal(api.detectEpisodeNo("已更新到 第12话"), null);
    assert.equal(api.detectEpisodeNo("更新至EP12"), null);
    assert.equal(api.detectEpisodeNo("已更新到EP12"), null);
    assert.equal(api.detectEpisodeNo("连载到S1E12"), null);
    assert.equal(api.detectEpisodeNo("连载到第12集"), null);
    assert.equal(api.detectEpisodeNo("連載到第12話"), null);
    assert.equal(api.detectEpisodeNo("[2024] Anime"), null);
    assert.equal(api.detectEpisodeNo("86"), null);
    assert.equal(api.detectEpisodeNo("Anime Season 2"), null);
    assert.equal(api.detectEpisodeNo("EP 2025"), null);
    assert.equal(api.detectEpisodeNo("#2025"), null);
    assert.equal(api.detectEpisodeNo("STEP 12"), null);
    assert.equal(api.detectEpisodeNo("PREP 12"), null);
    assert.equal(api.detectEpisodeNo("NEWS2E3"), null);
    assert.equal(api.detectEpisodeNo("『全集』 12"), null);
    assert.equal(api.detectEpisodeNo("番名 第1集-第12集"), null);
    assert.equal(api.detectEpisodeNo("番名 第一集至第十二集"), null);
    assert.equal(api.detectEpisodeNo("番名 S2E1-E12"), null);
    assert.equal(api.detectEpisodeNo("番名 EP1-EP12"), null);
    assert.equal(api.detectEpisodeNo("番名 #1-#12"), null);
    assert.equal(api.detectEpisodeNo("第86集"), 86, "an explicit episode marker remains valid");
    assert.equal(api.detectEpisodeNo("第1000集"), 1000, "long-running explicit episode markers remain valid");
    assert.equal(api.detectEpisodeNo("第1080集"), 1080, "explicit episode markers are not resolution metadata");
    assert.equal(api.detectEpisodeNo("EP 1080"), 1080, "explicit EP labels are not resolution metadata");
    assert.equal(api.detectEpisodeNo("EP 12"), 12, "an explicit EP marker remains valid");
    assert.equal(api.detectEpisodeNo("Episode 12"), 12, "the full English episode label remains valid");
    assert.equal(api.detectEpisodeNo("番名 12话"), 12, "a Chinese episode unit is explicit without 第");
    assert.equal(api.detectEpisodeNo("番名 12集"), 12, "a Chinese episode unit is explicit without 第");
    assert.equal(api.cleanTitle("番名 12话"), "番名");
    assert.equal(api.cleanTitle("番名 12集"), "番名");
    assert.equal(api.detectEpisodeNo("第二十集"), 20, "explicit Chinese-number episode markers remain valid");
    assert.equal(api.cleanTitle("番名 第1集-第12集"), "番名");
    assert.equal(api.cleanTitle("番名 第一集至第十二集"), "番名");
    assert.equal(api.cleanTitle("番名 S2E1-E12"), "番名 S2");
    assert.equal(api.cleanTitle("番名 EP1-EP12"), "番名");
    assert.equal(api.detectEpisodeNo("番名 Season 2 Episode 1-12"), null);
    assert.equal(api.cleanTitle("番名 Season 2 Episode 1-12"), "番名 S2");
  });

  test(`${label}: quality markers cannot become long-video episode ranges`, () => {
    const s2FourK = api.parseLongVideoPartTitle("S2 4K");
    assert.deepEqual(plain(s2FourK), {
      seasonNo: 2,
      episodeStart: null,
      episodeEnd: null,
      rangeLabel: "S2",
    });

    const chinese1080p = api.parseLongVideoPartTitle("第二季 1080P");
    assert.equal(chinese1080p.seasonNo, 2);
    assert.equal(chinese1080p.episodeStart, null);
    assert.equal(chinese1080p.episodeEnd, null);

    const episodes = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      sort: index + 1,
      duration_seconds: 24 * 60,
    }));
    sandbox.activeLongVideoPart = s2FourK;
    sandbox.testEpisodes = episodes;
    const segment = api.selectLongVideoEpisodeSegment(episodes, s2FourK);
    assert.equal(segment.rangeApplied, false, "S2 4K must not select episode 4 as a one-episode range");
    assert.equal(segment.episodes.length, 12, "season-only metadata keeps the full season");

    // This duration exactly fit the old false-positive one-episode range
    // (2h offset + 24m episode), which previously made autoMarkSafe true.
    const detection = api.getLongVideoDetection({ duration: (2 * 60 * 60) + (24 * 60) });
    assert.notEqual(detection.autoMarkSafe, true, "S2 4K must not create a safe EP4 auto-mark path");
  });

  test(`${label}: Chinese long-video ranges accept repeated episode units`, () => {
    const hyphenRange = api.parseLongVideoPartTitle("第二季 第1集-第12集");
    assert.equal(hyphenRange.seasonNo, 2);
    assert.equal(hyphenRange.episodeStart, 1);
    assert.equal(hyphenRange.episodeEnd, 12);

    const wordRange = api.parseLongVideoPartTitle("第二季 第1话至第12话");
    assert.equal(wordRange.seasonNo, 2);
    assert.equal(wordRange.episodeStart, 1);
    assert.equal(wordRange.episodeEnd, 12);

    const englishRange = api.parseLongVideoPartTitle("Season 2 Episode 1-12");
    assert.equal(englishRange.seasonNo, 2);
    assert.equal(englishRange.episodeStart, 1);
    assert.equal(englishRange.episodeEnd, 12);
  });

  test(`${label}: invalid clocks and partial unit matches are rejected`, () => {
    for (const duration of ["00:24:60", "00:60:00", "01:99:59", "24:60", "1ms"]) {
      assert.equal(api.parseEpisodeDurationText(duration), 0, `${duration} must not become a trusted duration`);
    }
    assert.equal(api.parseEpisodeDurationText("00:24:00"), 24 * 60);
    assert.equal(api.parseEpisodeDurationText("24m"), 24 * 60);
  });

  test(`${label}: fractional episodes select by Bangumi sort`, () => {
    sandbox.state.currentEpisodeNo = 1.5;
    assert.equal(
      api.isCurrentEpisodeNumber({ id: 15, sort: 1.5 }, 2, 12),
      true,
      "episode 1.5 must match its fractional Bangumi sort instead of integer localNo",
    );
    assert.equal(api.isCurrentEpisodeNumber({ id: 1, sort: 1 }, 1, 12), false);

    sandbox.state.currentEpisodeNo = 2;
    assert.equal(
      api.isCurrentEpisodeNumber({ id: 2, sort: 2 }, 2, 12),
      true,
      "ordinary integer episodes continue to use local ordering",
    );
  });

  test(`${label}: decimal collection rows distinguish split parts from fractional episodes`, () => {
    const fractionalRows = [10, 11, 12, 13].map((episodeNo, index) => ({
      partNo: index + 1,
      title: `${episodeNo}.5`,
      bareNumeric: false,
      parsed: {
        seasonKey: "s1",
        episodeNo,
        fragmentIndex: 5,
        hierarchical: false,
      },
    }));
    assert.deepEqual(
      plain(api.getQualifiedCollectionPartRows(fractionalRows)),
      [],
      "a run of .5 fractional episodes must not be reclassified as fifth fragments",
    );

    const splitRows = [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ].map(([episodeNo, fragmentIndex], index) => ({
      partNo: index + 1,
      title: `${episodeNo}.${fragmentIndex}`,
      bareNumeric: false,
      parsed: {
        seasonKey: "s1",
        episodeNo,
        fragmentIndex,
        hierarchical: false,
      },
    }));
    assert.equal(
      api.getQualifiedCollectionPartRows(splitRows).length,
      splitRows.length,
      "ordinary multi-fragment episode rows remain eligible",
    );
    const splitWithIsolatedSpecial = [
      ...splitRows,
      {
        partNo: 5,
        title: "3.5",
        bareNumeric: false,
        parsed: {
          seasonKey: "s1",
          episodeNo: 3,
          fragmentIndex: 5,
          hierarchical: false,
        },
      },
    ];
    assert.deepEqual(
      plain(api.getQualifiedCollectionPartRows(splitWithIsolatedSpecial).map((row) => row.partNo)),
      [1, 2, 3, 4],
      "split evidence from other episodes must not admit an isolated 3.5 special episode",
    );

    const mixedRows = [
      ...[1, 2, 3, 4, 5, 6].map((episodeNo, index) => ({
        partNo: index + 1,
        title: String(episodeNo),
        bareNumeric: true,
        parsed: {
          seasonKey: "default",
          episodeNo,
          fragmentIndex: 1,
          hierarchical: false,
        },
      })),
      {
        partNo: 7,
        title: "2.5",
        bareNumeric: false,
        parsed: {
          seasonKey: "default",
          episodeNo: 2,
          fragmentIndex: 5,
          hierarchical: false,
        },
      },
    ];
    assert.equal(
      api.getQualifiedCollectionPartRows(mixedRows).some((row) => row.partNo === 7),
      false,
      "an isolated 2.5 special episode inside an integer run must not become fragment 5",
    );
  });

  test(`${label}: page owner data never mixes a stale bridge snapshot with the current DOM`, () => {
    sandbox.pageInitialState = {
      bvid: "BV1OLD",
      videoData: {
        bvid: "BV1OLD",
        owner: { mid: "42", uid: "42", name: "旧 UP" },
      },
    };
    sandbox.domOwner = { mid: "84", uid: "84", name: "新 UP", username: "" };
    assert.deepEqual(plain(api.getPageOwnerInfo()), {
      mid: "84",
      uid: "84",
      name: "新 UP",
      username: "",
    });

    sandbox.domOwner = { mid: "", uid: "", name: "新 UP", username: "" };
    assert.deepEqual(plain(api.getPageOwnerInfo()), {
      mid: "",
      uid: "",
      name: "新 UP",
      username: "",
    });

    sandbox.pageInitialState.videoData.bvid = "BV1PARSERTEST";
    sandbox.pageInitialState.bvid = "BV1PARSERTEST";
    assert.deepEqual(plain(api.getPageOwnerInfo()), {
      mid: "42",
      uid: "42",
      name: "旧 UP",
      username: "",
    });
  });

  test(`${label}: a non-main ordinary multi-P part cannot fall back to partNo`, () => {
    sandbox.currentPart = {
      bvid: "BV1PARSERTEST",
      partNo: 2,
      partCount: 3,
      title: "ova 1",
      seasonNo: null,
    };
    assert.equal(api.getCurrentVideoPartEpisodeNo(), null);

    sandbox.currentPart = {
      bvid: "BV1PARSERTEST",
      partNo: 2,
      partCount: 3,
      title: "制作花絮",
      seasonNo: null,
    };
    assert.equal(api.getCurrentVideoPartEpisodeNo(), null);

    sandbox.currentPart = {
      bvid: "BV1PARSERTEST",
      partNo: 2,
      partCount: 3,
      title: "第5集",
      seasonNo: null,
    };
    assert.equal(api.getCurrentVideoPartEpisodeNo(), 5, "an explicit title episode wins over the P ordinal");

    sandbox.currentPart = {
      bvid: "BV1PARSERTEST",
      partNo: 2,
      partCount: 3,
      title: "旅程开始",
      seasonNo: null,
    };
    assert.equal(
      api.getCurrentVideoPartEpisodeNo(),
      null,
      "a descriptive multi-P title intentionally fails closed instead of guessing from P order",
    );
  });
}
