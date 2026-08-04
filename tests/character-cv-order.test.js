"use strict";

// Character CV rendering regression tests.
//
// The fixtures below come from the independently checked Codex thread
// "核查Bangumi CV顺序差异". For all five characters, Bangumi's web
// "出演" order is the exact reverse of the deduplicated API order. The age
// direction varies, so production code must not guess adult/child from gender.
// This reversal is verified for two-CV pairs only; live CLANNAD checks show
// that 3+ actor groups do not follow a simple reverse rule, so those retain API
// order while every CV is still rendered.

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

const ORDER_FIXTURES = [
  {
    characterId: 1683,
    character: "阿斯贝尔·兰特",
    api: ["櫻井孝宏", "甲斐田ゆき"],
    web: ["甲斐田ゆき", "櫻井孝宏"],
  },
  {
    characterId: 22567,
    character: "村上良太",
    api: ["佐藤利奈", "逢坂良太"],
    web: ["逢坂良太", "佐藤利奈"],
  },
  {
    characterId: 68756,
    character: "托尔芬",
    api: ["上村祐翔", "石上静香"],
    web: ["石上静香", "上村祐翔"],
  },
  {
    characterId: 93963,
    character: "高宫铁兵",
    api: ["亀井芳子", "檜山修之"],
    web: ["檜山修之", "亀井芳子"],
  },
  {
    characterId: 164507,
    character: "凤·拉斐内",
    api: ["平松晶子", "一条和矢"],
    web: ["一条和矢", "平松晶子"],
  },
];

// The helper and card renderer must remain identical in both builds.
for (const name of ["getDisplayCharacterActors", "renderCharacterCard"]) {
  const userscriptBlock = extractFunction(userscriptSource, name);
  const extensionBlock = extractFunction(extensionSource, name);
  assert.equal(extensionBlock, userscriptBlock, `${name} must stay identical between userscript and extension`);
}

function loadDisplayActors(source) {
  const sandbox = {};
  runInSandbox(extractFunction(source, "getDisplayCharacterActors"), sandbox);
  return (character) => Array.from(sandbox.getDisplayCharacterActors(character));
}

const getDisplayActors = loadDisplayActors(userscriptSource);

for (const fixture of ORDER_FIXTURES) {
  const actors = fixture.api.map((name, index) => ({ id: index + 1, name }));
  const actual = getDisplayActors({ actors }).map((actor) => actor.name);
  assert.deepEqual(
    actual,
    fixture.web,
    `${fixture.character} (${fixture.characterId}) must follow Bangumi web CV order`,
  );
}

// Three-or-more actor groups have no simple API-to-web transform. A live check
// of CLANNAD's 15-CV mob, 7-CV schoolgirls and 11-CV schoolboys showed that none
// were exact reversals, so preserve API order instead of inventing a new one.
{
  const apiActors = ["斉藤次郎", "モリノリ久", "巻島直樹"];
  const actual = getDisplayActors({
    actors: apiActors.map((name, index) => ({ id: index + 1, name })),
  }).map((actor) => actor.name);
  assert.deepEqual(actual, apiActors, "3+ CV groups must retain API order");
}

// Invalid actor records are ignored without changing the relative order of
// valid CVs, and the API-owned array must not be mutated by display sorting.
{
  const actors = [
    { id: 1, name: "成年CV" },
    null,
    { id: 2, name: "" },
    { id: 3, name: "幼年CV" },
  ];
  const before = actors.slice();
  const actual = getDisplayActors({ actors }).map((actor) => actor.name);
  assert.deepEqual(actual, ["幼年CV", "成年CV"]);
  assert.deepEqual(actors, before, "display ordering must not mutate character.actors");
  assert.deepEqual(getDisplayActors(null), []);
  assert.deepEqual(getDisplayActors({ actors: null }), []);
}

function loadCharacterCardRenderer(source) {
  const sandbox = {
    BGM_WEB_BASE: "https://bgm.tv",
    getBestCharacterImage: () => "",
  };
  for (const name of ["escapeHtml", "getDisplayCharacterActors", "renderCharacterCard"]) {
    runInSandbox(extractFunction(source, name), sandbox);
  }
  return (character) => sandbox.renderCharacterCard(character);
}

// The card must render every CV, in web order, with an individual person link.
{
  const renderCard = loadCharacterCardRenderer(userscriptSource);
  const html = renderCard({
    id: 1007,
    name: "岡崎朋也",
    relation: "主角",
    actors: [
      { id: 4495, name: "緒乃冬華" },
      { id: 4724, name: "中村悠一" },
    ],
  });
  const adultIndex = html.indexOf("中村悠一");
  const childIndex = html.indexOf("緒乃冬華");
  assert.ok(adultIndex !== -1 && childIndex !== -1, "all CV names must be rendered");
  assert.ok(adultIndex < childIndex, "CV names must follow Bangumi web order");
  assert.ok(html.includes('href="https://bgm.tv/person/4724"'));
  assert.ok(html.includes('href="https://bgm.tv/person/4495"'));
}

// Empty actor data keeps the existing user-facing fallback.
{
  const renderCard = loadCharacterCardRenderer(userscriptSource);
  const html = renderCard({ id: 1, name: "未录入角色", relation: "配角", actors: [] });
  assert.ok(html.includes("CV 未录入"));
}

// The old single-CV shortcut and nowrap clipping would silently hide extra
// actors even if their HTML existed; both regressions are guarded here.
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const renderBlock = extractFunction(source, "renderCharacterCard");
  assert.ok(!renderBlock.includes("character.actors[0]"), `${label} must not select only the first CV`);
  const cssStart = source.indexOf(`#${"${CHARACTER_STRIP_ID}"} .biligumi-character-cv {`);
  assert.notEqual(cssStart, -1, `${label} must keep the character CV style block`);
  const cssEnd = source.indexOf("\n    }", cssStart);
  const cssBlock = source.slice(cssStart, cssEnd);
  assert.ok(cssBlock.includes("white-space: normal"), `${label} must allow multiple CVs to wrap`);
  assert.ok(!cssBlock.includes("text-overflow: ellipsis"), `${label} must not clip later CVs`);
}

console.log("character CV order tests passed");
