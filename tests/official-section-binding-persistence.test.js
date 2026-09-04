"use strict";

const assert = require("node:assert/strict");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");

const PARENT_SUBJECT = 246430;
// Fixture id only: these tests do not call Bangumi or modify browser storage.
const MINI_SUBJECT = 999001;
const BASE_KEY = "bili:md28224078";
const MINI_KEY = `${BASE_KEY}|section:元祖迷你`;
const seriesTitle = "BanG Dream! 梦想协奏曲 第三季";
const clone = (value) => JSON.parse(JSON.stringify(value));

function createSandbox(source, extension) {
  const storage = {
    bindings: { [BASE_KEY]: PARENT_SUBJECT },
    subjects: {
      [PARENT_SUBJECT]: { names: [seriesTitle] },
      [MINI_SUBJECT]: { names: ["元祖！BanG Dream！", "元祖！バンドリちゃん"] },
    },
    mappings: {},
  };
  const scope = {
    console, storage, section: "元祖迷你", routeRefreshSeq: 1, bindingsUpdateQueue: Promise.resolve(),
    BINDINGS_LOCK_NAME: "test-bindings", navigator: {},
    location: { pathname: "/bangumi/play/ss29308", href: "https://www.bilibili.com/bangumi/play/ss29308" },
    state: { subjectId: PARENT_SUBJECT, pageKey: MINI_KEY, message: "", bindingGuardMessage: "", bindings: {}, bindingSubjects: {}, searchResults: [] },
    STORAGE: { bindings: "bindings", bindingSubjects: "subjects", collectionMappings: "mappings" },
    readJsonValue: (key, fallback) => clone(storage[key] || fallback),
    readJsonValueFresh: async (key, fallback) => clone(storage[key] || fallback),
    writeJsonValue: (key, value) => { storage[key] = clone(value); },
    writeJsonValueAsync: async (key, value) => { storage[key] = clone(value); },
    isOfficialBangumiPage: () => true,
    getCurrentLongVideoPartBindingKey: () => "",
    getCurrentCollectionPartContext: () => null,
    getCurrentCollectionLayoutContext: () => null,
    normalizeCollectionMappings: (value) => value,
    buildCollectionRangeBindingProposal: async () => null,
    buildLongVideoRangeGroupBindingProposal: async () => null,
    getStoredSubjectDeclaredTotalEpisodeCount: () => null,
    refreshCurrentEpisodeRecognitionState: () => {},
    loadSubjectBundle: async () => {}, render: () => {},
    getOfficialBangumiBaseBindingKeys: () => [BASE_KEY],
    getSeriesTitle: () => seriesTitle,
    getPageOwnerInfo: () => ({}),
    shouldUseRawTitleForPreview: () => false,
    cleanTitle: (value) => String(value || "").trim(),
    normalizeTitleText: (value) => String(value || "").replace(/-番剧.*$/, ""),
    normalizeBindingToken: (value) => String(value || "").toLowerCase().replace(/\s+/g, ""),
    getCurrentRouteKey: () => scope.location.pathname,
    getBvIdFromUrl: () => "",
    getStableBiliSubjectKey: () => BASE_KEY,
  };
  Object.assign(scope, {
    getOfficialBangumiDistinctSectionTitle: () => scope.section,
    getPageTitle: () => `${seriesTitle}${scope.section}${scope.episode || 47}-番剧`,
    resolveCurrentPageTitle: () => `${seriesTitle} ${scope.section}`.trim(),
  });
  const names = [
    "getCurrentBinding", "canReuseOfficialDirectBinding", "bindSubject", "resolveLongVideoBindingSubject", "getBindingKeysForCurrentPage", "getDirectBindingKeysForCurrentPage",
    "getOfficialBangumiSectionBindingKeys", "getOfficialBangumiSectionBindingKey", "getOfficialBangumiContextTitle",
    "getTitleBindingInfo", "getTitleBindingKey", "getTitleBindingTitleToken", "doesCurrentTitleMatchSubjectEvidence",
    "isTitleEvidenceMatch", "hasTitleSeasonConflict", "getTitleSeasonNumber", "parseChineseTitleNumber", "normalizeTitleMatchToken",
    "getTitleBigramDice", "extractAnimeWorkTitle", "extractQuotedWorkTitle", "migrateCurrentBindingKeys", "withBindingsLock",
    ...(extension ? ["captureRouteContext", "isRouteContextCurrent", "ensureRouteContext", "updateBindings", "mergeBindingKeys"]
      : ["capturePageContext", "isCurrentPageContext", "updateStoredBindings"]),
  ];
  runInSandbox(names.map((name) => extractFunction(source, name, { async: source.includes(`  async function ${name}(`) })).join("\n"), scope);
  return scope;
}

