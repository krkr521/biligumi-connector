"use strict";

// Official Bilibili Bangumi pages expose two episode numbers with different
// meanings: the visible label can be 0/1/2..., while "(1/13)" is the stable
// 1-based position used to select the corresponding Bangumi API episode.

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

for (const name of ["detectCurrentEpisodeNo", "getEpisodeDisplayNo", "formatEpisodeSort"]) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

function loadCurrentEpisodeDetector({ official, officialOrdinal }) {
  const sandbox = {
    getCurrentCollectionPartContext: () => null,
    getCollectionMappingRule: () => null,
    getCollectionMappedEpisodeNo: () => null,
    getOfficialBangumiProgressEpisodeNo: () => officialOrdinal,
    detectEpisodeNo: (text) => {
      const match = String(text || "").match(/第\s*(\d+)\s*集/);
      const value = match ? Number(match[1]) : 0;
      return value > 0 ? value : null;
    },
    hasEpisodeRangeMarker: () => false,
    isNonMainEpisodeTitle: () => false,
    getActiveEpisodeText: () => "",
    getCurrentVideoPartEpisodeNo: () => null,
    isOfficialBangumiPage: () => official,
  };
  runInSandbox(
    `${extractFunction(userscriptSource, "detectCurrentEpisodeNo")};globalThis.detect = detectCurrentEpisodeNo;`,
    sandbox,
  );
  return sandbox.detect;
}

{
  const detect = loadCurrentEpisodeDetector({ official: true, officialOrdinal: 1 });
  assert.equal(detect("UBW 第一季第0集"), 1, "official episode 0 is the first main-episode ordinal");
}

{
  const detect = loadCurrentEpisodeDetector({ official: true, officialOrdinal: 2 });
  assert.equal(
    detect("UBW 第一季第1集"),
    2,
    "official episode 1 after a real episode 0 must map to the second Bangumi item",
  );
}

{
  const detect = loadCurrentEpisodeDetector({ official: false, officialOrdinal: null });
  assert.equal(detect("普通视频 第1集"), 1, "non-official title detection keeps its old semantics");
}

{
  const sandbox = {};
  runInSandbox(
    `${extractFunction(userscriptSource, "parseOfficialBangumiProgressEpisodeNo")};globalThis.parse = parseOfficialBangumiProgressEpisodeNo;`,
    sandbox,
  );
  assert.equal(sandbox.parse("正片 (1/13)"), 1);
  assert.equal(sandbox.parse("正片（2 / 13）"), 2);
  assert.equal(sandbox.parse("正片 (13/13)"), 13);
}

{
  const sandbox = {};
  runInSandbox(
    `${extractFunction(userscriptSource, "formatEpisodeSort")};globalThis.format = formatEpisodeSort;`,
    sandbox,
  );
  assert.equal(sandbox.format(0), "0", "EP0 must not be padded to EP00");
  assert.equal(sandbox.format(1), "01", "ordinary single-digit episodes keep the existing padding");
  assert.equal(sandbox.format(12), "12");
}

function loadDisplayNo(episodes) {
  const sandbox = {
    getNormalEpisodes: () => episodes,
    getEpisodeLocalNo: (episode) => episodes.findIndex((item) => item.id === episode.id) + 1,
  };
  runInSandbox(
    `${extractFunction(userscriptSource, "getEpisodeDisplayNo")};globalThis.display = getEpisodeDisplayNo;`,
    sandbox,
  );
  return sandbox.display;
}

{
  const episodes = [
    { id: 435521, type: 0, sort: 0, name: "プロローグ" },
    { id: 1, type: 0, sort: 1 },
    { id: 2, type: 0, sort: 2 },
  ];
  const display = loadDisplayNo(episodes);
  assert.equal(display(episodes[0]), 0, "a real Bangumi sort=0 episode is displayed as EP0");
  assert.equal(display(episodes[1]), 1);
  assert.equal(display(episodes[2]), 2);
}

{
  const episodes = Array.from({ length: 13 }, (_, index) => ({
    id: 1000 + index,
    type: 0,
    sort: index,
  }));
  const sandbox = {
    state: { episodes, currentEpisodeNo: 2 },
  };
  runInSandbox(extractFunction(userscriptSource, "getNormalEpisodes"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "isCurrentEpisodeNumber"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getCurrentNormalEpisode"), sandbox);
  assert.equal(
    sandbox.getCurrentNormalEpisode().sort,
    1,
    "official ordinal 2 must select Bangumi sort=1 rather than the preceding EP0",
  );
  sandbox.state.currentEpisodeNo = 13;
  assert.equal(sandbox.getCurrentNormalEpisode().sort, 12);
}

{
  const episodes = [
    { id: 13, type: 0, sort: 13 },
    { id: 14, type: 0, sort: 14 },
  ];
  const display = loadDisplayNo(episodes);
  assert.equal(display(episodes[0]), 1, "a season subset without sort=0 keeps local numbering");
  assert.equal(display(episodes[1]), 2);
}

{
  const episodes = Array.from({ length: 13 }, (_, index) => ({
    id: 2000 + index,
    type: 0,
    sort: index,
  }));
  const sandbox = {
    getNormalEpisodes: () => episodes,
    getProgressInfo: () => ({ total: 13, watched: 0, summary: "0/13 已看" }),
    renderLongVideoEpisodeHint: () => "",
    renderAutoProgressModeToggle: () => "",
    getEpisodeCollectionType: () => 0,
    getEpisodeAirState: () => "aired",
    isCurrentEpisodeNumber: (_episode, ordinal) => ordinal === 1,
    escapeHtml: (value) => String(value),
  };
  runInSandbox(extractFunction(userscriptSource, "formatEpisodeSort"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getEpisodeDisplayNo"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "renderEpisodeGrid"), sandbox);
  const html = sandbox.renderEpisodeGrid();
  assert.match(html, /class="biligumi-episode [^"]*current"[^>]*>0<\/button>/);
  assert.match(html, />01<\/button>/);
  assert.match(html, />12<\/button>/);
  assert.ok(!html.includes(">13</button>"), "a real EP0 season must not be relabeled as 01-13");
}

const renderGridSource = extractFunction(userscriptSource, "renderEpisodeGrid");
assert.ok(
  renderGridSource.includes("getEpisodeDisplayNo(ep, localNo, episodes)"),
  "the episode grid must render the zero-aware display number",
);

console.log("official episode-zero tests passed");
