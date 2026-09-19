"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction } = require("./_source");
const { loadParsingFixture } = require("./_parsing-fixture");

// A small DOM fixture, not a selector-to-result stub: ownership, ancestry and
// nested active classes must be resolved by the production code under test.
function matchesCompound(node, selector, scope) {
  if (selector.includes(":scope")) {
    if (node !== scope) return false;
    selector = selector.replace(":scope", "");
  }
  const attributes = [...selector.matchAll(/\[([^\s\]^*$=]+)\s*(?:(\^=|\*=|\$=|=)\s*['"]?([^'"\]]*)['"]?)?\]/g)];
  for (const [, name, operator, expected] of attributes) {
    const value = node.getAttribute(name);
    if (value == null) return false;
    if (operator === "=" && value !== expected) return false;
    if (operator === "*=" && !value.includes(expected)) return false;
    if (operator === "^=" && !value.startsWith(expected)) return false;
    if (operator === "$=" && !value.endsWith(expected)) return false;
  }
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const tag = rest.match(/^[a-z][\w-]*/i);
  if (tag && node.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
  for (const [, name] of rest.matchAll(/\.([\w-]+)/g)) {
    if (!node.classList.contains(name)) return false;
  }
  const id = rest.match(/#([\w-]+)/);
  return !id || node.getAttribute("id") === id[1];
}

function matchesSelector(node, selector, scope) {
  return selector.split(",").some((branch) => {
    const tokens = branch.trim().match(/(?:\[[^\]]*\]|[^\s>])+|>/g) || [];
    let candidate = node;
    let index = tokens.length - 1;
    if (!candidate || !matchesCompound(candidate, tokens[index--] || "", scope)) return false;
    while (index >= 0) {
      const direct = tokens[index] === ">";
      if (direct) index -= 1;
      const parentSelector = tokens[index--];
      candidate = candidate.parentElement;
      if (!direct) {
        while (candidate && !matchesCompound(candidate, parentSelector, scope)) candidate = candidate.parentElement;
      }
      if (!candidate || !matchesCompound(candidate, parentSelector, scope)) return false;
    }
    return true;
  });
}

function element(className = "", attributes = {}, children = [], text = "") {
  const node = {
    tagName: "DIV",
    className,
    children,
    parentElement: null,
    hidden: false,
    style: {},
    getAttribute(name) {
      if (name === "class") return this.className;
      return Object.prototype.hasOwnProperty.call(attributes, name) ? String(attributes[name]) : null;
    },
    hasAttribute(name) { return this.getAttribute(name) != null; },
    matches(selector) { return matchesSelector(this, selector, this); },
    closest(selector) {
      for (let ancestor = this; ancestor; ancestor = ancestor.parentElement) {
        if (matchesSelector(ancestor, selector, ancestor)) return ancestor;
      }
      return null;
    },
    querySelectorAll(selector) {
      const result = [];
      const visit = (parent) => {
        for (const child of parent.children) {
          if (matchesSelector(child, selector, this)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    contains(other) {
      for (let ancestor = other; ancestor; ancestor = ancestor.parentElement) if (ancestor === this) return true;
      return false;
    },
    getClientRects() {
      for (let ancestor = this; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.hidden || ancestor.style.display === "none") return [];
      }
      return [{ width: 100, height: 20 }];
    },
  };
  node.classList = { contains: (name) => node.className.split(/\s+/).includes(name) };
  node.dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith("data-"))
    .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), String(value)]));
  Object.defineProperty(node, "textContent", { get: () => text + children.map((child) => child.textContent).join("") });
  for (const child of children) child.parentElement = node;
  return node;
}

const CURRENT_BVID = "BV1Nce56BENd";
const FIRST_BVID = "BV1AWTd6SEio";
const CURRENT_TITLE = "『碧蓝之海 第三季』第11话";

function partList(titles, activeIndex = 0, nestedActive = false) {
  const rows = titles.map((title, index) => element(
    `page-item${!nestedActive && index === activeIndex ? " active" : ""}`,
    { title },
    [element(`simple-base-item sub${nestedActive && index === activeIndex ? " active" : ""}`, {},
      [element("title", { title }, [], title)])],
  ));
  const list = element("page-list simple", {}, rows);
  return { root: element("multi-p", {}, [list]), list, rows };
}

