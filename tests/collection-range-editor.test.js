"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction, runInSandbox } = require("./_source");

const bvid = "BV1Axb56QEUH".toUpperCase();
const subjectId = 633836;
const clone = (value) => JSON.parse(JSON.stringify(value));

function context() {
  return {
    bvid, seasonKey: "season:4", seasonNo: 4, episodeNo: 14, partNo: 30, title: "第四季14",
    groupStart: 1, groupEnd: 15, groupLogicalEpisodeCount: 15,
    parsedPartCount: 31, segmentCount: 1, fragmentIndex: 1,
    sourceEpisodes: Array.from({ length: 15 }, (_, index) => ({
      episodeNo: index + 1, partNo: index + 17, title: `第四季${index + 1}`, fragmentIndex: 1,
    })),
  };
}

function proposal(overrides = {}) {
  return {
    context: context(), episodeCount: 8, hasEpisodeZero: false,
    replacesRule: null, siblingRules: [], initialSourceStart: 14, initialTargetStart: 1,
    extendToExpectedEnd: true, startConfirmed: false, reason: "请选择首集",
    rule: {
      bvid, id: "season:4:14-21", seasonKey: "season:4", sourceStart: 14, sourceEnd: 21,
      targetStart: 1, subjectId, targetEpisodeZero: false, segmentCount: 1, autoProgress: true,
    },
    ...overrides,
  };
}

function load(source, names, extra = {}) {
  const sandbox = {
    MAX_COLLECTION_SEGMENTS: 8, Date, state: { collectionMappings: {} },
    getCurrentCollectionPartContext: context,
    ...extra,
  };
  runInSandbox(names.map((name) => extractFunction(source, name, { async: source.includes(`  async function ${name}(`) })).join("\n"), sandbox);
  return sandbox;
}

