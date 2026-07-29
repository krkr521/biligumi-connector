"use strict";

// Official Bilibili Bangumi season switches are SPA navigations. Live URL/DOM
// identity must win over stale __INITIAL_STATE__, and an unbound new season
// must not inherit the previous season through the generic title fallback.

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

for (const name of [
  "getStableBiliSubjectKey",
  "getOfficialBangumiBaseBindingKeys",
  "getDirectBindingKeysForCurrentPage",
  "getPageKey",
  "getSeriesTitle",
  "canReuseOfficialDirectBinding",
  "getCurrentBinding",
]) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

let domMediaId = "1587";
let domMediaTitle = "Fate/stay night [Unlimited Blade Works] 第二季";
let canonicalMediaLinkVisible = true;
let extraMediaNodes = [];

const mediaNode = {
  get textContent() {
    return domMediaTitle;
  },
  getAttribute(name) {
    return name === "href" && domMediaId ? `/bangumi/media/md${domMediaId}` : null;
  },
};

const identitySandbox = {
  window: {
    __INITIAL_STATE__: {
      season_id: 1586,
      media_id: 1586,
      season_title: "Fate/stay night [Unlimited Blade Works] 第一季",
    },
  },
  location: {
    pathname: "/bangumi/play/ep29143",
    href: "https://www.bilibili.com/bangumi/play/ep29143",
  },
  document: {
    querySelector(selector) {
      if (selector.includes("mediainfo_mediaTitle")) return canonicalMediaLinkVisible ? mediaNode : null;
      if (selector === "a[href*='/bangumi/media/md']") return mediaNode;
      if (selector.includes(".media-title")) return null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "a[href*='/bangumi/media/md']" ? [mediaNode, ...extraMediaNodes] : [];
    },
  },
  state: { pageKey: "bili:ss1586" },
  isOfficialBangumiPage: () => true,
  getPathToken(prefix) {
    const match = identitySandbox.location.pathname.match(new RegExp(`/${prefix}(\\d+)`, "i"));
    return match ? `${prefix}${match[1]}` : "";
  },
  stripBiliPrefix: (value, prefix) => String(value || "").replace(new RegExp(`^${prefix}`, "i"), ""),
  getCurrentLongVideoPartBindingKey: () => "",
  getCurrentCollectionLayoutContext: () => null,
  getOfficialBangumiSectionBindingKeys: () => [],
  getOfficialBangumiSectionBindingKey: () => "",
  getCurrentRouteKey: () => identitySandbox.location.pathname,
  getBvIdFromUrl: () => "",
};

for (const name of [
  "getOfficialBangumiMediaIdFromDom",
  "getOfficialBangumiMediaTitleFromDom",
  "getStableBiliSubjectKey",
  "getOfficialBangumiBaseBindingKeys",
  "getDirectBindingKeysForCurrentPage",
  "getPageKey",
  "getSeriesTitle",
]) {
  runInSandbox(extractFunction(userscriptSource, name), identitySandbox);
}

assert.equal(
  identitySandbox.getStableBiliSubjectKey(),
  "bili:md1587",
  "an ep route must use the live second-season media id instead of stale initial ss1586",
);
assert.deepEqual(
  [...identitySandbox.getOfficialBangumiBaseBindingKeys()],
  ["bili:md1587"],
  "stale first-season ss/md keys must not participate in the second-season read",
);
assert.equal(
  identitySandbox.getSeriesTitle(),
  domMediaTitle,
  "the live second-season DOM title must win over stale first-season initial state",
);
assert.deepEqual(
  [...identitySandbox.getDirectBindingKeysForCurrentPage()],
  ["bili:md1587"],
  "state.pageKey from the previous season must not be a direct binding candidate",
);
assert.equal(identitySandbox.getPageKey(), "bili:md1587");

domMediaId = "1586";
domMediaTitle = "Fate/stay night [Unlimited Blade Works] 第一季";
identitySandbox.location.pathname = "/bangumi/play/ep67704";
identitySandbox.location.href = "https://www.bilibili.com/bangumi/play/ep67704";
assert.equal(
  identitySandbox.getPageKey(),
  "bili:md1586",
  "switching the live media DOM back to season one changes the page key even if initial state never changes",
);

domMediaId = "1587";
domMediaTitle = "Fate/stay night [Unlimited Blade Works] 第二季";

identitySandbox.location.pathname = "/bangumi/play/ss1587";
identitySandbox.location.href = "https://www.bilibili.com/bangumi/play/ss1587";
assert.equal(identitySandbox.getStableBiliSubjectKey(), "bili:ss1587");
assert.deepEqual(
  [...identitySandbox.getOfficialBangumiBaseBindingKeys()],
  ["bili:md1587", "bili:ss1587"],
  "an ss route writes both the canonical live md and explicit ss identities",
);
assert.deepEqual(
  [...identitySandbox.getDirectBindingKeysForCurrentPage()],
  ["bili:md1587", "bili:ss1587"],
);

identitySandbox.location.pathname = "/bangumi/play/ep29143";
identitySandbox.location.href = "https://www.bilibili.com/bangumi/play/ep29143";
canonicalMediaLinkVisible = false;
extraMediaNodes = [{
  getAttribute(name) {
    return name === "href" ? "/bangumi/media/md99999999" : null;
  },
}];
assert.equal(
  identitySandbox.getStableBiliSubjectKey(),
  "",
  "ambiguous live md links on an EP route must not fall back to stale initial-state season identity",
);
assert.deepEqual(
  [...identitySandbox.getOfficialBangumiBaseBindingKeys()],
  [],
  "ambiguous EP media identity must fail closed instead of producing a poisoned base key",
);
canonicalMediaLinkVisible = true;
extraMediaNodes = [];

