"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource } = require("./_source");
const { loadParsingFixture } = require("./_parsing-fixture");

const WORK_TITLE = "弱气MAX的大小姐 极致软弱 居然不小心接受了精明铁腕未婚夫的赌约";
const VIDEO_TITLE = `『全12话 ${WORK_TITLE}』周更`;
const ARCHIVE_TITLE = "『10月 补\\26年』";
const CONSTANTS = [
  "EPISODE_PATTERNS", "EPISODE_NUMBER_SOURCE", "EPISODE_MARKER_SOURCE",
  "EPISODE_RANGE_MARKER_SOURCE", "LABELED_EPISODE_RANGE_SOURCE", "COMMON_RESOLUTIONS", "TITLE_PROPERTY_TAGS",
  "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN", "WHITELIST_NEWS_NON_MAIN_PATTERN",
];
const FUNCTIONS = [
  "getTitleSeasonNumber", "parseChineseTitleNumber", "parseChineseNumber",
  "cleanTitle", "extractAnimeWorkTitle", "extractQuotedWorkTitle", "getNonMainTitleSource",
  "extractTitleBeforeEpisodeMarker", "extractTitleAfterJapaneseQuoteBeforeEpisode",
  "stripNonMainEdgeBracketTags", "stripNonMainMarkerTail", "stripNonMainPromoSuffix",
  "normalizeTitleText", "cleanupAnimeTitle", "stripEpisodeMarkersAtEdges",
  "isTitleMetaTag", "isTitlePropertyTag", "isSeasonMarker", "isEpisodeMarkerToken",
  "isCommonResolutionNumber", "isReleaseInfoTag", "isNonMainEpisodeTitle", "isWhitelistNewsNonMainTitle",
  "detectEpisodeNo", "isTotalEpisodeCountMatch", "isEpisodeRangeMatch", "hasEpisodeRangeMarker",
  "getPageTitle", "getElementTitleText", "resolveCurrentPageTitle",
  "getBilibiliCollectionTitle", "isBilibiliCollectionArchiveTitle",
  "suggestSearchKeyword", "getCurrentPageSearchKeyword", "isStandaloneBilibiliPartTitle",
  "renderInlineAutoPreview", "renderNonMainPreviewStatus",
];

function setup(file, rawTitle = VIDEO_TITLE, collectionTitle = ARCHIVE_TITLE, groupTitle = "") {
  const titleNode = (value) => value ? { textContent: value, getAttribute: () => value } : null;
  const scope = {
    state: { rawTitle, pageTitle: "", subject: null, nonMainResults: [] },
    document: {
      title: `${rawTitle}_哔哩哔哩_bilibili`,
      querySelector(selector) {
        if (selector === "h1.video-title") return titleNode(rawTitle);
        if (selector.includes("collectiondetail")) return titleNode(collectionTitle);
        if (selector.includes("active.head")) return titleNode(groupTitle);
        return null;
      },
    },
    isOfficialBangumiPage: () => false,
    shouldUseRawTitleForPreview: () => false,
    getOfficialBangumiContextTitle: () => "",
    getSeriesTitle: () => "",
    getCurrentSeasonSearchKeyword: () => "",
    displaySubjectName: (subject) => subject.name,
    isNonMainPreviewPage: () => false,
    normalizeBindingToken: (value) => String(value || "").replace(/\s+/g, "").toLowerCase(),
    renderNonMainCandidate: () => "",
    escapeHtml: (value) => String(value),
  };
  loadParsingFixture(readSource(file), FUNCTIONS, scope, CONSTANTS);
  scope.getInlineAutoPreviewKeyword = () => scope.suggestSearchKeyword();
  scope.state.rawTitle = scope.getPageTitle();
  scope.state.pageTitle = scope.resolveCurrentPageTitle(scope.state.rawTitle);
  return scope;
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  test(`${label}: a leading total count preserves the following work title`, () => {
    const api = setup(file);
    for (const [title, expected] of [
      [VIDEO_TITLE, WORK_TITLE],
      ["『全12话 你好 我是身为受心上人所托来做恋爱迷情药的魔女』周更", "你好 我是身为受心上人所托来做恋爱迷情药的魔女"],
      ["【全 12 集 番名】", "番名"],
      ["【全12话 番名】周更", "番名"],
      ["《全12話 番名 第二季》", "番名 第二季"],
      ["全12话 番名", "番名"],
      ["全12话番名", "番名"],
      ["番名 全12话 周更", "番名"],
      ["『番名』全12话 周更", "番名"],
      ["全12话", ""],
      ["『86』", "86"],
    ]) {
      assert.equal(api.cleanTitle(title), expected, title);
    }
  });

  test(`${label}: archive metadata accepts month/year order and replenishment labels only`, () => {
    const api = setup(file);
    for (const title of [
      ARCHIVE_TITLE, "10月/2026年", "10月\\26年补", "补 10月\\26年", "26年\\10月补",
      "2026年10月补档", "10月新番补番合集/26年", "『１０月 補＼２６年』",
      "26年\\7月", "2026年/7月", "26年7月新番合集", "7月新番", "01月番剧合集",
    ]) {
      assert.equal(api.isBilibiliCollectionArchiveTitle(title), true, title);
      assert.equal(api.isBilibiliCollectionArchiveTitle(api.cleanTitle(title)), true, `cleaned ${title}`);
    }
    for (const title of [
      "22/7", "86", "7月与安生", "3月的狮子", "10月补番日记", "补完计划",
      "26年后的10月", "10月 番名 26年", "0月新番", "13月新番",
    ]) {
      assert.equal(api.isBilibiliCollectionArchiveTitle(title), false, title);
    }
  });

  test(`${label}: the reported page searches its real title and does not claim a collection fallback`, () => {
    const api = setup(file);
    assert.equal(api.state.rawTitle, VIDEO_TITLE);
    assert.equal(api.state.pageTitle, WORK_TITLE);
    assert.equal(api.suggestSearchKeyword(), WORK_TITLE);
    const html = api.renderInlineAutoPreview();
    assert.ok(html.includes(`按「${WORK_TITLE}」`));
    assert.doesNotMatch(html, /当前视频标题未包含作品名|10月|26年/);
  });

  test(`${label}: metadata-only pages use a real group or collection, never a calendar archive`, () => {
    const group = setup(file, "(1)", ARCHIVE_TITLE, VIDEO_TITLE);
    assert.equal(group.getBilibiliCollectionTitle(), VIDEO_TITLE);
    assert.equal(group.suggestSearchKeyword(), WORK_TITLE);

    const collection = setup(file, "『第1~3话』", "『示例番剧』");
    assert.equal(collection.suggestSearchKeyword(), "示例番剧");

    const archiveOnly = setup(file, "(1)");
    assert.equal(archiveOnly.getBilibiliCollectionTitle(), "");
    assert.equal(archiveOnly.suggestSearchKeyword(), "");
    assert.match(archiveOnly.renderInlineAutoPreview(), /没有执行自动推荐/);
  });
}
