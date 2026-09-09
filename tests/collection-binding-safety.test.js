"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, extractConstants, runInSandbox } = require("./_source");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function install(source, names, sandbox) {
  runInSandbox(names.map((name) => extractFunction(source, name, {
    async: source.includes(`  async function ${name}(`),
  })).join("\n"), sandbox);
  return sandbox;
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);

  test(`${label}: normalized and EP-prefixed decimal labels still need real split-list evidence`, () => {
    const api = install(source, [
      "normalizeTitleText", "isNonMainEpisodeTitle", "stripTrailingDurationText", "parseChineseNumber",
      "parseCollectionFragment", "parseCollectionPartTitle", "getQualifiedCollectionPartRows",
    ], extractConstants(source, ["NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN", "MAX_COLLECTION_SEGMENTS", "MIN_COLLECTION_PARSED_PARTS"]));
    const rows = (titles) => titles.map((title, index) => ({ title, partNo: index + 1, parsed: api.parseCollectionPartTitle(title) }));
    for (const titles of [
      ["１．１", "２．１", "３．１", "４．１"],
      ["EP1.5", "EP2.5", "EP3.5", "EP4.5"],
      ["1.5:说明", "2.5:说明", "3.5:说明", "4.5:说明"],
    ]) assert.equal(api.getQualifiedCollectionPartRows(rows(titles)).length, 0, titles.join(", "));
    assert.equal(api.getQualifiedCollectionPartRows(rows(["ＥＰ１．１", "ＥＰ１．２", "ＥＰ２．１", "ＥＰ２．２"])).length, 4);
  });

  test(`${label}: newly uploaded previews never inherit the reserved main-episode range`, () => {
    const rule = { seasonKey: "season:4", sourceStart: 12, sourceEnd: 19, targetStart: 1, subjectId: 633836, autoProgress: true };
    let nodes;
    const api = install(source, [
      "normalizeTitleText", "isNonMainEpisodeTitle", "stripTrailingDurationText",
      "parseCollectionPartTitle", "parseBareCollectionEpisodeTitle", "parseChineseNumber", "parseCollectionFragment",
      "getCollectionPartRows", "getQualifiedCollectionPartRows", "getCurrentCollectionLayoutContext",
      "getCurrentCollectionPartContext", "getCollectionMappingResolution", "getCollectionMappingRule",
      "getCollectionMappedEpisodeNo", "isCurrentCollectionPartAutoMarkEligible",
    ], {
      ...extractConstants(source, ["NON_MAIN_EPISODE_PATTERN", "NON_MAIN_KEYWORD_PATTERN"]),
      MAX_COLLECTION_SEGMENTS: 8, MIN_COLLECTION_PARSED_PARTS: 4, COLLECTION_PART_ROWS_CACHE_MS: 0,
      getBvIdFromUrl: () => "BVABC", getVideoPartListNodes: () => nodes,
      getVideoPartNodeTitle: (node) => node.title,
      isActiveVideoPartNode: (node) => node === nodes.at(-1),
      getCurrentVideoPartContext: () => ({ bvid: "BVABC", partCount: nodes.length, partNo: nodes.length, title: nodes.at(-1).title }),
      parseLongVideoPartTitle: () => null,
      getPageTitle: () => "Re：从零开始的异世界生活 全四季",
      getCollectionMappingRules: () => [rule],
      isCurrentOrdinaryEpisodeCollection: () => false,
    });
    for (const title of ["第四季16", "第四季16 决战", "第四季16 预告", "第四季16 总集篇", "第四季16 PV"]) {
      nodes = Array.from({ length: 16 }, (_, index) => ({ title: index === 15 ? title : `第四季${index + 1}` }));
      const special = /预告|总集篇|PV/.test(title);
      const layout = api.getCurrentCollectionLayoutContext();
      const context = api.getCurrentCollectionPartContext();
      assert.equal(layout.currentKind, special ? "unmapped" : "episode", title);
      assert.equal(api.getCollectionMappingResolution(context).rule?.subjectId || null, special ? null : 633836, title);
      assert.equal(api.getCollectionMappedEpisodeNo(context), special ? null : 5, title);
      assert.equal(api.isCurrentCollectionPartAutoMarkEligible(), !special, title);
    }
  });

  function sourceBindingHarness({ pauseStorage = false, changeDuringLookup = false } = {}) {
    const bvid = "BVSAFETYSOURCE";
    let live = {
      bvid, seasonKey: "season:4", seasonNo: 4, partNo: 30, episodeNo: 14, title: "第四季14",
      collectionTitle: "Re：从零开始的异世界生活 全四季", groupStart: 1, groupEnd: 15,
      groupLogicalEpisodeCount: 15, segmentCount: 1, fragmentIndex: 1,
      sourceEpisodes: Array.from({ length: 15 }, (_, index) => ({
        episodeNo: index + 1, partNo: index + 17, fragmentIndex: 1, fragmentCount: 1, title: "第四季" + (index + 1),
      })),
    };
    const shown = deferred();
    const storageEntered = deferred();
    const storageGate = deferred();
    const storage = { mappings: {}, bindings: {} };
    const writes = [];
    let confirmations = 0;
    const api = {
      subjectSearchSeq: 0, subjectBindRequestSeq: 0, routeRefreshSeq: 1, MAX_COLLECTION_SEGMENTS: 8,
      state: { pageKey: "unchanged-url", token: "same-token", subjectId: 999, collectionMappings: {}, bindings: {} },
      LONG_VIDEO_BIND_WAIT_TIMEOUT_MS: 8000, PANEL_ID: "panel", SETTINGS_ID: "settings",
      STORAGE: { collectionMappings: "mappings", bindings: "bindings" },
      captureRouteContext: () => ({ pageKey: "unchanged-url", routeSeq: 1 }),
      isCurrentPageContext: () => true, isRouteContextCurrent: () => true, ensureRouteContext() {},
      getActiveVideoElement: () => null,
      getLongVideoBindReadinessForSubject: async () => ({ action: "bind" }),
      getBindingKeysForCurrentPage: () => [],
      getCollectionPartRows() {},
      getCurrentCollectionPartContext: () => {
        // Model the normal short-lived cache, including reused nodes whose text changes.
        if (!api.getCollectionPartRows.cache) api.getCollectionPartRows.cache = structuredClone(live);
        return api.getCollectionPartRows.cache;
      },
      getCollectionMappingResolution: () => ({ rule: null, ambiguous: false }),
      getCollectionMappingRules: () => [],
      getSubjectDeclaredTotalEpisodeCountForMapping: async () => {
        if (changeDuringLookup) live = { ...live, episodeNo: 5, title: "第四季5" };
        return 8;
      },
      getSubjectMainEpisodeInfoForMapping: async () => ({ episodeCount: 8, hasEpisodeZero: false }),
      isCollectionRangeMappingEligible: () => true,
      inferCollectionRangeBindingStart: async () => null,
      getStoredSubjectDeclaredTotalEpisodeCount: () => 8,
      isOrdinaryEpisodeCollectionForTotal: () => false,
      getCollectionPartBindingKey: () => "",
      formatCollectionRangeBindingPrompt: () => "选择第一集",
      document: { getElementById: () => null },
      focusInlineConfirmButton() {},
      render: () => {
        if (api.state.inlineConfirm) {
          confirmations += 1;
          shown.resolve();
        }
      },
      withBindingsLock: async (callback) => {
        storageEntered.resolve();
        if (pauseStorage) await storageGate.promise;
        return callback();
      },
      readJsonValue: (key, fallback) => structuredClone(storage[key] || fallback),
      readJsonValueFresh: async (key, fallback) => structuredClone(storage[key] || fallback),
      writeJsonValue: (key, value) => { storage[key] = structuredClone(value); writes.push(key); },
      writeJsonValueAsync: async (key, value) => { storage[key] = structuredClone(value); writes.push(key); },
      updateStoredBindings: async () => {},
      updateBindings: async () => {},
      resolveLongVideoBindingSubject: (id) => ({ id }),
      refreshCurrentEpisodeRecognitionState() {},
      loadSubjectBundle: async () => {},
    };
    install(source, [
      "getCollectionBindingSourceSignature", "ensureCollectionBindingSourceCurrent",
      "getCollectionBindingStartOptions", "reviseCollectionRangeBindingProposal", "buildCollectionRangeBindingProposal",
      "normalizeCollectionMappingRule", "normalizeCollectionMappings", "putCollectionMappingRule",
      "validateCollectionRangeBindingWrite", "updateStoredCollectionMappings",
      "requestInlineConfirm", "settleInlineConfirm", "handleCollectionBindingStartChange",
      "requestBindSubject", "bindSubject",
    ], api);
    return {
      api, shown, storageEntered, storageGate, storage, writes,
      confirmations: () => confirmations,
      change: (update) => { live = update(structuredClone(live)); },
      chooseAndAccept: () => {
        api.handleCollectionBindingStartChange({ isTrusted: true, target: { value: "12" }, stopPropagation() {} });
        api.settleInlineConfirm(true);
      },
    };
  }

  test(`${label}: source changes during metadata lookup reject the old proposal before showing confirmation`, async () => {
    const harness = sourceBindingHarness({ changeDuringLookup: true });
    await assert.rejects(harness.api.requestBindSubject(633836), /分P列表|当前集已变化/);
    assert.equal(harness.confirmations(), 0);
    assert.deepEqual(harness.writes, []);
    assert.equal(harness.api.state.subjectId, 999);
  });

  test(`${label}: the real manual-first-P bind chain refuses changed source semantics on the same route`, async () => {
    const changes = [
      (live) => ({ ...live, episodeNo: 5, title: "第四季5" }),
      (live) => ({ ...live, seasonKey: "season:5" }),
      (live) => ({ ...live, sourceEpisodes: live.sourceEpisodes.map((row, index) => index === 11 ? { ...row, partNo: 40 } : row) }),
      (live) => ({ ...live, sourceEpisodes: live.sourceEpisodes.map((row, index) => index === 11 ? { ...row, title: "第四季12 总集篇" } : row) }),
      (live) => ({ ...live, sourceEpisodes: live.sourceEpisodes.map((row, index) => index === 11 ? { ...row, fragmentCount: 2 } : row) }),
      (live) => ({ ...live, groupEnd: 16, sourceEpisodes: [...live.sourceEpisodes, { episodeNo: 16, partNo: 32, fragmentIndex: 1, title: "第四季16" }] }),
    ];
    for (const change of changes) {
      const harness = sourceBindingHarness();
      const binding = harness.api.requestBindSubject(633836);
      await harness.shown.promise;
      harness.change(change);
      harness.chooseAndAccept();
      await assert.rejects(binding, /分P列表|当前集已变化/);
      assert.deepEqual(harness.writes, []);
      assert.deepEqual(harness.storage.mappings, {});
      assert.equal(harness.api.state.subjectId, 999, "a stale source must not select a different subject in the current panel");
    }
  });

  test(`${label}: source changes while waiting for the storage lock cannot pass the final write check`, async () => {
    const harness = sourceBindingHarness({ pauseStorage: true });
    const binding = harness.api.requestBindSubject(633836);
    await harness.shown.promise;
    harness.chooseAndAccept();
    await harness.storageEntered.promise;
    harness.change((live) => ({ ...live, episodeNo: 5, title: "第四季5" }));
    harness.storageGate.resolve();
    await assert.rejects(binding, /分P列表|当前集已变化/);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.storage.mappings, {});
    assert.equal(harness.api.state.subjectId, 999);
  });

  test(`${label}: equivalent DOM rerenders preserve a user's first-P choice and source changes still allow cancel`, async () => {
    const stable = sourceBindingHarness();
    const binding = stable.api.requestBindSubject(633836);
    await stable.shown.promise;
    stable.change((live) => ({
      ...live, unrelatedDomRevision: 2, title: "  " + live.title + "  ",
      sourceEpisodes: live.sourceEpisodes.map((row) => ({ ...row, title: "  " + row.title + "  " })),
    }));
    stable.chooseAndAccept();
    await binding;
    assert.deepEqual(stable.writes, ["mappings"]);
    assert.equal(stable.storage.mappings.BVSAFETYSOURCE[0].sourceStart, 12);
    assert.equal(stable.storage.mappings.BVSAFETYSOURCE[0].sourceEnd, 19);

    const canceled = sourceBindingHarness();
    const pending = canceled.api.requestBindSubject(633836);
    await canceled.shown.promise;
    canceled.change((live) => ({ ...live, episodeNo: 5, title: "第四季5" }));
    canceled.api.settleInlineConfirm(false);
    await assert.doesNotReject(pending);
    assert.deepEqual(canceled.writes, []);
    assert.equal(canceled.api.state.subjectId, 999);
  });


  function bindingHarness({ pauseReadiness = false } = {}) {
    const pending = new Map([[101, deferred()], [202, deferred()]]);
    const entered = new Map([[101, deferred()], [202, deferred()]]);
    const confirmations = [];
    const collectionContext = { bvid: "BVSAFETY", seasonKey: "season:4", partNo: 14, episodeNo: 14, groupStart: 1, groupEnd: 15 };
    const api = {
      subjectSearchSeq: 0, subjectBindRequestSeq: 0, routeRefreshSeq: 1,
      state: { pageKey: "same-page", token: "same-token", busy: false, error: "" },
      LONG_VIDEO_BIND_WAIT_TIMEOUT_MS: 8000,
      captureRouteContext: () => ({ pageKey: "same-page", routeSeq: 1 }),
      isCurrentPageContext: () => true, isRouteContextCurrent: () => true, ensureRouteContext() {},
      getActiveVideoElement: () => null,
      getLongVideoBindReadinessForSubject: async (id) => {
        if (!pauseReadiness) return { action: "bind" };
        entered.get(id).resolve();
        return pending.get(id).promise;
      },
      getBindingKeysForCurrentPage: () => [],
      buildCollectionRangeBindingProposal: async (id) => {
        entered.get(id).resolve();
        if (!pauseReadiness) await pending.get(id).promise;
        return { subjectId: id, context: collectionContext };
      },
      getCurrentCollectionPartContext: () => collectionContext,
      getStoredSubjectDeclaredTotalEpisodeCount: () => null,
      formatCollectionRangeBindingPrompt: (_proposal, id) => String(id),
      requestInlineConfirm: async (options) => { confirmations.push(Number(options.message)); return false; },
      render() {},
      showLongVideoBindingPrompt: (id) => confirmations.push(id),
      beginLongVideoBindingWait: (id) => confirmations.push(id),
      setLongVideoEpisodeModeDecision: async () => { throw new Error("unexpected automatic decision"); },
    };
    install(source, ["getCollectionBindingSourceSignature", "ensureCollectionBindingSourceCurrent", "requestBindSubject", "bindSubject"], api);
    return { api, pending, entered, confirmations };
  }

  test(`${label}: a slow earlier candidate cannot replace the latest candidate's first-P prompt`, async () => {
    const { api, pending, entered, confirmations } = bindingHarness();
    const first = api.requestBindSubject(101);
    await entered.get(101).promise;
    const second = api.requestBindSubject(202);
    await entered.get(202).promise;
    pending.get(202).resolve();
    await second;
    assert.deepEqual(confirmations, [202]);
    pending.get(101).resolve();
    await first;
    assert.deepEqual(confirmations, [202], "the stale relation lookup must not open a new confirmation");
  });

  test(`${label}: only the latest click survives an out-of-order readiness result`, async () => {
    const { api, pending, entered, confirmations } = bindingHarness({ pauseReadiness: true });
    const first = api.requestBindSubject(101);
    await entered.get(101).promise;
    const second = api.requestBindSubject(202);
    await entered.get(202).promise;
    pending.get(202).resolve({ action: "bind" });
    await second;
    pending.get(101).resolve({ action: "prompt" });
    await first;
    assert.deepEqual(confirmations, [202], "a stale readiness result must not replace the selected candidate");
  });

  test(`${label}: a failed earlier lookup cannot surface an error after another candidate is selected`, async () => {
    const { api, pending, entered, confirmations } = bindingHarness();
    const first = api.requestBindSubject(101);
    await entered.get(101).promise;
    const second = api.requestBindSubject(202);
    await entered.get(202).promise;
    pending.get(101).reject(new Error("stale lookup failed"));
    await assert.doesNotReject(first);
    pending.get(202).resolve();
    await second;
    assert.deepEqual(confirmations, [202]);
  });
}
