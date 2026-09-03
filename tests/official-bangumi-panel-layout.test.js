"use strict";

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  extractConstants,
  runInSandbox,
} = require("./_source");

function loadAnchorFinder(filePath) {
  const source = readSource(filePath);
  const constants = extractConstants(source, ["OFFICIAL_BANGUMI_EPISODE_LIST_SELECTOR"]);
  const functionSource = extractFunction(source, "findOfficialBangumiLayoutAnchor");
  const sandbox = {
    ...constants,
    state: { officialBangumiLayoutEnabled: true },
    isOfficialBangumiPage: () => true,
    isVisible: (node) => Boolean(node && node.visible !== false),
    getDirectChild: (_host, node) => node.directChild || node,
    getVisibleChildren: (host) => host.children.filter((node) => node.visible !== false),
  };
  runInSandbox(`${functionSource}\n;globalThis.findOfficialBangumiLayoutAnchor = findOfficialBangumiLayoutAnchor;`, sandbox);
  return sandbox;
}

function exerciseFallbackLayout(filePath, officialPage, rightColumnAvailable = true) {
  const source = readSource(filePath);
  const functionSource = extractFunction(source, "layoutPanelWithoutOwningBiliDom");
  const panel = {
    classList: { toggle() {} },
    style: {},
    getBoundingClientRect: () => ({ height: 400 }),
  };
  const fallback = {
    getBoundingClientRect: () => ({ bottom: 500 }),
  };
  const rightColumn = {
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 100, width: 350 }),
  };
  let fallbackCalls = 0;
  let reservedTarget = null;
  let cleared = false;
  const sandbox = {
    PANEL_ID: "biligumi-connector-panel",
    document: { getElementById: () => panel },
    window: { scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0 },
    findRightColumn: () => (rightColumnAvailable ? rightColumn : null),
    findOfficialBangumiLayoutAnchor: () => null,
    findPanelInsertReference: () => {
      fallbackCalls += 1;
      return fallback;
    },
    isOfficialBangumiPage: () => officialPage,
    isVisible: (node) => Boolean(node),
    hasOverlappingBiliMusicOverlay: () => false,
    clearReservedLayoutSpace: () => { cleared = true; },
    stabilizePanelReserve: (_panel, reserve) => reserve,
    reserveLayoutSpace: (target) => { reservedTarget = target; },
  };
  runInSandbox(`${functionSource}\n;globalThis.layoutPanelWithoutOwningBiliDom = layoutPanelWithoutOwningBiliDom;`, sandbox);
  sandbox.layoutPanelWithoutOwningBiliDom();
  return { panel, fallback, fallbackCalls, reservedTarget, cleared };
}

for (const [label, filePath] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const sandbox = loadAnchorFinder(filePath);
  const paginatedRoot = { textContent: "", visible: true };
  const nestedPanel = { textContent: "正片 (2/13)", visible: true, directChild: paginatedRoot };
  let selectorUsed = "";
  const nextRightColumn = {
    children: [paginatedRoot],
    querySelectorAll(selector) {
      selectorUsed = selector;
      return [nestedPanel];
    },
  };

  assert.equal(
    sandbox.findOfficialBangumiLayoutAnchor(nextRightColumn),
    paginatedRoot,
    `${label}: the Next.js episode panel must resolve to its direct right-column module`,
  );
  assert.match(selectorUsed, /PaginatedEpList_root/, `${label}: the current Bilibili episode-list root must be recognized`);
  assert.match(selectorUsed, /SectionPanel_panel/, `${label}: the current nested episode panel must be recognized`);

  const semanticRoot = { textContent: "选集（5/24） 1 2 3", visible: true };
  const unknownRightColumn = {
    children: [{ textContent: "弹幕列表", visible: true }, semanticRoot],
    querySelectorAll() {
      return [];
    },
  };
  assert.equal(
    sandbox.findOfficialBangumiLayoutAnchor(unknownRightColumn),
    semanticRoot,
    `${label}: a renamed episode module must still be found by its leading section label`,
  );

  const officialOptOut = exerciseFallbackLayout(filePath, true);
  assert.equal(officialOptOut.fallbackCalls, 0, `${label}: official layout opt-out must skip the generic fallback`);
  assert.equal(officialOptOut.panel.style.position, "fixed", `${label}: opt-out keeps the legacy non-reserving layout`);
  assert.equal(officialOptOut.panel.style.top, "96px", `${label}: opt-out keeps the panel visible below the site header`);
  assert.equal(officialOptOut.panel.style.left, "100px", `${label}: opt-out aligns the fixed panel to the right column`);
  assert.equal(officialOptOut.panel.style.right, "auto", `${label}: aligned fixed layout must not keep a stale right offset`);
  assert.equal(officialOptOut.panel.style.width, "350px", `${label}: opt-out keeps the right-column panel width`);
  assert.equal(officialOptOut.reservedTarget, null, `${label}: opt-out must not move Bilibili's official modules`);
  assert.equal(officialOptOut.cleared, true, `${label}: opt-out clears any earlier reserved space`);

  const ordinaryFallback = exerciseFallbackLayout(filePath, false);
  assert.equal(ordinaryFallback.fallbackCalls, 1, `${label}: ordinary pages retain the generic fallback`);
  assert.equal(ordinaryFallback.panel.style.position, "absolute", `${label}: ordinary fallback remains positioned`);
  assert.equal(ordinaryFallback.panel.style.top, "512px", `${label}: ordinary fallback is placed below its anchor`);
  assert.equal(ordinaryFallback.reservedTarget, ordinaryFallback.fallback, `${label}: ordinary fallback reserves space`);

  const missingColumnFallback = exerciseFallbackLayout(filePath, false, false);
  assert.equal(missingColumnFallback.panel.style.position, "fixed", `${label}: missing right column uses a fixed fallback`);
  assert.equal(missingColumnFallback.panel.style.top, "96px", `${label}: missing right column fallback stays on-screen`);
  assert.equal(missingColumnFallback.panel.style.left, "auto", `${label}: missing right column fallback clears stale left offsets`);
  assert.equal(missingColumnFallback.panel.style.right, "16px", `${label}: missing right column fallback uses a safe viewport inset`);
  assert.equal(missingColumnFallback.panel.style.width, "min(350px, calc(100vw - 32px))", `${label}: missing right column fallback fits narrow viewports`);
}

assert.equal(
  extractFunction(readSource(EXTENSION_PATH), "findOfficialBangumiLayoutAnchor"),
  extractFunction(readSource(USERSCRIPT_PATH), "findOfficialBangumiLayoutAnchor"),
  "official Bangumi panel anchoring must stay identical between userscript and extension",
);

for (const name of ["mutationTouchesOfficialBangumiEpisodeList", "layoutPanelWithoutOwningBiliDom"]) {
  assert.equal(
    extractFunction(readSource(EXTENSION_PATH), name),
    extractFunction(readSource(USERSCRIPT_PATH), name),
    `${name} must stay identical between userscript and extension`,
  );
}

assert.equal(
  extractConstants(readSource(EXTENSION_PATH), ["OFFICIAL_BANGUMI_EPISODE_LIST_SELECTOR"])
    .OFFICIAL_BANGUMI_EPISODE_LIST_SELECTOR,
  extractConstants(readSource(USERSCRIPT_PATH), ["OFFICIAL_BANGUMI_EPISODE_LIST_SELECTOR"])
    .OFFICIAL_BANGUMI_EPISODE_LIST_SELECTOR,
  "official Bangumi episode-list selectors must stay identical between userscript and extension",
);

console.log("official Bangumi panel layout tests passed");