function playerPartList(titles, activeIndex = -1, bvid = "") {
  const rows = titles.map((title, index) => element(
    `bpx-player-ctrl-eplist-multi-menu-item${index === activeIndex ? " bpx-state-multi-active-item" : ""}`,
    { "data-cid": 39711540546 + index }, [], title,
  ));
  const list = element("bpx-player-ctrl-eplist-episodes-content", {}, rows);
  const root = element("bpx-player-ctrl-eplist-episodes", bvid ? { "data-bvid": bvid } : {}, [list]);
  root.hidden = true;
  root.style.display = "none";
  return { root, rows };
}

function ugcFixture(currentParts = null, playerParts = null) {
  const foreign = partList(Array.from({ length: 8 }, (_, index) => `第一季${index + 1}`), 3, true);
  foreign.root.hidden = true;
  foreign.root.style.display = "none";
  const rows = Array.from({ length: 11 }, (_, index) => {
    const bvid = index === 0 ? FIRST_BVID : index === 10 ? CURRENT_BVID : `BVUGCITEM${index + 1}`;
    const title = `『碧蓝之海 第三季』第${index + 1}话`;
    const header = element(`simple-base-item head${index === 10 ? " active" : ""}`, {},
      [element("title", { title }, [], title)]);
    return element("pod-item video-pod__item simple", {
      "data-key": bvid,
      ...(index === 10 ? { "data-scrolled": "true" } : {}),
    }, [header, ...(index === 0 ? [foreign.root] : []), ...(index === 10 && currentParts ? [currentParts.root] : [])]);
  });
  const root = element("video-pod", {}, [element("video-pod__list section", {}, rows)]);
  return { document: element("document", {}, [root, ...(playerParts ? [playerParts.root] : [])]), rows, foreign };
}

function linkedVideoPod(titles, hrefs, activeIndex) {
  const rows = titles.map((title, index) => element("video-pod__item simple", { href: hrefs[index] }, [
    element(`simple-base-item${index === activeIndex ? " active" : ""}`, {}, [element("title", { title }, [], title)]),
  ]));
  const root = element("video-pod", {}, [element("video-pod__list", {}, rows)]);
  return { document: element("document", {}, [root]), rows };
}

const constants = [
  "EPISODE_PATTERNS", "EPISODE_NUMBER_SOURCE", "EPISODE_MARKER_SOURCE", "EPISODE_RANGE_MARKER_SOURCE",
  "LABELED_EPISODE_RANGE_SOURCE", "COMMON_RESOLUTIONS", "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN",
  "MIN_COLLECTION_PARSED_PARTS", "MAX_COLLECTION_SEGMENTS", "COLLECTION_PART_ROWS_CACHE_MS",
];
const functions = [
  "getBvIdFromUrl", "getCurrentPartNoFromUrl", "getVideoPartListNodes", "isActiveVideoPartNode",
  "getVideoPartNodeTitle", "getCurrentVideoPartContext", "getCollectionPartRows", "getQualifiedCollectionPartRows",
  "getCurrentCollectionLayoutContext", "getCurrentCollectionPartContext", "parseCollectionPartTitle",
  "parseBareCollectionEpisodeTitle", "parseChineseNumber", "parseCollectionFragment", "parseLongVideoPartTitle",
  "normalizeTitleText", "isNonMainEpisodeTitle", "stripTrailingDurationText", "getCollectionLogicalEpisodeCount",
  "isCollectionRangeMappingEligible", "isOrdinaryEpisodeCollectionForTotal", "isCurrentOrdinaryEpisodeCollection",
  "getDeclaredTotalEpisodeCount", "getStoredSubjectDeclaredTotalEpisodeCount", "getCollectionMappingRules",
  "getCollectionMappingResolution", "getCollectionMappingRule", "getCollectionMappedEpisodeNo",
  "detectCurrentEpisodeNo", "detectEpisodeNo", "isTotalEpisodeCountMatch", "isEpisodeRangeMatch",
  "hasEpisodeRangeMarker", "isCommonResolutionNumber", "getCurrentVideoPartEpisodeNo",
  "formatCollectionTargetEpisodeLabel", "formatCollectionSourceRange", "formatCollectionTargetRange",
  "renderCollectionMappingHint",
];

