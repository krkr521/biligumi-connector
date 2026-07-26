"use strict";

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  runInSandbox,
} = require("./_source");

const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);

const CONTEXT_FUNCTIONS = [
  "getSeriesTitle",
  "getOfficialBangumiMediaTitleFromDom",
  "stripOfficialBangumiProgressSuffix",
  "getOfficialBangumiSectionTitle",
  "extractOfficialBangumiSectionTitleFromPageTitle",
  "normalizeOfficialBangumiSectionTitle",
  "isOfficialBangumiSectionContainedInSeries",
  "getOfficialBangumiDistinctSectionTitle",
  "getOfficialBangumiContextTitle",
  "resolveCurrentPageTitle",
  "getOfficialBangumiMediaIdFromDom",
  "getOfficialBangumiBaseBindingKeys",
  "getOfficialBangumiSectionBindingKey",
  "getOfficialBangumiSectionBindingKeys",
];

const MIRRORED_FUNCTIONS = [
  "observeRouteChanges",
  "mutationTouchesOfficialBangumiEpisodeList",
  "hookHistoryNavigation",
  "scheduleRouteRefresh",
  "refreshPageContext",
  "getBindingKeysForCurrentPage",
  "getDirectBindingKeysForCurrentPage",
  "getPageKey",
  "getStableBiliSubjectKey",
  "getTitleBindingInfo",
  "doesCurrentTitleMatchSubjectEvidence",
  ...CONTEXT_FUNCTIONS,
];

for (const name of MIRRORED_FUNCTIONS) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

const canonicalizeExtensionRouteRefresh = (value) => value
  .replace("    state.settingsOpen = false;\n", "")
  .replace("    state.collectionEditorOpen = false;\n", "")
  .replace("    state.collectionEditorContext = null;\n", "")
  .replace("    removeModal();\n", "");
assert.equal(
  extractFunction(extensionSource, "refreshAfterRouteChange"),
  canonicalizeExtensionRouteRefresh(extractFunction(userscriptSource, "refreshAfterRouteChange")),
  "refreshAfterRouteChange must differ only by the established extension modal lifecycle",
);

let activeSectionTitle = "元祖迷你动画";
let listTitleText = "";
let rawTitle = "BanG Dream! 梦想协奏曲 第三季";
let episodeLinks = [];

const mediaNode = {
  textContent: "BanG Dream! 梦想协奏曲 第三季",
  getAttribute(name) {
    return name === "href" ? "/bangumi/media/md28224078" : null;
  },
};

const document = {
  querySelector(selector) {
    if (selector === "#eplist_module") {
      return {
        querySelectorAll(innerSelector) {
          if (innerSelector === "a[href*='/bangumi/play/']") return episodeLinks;
          return [];
        },
      };
    }
    if (selector.includes("mediainfo_mediaTitle")) return mediaNode;
    if (selector === "a[href*='/bangumi/media/md']") return mediaNode;
    if (selector.includes(".media-title")) return null;
    if (selector.includes("SectionSelector_sectionItem") && selector.includes("SectionSelector_active")) {
      return activeSectionTitle ? { textContent: activeSectionTitle } : null;
    }
    if (selector.includes("[class*='sectionItem'][class*='active']")) return null;
    if (selector.includes("[class*='eplist_list_title'] h4")) {
      return listTitleText ? { textContent: listTitleText } : null;
    }
    if (selector.includes("[class*='eplist_list_title']")) {
      if (listTitleText) return { textContent: listTitleText };
      return activeSectionTitle ? { textContent: activeSectionTitle } : null;
    }
    return null;
  },
  querySelectorAll(selector) {
    return selector === "a[href*='/bangumi/media/md']" ? [mediaNode] : [];
  },
};