(async () => {
  const userscript = readSource(USERSCRIPT_PATH);
  const extension = readSource(EXTENSION_PATH);
  for (const name of ["getCurrentBinding", "canReuseOfficialDirectBinding"]) {
    assert.equal(extractFunction(extension, name), extractFunction(userscript, name), `${name}: keep both implementations aligned`);
  }
  for (const [label, source] of [["userscript", userscript], ["extension", extension]]) {
    const scope = createSandbox(source, label === "extension");
    // A distinct, unbound section never borrows the parent's existing S3 binding.
    assert.equal(scope.getCurrentBinding(), null);
    assert.equal(scope.getTitleBindingInfo().seasonNo, 3, "fixture preserves the parent-season evidence which caused the regression");
    await scope.bindSubject(MINI_SUBJECT);
    assert.equal(scope.storage.bindings[MINI_KEY], MINI_SUBJECT, "manual bind persists the exact section key");
    assert.equal(scope.storage.bindings[BASE_KEY], PARENT_SUBJECT, "binding the mini section preserves the parent anime binding");

    for (const episode of [44, 47, 44]) {
      scope.episode = episode;
      scope.routeRefreshSeq += 1;
      scope.location.pathname = episode === 44 ? "/bangumi/play/ep5161246" : "/bangumi/play/ss29308";
      scope.location.href = `https://www.bilibili.com${scope.location.pathname}`;
      scope.state.subjectId = null;
      scope.state.bindings = {};
      scope.state.bindingSubjects = {};
      scope.state.pageKey = scope.getOfficialBangumiSectionBindingKey();
      assert.equal(scope.state.pageKey, MINI_KEY);
      assert.equal(scope.getCurrentBinding(), MINI_SUBJECT, `${label}: episode ${episode} retrieves the saved mini binding with loaded name evidence`);
      assert.equal(scope.state.bindingGuardMessage, "");
    }

    scope.section = "其他短篇";
    scope.state.pageKey = scope.getOfficialBangumiSectionBindingKey();
    assert.equal(scope.getCurrentBinding(), null, "a different section cannot inherit the mini binding");
    assert.equal(scope.canReuseOfficialDirectBinding(MINI_SUBJECT, MINI_KEY), false, "a stale section key cannot claim the exemption");
    assert.equal(scope.canReuseOfficialDirectBinding(MINI_SUBJECT, `${BASE_KEY}|section:不存在的分区`), false);

    scope.section = "";
    scope.state.pageKey = BASE_KEY;
    assert.equal(scope.getCurrentBinding(), PARENT_SUBJECT, "returning to the main anime retrieves its own S3 binding");
    scope.storage.bindings[BASE_KEY] = MINI_SUBJECT;
    assert.equal(scope.getCurrentBinding(), null, "a non-S3 subject under the plain parent key is still rejected");
    assert.match(scope.state.bindingGuardMessage, /切换季度/);
    assert.equal(scope.canReuseOfficialDirectBinding(MINI_SUBJECT, BASE_KEY), false);
  }
  console.log("official section binding persistence tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
