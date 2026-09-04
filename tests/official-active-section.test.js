"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");

const functions = [
  "getOfficialBangumiSectionTitle", "getOfficialBangumiPlayingSectionTitle",
  "stripOfficialBangumiProgressSuffix", "extractOfficialBangumiSectionTitleFromPageTitle",
  "normalizeOfficialBangumiSectionTitle", "isOfficialBangumiSectionContainedInSeries",
  "getOfficialBangumiDistinctSectionTitle", "getOfficialBangumiContextTitle",
  "resolveCurrentPageTitle", "getOfficialBangumiSectionBindingKey",
  "getOfficialBangumiSectionBindingKeys", "isVisible",
];
const seriesTitle = "BanG Dream! 梦想协奏曲 第三季";

// Mirror the observed DOM hierarchy: both panels have a selected SectionTabs
// button, but only the actual playing EP has EpisodeVirtualList_activeItem.
function makePanel(title, episodes, selectedTab = title) {
  const panel = {
    className: "SectionPanel_panel__rImmk",
    heading: { textContent: title },
    selectedTab: { className: "SectionTabs_tab__gqNSD SectionTabs_active__cms8S", textContent: selectedTab },
    querySelector(selector) {
      assert.equal(selector, "h3");
      return this.heading;
    },
  };
  const scroll = { className: "scroll", parentElement: panel };
  const canvas = { className: "virtualCanvas", parentElement: scroll };
  const row = { className: "EpisodeVirtualList_virtualRow", parentElement: canvas };
  panel.links = episodes.map(({ id, active = false, grid = false, visible = true, text = "" }) => ({
    className: `${grid ? "EpisodeVirtualList_numberItem__GLWgO" : "EpisodeVirtualList_listItem__QZXPZ"}${active ? (grid ? " EpisodeVirtualList_activeNumber__Sm49O" : " EpisodeVirtualList_activeItem__yHjGZ") : ""}`,
    textContent: text,
    parentElement: row,
    offsetWidth: visible ? 80 : 0,
    getClientRects: () => [],
    getAttribute: (name) => name === "href" ? `/bangumi/play/ep${id}` : null,
    matches(selector) {
      assert.equal(selector, "[class*='EpisodeVirtualList_activeItem'], [class*='EpisodeVirtualList_activeNumber']");
      return /EpisodeVirtualList_active(?:Item|Number)/.test(this.className);
    },
    closest(selector) {
      assert.equal(selector, "[class*='SectionPanel_panel']");
      let ancestor = this.parentElement;
      while (ancestor && !ancestor.className.includes("SectionPanel_panel")) ancestor = ancestor.parentElement;
      return ancestor || null;
    },
  }));
  return panel;
}

function setup(source) {
  const api = {
    state: {},
    panels: [],
    mediaId: "28224078",
    legacySection: "",
    rawTitle: seriesTitle,
    location: { pathname: "/bangumi/play/ss29308", href: "https://www.bilibili.com/bangumi/play/ss29308?spm_id_from=333.337.0.0" },
    isOfficialBangumiPage: () => true,
    getSeriesTitle: () => seriesTitle,
    getOfficialBangumiMediaIdFromDom: () => api.mediaId,
    getPageTitle: () => api.rawTitle,
    shouldUseRawTitleForPreview: () => false,
    getOfficialBangumiBaseBindingKeys: () => ["bili:md28224078", "bili:ss29308"],
    cleanTitle: (value) => String(value || "").trim(),
    normalizeTitleText: (value) => String(value || "").trim(),
    normalizeBindingToken: (value) => String(value || "").toLowerCase().replace(/\s+/g, ""),
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, "[class*='SectionPanel_panel'] a[href*='/bangumi/play/ep']");
        return api.panels.flatMap((panel) => panel.links);
      },
      querySelector(selector) {
        if (selector.includes("SectionSelector_sectionItem") && api.legacySection) return { textContent: api.legacySection };
        return null;
      },
    },
  };
  return runInSandbox(functions.map((name) => extractFunction(source, name)).join("\n"), api);
}

const sources = [["userscript", readSource(USERSCRIPT_PATH)], ["extension", readSource(EXTENSION_PATH)]];
for (const name of functions) assert.equal(extractFunction(sources[0][1], name), extractFunction(sources[1][1], name), `${name} must stay mirrored`);