const sandbox = {
  document,
  window: { __INITIAL_STATE__: {} },
  location: {
    pathname: "/bangumi/play/ss29308",
    href: "https://www.bilibili.com/bangumi/play/ss29308",
  },
  URL,
  isOfficialBangumiPage: () => true,
  normalizeTitleText: (value) => String(value || "")
    .replace(/\s*-\s*(?:番剧|番劇).*$/i, "")
    .replace(/\s+/g, " ")
    .trim(),
  cleanTitle: (value) => String(value || "")
    .replace(/\s*-\s*番剧.*$/i, "")
    .replace(/\s+/g, " ")
    .trim(),
  // Match production: trim + collapse whitespace only (do not strip punctuation).
  normalizeBindingToken: (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, ""),
  shouldUseRawTitleForPreview: () => false,
  getPageTitle: () => rawTitle,
  getPathToken: (prefix) => {
    const match = sandbox.location.pathname.match(new RegExp(`/${prefix}(\\d+)`, "i"));
    return match ? `${prefix}${match[1]}` : "";
  },
  stripBiliPrefix: (value, prefix) => String(value || "").replace(new RegExp(`^${prefix}`, "i"), ""),
  getStableBiliSubjectKey: () => "bili:ss29308",
};

const source = CONTEXT_FUNCTIONS.map((name) => extractFunction(userscriptSource, name)).join("\n");
runInSandbox(
  `${source}\n;globalThis.api = {
    getSeriesTitle,
    stripOfficialBangumiProgressSuffix,
    getOfficialBangumiSectionTitle,
    extractOfficialBangumiSectionTitleFromPageTitle,
    getOfficialBangumiDistinctSectionTitle,
    getOfficialBangumiContextTitle,
    resolveCurrentPageTitle,
    getOfficialBangumiMediaIdFromDom,
    getOfficialBangumiBaseBindingKeys,
    getOfficialBangumiSectionBindingKey,
    getOfficialBangumiSectionBindingKeys,
    isOfficialBangumiSectionContainedInSeries,
  };`,
  sandbox,
);

const expectedContextTitle = "BanG Dream! 梦想协奏曲 第三季 元祖迷你";
assert.equal(sandbox.api.getSeriesTitle(), "BanG Dream! 梦想协奏曲 第三季", "series title falls back to the media link");
assert.equal(sandbox.api.getOfficialBangumiSectionTitle(), "元祖迷你动画");
assert.equal(sandbox.api.getOfficialBangumiContextTitle(), expectedContextTitle);
assert.equal(sandbox.api.resolveCurrentPageTitle(), expectedContextTitle, "initial season-only document title uses the active section");

rawTitle = "BanG Dream! 梦想协奏曲 第三季元祖迷你42-番剧-高清独家在线观看-bilibili-哔哩哔哩";
sandbox.location.pathname = "/bangumi/play/ep4818476";
sandbox.location.href = "https://www.bilibili.com/bangumi/play/ep4818476";
assert.equal(
  sandbox.api.resolveCurrentPageTitle(),
  expectedContextTitle,
  "episode switches must not leak the current mini-episode number into the binding title",
);
assert.equal(sandbox.api.getOfficialBangumiMediaIdFromDom(), "28224078");
assert.equal(
  sandbox.api.getOfficialBangumiSectionBindingKey(),
  "bili:md28224078|section:元祖迷你",
  "all episodes in one Bilibili section share a stable binding key",
);
assert.deepEqual(
  [...sandbox.api.getOfficialBangumiSectionBindingKeys()],
  ["bili:md28224078|section:元祖迷你"],
  "an ep route with live media identity must not include a stale initial season key",
);

// EP path with list already containing the current episode still prefers active SectionSelector.
episodeLinks = [{
  getAttribute() {
    return "/bangumi/play/ep4818476";
  },
}];
activeSectionTitle = "元祖迷你动画";
assert.equal(
  sandbox.api.getOfficialBangumiSectionTitle(),
  "元祖迷你动画",
  "when the list contains the current ep, active section DOM remains authoritative",
);
assert.equal(sandbox.api.getOfficialBangumiSectionBindingKey(), "bili:md28224078|section:元祖迷你");

