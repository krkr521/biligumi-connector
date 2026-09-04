"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource } = require("./_source");
const { loadParsingFixture } = require("./_parsing-fixture");

const constants = [
  "EPISODE_PATTERNS", "EPISODE_NUMBER_SOURCE", "EPISODE_MARKER_SOURCE",
  "EPISODE_RANGE_MARKER_SOURCE", "LABELED_EPISODE_RANGE_SOURCE", "COMMON_RESOLUTIONS",
  "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN", "LONG_VIDEO_MIN_DURATION_SECONDS", "DEFAULT_EPISODE_DURATION_SECONDS",
  "DEFAULT_LONG_VIDEO_EPISODE_OFFSET_SECONDS", "LONG_VIDEO_DISPLAY_OVERFLOW_TOLERANCE_SECONDS",
  "LONG_VIDEO_AUTO_MARK_OVERFLOW_TOLERANCE_SECONDS",
];
const functions = [
  "detectCurrentEpisodeNo", "detectEpisodeNo", "isNonMainEpisodeTitle", "normalizeTitleText", "isTotalEpisodeCountMatch",
  "isEpisodeRangeMatch", "hasEpisodeRangeMarker", "parseChineseNumber", "isCommonResolutionNumber",
  "getNormalEpisodes", "getCurrentNormalEpisode", "isCurrentEpisodeNumber", "getEpisodeLabelLocalNo",
  "getCollectionMappedEpisodeNo", "parseLongVideoPartTitle", "isExplicitLongVideoPartRange",
  "selectLongVideoEpisodeSegment", "getLongVideoEpisodeSegment", "getLongVideoDetection",
  "getAnimeMoviePlatformDecision", "buildLongVideoEpisodeTimeline", "getEpisodeDurationSeconds",
  "parseEpisodeDurationText", "normalizeLongVideoOffsetSeconds", "median", "inferLongVideoEpisode",
  "refreshLongVideoEpisodeGuess", "refreshEpisodeContextIfChanged", "getEpisodeDisplayNo", "getEpisodeLocalNo",
];
function episodes(sorts) {
  return sorts.map((sort, index) => ({ id: 1000 + index, type: 0, sort, duration_seconds: 1440 }));
}
function setup(source) {
  const api = {
    state: { subjectId: 111, currentEpisodeNo: null, currentEpisodeNumberSource: "", episodes: [], longVideoEpisodeRenderKey: "" },
    location: { pathname: "/video/BVTEST" }, officialOrdinal: null, collection: null, rule: null, part: null,
    episodeContextRefreshSeq: 1, rawTitle: "", getPageTitle: () => api.rawTitle,
    refreshCurrentBindingIfChanged: () => false,
    getCurrentCollectionPartContext: () => api.collection,
    isCurrentOrdinaryEpisodeCollection: () => false,
    getCollectionMappingRule: () => api.rule,
    getCurrentCollectionLayoutContext: () => null,
    getOfficialBangumiProgressEpisodeNo: () => api.officialOrdinal,
    getActiveEpisodeText: () => "",
    getCurrentVideoPartEpisodeNo: () => null,
    getCurrentVideoPartContext: () => api.part,
    isOfficialBangumiPage: () => api.officialOrdinal != null,
    resolveLongVideoBindingSubject: () => null,
    getLoadedAnimeMovieClassification: () => false,
    getCachedAnimeMovieClassification: () => false,
    getLongVideoDurationSeconds: (video) => video.duration,
    getLongVideoEpisodeModeDecision: () => true,
    getLongVideoOwnerKey: () => "mid:42",
    getEffectiveLongVideoOffsetSeconds: () => 0,
    isCurrentVideoAutoProgressDisabled: () => false,
    getLongVideoDetectionCacheKey: () => "test",
    render: () => {}, formatTimecode: (value) => String(value),
  };
  return loadParsingFixture(source, functions, api, constants);
}
function currentSort(api, title) {
  api.state.currentEpisodeNo = api.detectCurrentEpisodeNo(title);
  return api.getCurrentNormalEpisode()?.sort ?? null;
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);
  test(`${label}: ordinary labels and official ordinals select different EP0 positions`, () => {
    const api = setup(source);
    api.state.episodes = episodes(Array.from({ length: 13 }, (_, index) => index));
    assert.equal(currentSort(api, "UBW 第1集"), 1);
    assert.equal(api.state.currentEpisodeNumberSource, "label");
    assert.equal(currentSort(api, "UBW 第0集"), 0);
    api.officialOrdinal = 2;
    assert.equal(currentSort(api, "UBW 第1集"), 1);
    assert.equal(api.state.currentEpisodeNumberSource, "ordinal");
    api.officialOrdinal = 1;
    assert.equal(currentSort(api, "UBW 第0集"), 0);
  });

  test(`${label}: fractional entries do not displace following explicit integer labels`, () => {
    const api = setup(source);
    api.state.episodes = episodes([1, 1.5, 2, 3]);
    assert.equal(currentSort(api, "番名 第2集"), 2);
    assert.equal(currentSort(api, "番名 第1.5集"), 1.5);
    assert.equal(api.getEpisodeDisplayNo(api.getCurrentNormalEpisode()), 1.5);
    assert.equal(currentSort(api, "番名 第3集"), 3);
    assert.equal(currentSort(api, "番名 第4集"), null, "an absent sort must not select another list position");
  });

  test(`${label}: a late EP0 title refresh does not confuse zero with an unset number`, () => {
    const api = setup(source);
    api.state.episodes = episodes([0, 1, 2]);
    api.rawTitle = "番名 第0集";
    api.getLongVideoEpisodeModeDecision = () => null;
    api.refreshEpisodeContextIfChanged(1);
    assert.equal(api.state.currentEpisodeNo, 0);
    assert.equal(api.getCurrentNormalEpisode().sort, 0);
  });

  test(`${label}: delayed official ordinal evidence rerenders even when its numeric value is unchanged`, () => {
    const api = setup(source);
    api.state.episodes = episodes([0, 1, 2]);
    api.rawTitle = "番名 第1集";
    assert.equal(currentSort(api, api.rawTitle), 1);
    api.officialOrdinal = 1;
    api.getLongVideoEpisodeModeDecision = () => null;
    let renders = 0;
    api.render = () => { renders += 1; };
    api.refreshEpisodeContextIfChanged(1);
    assert.equal(api.state.currentEpisodeNo, 1);
    assert.equal(api.getCurrentNormalEpisode().sort, 0);
    assert.equal(renders, 1);
  });

  test(`${label}: later seasons preserve local numbering and explicit global ranges`, () => {
    const api = setup(source);
    api.state.episodes = episodes(Array.from({ length: 13 }, (_, index) => index + 12));
    assert.equal(currentSort(api, "番名 第二季 第1集"), 12);
    assert.equal(currentSort(api, "番名 第二季 第13集"), 24);
    for (const title of ["S2 1-13", "S2 12-24"]) {
      const segment = api.selectLongVideoEpisodeSegment(api.getNormalEpisodes(), api.parseLongVideoPartTitle(title));
      assert.equal(segment.rangeApplied, true);
      assert.equal(segment.firstEpisodeNo, 1);
      assert.deepEqual(Array.from(segment.episodes, (episode) => episode.sort), Array.from({ length: 13 }, (_, index) => index + 12));
    }
  });

  test(`${label}: collection mapping keeps explicit ordinal EP0 shifts and split-part semantics`, () => {
    const api = setup(source);
    api.state.episodes = episodes([0, 1, 2]);
    api.collection = { episodeNo: 0, fragmentIndex: 2 };
    api.rule = { sourceStart: 0, targetStart: 1 };
    assert.equal(currentSort(api, "0.2"), 0);
    assert.equal(api.state.currentEpisodeNumberSource, "ordinal");
    api.collection.episodeNo = 1;
    assert.equal(currentSort(api, "1.2"), 1);
    api.state.episodes = episodes([1, 2, 3]);
    api.collection.episodeNo = 0;
    assert.equal(currentSort(api, "0.2"), 1, "a source EP0 still maps to ordinal 1 when the target has no EP0");
  });

  test(`${label}: explicit long-video labels skip EP0 and inference retains actual ordinal identity`, () => {
    const api = setup(source);
    api.state.episodes = episodes(Array.from({ length: 13 }, (_, index) => index));
    api.part = api.parseLongVideoPartTitle("第一季 第1集-第6集");
    const guess = api.refreshLongVideoEpisodeGuess({ duration: 6 * 1440, currentTime: 1200 });
    assert.equal(guess.autoMarkSafe, true);
    assert.equal(guess.episode.sort, 1);
    assert.equal(guess.episodeNo, 2, "timeline identities remain local ordinals for the full Bangumi list");
    assert.equal(api.state.currentEpisodeNumberSource, "ordinal");
    assert.equal(api.getCurrentNormalEpisode().sort, 1);
    assert.deepEqual(Array.from(guess.segment.episodes, (episode) => episode.sort), [1, 2, 3, 4, 5, 6]);
    const zeroRange = api.parseLongVideoPartTitle("第一季 第0集-第5集");
    assert.equal(api.isExplicitLongVideoPartRange(zeroRange), true);
    const segment = api.selectLongVideoEpisodeSegment(api.getNormalEpisodes(), zeroRange);
    assert.deepEqual(Array.from(segment.episodes, (episode) => episode.sort), [0, 1, 2, 3, 4, 5]);
    assert.equal(segment.firstEpisodeNo, 1);
    assert.equal(api.isExplicitLongVideoPartRange(api.parseLongVideoPartTitle("S2")), false);
  });
}
