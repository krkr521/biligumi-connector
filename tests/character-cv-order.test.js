"use strict";

// Bangumi's public characters API omits web relation labels (CV, 中配, etc.)
// and does not guarantee the web display order. Reuse the subject page that
// the info panel already reads in the background; do not add another request.

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

const MIRRORED_FUNCTIONS = [
  "getDisplayCharacterActors",
  "getDisplayCharacterActorGroups",
  "renderCharacterCard",
  "parseCharacterActorRelations",
  "applyCharacterActorRelations",
];

for (const name of MIRRORED_FUNCTIONS) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

function anchor(href, textContent = "") {
  return {
    textContent,
    getAttribute(name) {
      return name === "href" ? href : null;
    },
  };
}

function actorBadge({ id, name, relation, primary }) {
  const actorAnchor = anchor(`/person/${id}`, name);
  return {
    getAttribute(attribute) {
      if (attribute === "att-rlt-type-name") return relation;
      if (attribute === "attr-rlt-primary") return primary ? "1" : "";
      return null;
    },
    querySelector(selector) {
      if (selector.includes("/person/")) return actorAnchor;
      if (selector === ".tip_j") return { textContent: relation };
      return null;
    },
  };
}

function characterItem(characterId, badges) {
  return {
    querySelector(selector) {
      if (selector.includes("/character/")) return anchor(`/character/${characterId}`);
      return null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".actorBadge.badge_actor");
      return badges;
    },
  };
}

// subject 221736: the male API order is Chinese dub first, while the female
// API order is already primary CV first. A global two-actor reversal breaks 7
// of the 8 visible characters on this subject.
const subjectPageDocument = {
  querySelectorAll(selector) {
    assert.equal(selector, "#browserItemList .item");
    return [
      characterItem(57009, [
        actorBadge({ id: 31360, name: "高杉真宙", relation: "CV", primary: true }),
        actorBadge({ id: 18116, name: "藤新", relation: "中配", primary: false }),
      ]),
      characterItem(56788, [
        actorBadge({ id: 15497, name: "Lynn", relation: "CV", primary: true }),
        actorBadge({ id: 38697, name: "阎么么", relation: "中配", primary: false }),
      ]),
    ];
  },
};

const relationSandbox = {};
runInSandbox(extractFunction(userscriptSource, "parseCharacterActorRelations"), relationSandbox);
const relations = JSON.parse(JSON.stringify(relationSandbox.parseCharacterActorRelations(subjectPageDocument)));
assert.deepEqual(relations, {
  57009: [
    { actorId: 31360, name: "高杉真宙", relation: "CV", primary: true, order: 0 },
    { actorId: 18116, name: "藤新", relation: "中配", primary: false, order: 1 },
  ],
  56788: [
    { actorId: 15497, name: "Lynn", relation: "CV", primary: true, order: 0 },
    { actorId: 38697, name: "阎么么", relation: "中配", primary: false, order: 1 },
  ],
});

const displaySandbox = {
  BGM_WEB_BASE: "https://bgm.tv",
  getBestCharacterImage: () => "",
};
for (const name of [
  "escapeHtml",
  "getDisplayCharacterActors",
  "getDisplayCharacterActorGroups",
  "renderCharacterCard",
  "applyCharacterActorRelations",
]) {
  runInSandbox(extractFunction(userscriptSource, name), displaySandbox);
}

const apiCharacters = [
  {
    id: 57009,
    name: "僕",
    relation: "主角",
    actors: [
      { id: 18116, name: "藤新" },
      { id: 31360, name: "高杉真宙" },
    ],
  },
  {
    id: 56788,
    name: "山内桜良",
    relation: "主角",
    actors: [
      { id: 15497, name: "Lynn" },
      { id: 38697, name: "阎么么" },
    ],
  },
];
const apiSnapshot = JSON.stringify(apiCharacters);
const enriched = displaySandbox.applyCharacterActorRelations(apiCharacters, relations);
assert.equal(JSON.stringify(apiCharacters), apiSnapshot, "relation enrichment must not mutate API data");

function plainGroups(character) {
  return Array.from(displaySandbox.getDisplayCharacterActorGroups(character), (group) => ({
    label: group.label,
    actors: Array.from(group.actors, (actor) => actor.name),
  }));
}

assert.deepEqual(plainGroups(enriched[0]), [
  { label: "CV", actors: ["高杉真宙"] },
  { label: "中配", actors: ["藤新"] },
]);
assert.deepEqual(plainGroups(enriched[1]), [
  { label: "CV", actors: ["Lynn"] },
  { label: "中配", actors: ["阎么么"] },
]);

const maleHtml = displaySandbox.renderCharacterCard(enriched[0]);
assert.ok(maleHtml.includes(">CV <a href=\"https://bgm.tv/person/31360\""));
assert.ok(maleHtml.includes(">中配 <a href=\"https://bgm.tv/person/18116\""));
assert.ok(maleHtml.indexOf("高杉真宙") < maleHtml.indexOf("藤新"));

// Without already-fetched web metadata, preserve all API actors and label the
// group neutrally. Do not guess that actors[0] is the primary CV.
assert.deepEqual(plainGroups(apiCharacters[0]), [
  { label: "出演", actors: ["藤新", "高杉真宙"] },
]);

// A partially matched actor must also remain neutral instead of being mislabeled CV.
{
  const partial = displaySandbox.applyCharacterActorRelations(
    [{ id: 57009, name: "僕", actors: [{ id: 31360, name: "高杉真宙" }, { id: 999, name: "未知出演" }] }],
    { 57009: relations[57009].slice(0, 1) },
  );
  assert.deepEqual(plainGroups(partial[0]), [
    { label: "CV", actors: ["高杉真宙"] },
    { label: "出演", actors: ["未知出演"] },
  ]);
}

assert.ok(displaySandbox.renderCharacterCard({ id: 1, name: "未录入角色", actors: [] }).includes("CV 未录入"));

for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const loadBlock = extractFunction(source, "loadSubjectCharacters", { async: true });
  const supplementBlock = extractFunction(source, "parseSubjectInfoSupplement");
  const parserBlock = extractFunction(source, "parseCharacterActorRelations");
  assert.ok(!loadBlock.includes("bgmWebRequest"), `${label} character loading must not add a web request`);
  assert.ok(supplementBlock.includes("parseCharacterActorRelations(doc)"), `${label} must reuse subject-page HTML`);
  assert.ok(parserBlock.includes('getAttribute("att-rlt-type-name")'), `${label} must read Bangumi relation labels`);
  assert.ok(parserBlock.includes('getAttribute("attr-rlt-primary")'), `${label} must retain primary-CV metadata`);

  const cssStart = source.indexOf(`#${"${CHARACTER_STRIP_ID}"} .biligumi-character-cv {`);
  assert.notEqual(cssStart, -1, `${label} must keep the character CV style block`);
  const cssEnd = source.indexOf("\n    }", cssStart);
  const cssBlock = source.slice(cssStart, cssEnd);
  assert.ok(cssBlock.includes("white-space: normal"), `${label} must allow relation rows to wrap`);
  assert.ok(!cssBlock.includes("text-overflow: ellipsis"), `${label} must not clip later relation rows`);
}

console.log("character CV relation tests passed");