for (const [label, source] of sources) {
  test(`${label}: ss history resumes the attached work despite a season-only document title`, () => {
    const api = setup(source);
    const main = makePanel("正片", [{ id: 307454 }], "第三季");
    const mini = makePanel("元祖迷你动画", [{ id: 5732269, active: true, text: "元祖迷你47 Sauna..." }]);
    api.panels = [main, mini];
    api.legacySection = "第三季";
    assert.equal(api.getOfficialBangumiSectionTitle(), "元祖迷你动画");
    assert.equal(api.resolveCurrentPageTitle(), `${seriesTitle} 元祖迷你`);
    assert.equal(api.getOfficialBangumiSectionBindingKey(), "bili:md28224078|section:元祖迷你");
    main.selectedTab.textContent = "第二季";
    mini.selectedTab.textContent = "PV";
    assert.equal(api.getOfficialBangumiSectionTitle(), "元祖迷你动画", "browsing tabs does not change the playing work");
  });

  test(`${label}: the EP route wins over an old active item in a different panel`, () => {
    const api = setup(source);
    api.location.pathname = "/bangumi/play/ep5732269";
    api.location.href = "https://www.bilibili.com/bangumi/play/ep5732269";
    api.panels = [
      makePanel("正片", [{ id: 307454, active: true }]),
      makePanel("元祖迷你动画", [{ id: 5732269 }]),
    ];
    assert.equal(api.getOfficialBangumiSectionTitle(), "元祖迷你动画");
    api.location.pathname = "/bangumi/play/ep307454";
    api.location.href = "https://www.bilibili.com/bangumi/play/ep307454";
    assert.equal(api.getOfficialBangumiSectionTitle(), "正片");
    assert.equal(api.getOfficialBangumiSectionBindingKey(), "", "switching to the main work restores its season binding");
  });

  test(`${label}: a browsed attached-work panel cannot replace the playing main work`, () => {
    const api = setup(source);
    api.panels = [
      makePanel("正片", [{ id: 307454, active: true }], "第三季"),
      makePanel("元祖迷你动画", [{ id: 5732269 }]),
    ];
    api.legacySection = "元祖迷你动画";
    assert.equal(api.getOfficialBangumiSectionTitle(), "正片");
    assert.equal(api.resolveCurrentPageTitle(), seriesTitle);
  });

  test(`${label}: hidden old active items do not mask the visible playing section`, () => {
    const api = setup(source);
    api.panels = [
      makePanel("正片", [{ id: 307454, active: true, visible: false }]),
      makePanel("元祖迷你动画", [{ id: 5732269, active: true }]),
    ];
    assert.equal(api.getOfficialBangumiSectionTitle(), "元祖迷你动画");
  });

  test(`${label}: virtual unmount preserves the confirmed section until a new playing item appears`, () => {
    const api = setup(source);
    api.panels = [makePanel("元祖迷你动画", [{ id: 5732269, active: true }])];
    assert.equal(api.getOfficialBangumiSectionBindingKey(), "bili:md28224078|section:元祖迷你");
    api.panels = [makePanel("正片", [{ id: 307454 }], "第三季")];
    api.legacySection = "第三季";
    assert.equal(api.getOfficialBangumiSectionBindingKey(), "bili:md28224078|section:元祖迷你");
    api.panels = [makePanel("正片", [{ id: 307454, active: true, grid: true }])];
    assert.equal(api.getOfficialBangumiSectionTitle(), "正片", "the number-grid playing marker replaces the cached attached work");
    assert.equal(api.getOfficialBangumiSectionBindingKey(), "");
  });

  test(`${label}: a different route or live media identity cannot inherit the cached playing section`, () => {
    const api = setup(source);
    api.panels = [makePanel("元祖迷你动画", [{ id: 5732269, active: true }])];
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "元祖迷你动画");
    api.panels = [];
    api.mediaId = "99999";
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "");
    api.mediaId = "28224078";
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "", "restoring a media id must not resurrect its cleared cache");
    api.panels = [makePanel("元祖迷你动画", [{ id: 5732269, active: true }])];
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "元祖迷你动画");
    api.panels = [];
    api.location.pathname = "/bangumi/play/ss31861";
    api.location.href = "https://www.bilibili.com/bangumi/play/ss31861";
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "");
  });

  test(`${label}: leaving the official page clears the cache before returning to the same ss URL`, () => {
    const api = setup(source);
    api.panels = [makePanel("元祖迷你动画", [{ id: 5732269, active: true }])];
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "元祖迷你动画");
    api.panels = [];
    const originalHref = api.location.href;
    api.location.href = "https://www.bilibili.com/video/BV1other";
    api.location.pathname = "/video/BV1other";
    Object.assign(api, {
      routeRefreshSeq: 0,
      invalidatePageInitialState() {},
      refreshPageInitialState: () => Promise.resolve(),
      removeModal() {},
      settleInlineConfirm() {},
      render() {},
      window: { setTimeout() {} },
    });
    runInSandbox(extractFunction(source, "scheduleRouteRefresh"), api);
    api.scheduleRouteRefresh(seriesTitle);
    assert.equal(api.state.officialBangumiPlayingSection, null);
    api.location.href = originalHref;
    api.location.pathname = "/bangumi/play/ss29308";
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "");
  });

  test(`${label}: ambiguous active items and selected tabs alone provide no playing section`, () => {
    const api = setup(source);
    api.panels = [
      makePanel("正片", [{ id: 307454, active: true }]),
      makePanel("元祖迷你动画", [{ id: 5732269, active: true }]),
    ];
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "");
    api.panels = [makePanel("元祖迷你动画", [{ id: 5732269 }], "PV")];
    assert.equal(api.getOfficialBangumiPlayingSectionTitle(), "");
    assert.equal(api.resolveCurrentPageTitle(), seriesTitle);
  });

  test(`${label}: legacy section selectors and episode-title fallbacks remain usable`, () => {
    const api = setup(source);
    api.legacySection = "元祖迷你动画 (47/52)";
    assert.equal(api.getOfficialBangumiSectionTitle(), "元祖迷你动画");
    api.legacySection = "";
    api.rawTitle = `${seriesTitle}元祖迷你47`;
    assert.equal(api.getOfficialBangumiSectionTitle(), "元祖迷你");
  });
}
