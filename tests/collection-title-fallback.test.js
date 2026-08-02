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
const collectionArchiveTitleSource = extractFunction(source, "isBilibiliCollectionArchiveTitle");
const overallCollectionNode = {
  value: "『与奔驰于透明之夜的你 谈一场看不见的恋爱』",
};
const activeGroupNode = {
  value: "『第1~2话 与奔驰于透明之夜的你 谈一场看不见的恋爱』",
};
const calendarCollectionNode = {
  value: "『26年\\7月』",
};
const numericWorkCollectionNode = {
  value: "『22/7』",
};
let collectionSelectorMode = "overall";
const collectionSandbox = {
  isOfficialBangumiPage: () => false,
  document: {
    querySelector(selector) {
      if (collectionSelectorMode === "overall" && selector.includes("collectiondetail")) return overallCollectionNode;
      if (collectionSelectorMode === "active" && selector.includes("active.head")) return activeGroupNode;
      if (collectionSelectorMode === "calendar-with-active" && selector.includes("collectiondetail")) return calendarCollectionNode;
      if (collectionSelectorMode === "calendar-with-active" && selector.includes("active.head")) return activeGroupNode;
      if (collectionSelectorMode === "calendar-only" && selector.includes("collectiondetail")) return calendarCollectionNode;
      if (collectionSelectorMode === "numeric-work" && selector.includes("collectiondetail")) return numericWorkCollectionNode;
      return null;
    },
  },
  getElementTitleText: (node) => node.value,
  cleanTitle: (value) => String(value || "")
    .replace(/[『』]/g, "")
    .replace(/^第1~2话\s*/, "")
    .trim(),
};
runInSandbox(`${collectionArchiveTitleSource}
${collectionTitleSource}
;globalThis.api = { getBilibiliCollectionTitle, isBilibiliCollectionArchiveTitle };`, collectionSandbox);

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
collectionSelectorMode = "calendar-with-active";
assert.equal(
  collectionSandbox.api.getBilibiliCollectionTitle(),
  activeGroupNode.value,
  "a calendar archive title is skipped in favor of the active work group",
);
collectionSelectorMode = "calendar-only";
assert.equal(collectionSandbox.api.getBilibiliCollectionTitle(), "", "a calendar-only collection is not searched as a work title");
collectionSelectorMode = "numeric-work";
assert.equal(
  collectionSandbox.api.getBilibiliCollectionTitle(),
  numericWorkCollectionNode.value,
  "a slash in a legitimate numeric work title is not treated as a calendar archive",
);
for (const archiveTitle of ["7月新番", "2026年7月", "26年\\7月", "2026年/7月", "26年7月新番合集"]) {
  assert.equal(collectionSandbox.api.isBilibiliCollectionArchiveTitle(archiveTitle), true, `${archiveTitle} is a calendar archive`);
}
for (const workTitle of ["22/7", "86", "7月与安生"]) {
  assert.equal(collectionSandbox.api.isBilibiliCollectionArchiveTitle(workTitle), false, `${workTitle} remains a usable work title`);
}

