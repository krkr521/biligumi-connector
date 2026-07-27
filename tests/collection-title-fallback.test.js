"use strict";

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

const source = readSource(USERSCRIPT_PATH);

const collectionTitleSource = extractFunction(source, "getBilibiliCollectionTitle");
const overallCollectionNode = {
  value: "『与奔驰于透明之夜的你 谈一场看不见的恋爱』",
};
const activeGroupNode = {
  value: "『第1~2话 与奔驰于透明之夜的你 谈一场看不见的恋爱』",
};
let collectionSelectorMode = "overall";
const collectionSandbox = {
  isOfficialBangumiPage: () => false,
  document: {
    querySelector(selector) {
      if (collectionSelectorMode === "overall" && selector.includes("collectiondetail")) return overallCollectionNode;
      if (collectionSelectorMode === "active" && selector.includes("active.head")) return activeGroupNode;
      return null;
    },
  },
  getElementTitleText: (node) => node.value,
  cleanTitle: (value) => String(value || "")
    .replace(/[『』]/g, "")
    .replace(/^第1~2话\s*/, "")
    .trim(),
};
runInSandbox(`${collectionTitleSource}
;globalThis.api = { getBilibiliCollectionTitle };`, collectionSandbox);

assert.equal(
  collectionSandbox.api.getBilibiliCollectionTitle(),
  overallCollectionNode.value,
  "the overall collection link title is preferred",
);
collectionSelectorMode = "active";
assert.equal(
  collectionSandbox.api.getBilibiliCollectionTitle(),
  activeGroupNode.value,
  "the active collection group title is used when the overall title is unavailable",
);

const suggestTitleSource = extractFunction(source, "suggestSearchKeyword");
const suggestSandbox = {
  state: { subject: null, pageTitle: "" },
  displaySubjectName: (subject) => subject.name,
  cleanTitle: (value) => {
    if (value === "『第1~3话』") return "";
    if (value === overallCollectionNode.value) return "与奔驰于透明之夜的你 谈一场看不见的恋爱";
    return String(value || "").trim();
  },
  getCurrentSeasonSearchKeyword: () => "",
  getBilibiliCollectionTitle: () => overallCollectionNode.value,
};
runInSandbox(`${suggestTitleSource}
;globalThis.api = { suggestSearchKeyword };`, suggestSandbox);
assert.equal(
  suggestSandbox.api.suggestSearchKeyword(),
  "与奔驰于透明之夜的你 谈一场看不见的恋爱",
  "automatic search falls back to the collection title",
);
suggestSandbox.state.subject = { name: "已绑定条目" };
assert.equal(suggestSandbox.api.suggestSearchKeyword(), "已绑定条目", "a bound subject still has highest priority");
suggestSandbox.state.subject = null;
suggestSandbox.getCurrentSeasonSearchKeyword = () => "药屋少女の呢喃 第2季";
assert.equal(
  suggestSandbox.api.suggestSearchKeyword(),
  "药屋少女の呢喃 第2季",
  "an active season inferred from the part title is preferred over a cross-season collection title",
);

const renderPreviewSource = extractFunction(source, "renderInlineAutoPreview");
const missingKeywordSandbox = {
  state: { nonMainResults: [], rawTitle: "『第1~3话』" },
  getInlineAutoPreviewKeyword: () => "",
};
runInSandbox(`${renderPreviewSource}
;globalThis.api = { renderInlineAutoPreview };`, missingKeywordSandbox);
assert.match(
  missingKeywordSandbox.api.renderInlineAutoPreview(),
  /未能从视频标题或合集标题识别作品名，因此没有执行自动推荐/,
  "missing automatic search input must be explained instead of failing silently",
);

const collectionPreviewSandbox = {
  state: { nonMainResults: [], rawTitle: "『第1~3话』" },
  getInlineAutoPreviewKeyword: () => "与奔驰于透明之夜的你 谈一场看不见的恋爱",
  isNonMainPreviewPage: () => false,
  cleanTitle: suggestSandbox.cleanTitle,
  getOfficialBangumiContextTitle: () => "",
  getSeriesTitle: () => "",
  getPageTitle: () => "『第1~3话』",
  getBilibiliCollectionTitle: () => overallCollectionNode.value,
  normalizeBindingToken: (value) => String(value || "").replace(/\s+/g, "").toLowerCase(),
  renderNonMainCandidate: () => "",
  renderNonMainPreviewStatus: () => "NO_CANDIDATES",
  escapeHtml: (value) => String(value),
};
runInSandbox(`${renderPreviewSource}
;globalThis.api = { renderInlineAutoPreview };`, collectionPreviewSandbox);
assert.match(
  collectionPreviewSandbox.api.renderInlineAutoPreview(),
  /已改用合集标题「与奔驰于透明之夜的你 谈一场看不见的恋爱」自动匹配/,
  "the UI explains when the collection title supplies the automatic keyword",
);

const renderStatusSource = extractFunction(source, "renderNonMainPreviewStatus");
const emptyResultSandbox = {
  state: { nonMainBusy: false, nonMainError: "", nonMainKeyword: "示例番剧" },
  escapeHtml: (value) => String(value),
};
runInSandbox(`${renderStatusSource}
;globalThis.api = { renderNonMainPreviewStatus };`, emptyResultSandbox);
assert.match(
  emptyResultSandbox.api.renderNonMainPreviewStatus("", "示例番剧"),
  /按「示例番剧」没有找到自动候选，请修改上方搜索词后手动搜索/,
  "empty automatic results show the attempted keyword and a manual-search next step",
);

const seasonKeywordSource = extractFunction(source, "getCurrentSeasonSearchKeyword");
const seasonKeywordSandbox = {
  state: { rawTitle: "【药屋少女の呢喃 第1-2季】4K超清未删减完整版" },
  currentSeason: 2,
  getCurrentCollectionPartContext: () => null,
  getCurrentVideoPartContext: () => ({ seasonNo: seasonKeywordSandbox.currentSeason }),
  getPageTitle: () => seasonKeywordSandbox.state.rawTitle,
  cleanTitle: (value) => String(value || "").includes("药屋少女") ? "药屋少女の呢喃" : "",
  getTitleSeasonNumber: () => 0,
};
runInSandbox(`${seasonKeywordSource}
;globalThis.api = { getCurrentSeasonSearchKeyword };`, seasonKeywordSandbox);
assert.equal(
  seasonKeywordSandbox.api.getCurrentSeasonSearchKeyword(),
  "药屋少女の呢喃 第2季",
  "a ranged multi-season page uses the active second-season part for automatic search",
);
seasonKeywordSandbox.currentSeason = 1;
assert.equal(
  seasonKeywordSandbox.api.getCurrentSeasonSearchKeyword(),
  "药屋少女の呢喃",
  "the first season keeps the base work title because Bangumi commonly omits a first-season suffix",
);

console.log("collection title fallback tests passed");
