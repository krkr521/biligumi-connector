"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, extractConstants, runInSandbox } = require("./_source");

function setup(file) {
  const source = readSource(file);
  const scope = {
    ...extractConstants(source, ["MAX_COLLECTION_SEGMENTS", "MIN_COLLECTION_PARSED_PARTS", "NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN"]),
  };
  runInSandbox([
    "stripTrailingDurationText", "normalizeTitleText", "isNonMainEpisodeTitle", "parseChineseNumber",
    "parseCollectionFragment", "parseCollectionPartTitle", "getQualifiedCollectionPartRows",
  ].map((name) => extractFunction(source, name)).join("\n"), scope);
  return scope;
}

const seasonFourEpisodeTwelve = [
  "S4E12", "s4ep12", "S04 E012", "S4.12", "S4-12", "S4_12", "S4 12", "S4:12",
  "Season 4 Episode 12", "season4 EP012", "SEASON 04 : E012", "4th Season EP12",
  "Season IV Episode 12", "season iv - ep12", "第IV季第12集", "Ⅳ Season EP12",
  "Fourth Season Episode 12", "Season Four EP12", "SEASON FOURTH EP12", "Season:4 EP12", "Season:Ⅳ EP12",
  "Part Two Season Four EP12", "S-04 E12", "Season-IV EP12",
  "シーズン4 第12話", "第4シーズン第十二話", "第四シーズン 第12話",
  "第四季12", "第4季第12集", "第四期第十二話", "四季 第十二集", "第４期 第０１２话",
  "S4第十二集", "4x12", "04x012", "04×012", "４Ｘ０１２", "4x12话",
  "【S04】（EP012）", "［ｓ４］［ｅｐ１２］", "Ｓ４．１２", "Ｓ４－１２", "S4—12",
  "【示例动画】 S4E12", "示例动画第四季第十二集", "Example Anime S4E12", "示例动画：S4E12",
  "【示例动画】第四季 第十二集 相遇", "示例动画 4th Season Episode 12", "示例动画：4x12",
  "【示例动画】【Season IV】【EP12】", "S4E12 1080P", "S4E12 相遇 23:45",
];