for (const [label, file] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  const source = readSource(file);
  const editingNames = ["getCollectionBindingStartOptions", "reviseCollectionRangeBindingProposal"];

  test(`${label}: mapping hints distinguish the full range from the current episode`, () => {
    const current = { ...context(), episodeNo: 14 };
    const rule = { ...proposal().rule, sourceStart: 12, sourceEnd: 19, targetStart: 1 };
    const api = load(source, [
      "renderCollectionMappingHint", "getCollectionMappedEpisodeNo", "formatCollectionSourceRange",
      "formatCollectionTargetRange", "formatCollectionTargetEpisodeLabel", "escapeHtml",
    ], {
      getCurrentCollectionPartContext: () => current,
      getCollectionMappingRule: () => rule,
      formatEpisodeSort: (value) => String(value).padStart(2, "0"),
    });
    const html = api.renderCollectionMappingHint();
    assert.match(html, /第4季 第12-19集 → Bangumi 第01-08集/);
    assert.match(html, /当前：来源第14集 → Bangumi 第 03 集/);
    assert.doesNotMatch(html, /第12-19集 → Bangumi 第 03 集/);
    rule.targetEpisodeZero = true;
    const zeroHtml = api.renderCollectionMappingHint();
    assert.match(zeroHtml, /第12-19集 → Bangumi EP00-EP07/);
    assert.match(zeroHtml, /当前：来源第14集 → Bangumi EP02/);
  });

  test(`${label}: choose the actual first P without moving from fourth-season episode 14`, () => {
    const api = load(source, editingNames);
    const original = proposal();
    const before = clone(original);
    const options = api.getCollectionBindingStartOptions(original.context);
    assert.deepEqual(clone(options.find((item) => item.sourceStart === 12)), {
      sourceStart: 12, partNo: 28, title: "第四季12",
    });
    const revised = api.reviseCollectionRangeBindingProposal(original, 12);
    assert.equal(revised.rule.sourceStart, 12);
    assert.equal(revised.rule.sourceEnd, 19, "save the complete eight-episode range, including not-yet-uploaded episodes");
    assert.equal(revised.rule.targetStart, 1);
    assert.equal(revised.rule.targetStart + revised.context.episodeNo - revised.rule.sourceStart, 3);
    assert.equal(revised.startConfirmed, true);
    assert.equal(revised.context.partNo, 30, "selecting the first P must leave the playing P unchanged");
    assert.deepEqual(clone(original), before, "revision must not mutate its input proposal");
  });

  test(`${label}: only the first fragment of each logical episode is offered`, () => {
    const api = load(source, editingNames);
    const split = context();
    split.sourceEpisodes = [
      { episodeNo: 12, partNo: 28, title: "第四季12上", fragmentIndex: 1 },
      { episodeNo: 12, partNo: 29, title: "第四季12下", fragmentIndex: 2 },
      { episodeNo: 13, partNo: 30, title: "第四季13", fragmentIndex: 1 },
    ];
    assert.deepEqual(clone(api.getCollectionBindingStartOptions(split)), [
      { sourceStart: 12, partNo: 28, title: "第四季12上" },
      { sourceStart: 13, partNo: 30, title: "第四季13" },
    ]);
  });

  test(`${label}: reject absent first episodes and ranges that exclude the current episode`, () => {
    const api = load(source, editingNames);
    for (const first of [0, -1, 1.5, 16, NaN, 1, 15]) {
      assert.throws(() => api.reviseCollectionRangeBindingProposal(proposal(), first), /首集|范围|当前|分P|集数/);
    }
  });

  test(`${label}: preserve an old continuation ordinal only at the original first episode`, () => {
    const api = load(source, editingNames);
    const original = proposal({ initialSourceStart: 12, initialTargetStart: 3 });
    const same = api.reviseCollectionRangeBindingProposal(original, 12);
    assert.equal(same.rule.targetStart, 3);
    assert.equal(same.rule.sourceEnd, 17);
    const changed = api.reviseCollectionRangeBindingProposal(original, 11);
    assert.equal(changed.rule.targetStart, 1);
    assert.equal(changed.rule.sourceEnd, 18);
  });

  test(`${label}: future range stops before a following rule and cannot overlap a previous one`, () => {
    const api = load(source, editingNames);
    const previous = { id: "season:4:1-11", seasonKey: "season:4", sourceStart: 1, sourceEnd: 11, targetStart: 1, subjectId: 547888 };
    const next = { id: "season:4:18-20", seasonKey: "season:4", sourceStart: 18, sourceEnd: 20, targetStart: 1, subjectId: 999999 };
    const original = proposal({ siblingRules: [previous, next] });
    assert.equal(api.reviseCollectionRangeBindingProposal(original, 12).rule.sourceEnd, 17);
    assert.throws(() => api.reviseCollectionRangeBindingProposal(original, 11), /冲突|重叠|范围|已有/);
  });

  test(`${label}: expected range survives storage normalization and later uploaded episodes inherit it`, () => {
    const api = load(source, [
      ...editingNames, "normalizeCollectionMappings", "normalizeCollectionMappingRule",
      "getCollectionMappingRules", "getCollectionMappingResolution", "getCollectionMappedEpisodeNo",
    ]);
    const revised = api.reviseCollectionRangeBindingProposal(proposal(), 12);
    api.state.collectionMappings = api.normalizeCollectionMappings({ [bvid]: [revised.rule] });
    assert.equal(api.state.collectionMappings[bvid][0].sourceEnd, 19);
    for (const episodeNo of [16, 19]) {
      const future = { ...context(), groupEnd: 19, episodeNo };
      const resolved = api.getCollectionMappingResolution(future);
      assert.equal(resolved.rule.subjectId, subjectId);
      assert.equal(api.getCollectionMappedEpisodeNo(future, resolved.rule), episodeNo - 11);
    }
    assert.equal(api.getCollectionMappingResolution({ ...context(), episodeNo: 20 }).rule, null);
    assert.equal(api.getCollectionMappingResolution({ ...context(), episodeNo: 16, seasonKey: "season:5" }).rule, null);
  });

  test(`${label}: saved 12-15 mapping expands only through an explicit unchanged replacement`, () => {
    const api = load(source, [...editingNames, "validateCollectionRangeBindingWrite"]);
    const old = {
      id: "season:4:12-15", seasonKey: "season:4", sourceStart: 12, sourceEnd: 15,
      targetStart: 1, subjectId, targetEpisodeZero: false, segmentCount: 1, autoProgress: true,
    };
    const revised = api.reviseCollectionRangeBindingProposal(proposal({
      initialSourceStart: 12, replacesRule: old, rule: { ...old, bvid },
    }), 12);
    assert.equal(revised.rule.sourceEnd, 19);
    assert.equal(api.validateCollectionRangeBindingWrite({ [bvid]: [old] }, revised, {}), true);
    assert.throws(() => api.validateCollectionRangeBindingWrite({}, revised, {}), /修改|删除|变化|重新/);
    for (const changed of [{ ...old, subjectId: 10 }, { ...old, sourceEnd: 16 }, { ...old, targetStart: 2 }]) {
      assert.throws(() => api.validateCollectionRangeBindingWrite({ [bvid]: [changed] }, revised, {}), /修改|删除|变化|重新/);
    }
  });

  test(`${label}: a new mapping cannot remove an overlapping rule created while confirmation was open`, () => {
    const api = load(source, [...editingNames, "validateCollectionRangeBindingWrite"]);
    const revised = api.reviseCollectionRangeBindingProposal(proposal(), 12);
    const concurrent = { id: "season:4:17-19", seasonKey: "season:4", sourceStart: 17, sourceEnd: 19, targetStart: 1, subjectId: 999999 };
    const mappings = { [bvid]: [concurrent] };
    const before = clone(mappings);
    assert.throws(() => api.validateCollectionRangeBindingWrite(mappings, revised, {}), /其他|冲突|已有/);
    assert.deepEqual(mappings, before, "preflight is read-only on failure");
    assert.equal(api.validateCollectionRangeBindingWrite({ [bvid]: [{ ...concurrent, seasonKey: "season:5" }] }, revised, {}), true);
  });

  test(`${label}: a range does not shadow a different explicit per-P binding`, () => {
    const api = load(source, [...editingNames, "validateCollectionRangeBindingWrite"]);
    const revised = api.reviseCollectionRangeBindingProposal(proposal(), 12);
    assert.throws(() => api.validateCollectionRangeBindingWrite({}, revised, { [`bili:${bvid}:p29`]: 999999 }), /P29|单独|分P/);
    assert.equal(api.validateCollectionRangeBindingWrite({}, revised, { [`bili:${bvid}:p29`]: subjectId }), true);
    assert.equal(api.validateCollectionRangeBindingWrite({}, revised, { [`bili:${bvid}:p27`]: 547888 }), true);
  });

  test(`${label}: rebind another subject resets a covering continuation ordinal and EP0 metadata`, async () => {
    const old = {
      id: "season:4:12-15", seasonKey: "season:4", sourceStart: 12, sourceEnd: 15,
      targetStart: 3, subjectId: 999999, targetEpisodeZero: true, segmentCount: 1, autoProgress: true,
    };
    const api = load(source, [...editingNames, "buildCollectionRangeBindingProposal"], {
      getCollectionMappingResolution: () => ({ ambiguous: false, rule: old }),
      getCollectionMappingRules: () => [old],
      getSubjectDeclaredTotalEpisodeCountForMapping: async () => 8,
      getSubjectMainEpisodeInfoForMapping: async () => ({ episodeCount: 8, hasEpisodeZero: false }),
      isCollectionRangeMappingEligible: () => true,
      inferCollectionRangeBindingStart: () => { throw new Error("an existing covering rule supplies its selected start"); },
    });
    const same = await api.buildCollectionRangeBindingProposal(999999);
    assert.equal(same.rule.targetStart, 3);
    assert.equal(same.rule.targetEpisodeZero, true);
    assert.equal(same.rule.sourceEnd, 17);
    const changed = await api.buildCollectionRangeBindingProposal(subjectId);
    assert.equal(changed.rule.sourceStart, 12);
    assert.equal(changed.rule.targetStart, 1, "the old subject's local ordinal cannot shift the new subject");
    assert.equal(changed.rule.targetEpisodeZero, false, "EP0 metadata belongs to the selected subject");
    assert.equal(changed.rule.sourceEnd, 19);
  });

  test(`${label}: collection storage checks fresh per-P bindings after waiting for the shared lock`, async () => {
    let releaseLock;
    const gate = new Promise((resolve) => { releaseLock = resolve; });
    const storage = { mappings: {}, bindings: {} };
    const writes = [];
    let locked = false;
    const read = (key, fallback) => {
      assert.equal(locked, true, "both mapping and per-P binding reads must happen inside the shared lock");
      return clone(storage[key] || fallback);
    };
    const api = load(source, [
      ...editingNames, "validateCollectionRangeBindingWrite", "normalizeCollectionMappings",
      "normalizeCollectionMappingRule", "updateStoredCollectionMappings",
    ], {
      STORAGE: { collectionMappings: "mappings", bindings: "bindings" },
      state: { collectionMappings: {}, bindings: {} },
      withBindingsLock: async (callback) => {
        await gate;
        locked = true;
        try { return await callback(); } finally { locked = false; }
      },
      readJsonValue: read, readJsonValueFresh: read,
      writeJsonValue: (key, value) => writes.push({ key, value }),
      writeJsonValueAsync: async (key, value) => writes.push({ key, value }),
    });
    const revised = api.reviseCollectionRangeBindingProposal(proposal(), 12);
    const update = api.updateStoredCollectionMappings((mappings, latestBindings) => {
      api.validateCollectionRangeBindingWrite(mappings, revised, latestBindings);
      mappings[bvid] = [revised.rule];
      return true;
    });
    storage.bindings[`bili:${bvid}:p29`] = 999999;
    releaseLock();
    await assert.rejects(update, /P29|单独|分P/);
    assert.deepEqual(writes, []);
    assert.deepEqual(storage.mappings, {});
    assert.deepEqual(api.state.bindings, {}, "the test intentionally retains stale in-memory per-P bindings");
  });

  function editorApi() {
    const focused = [];
    const select = { focus: () => focused.push("select") };
    const panel = { querySelector: () => select, querySelectorAll: () => [] };
    const api = load(source, [
      ...editingNames, "escapeHtml", "formatCollectionTargetEpisodeLabel", "formatCollectionSourceRange",
      "formatCollectionTargetRange", "renderCollectionBindingEditor", "renderInlineConfirm",
      "requestInlineConfirm", "settleInlineConfirm", "focusInlineConfirmButton", "handleCollectionBindingStartChange",
    ], {
      PANEL_ID: "fixture-panel", SETTINGS_ID: "fixture-settings", focused,
      formatEpisodeSort: String,
      document: { getElementById: (id) => id === "fixture-panel" ? panel : null },
      renders: 0, render: () => { api.renders += 1; },
    });
    return api;
  }

  test(`${label}: unconfirmed first-episode choice cannot be accepted, including direct settle calls`, async () => {
    const api = editorApi();
    const original = proposal();
    const pending = api.requestInlineConfirm({ collectionProposal: original, message: "选择首集" });
    assert.equal(api.state.inlineConfirm.collectionProposal, original);
    assert.match(api.renderInlineConfirm(), /data-action="inline-confirm-accept" disabled/);
    assert.deepEqual(api.focused, ["select"]);
    api.settleInlineConfirm(true);
    assert.ok(api.state.inlineConfirm, "disabled confirmation stays pending without writing a guessed range");
    api.settleInlineConfirm(false);
    assert.equal(await pending, false);
  });

  test(`${label}: trusted first-P selection keeps proposal identity and renders current and future coverage`, async () => {
    const api = editorApi();
    const original = proposal();
    const pending = api.requestInlineConfirm({ collectionProposal: original });
    api.handleCollectionBindingStartChange({ isTrusted: false, target: { value: "12" } });
    assert.equal(original.startConfirmed, false, "a script-generated change cannot approve a mapping");
    let stopped = 0;
    api.handleCollectionBindingStartChange({ isTrusted: true, target: { value: "12" }, stopPropagation: () => { stopped += 1; } });
    assert.equal(stopped, 1);
    assert.equal(api.state.inlineConfirm.collectionProposal, original, "bindSubject keeps the same live proposal reference");
    assert.equal(original.rule.sourceStart, 12);
    assert.equal(original.rule.sourceEnd, 19);
    const html = api.renderInlineConfirm();
    assert.match(html, /P28 · 第四季12/);
    assert.match(html, /第四季14.*Bangumi 第 3 集/);
    assert.match(html, /已上传范围.*12-15/);
    assert.match(html, /完整映射.*12-19/);
    assert.doesNotMatch(html, /data-action="inline-confirm-accept" disabled/);
    api.settleInlineConfirm(true);
    assert.equal(await pending, true);
  });

  test(`${label}: invalid or cleared choice revokes confirmation and preserves safe cancellation`, async () => {
    const api = editorApi();
    const original = proposal();
    const pending = api.requestInlineConfirm({ collectionProposal: original });
    const choose = (value) => api.handleCollectionBindingStartChange({ isTrusted: true, target: { value }, stopPropagation() {} });
    choose("12");
    choose("1");
    assert.equal(original.startConfirmed, false);
    assert.match(original.editError, /当前|起点|范围/);
    api.settleInlineConfirm(true);
    assert.ok(api.state.inlineConfirm);
    choose("12");
    choose("");
    assert.equal(original.startConfirmed, false);
    assert.equal(original.editError, "");
    api.settleInlineConfirm(false);
    assert.equal(await pending, false);
  });

  test(`${label}: changed route or request cancels both first-P edits and final acceptance`, async () => {
    for (const action of ["edit", "accept"]) {
      const api = editorApi();
      let current = true;
      const original = api.reviseCollectionRangeBindingProposal(proposal(), 12);
      const before = clone(original);
      const pending = api.requestInlineConfirm({ collectionProposal: original, isCurrent: () => current });
      current = false;
      if (action === "edit") api.handleCollectionBindingStartChange({ isTrusted: true, target: { value: "13" }, stopPropagation() {} });
      else api.settleInlineConfirm(true);
      assert.equal(await pending, false);
      assert.equal(api.state.inlineConfirm, null);
      assert.deepEqual(clone(original), before, "stale controls cannot revise their saved proposal");
    }
  });

  test(`${label}: raw part titles are escaped in options and current-episode previews`, () => {
    const api = editorApi();
    const original = api.reviseCollectionRangeBindingProposal(proposal(), 12);
    original.context.title = '<img src=x onerror="boom">';
    original.context.sourceEpisodes[11].title = '</option><script>boom()</script>';
    const html = api.renderCollectionBindingEditor(original);
    assert.doesNotMatch(html, /<script>|<img /);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;\/option&gt;&lt;script&gt;/);
  });
}