function setup(source, document, { titles = [CURRENT_TITLE], urlPart = null, legacyMapping = false } = {}) {
  const href = `https://www.bilibili.com/video/${CURRENT_BVID}/${urlPart == null ? "" : `?p=${urlPart}`}`;
  const initial = {
    bvid: CURRENT_BVID,
    p: urlPart || 1,
    videoData: {
      bvid: CURRENT_BVID,
      videos: titles.length,
      pages: titles.map((part, index) => ({ page: index + 1, cid: 41896379615 + index, part })),
    },
  };
  const api = {
    URL,
    document,
    location: { href, pathname: `/video/${CURRENT_BVID}/` },
    getPageInitialState: () => initial,
    getPageTitle: () => CURRENT_TITLE,
    getCurrentDirectBindingSubjectId: () => 999,
    getOfficialBangumiProgressEpisodeNo: () => null,
    getActiveEpisodeText: () => "",
    formatEpisodeSort: (value) => String(value),
    escapeHtml: (value) => String(value),
    state: {
      subjectId: 999,
      subject: { id: 999, total_episodes: 12 },
      bindingSubjects: {},
      currentEpisodeNumberSource: "",
      collectionMappings: legacyMapping ? { [CURRENT_BVID.toUpperCase()]: [{
        id: "season:3:1-12", seasonKey: "season:3", sourceStart: 1, sourceEnd: 12, targetStart: 1,
        subjectId: 999, segmentCount: 1, autoProgress: true,
      }] } : {},
    },
  };
  loadParsingFixture(source, functions, api, constants);
  const vm = require("node:vm");
  vm.runInContext(extractFunction(source, "buildCollectionRangeBindingProposal", { async: true }), api);
  return api;
}