const suggestTitleSource = extractFunction(source, "suggestSearchKeyword");
const standalonePartTitleSource = extractFunction(source, "isStandaloneBilibiliPartTitle");
const pageSearchKeywordSource = extractFunction(source, "getCurrentPageSearchKeyword");
const suggestSandbox = {
  EPISODE_MARKER_SOURCE: "第\\s*\\d+(?:(?:\\s*[话話集])?\\s*[-~～至到]\\s*(?:第\\s*)?\\d+)?\\s*[话話集]",
  state: { subject: null, rawTitle: "『第1~3话』", pageTitle: "" },
  displaySubjectName: (subject) => subject.name,
  cleanTitle: (value) => {
    if (value === "『第1~3话』") return "";
    if (value === overallCollectionNode.value) return "与奔驰于透明之夜的你 谈一场看不见的恋爱";
    return String(value || "").trim();
  },
  getCurrentSeasonSearchKeyword: () => "",
  getPageTitle: () => suggestSandbox.state.rawTitle,
  getBilibiliCollectionTitle: () => overallCollectionNode.value,
};
runInSandbox(`${standalonePartTitleSource}
${pageSearchKeywordSource}
${suggestTitleSource}
;globalThis.api = { suggestSearchKeyword, getCurrentPageSearchKeyword };`, suggestSandbox);
assert.equal(
  suggestSandbox.api.suggestSearchKeyword(),
  "与奔驰于透明之夜的你 谈一场看不见的恋爱",
  "automatic search falls back to the collection title",
);
suggestSandbox.state.rawTitle = "『擅长跳舞的殿下』周更 全13话";
suggestSandbox.state.pageTitle = "擅长跳舞的殿下";
assert.equal(
  suggestSandbox.api.suggestSearchKeyword(),
  "擅长跳舞的殿下",
  "a usable page work title is preferred over the overall collection title",
);
suggestSandbox.state.rawTitle = "(4)";
suggestSandbox.state.pageTitle = "(4)";
assert.equal(
  suggestSandbox.api.suggestSearchKeyword(),
  "与奔驰于透明之夜的你 谈一场看不见的恋爱",
  "a wrapped part number falls through the full selection chain to collection context",
);
suggestSandbox.getBilibiliCollectionTitle = () => "";
assert.equal(suggestSandbox.api.suggestSearchKeyword(), "", "a wrapped part number with only a calendar archive yields no automatic keyword");
suggestSandbox.getBilibiliCollectionTitle = () => overallCollectionNode.value;
suggestSandbox.state.subject = { name: "已绑定条目" };
assert.equal(suggestSandbox.api.suggestSearchKeyword(), "已绑定条目", "a bound subject still has highest priority");
suggestSandbox.state.subject = null;
suggestSandbox.getCurrentSeasonSearchKeyword = () => "药屋少女の呢喃 第2季";
assert.equal(
  suggestSandbox.api.suggestSearchKeyword(),
  "药屋少女の呢喃 第2季",
  "an active season inferred from the part title is preferred over a cross-season collection title",
);

const pageKeywordSandbox = {
  EPISODE_MARKER_SOURCE: "第\\s*\\d+(?:(?:\\s*[话話集])?\\s*[-~～至到]\\s*(?:第\\s*)?\\d+)?\\s*[话話集]",
  state: { rawTitle: "(4)", pageTitle: "(4)" },
  getPageTitle: () => pageKeywordSandbox.state.rawTitle,
};
runInSandbox(`${standalonePartTitleSource}
${pageSearchKeywordSource}
;globalThis.api = { getCurrentPageSearchKeyword };`, pageKeywordSandbox);
assert.equal(pageKeywordSandbox.api.getCurrentPageSearchKeyword(), "", "a wrapped part number still falls back to collection context");
pageKeywordSandbox.state = { rawTitle: "『第1~3话』", pageTitle: "第1~3话" };
assert.equal(pageKeywordSandbox.api.getCurrentPageSearchKeyword(), "", "an episode-range-only title still falls back to collection context");
pageKeywordSandbox.state = { rawTitle: "86", pageTitle: "86" };
assert.equal(pageKeywordSandbox.api.getCurrentPageSearchKeyword(), "86", "a legitimate numeric work title remains usable");
pageKeywordSandbox.state = { rawTitle: "『86』", pageTitle: "86" };
assert.equal(pageKeywordSandbox.api.getCurrentPageSearchKeyword(), "86", "a quote-wrapped numeric work title remains usable");
pageKeywordSandbox.state = { rawTitle: "『擅长跳舞的殿下』周更 全13话", pageTitle: "擅长跳舞的殿下" };
assert.equal(pageKeywordSandbox.api.getCurrentPageSearchKeyword(), "擅长跳舞的殿下", "a normal page work title remains usable");

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

const pagePreviewSandbox = {
  ...collectionPreviewSandbox,
  state: { nonMainResults: [], rawTitle: "『擅长跳舞的殿下』周更 全13话" },
  getInlineAutoPreviewKeyword: () => "擅长跳舞的殿下",
  getPageTitle: () => "『擅长跳舞的殿下』周更 全13话",
  getBilibiliCollectionTitle: () => calendarCollectionNode.value,
  cleanTitle: (value) => String(value || "").includes("擅长跳舞的殿下") ? "擅长跳舞的殿下" : String(value || "").replace(/[『』]/g, ""),
};
runInSandbox(`${renderPreviewSource}
;globalThis.api = { renderInlineAutoPreview };`, pagePreviewSandbox);
const pagePreviewHtml = pagePreviewSandbox.api.renderInlineAutoPreview();
assert.doesNotMatch(pagePreviewHtml, /当前视频标题未包含作品名/, "a valid page title must not be described as missing");
assert.match(pagePreviewHtml, /下面是按「擅长跳舞的殿下」自动匹配的候选/, "the UI reports the selected page keyword");

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