const rejected = [
  "S4", "s04", "第四季", "Season IV", "S412", "S0412", "Season 412", "NEWS4E12", "ExampleS4E12",
  "4.12", "4.12.0", "4.12.9", "4.12.1.2", "4.0.9", "0.12.1", "4x", "4x1000",
  "2026.09.09", "2026-09-09", "2026/09/09", "v4.12.1", "版本 4.12.1", "version 4.12.1", "Version:4.12.1",
  "日期 4.12.1", "分辨率 4x12", "1920x1080", "1080P", "4K超清", "S4 1080P",
  "Part 4 EP12", "Cour 4 EP12", "第4部第12集", "第四篇第12集", "上篇12", "下篇12", "Season IV Part 2",
  "S4E12 OP", "S4E12 PV2", "第四季12 预告", "4.12.1 OVA", "示例动画 PV S4E12",
  "S4E12-13", "第四季1-2", "第4季第12集-第13集", "S4E12/13", "S4E12~13", "第四季12至13集",
  "Season IIII Episode 12", "Season IIIV EP12", "S3 S4E12", "第四季 S3E12",
  "S4E12 .9", "S4E12 .1.2", "S4E12 第9段", "S4E12 第十二段",
  "S4E12 Part 9", "S4E12 Pt.0", "S4E12 Part II", "S4E12 中篇", "S4E12 中", "S4E12 上中下",
  "S4E12 上篇 下篇", "S4E12 上/下", "S4E12 下半段2",
  "全四季 第12集", "共4季 第12集", "第1-4季 第12集", "第一至第四季 第12集", "第1、2、3、4季 第12集",
  "Season1-4 EP12", "Season 1-4", "Seasons 1-4 EP12", "All Four Seasons EP12", "First to Fourth Season EP12",
  "S1-4 EP12", "S4-12 EP13", "S4E12 第13集",
];

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  test(`${label}: common explicit season and episode notation resolves to the same logical episode`, () => {
    const api = setup(file);
    for (const title of seasonFourEpisodeTwelve) {
      const actual = api.parseCollectionPartTitle(title);
      assert.ok(actual, title);
      assert.equal(actual.seasonNo, 4, title);
      assert.equal(actual.seasonKey, "season:4", title);
      assert.equal(actual.episodeNo, 12, title);
      assert.equal(actual.fragmentIndex, 1, title);
      assert.equal(actual.fragmentCount, 1, title);
    }
  });

  test(`${label}: first/second/third ordinals and canonical roman season numbers remain distinct`, () => {
    const api = setup(file);
    for (const [title, seasonNo] of [
      ["1st Season E12", 1], ["2nd Season EP12", 2], ["3rd Season Episode 12", 3],
      ["11th Season EP12", 11], ["Season II EP12", 2], ["Season IX EP12", 9],
      ["Season XII EP12", 12], ["第十二季第十二集", 12], ["Twelfth Season Episode12", 12], ["Season Eleven EP12", 11],
    ]) {
      const actual = api.parseCollectionPartTitle(title);
      assert.equal(actual?.seasonNo, seasonNo, title);
      assert.equal(actual?.episodeNo, 12, title);
    }
    assert.equal(api.parseCollectionPartTitle("第四季第零话").episodeNo, 0);
  });

  test(`${label}: explicit seasons and hierarchical labels retain fragment counts and existing decimal semantics`, () => {
    const api = setup(file);
    for (const [title, seasonNo, episodeNo, fragmentIndex, fragmentCount, hierarchical] of [
      ["4.12.1", 4, 12, 1, 2, true], ["4.12.2", 4, 12, 2, 2, true], ["4.12.8", 4, 12, 8, 8, true],
      ["【示例动画】４．１２．１ 相遇 ２３：４５", 4, 12, 1, 2, true], ["示例动画：4.12.2", 4, 12, 2, 2, true],
      ["S4E12.1", 4, 12, 1, 2, false], ["S4.12.2", 4, 12, 2, 2, false], ["S4E12_3", 4, 12, 3, 3, false],
      ["S4E12-A", 4, 12, 1, 2, false], ["S4EP12 B", 4, 12, 2, 2, false],
      ["第4季第12集上", 4, 12, 1, 2, false], ["第四期第十二话下", 4, 12, 2, 2, false],
      ["Season IV Episode 12 第三段", 4, 12, 3, 3, false], ["4x12 第2段", 4, 12, 2, 2, false],
      ["S4E12 Part 1", 4, 12, 1, 2, false], ["S4E12 Part 2", 4, 12, 2, 2, false],
      ["S4E12-Pt.1", 4, 12, 1, 2, false], ["S4E12 Pt.2", 4, 12, 2, 2, false],
      ["S4E12 第二部分", 4, 12, 2, 2, false], ["S4E12 上篇", 4, 12, 1, 2, false], ["S4E12 下篇", 4, 12, 2, 2, false],
      ["S4E12 上半", 4, 12, 1, 2, false], ["S4E12 下半", 4, 12, 2, 2, false],
      ["S4E12 上半段", 4, 12, 1, 2, false], ["S4E12 下半段", 4, 12, 2, 2, false],
      ["S4E12 上半部分", 4, 12, 1, 2, false], ["S4E12 下半部分", 4, 12, 2, 2, false],
      ["S4E12 前半", 4, 12, 1, 2, false], ["S4E12 后半", 4, 12, 2, 2, false],
      ["1.1", null, 1, 1, 2, false], ["1.3", null, 1, 3, 3, false], ["4.2", null, 4, 2, 2, false],
      ["第十二集下", null, 12, 2, 2, false], ["EP01-A", null, 1, 1, 2, false],
    ]) {
      const actual = api.parseCollectionPartTitle(title);
      assert.ok(actual, title);
      assert.equal(actual.seasonNo, seasonNo, title);
      assert.equal(actual.episodeNo, episodeNo, title);
      assert.equal(actual.fragmentIndex, fragmentIndex, title);
      assert.equal(actual.fragmentCount, fragmentCount, title);
      assert.equal(Boolean(actual.hierarchical), hierarchical, title);
    }
  });

  test(`${label}: ambiguous compact numbers, ranges, releases and non-content labels cannot become an episode binding`, () => {
    const api = setup(file);
    for (const title of rejected) assert.equal(api.parseCollectionPartTitle(title), null, title);
  });

  test(`${label}: numeric work names survive range checks while mixed episode markers fail closed`, () => {
    const api = setup(file);
    for (const [title, seasonNo] of [["86 - 2nd Season EP12", 2], ["22/7 Season 4 EP12", 4]]) {
      assert.equal(api.parseCollectionPartTitle(title)?.seasonNo, seasonNo, title);
      assert.equal(api.parseCollectionPartTitle(title)?.episodeNo, 12, title);
    }
    for (const title of ["S3 4.12.1", "Example 4.12.1 S3", "S4E7 4.12.1", "4x12 S3E10", "S4E7 4x12", "S4E12 4x13"]) {
      assert.equal(api.parseCollectionPartTitle(title), null, title);
    }
    for (const title of ["S4 4.12.1", "Season IV 4.12.1", "S4 4x12"]) {
      assert.equal(api.parseCollectionPartTitle(title)?.seasonNo, 4, title);
      assert.equal(api.parseCollectionPartTitle(title)?.episodeNo, 12, title);
    }
  });

  test(`${label}: a subdivision numeral before Season cannot become a second season marker`, () => {
    const api = setup(file);
    for (const title of ["Example Anime Part II Season IV EP12", "Example Anime Cour II Season IV EP12", "Example Anime Part Fourth Season IV EP12", "Example Anime Ｐａｒｔ Ⅱ Ｓｅａｓｏｎ Ⅳ EP12", "Example Anime IV Season EP12"]) {
      assert.equal(api.parseCollectionPartTitle(title)?.seasonNo, 4, title);
      assert.equal(api.parseCollectionPartTitle(title)?.episodeNo, 12, title);
    }
    for (const title of ["Example Anime Part II Season EP12", "Example Anime Part II Season III Season IV EP12"]) {
      assert.equal(api.parseCollectionPartTitle(title), null, title);
    }
  });

  test(`${label}: hierarchical season labels still require a complete ordered collection`, () => {
    const api = setup(file);
    const rows = [];
    for (let episode = 12; episode <= 15; episode += 1) {
      for (let fragment = 1; fragment <= 2; fragment += 1) {
        const title = `【示例动画】4.${episode}.${fragment}`;
        rows.push({ partNo: rows.length + 1, title, parsed: api.parseCollectionPartTitle(title) });
      }
    }
    assert.equal(api.getQualifiedCollectionPartRows(rows).length, 8);
    assert.equal(api.getQualifiedCollectionPartRows(rows.slice(0, 2)).length, 0, "a single logical split episode is insufficient");
    assert.equal(api.getQualifiedCollectionPartRows(rows.filter((row) => row.partNo !== 3)).length, 0, "missing the first fragment cannot qualify");
    const outOfOrder = rows.map((row) => ({ ...row, partNo: row.partNo === 3 ? 4 : row.partNo === 4 ? 3 : row.partNo }));
    assert.equal(api.getQualifiedCollectionPartRows(outOfOrder).length, 0);
  });
}

test("collection part notation parser remains identical in both distribution formats", () => {
  assert.equal(
    extractFunction(readSource(USERSCRIPT_PATH), "parseCollectionPartTitle"),
    extractFunction(readSource(EXTENSION_PATH), "parseCollectionPartTitle"),
  );
});