for (const [label, path] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(path);

  test(`${label}: a single-P BV does not inherit UGC rows or another BV's hidden P list`, () => {
    const fixture = ugcFixture();
    const api = setup(source, fixture.document);
    assert.equal(fixture.document.querySelectorAll(".video-pod__list .video-pod__item").length, 11);
    assert.equal(fixture.document.querySelectorAll(".multi-p .page-list .page-item").length, 8);
    assert.equal(fixture.rows[10].classList.contains("active"), false);
    assert.ok(fixture.rows[10].querySelector(".simple-base-item.active"));
    assert.equal(api.getVideoPartListNodes().length, 0, "cross-BV UGC episodes are not this video's P list");
    assert.equal(api.getCurrentCollectionPartContext(), null);
  });

  test(`${label}: a stale UGC mapping cannot override the single-P video's episode 11 title`, async () => {
    const api = setup(source, ugcFixture().document, { legacyMapping: true });
    assert.equal(api.detectCurrentEpisodeNo(CURRENT_TITLE), 11);
    assert.equal(api.state.currentEpisodeNumberSource, "label");
    assert.equal(api.renderCollectionMappingHint(), "", "the unrelated saved rule must not be advertised as active");
    assert.equal(await api.buildCollectionRangeBindingProposal(999), null, "binding must stay out of the P-range editor");
  });

  test(`${label}: missing page-state counts still exclude cross-BV rows and hidden foreign P lists`, () => {
    const api = setup(source, ugcFixture().document, { legacyMapping: true });
    api.getPageInitialState = () => ({});
    assert.equal(api.getVideoPartListNodes().length, 0, "DOM ownership must work before page-state arrives");
    assert.equal(api.getCurrentCollectionPartContext(), null);
    assert.equal(api.detectCurrentEpisodeNo(CURRENT_TITLE), 11);
    assert.equal(api.renderCollectionMappingHint(), "");
    assert.equal(api.state.collectionMappings[CURRENT_BVID.toUpperCase()].length, 1,
      "ignoring an inapplicable old rule must not delete stored user data");
  });

  test(`${label}: a multi-P BV nested in UGC uses its own rows and nested active part`, () => {
    const titles = ["第一季1", "第一季2", "第一季3", "第一季4"];
    const own = partList(titles, 2, true);
    const fixture = ugcFixture(own);
    const api = setup(source, fixture.document, { titles });
    const actual = api.getVideoPartListNodes();
    assert.equal(actual.length, own.rows.length, "the preceding foreign BV's hidden 8P must be excluded");
    assert.ok(Array.from(actual).every((row, index) => row === own.rows[index]), "every returned P must belong to the current BV");
    const context = api.getCurrentVideoPartContext();
    assert.equal(context.partNo, 3);
    assert.equal(context.partCount, 4);
    assert.equal(context.title, titles[2]);
  });

  test(`${label}: an unowned player menu for another UGC archive cannot revive a stale mapping`, () => {
    for (const activeIndex of [-1, 2]) {
      const foreignPlayer = playerPartList(Array.from({ length: 8 }, (_, index) => `(${index + 1})`), activeIndex);
      const api = setup(source, ugcFixture(null, foreignPlayer).document, { legacyMapping: true });
      api.getPageInitialState = () => ({});
      assert.equal(api.getVideoPartListNodes().length, 0, "the player caches other UGC archives without BV ownership");
      assert.equal(api.getCurrentCollectionPartContext(), null);
      assert.equal(api.detectCurrentEpisodeNo(CURRENT_TITLE), 11);
      assert.equal(api.renderCollectionMappingHint(), "", "the sandbox's missing page-state must not produce an unmapped notice");
    }
  });

  test(`${label}: a current UGC archive's own P list wins over an unowned player menu`, () => {
    const titles = ["第一季1", "第一季2", "第一季3", "第一季4"];
    const own = partList(titles, 2, true);
    const foreignPlayer = playerPartList(Array.from({ length: 8 }, (_, index) => `(${index + 1})`), 1);
    const api = setup(source, ugcFixture(own, foreignPlayer).document, { titles });
    api.getPageInitialState = () => ({});
    const nodes = api.getVideoPartListNodes();
    assert.equal(nodes.length, 4);
    assert.ok(Array.from(nodes).every((node, index) => node === own.rows[index]));
    assert.equal(api.getCurrentCollectionPartContext().episodeNo, 3);
  });

  test(`${label}: a standalone player-only P list remains usable without page-state`, () => {
    const titles = ["第一季1", "第一季2", "第一季3", "第一季4"];
    const player = playerPartList(titles, 2);
    const api = setup(source, element("document", {}, [player.root]), { titles });
    api.getPageInitialState = () => ({});
    const nodes = api.getVideoPartListNodes();
    assert.equal(nodes.length, 4);
    assert.ok(Array.from(nodes).every((node, index) => node === player.rows[index]));
    assert.equal(api.getCurrentCollectionPartContext().episodeNo, 3);
  });

  test(`${label}: a player P menu with explicit current BV ownership remains usable in UGC`, () => {
    const titles = ["第一季1", "第一季2", "第一季3", "第一季4"];
    const player = playerPartList(titles, 2, CURRENT_BVID);
    const api = setup(source, ugcFixture(null, player).document, { titles });
    api.getPageInitialState = () => ({});
    const nodes = api.getVideoPartListNodes();
    assert.equal(nodes.length, 4);
    assert.ok(Array.from(nodes).every((node, index) => node === player.rows[index]));
    assert.equal(api.getCurrentCollectionPartContext().episodeNo, 3);
  });

  test(`${label}: a stale single-P snapshot cannot suppress a new BV's real multi-P group`, () => {
    const titles = ["第一季1", "第一季2", "第一季3", "第一季4"];
    const own = partList(titles, 2, true);
    const api = setup(source, ugcFixture(own).document, { titles });
    for (const initial of [{}, { bvid: FIRST_BVID, videoData: {
      bvid: FIRST_BVID, videos: 1, pages: [{ page: 1, part: "另一个视频" }],
    } }]) {
      api.getPageInitialState = () => initial;
      const actual = api.getVideoPartListNodes();
      assert.equal(actual.length, 4);
      assert.ok(Array.from(actual).every((row, index) => row === own.rows[index]));
      assert.equal(api.getCurrentVideoPartContext().partNo, 3);
    }
  });

  test(`${label}: ordinary multi-P lists retain DOM selection and URL p precedence`, () => {
    const titles = ["开头", "中间", "结尾"];
    const ordinary = partList(titles, 2);
    const document = element("document", {}, [ordinary.root]);
    const api = setup(source, document, { titles });
    assert.ok(Array.from(api.getVideoPartListNodes()).every((row, index) => row === ordinary.rows[index]));
    assert.equal(api.getVideoPartListNodes().length, ordinary.rows.length);
    assert.equal(api.getCurrentVideoPartContext().partNo, 3);
    const urlApi = setup(source, document, { titles, urlPart: 2 });
    assert.equal(urlApi.getCurrentVideoPartContext().partNo, 2);
    assert.equal(urlApi.getCurrentVideoPartContext().title, "中间", "the active DOM row may lag behind a route change");
  });

  test(`${label}: linked video-pod rows for the same BV retain nested active P and URL precedence`, () => {
    const titles = ["开头", "中间", "结尾"];
    const fixture = linkedVideoPod(titles, titles.map((_, index) => `/video/${CURRENT_BVID}/?p=${index + 1}`), 2);
    const api = setup(source, fixture.document, { titles });
    const rows = api.getVideoPartListNodes();
    assert.equal(rows.length, 3, "same-BV P links must not be confused with separate UGC archives");
    assert.ok(Array.from(rows).every((row, index) => row === fixture.rows[index]));
    assert.equal(api.getCurrentVideoPartContext().partNo, 3);
    assert.equal(api.getCurrentVideoPartContext().title, "结尾");
    const urlApi = setup(source, fixture.document, { titles, urlPart: 2 });
    assert.equal(urlApi.getCurrentVideoPartContext().partNo, 2);
    assert.equal(urlApi.getCurrentVideoPartContext().title, "中间");
  });

  test(`${label}: href ownership rejects cross-BV video-pod rows even without data-key or page-state`, () => {
    const titles = Array.from({ length: 11 }, (_, index) => `『碧蓝之海 第三季』第${index + 1}话`);
    const hrefs = titles.map((_, index) => `/video/${index === 10 ? CURRENT_BVID : `BVUGCLINK${index + 1}`}/`);
    const fixture = linkedVideoPod(titles, hrefs, 10);
    const api = setup(source, fixture.document, { legacyMapping: true });
    api.getPageInitialState = () => ({});
    assert.equal(api.getVideoPartListNodes().length, 0);
    assert.equal(api.getCurrentCollectionPartContext(), null);
    assert.equal(api.detectCurrentEpisodeNo(CURRENT_TITLE), 11);
    assert.equal(api.renderCollectionMappingHint(), "");
  });

  test(`${label}: a real multi-season multi-P upload retains collection mapping`, () => {
    const titles = ["第一季1", "第一季2", "第一季3", "第一季4", "第二季1", "第二季2", "第二季3", "第二季4"];
    const parts = partList(titles, 5, true);
    const api = setup(source, element("document", {}, [parts.root]), { titles });
    api.state.collectionMappings[CURRENT_BVID.toUpperCase()] = [{
      id: "season:2:1-4", seasonKey: "season:2", sourceStart: 1, sourceEnd: 4, targetStart: 1,
      subjectId: 1000, segmentCount: 1, autoProgress: true,
    }];
    const context = api.getCurrentCollectionPartContext();
    assert.equal(context.seasonKey, "season:2");
    assert.equal(context.partNo, 6);
    assert.equal(context.episodeNo, 2);
    assert.equal(context.groupLogicalEpisodeCount, 4);
    assert.equal(api.detectCurrentEpisodeNo("多季合集"), 2);
    assert.equal(api.state.currentEpisodeNumberSource, "ordinal");
  });
}