// Progress counters must not become part of the section key.
activeSectionTitle = "正片 (3/13)";
listTitleText = "";
episodeLinks = [];
sandbox.location.pathname = "/bangumi/play/ss29308";
sandbox.location.href = "https://www.bilibili.com/bangumi/play/ss29308";
assert.equal(sandbox.api.stripOfficialBangumiProgressSuffix("正片 (3/13)"), "正片");
assert.equal(sandbox.api.getOfficialBangumiDistinctSectionTitle(), "", "generic main-content sections keep legacy season binding");
assert.equal(sandbox.api.getOfficialBangumiContextTitle(), "BanG Dream! 梦想协奏曲 第三季");
assert.equal(sandbox.api.getOfficialBangumiSectionBindingKey(), "");

listTitleText = "选集（5/24）";
activeSectionTitle = "";
assert.equal(sandbox.api.getOfficialBangumiSectionTitle(), "选集");
assert.equal(sandbox.api.getOfficialBangumiDistinctSectionTitle(), "", "progress-contaminated generic list titles stay non-distinct");
assert.equal(sandbox.api.getOfficialBangumiSectionBindingKey(), "");

listTitleText = "元祖迷你动画 (12/42)";
assert.equal(sandbox.api.getOfficialBangumiSectionTitle(), "元祖迷你动画");
assert.equal(sandbox.api.getOfficialBangumiDistinctSectionTitle(), "元祖迷你");
assert.equal(
  sandbox.api.getOfficialBangumiSectionBindingKey(),
  "bili:md28224078|section:元祖迷你",
  "progress counters do not churn the section binding token",
);

listTitleText = "";
activeSectionTitle = "第三季";
assert.equal(sandbox.api.getOfficialBangumiDistinctSectionTitle(), "", "a section already contained in the series title is not duplicated");
assert.equal(sandbox.api.isOfficialBangumiSectionContainedInSeries("第三季"), true);

// Page-title extract: strip CJK-trailing episode numbers but keep ASCII tails like OVA2.
assert.equal(
  sandbox.api.extractOfficialBangumiSectionTitleFromPageTitle(
    "BanG Dream! 梦想协奏曲 第三季元祖迷你42-番剧",
    "BanG Dream! 梦想协奏曲 第三季",
  ),
  "元祖迷你",
);
assert.equal(
  sandbox.api.extractOfficialBangumiSectionTitleFromPageTitle("Some Series OVA2-番剧", "Some Series"),
  "OVA2",
  "intentional ASCII numeric tails are preserved",
);

// Missing media id falls back to stable subject key for section bindings.
const previousMediaHref = mediaNode.getAttribute;
mediaNode.getAttribute = () => null;
document.querySelectorAll = () => [];
const prevQuery = document.querySelector;
document.querySelector = (selector) => {
  if (selector === "a[href*='/bangumi/media/md']") return null;
  if (selector.includes("mediainfo_mediaTitle")) return null;
  return prevQuery.call(document, selector);
};
listTitleText = "";
activeSectionTitle = "元祖迷你动画";
assert.equal(
  sandbox.api.getOfficialBangumiSectionBindingKey(),
  "bili:ss29308|section:元祖迷你",
  "section keys fall back to stable subject key when media id is unavailable",
);
assert.deepEqual(
  [...sandbox.api.getOfficialBangumiSectionBindingKeys()],
  ["bili:ss29308|section:元祖迷你"],
  "without a media id only the stable subject base variant exists",
);
mediaNode.getAttribute = previousMediaHref;
document.querySelector = prevQuery;
document.querySelectorAll = (selector) => (selector === "a[href*='/bangumi/media/md']" ? [mediaNode] : []);

console.log("official Bangumi section context tests passed");