function createBindingSandbox({ official, directSubjectId = null, directEvidenceNames = [] }) {
  const STORAGE = {
    bindings: "bindings",
    bindingSubjects: "bindingSubjects",
    collectionMappings: "collectionMappings",
  };
  const bindings = {
    "bili:md1586": 95225,
    "title:|fatestaynightunlimitedbladeworks第二季": 95225,
  };
  if (directSubjectId) bindings["bili:md1587"] = directSubjectId;
  const bindingSubjects = directSubjectId && directEvidenceNames.length
    ? { [String(directSubjectId)]: { names: directEvidenceNames } }
    : {};
  const sandbox = {
    STORAGE,
    state: {
      message: "",
      bindingGuardMessage: "",
      bindings,
      bindingSubjects,
      collectionMappings: {},
    },
    readJsonValue(key, fallback) {
      if (key === STORAGE.bindings) return bindings;
      if (key === STORAGE.bindingSubjects) return bindingSubjects;
      if (key === STORAGE.collectionMappings) return {};
      return fallback;
    },
    normalizeCollectionMappings: (value) => value,
    getCurrentCollectionPartContext: () => null,
    getCurrentCollectionLayoutContext: () => null,
    getCollectionMappingRule: () => null,
    getCollectionMappingRules: () => [],
    getDirectBindingKeysForCurrentPage: () => ["bili:md1587"],
    getCurrentLongVideoPartBindingKey: () => "",
    isOfficialBangumiPage: () => official,
    getOfficialBangumiBaseBindingKeys: () => (official ? ["bili:md1587"] : []),
    getTitleBindingKey: () => "title:|fatestaynightunlimitedbladeworks第二季",
    canReuseTitleBinding: () => true,
    getCrossOwnerTitleBinding: () => null,
    getNonMainTitleBinding: () => null,
    getTitleBindingInfo: () => ({
      sourceTitle: "Fate/stay night [Unlimited Blade Works] 第二季",
      token: "fatestaynightunlimitedbladeworks第二季",
      lowConfidence: false,
    }),
    doesCurrentTitleMatchSubjectEvidence: (evidence) => (
      Array.isArray(evidence && evidence.names)
      && evidence.names.some((name) => String(name).includes("第二季"))
    ),
    getTitleBindingSubjectIdsByToken: () => [],
    migrateCalls: [],
    migrateCurrentBindingKeys(subjectId) {
      sandbox.migrateCalls.push(subjectId);
    },
  };
  runInSandbox(extractFunction(userscriptSource, "parseChineseTitleNumber"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "getTitleSeasonNumber"), sandbox);
  runInSandbox(extractFunction(userscriptSource, "canReuseOfficialDirectBinding"), sandbox);
  runInSandbox(
    `${extractFunction(userscriptSource, "getCurrentBinding")};globalThis.readBinding = getCurrentBinding;`,
    sandbox,
  );
  return sandbox;
}

{
  const sandbox = createBindingSandbox({ official: true });
  assert.equal(
    sandbox.readBinding(),
    null,
    "an unbound official second season must prompt for binding instead of inheriting the first season title binding",
  );
  assert.deepEqual(sandbox.migrateCalls, [], "a rejected title fallback must not poison the second-season md key");
}

{
  const sandbox = createBindingSandbox({
    official: true,
    directSubjectId: 109386,
    directEvidenceNames: ["Fate/stay night [Unlimited Blade Works] 第二季"],
  });
  assert.equal(sandbox.readBinding(), 109386, "an explicit current-season direct binding still resolves");
  assert.deepEqual(sandbox.migrateCalls, [109386]);
}

{
  const sandbox = createBindingSandbox({
    official: true,
    directSubjectId: 95225,
    directEvidenceNames: ["Fate/stay night [Unlimited Blade Works]"],
  });
  assert.equal(
    sandbox.readBinding(),
    null,
    "a previously poisoned second-season direct key is ignored when cached subject evidence proves it is season one",
  );
  assert.match(sandbox.state.bindingGuardMessage, /切换季度/);
  assert.deepEqual(sandbox.migrateCalls, []);
}

{
  // Reverse direction: S1 page must not reuse a poisoned key whose evidence is S2.
  const sandbox = createBindingSandbox({
    official: true,
    directSubjectId: 109386,
    directEvidenceNames: ["Fate/stay night [Unlimited Blade Works] 第二季"],
  });
  sandbox.getTitleBindingInfo = () => ({
    sourceTitle: "Fate/stay night [Unlimited Blade Works] 第一季",
    token: "fatestaynightunlimitedbladeworks第一季",
    lowConfidence: false,
  });
  sandbox.doesCurrentTitleMatchSubjectEvidence = () => false;
  assert.equal(
    sandbox.readBinding(),
    null,
    "a first-season official page must ignore direct evidence that only matches season two",
  );
  assert.match(sandbox.state.bindingGuardMessage, /切换季度/);
  assert.deepEqual(sandbox.migrateCalls, []);
}

{
  const sandbox = createBindingSandbox({ official: false });
  assert.equal(sandbox.readBinding(), 95225, "ordinary video pages keep the established title fallback");
}

console.log("official Bangumi season-binding tests passed");
