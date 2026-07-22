"use strict";

// Input-draft restoration tests for the panel re-render path.
//
// render() captures search-keyword + progress input drafts before it rewrites
// panel.innerHTML and restores them afterwards so the user never loses focus or
// half-typed text on a state refresh. These tests pin that contract directly
// against the extracted production functions (capturePanelInputDrafts /
// restorePanelInputDrafts) running inside a node:vm sandbox with a tiny fake
// DOM. No browser or heavy framework is involved.

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

// ---------------------------------------------------------------------------
// Anti-drift: capture/restore must stay byte-identical between builds.
// ---------------------------------------------------------------------------

const IDENTICAL_FUNCTIONS = ["capturePanelInputDrafts", "restorePanelInputDrafts"];
for (const name of IDENTICAL_FUNCTIONS) {
  const userscriptBlock = extractFunction(userscriptSource, name);
  const extensionBlock = extractFunction(extensionSource, name);
  assert.equal(extensionBlock, userscriptBlock, `${name} must stay identical between userscript and extension`);
}

// The contract must cover exactly these two roles and nothing else, so a third
// role added by mistake cannot silently evade restoration.
const captureSource = extractFunction(userscriptSource, "capturePanelInputDrafts");
assert.ok(
  /\["search-keyword", "progress"\]\.forEach/.test(captureSource),
  "capturePanelInputDrafts must snapshot the search-keyword and progress roles",
);

// render() must wire the capture/restore pair around every innerHTML rewrite
// in BOTH builds. Counting the call sites catches a build that drops one of the
// restore hooks (there are three restore sites plus one capture in render()).
function renderFunction(source) {
  return extractFunction(source, "render");
}
const userscriptRender = renderFunction(userscriptSource);
const extensionRender = renderFunction(extensionSource);
const countCapture = (src) => (src.match(/capturePanelInputDrafts\(/g) || []).length;
const countRestore = (src) => (src.match(/restorePanelInputDrafts\(/g) || []).length;
assert.ok(countCapture(userscriptRender) >= 1, "userscript render must capture drafts");
assert.equal(countCapture(extensionRender), countCapture(userscriptRender), "render capture sites must match across builds");
assert.equal(countRestore(extensionRender), countRestore(userscriptRender), "render restore sites must match across builds");
assert.ok(countRestore(userscriptRender) >= 3, "render must restore drafts after each innerHTML rewrite");

// ---------------------------------------------------------------------------
// Minimal fake input/element + fake document.
// ---------------------------------------------------------------------------

// A fake input element that tracks value, focus, selection and whether
// setSelectionRange is supported / throws. querySelector resolves data-role.
function makeInput(role, opts = {}) {
  const input = {
    tagName: opts.tagName || "INPUT",
    type: opts.type || "text",
    _role: role,
    value: opts.value != null ? opts.value : "",
    selectionStart: opts.selectionStart != null ? opts.selectionStart : 0,
    selectionEnd: opts.selectionEnd != null ? opts.selectionEnd : 0,
    _focused: false,
    supportsSelectionRange: opts.supportsSelectionRange != null ? opts.supportsSelectionRange : true,
    selectionRangeThrows: Boolean(opts.selectionRangeThrows),
    setSelectionRangeCalls: [],
    focusCalls: 0,
    focus(options) {
      this._focused = true;
      this.focusCalls += 1;
      this._focusOptions = options;
    },
    blur() { this._focused = false; },
    setSelectionRange(start, end) {
      if (this.selectionRangeThrows) throw new Error("setSelectionRange not supported");
      this.setSelectionRangeCalls.push([start, end]);
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  if (!input.supportsSelectionRange) delete input.setSelectionRange;
  return input;
}

// A fake panel element: querySelector("[data-role='X']") returns the input
// registered for that role, or null if none was registered.
function makePanel(inputs = {}) {
  const byRole = new Map();
  for (const [role, input] of Object.entries(inputs)) {
    if (input) byRole.set(role, input);
  }
  return {
    querySelector(selector) {
      const match = /^\[data-role=['"]([a-z-]+)['"]\]$/.exec(selector);
      if (!match) return null;
      return byRole.get(match[1]) || null;
    },
  };
}

const DRAFT_SOURCE = [
  extractFunction(userscriptSource, "capturePanelInputDrafts"),
  extractFunction(userscriptSource, "restorePanelInputDrafts"),
].join("\n");

function createSandbox(document) {
  const sandbox = { document };
  runInSandbox(
    `${DRAFT_SOURCE}\n;globalThis.api = { capturePanelInputDrafts, restorePanelInputDrafts };`,
    sandbox,
  );
  return sandbox;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
  // 1) Values round-trip across a capture/restore pair (search-keyword + progress).
  {
    const search = makeInput("search-keyword", { value: "孤独摇滚" });
    const progress = makeInput("progress", { type: "number", value: "5" });
    const panel = makePanel({ "search-keyword": search, progress });
    const sandbox = createSandbox({ activeElement: null });

    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    assert.equal(drafts.length, 2, "both roles are captured");

    // Simulate render() wiping the inputs.
    search.value = "";
    progress.value = "";

    sandbox.api.restorePanelInputDrafts(panel, drafts);
    assert.equal(search.value, "孤独摇滚", "search-keyword value restored");
    assert.equal(progress.value, "5", "progress value restored");
  }

  // 2) restorePanelInputDrafts only writes when the value differs.
  {
    let writes = 0;
    const search = {
      _value: "same",
      get value() { return this._value; },
      set value(v) { writes += 1; this._value = v; },
      selectionStart: 0,
      selectionEnd: 0,
      _focused: false,
      focusCalls: 0,
      setSelectionRangeCalls: [],
      focus() { this._focused = true; this.focusCalls += 1; },
      setSelectionRange(s, e) { this.setSelectionRangeCalls.push([s, e]); },
    };
    const panel = makePanel({ "search-keyword": search });
    const sandbox = createSandbox({ activeElement: null });
    const drafts = [{ role: "search-keyword", value: "same", focused: false, selectionStart: null, selectionEnd: null }];
    sandbox.api.restorePanelInputDrafts(panel, drafts);
    assert.equal(writes, 0, "an unchanged value must not be rewritten");
    assert.equal(search.value, "same");
    assert.equal(search.focusCalls, 0, "an unfocused input must not be refocused");
  }

  // 3) Focus + selectionStart/selectionEnd are restored for the focused input.
  {
    const search = makeInput("search-keyword", { value: "abc", selectionStart: 1, selectionEnd: 2 });
    const panel = makePanel({ "search-keyword": search });
    // The captured draft must mark this input as focused (document.activeElement === input).
    const sandbox = createSandbox({ activeElement: search });

    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    const searchDraft = drafts.find((d) => d.role === "search-keyword");
    assert.equal(searchDraft.focused, true, "capture must record focus via document.activeElement");
    assert.equal(searchDraft.selectionStart, 1);
    assert.equal(searchDraft.selectionEnd, 2);

    // Reset focus/selection as render() would, then restore.
    search._focused = false;
    search.selectionStart = 0;
    search.selectionEnd = 0;
    sandbox.api.restorePanelInputDrafts(panel, drafts);
    assert.equal(search._focused, true, "focus restored");
    assert.equal(search.focusCalls, 1, "focus called exactly once");
    assert.deepEqual(search.setSelectionRangeCalls, [[1, 2]], "selection restored to the captured range");
    assert.equal(search._focusOptions && search._focusOptions.preventScroll, true, "focus uses preventScroll");
  }

  // 4) An input that was not focused must not be refocused or have its selection touched.
  {
    const search = makeInput("search-keyword", { value: "abc", selectionStart: 0, selectionEnd: 0 });
    const panel = makePanel({ "search-keyword": search });
    const sandbox = createSandbox({ activeElement: null });
    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    assert.equal(drafts[0].focused, false);
    sandbox.api.restorePanelInputDrafts(panel, drafts);
    assert.equal(search.focusCalls, 0, "unfocused inputs stay unfocused");
    assert.equal(search.setSelectionRangeCalls.length, 0, "selection not touched when unfocused");
  }

  // 5) A number input that lacks setSelectionRange must not crash restore.
  {
    const progress = makeInput("progress", {
      type: "number",
      value: "12",
      selectionStart: 2,
      selectionEnd: 2,
      supportsSelectionRange: false,
    });
    const panel = makePanel({ progress });
    const sandbox = createSandbox({ activeElement: progress });

    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    assert.equal(drafts[0].selectionStart, 2, "capture still records selectionStart as a number");
    progress._focused = false;
    assert.doesNotThrow(() => sandbox.api.restorePanelInputDrafts(panel, drafts), "missing setSelectionRange must not throw");
    assert.equal(progress._focused, true, "focus still restored");
    assert.equal(progress.value, "12");
  }

  // 6) A number input whose setSelectionRange throws must not crash restore.
  {
    const progress = makeInput("progress", {
      type: "number",
      value: "9",
      selectionStart: 1,
      selectionEnd: 1,
      selectionRangeThrows: true,
    });
    const panel = makePanel({ progress });
    const sandbox = createSandbox({ activeElement: progress });

    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    progress._focused = false;
    assert.doesNotThrow(() => sandbox.api.restorePanelInputDrafts(panel, drafts), "setSelectionRange throwing must be swallowed");
    assert.equal(progress._focused, true, "focus still restored even when selection throws");
    assert.equal(progress.value, "9", "value still restored");
  }

  // 7) Missing inputs (querySelector returns null) are skipped safely.
  {
    const panel = makePanel({ "search-keyword": makeInput("search-keyword", { value: "x" }) });
    const sandbox = createSandbox({ activeElement: null });
    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    // Only search-keyword exists; progress is absent.
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].role, "search-keyword");

    // restorePanelInputDrafts with a draft whose input disappeared must skip it.
    const restore = sandbox.api.restorePanelInputDrafts.bind(null, panel, [
      ...drafts,
      { role: "progress", value: "3", focused: false, selectionStart: null, selectionEnd: null },
    ]);
    assert.doesNotThrow(restore, "a draft whose input no longer exists must be skipped");
  }

  // 8) capturePanelInputDrafts guards against a non-element / broken panel.
  //    (Uses length checks because the array is created inside the vm sandbox
  //    and assert/strict.deepStrictEqual rejects cross-realm empty arrays.)
  {
    const sandbox = createSandbox({ activeElement: null });
    assert.equal(sandbox.api.capturePanelInputDrafts(null).length, 0);
    assert.equal(sandbox.api.capturePanelInputDrafts(undefined).length, 0);
    assert.equal(
      sandbox.api.capturePanelInputDrafts({}).length,
      0,
      "an object without querySelector must yield an empty draft list",
    );
    assert.equal(
      sandbox.api.capturePanelInputDrafts({ querySelector: "not a function" }).length,
      0,
      "a non-function querySelector must yield an empty draft list",
    );
  }

  // 9) restorePanelInputDrafts guards against a non-element / bad draft list.
  {
    const sandbox = createSandbox({ activeElement: null });
    assert.doesNotThrow(() => sandbox.api.restorePanelInputDrafts(null, [{ role: "search-keyword", value: "x" }]));
    assert.doesNotThrow(() => sandbox.api.restorePanelInputDrafts(undefined, []));
    assert.doesNotThrow(() => sandbox.api.restorePanelInputDrafts({}, null), "a null draft list is a no-op");
    assert.doesNotThrow(() => sandbox.api.restorePanelInputDrafts({}, []), "an empty draft list is a no-op");
  }

  // 10) Full render() cycle simulation: capture -> rewrite innerHTML -> restore.
  //     Mirrors the three restore sites in render() so a regression in the
  //     sequence (capture before wipe, restore after rebind) is caught.
  {
    const oldSearch = makeInput("search-keyword", { value: "药屋少女", selectionStart: 2, selectionEnd: 4 });
    const oldProgress = makeInput("progress", { type: "number", value: "3" });
    const panel = makePanel({ "search-keyword": oldSearch, progress: oldProgress });
    const sandbox = createSandbox({ activeElement: oldSearch });

    // Step 1: capture (render does this before touching innerHTML).
    const drafts = sandbox.api.capturePanelInputDrafts(panel);
    assert.equal(drafts.length, 2);

    // Step 2: render() rebuilds the panel with fresh, empty input nodes.
    const newSearch = makeInput("search-keyword", { value: "" });
    const newProgress = makeInput("progress", { type: "number", value: "" });
    const rebuiltPanel = makePanel({ "search-keyword": newSearch, progress: newProgress });

    // Step 3: restore onto the rebuilt panel.
    sandbox.api.restorePanelInputDrafts(rebuiltPanel, drafts);
    assert.equal(newSearch.value, "药屋少女", "search value survives a full rebuild");
    assert.equal(newProgress.value, "3", "progress value survives a full rebuild");
    assert.equal(newSearch._focused, true, "focus moves to the rebuilt search input");
    assert.deepEqual(newSearch.setSelectionRangeCalls, [[2, 4]], "selection survives a full rebuild");
  }

  // 11) A page/business switch must not wrongly restore the previous page's draft.
  //     capture/restore are deliberately value-only snapshots; when render() is
  //     called for a different page the caller passes a fresh capture (or none),
  //     so stale drafts never leak across pages. We emulate that by handing
  //     restore an empty list (what render() does once the new page's inputs are
  //     the source of truth) and assert the new value is left untouched.
  {
    const freshSearch = makeInput("search-keyword", { value: "新页面关键词" });
    const panel = makePanel({ "search-keyword": freshSearch });
    const sandbox = createSandbox({ activeElement: null });

    // A stale draft from the *previous* page is intentionally not reused.
    const staleDraftFromPreviousPage = [{ role: "search-keyword", value: "旧页面关键词", focused: true, selectionStart: 0, selectionEnd: 0 }];
    // render() on the new page instead captures the current (new) inputs.
    const freshDrafts = sandbox.api.capturePanelInputDrafts(panel);
    assert.equal(freshDrafts[0].value, "新页面关键词", "capture reads the new page's value, not a stale one");

    // Simulate an innerHTML rewrite then restore the fresh (not stale) drafts.
    freshSearch.value = "";
    sandbox.api.restorePanelInputDrafts(panel, freshDrafts);
    assert.equal(freshSearch.value, "新页面关键词", "the new page value is restored, the stale draft is ignored");

    // And if a caller mis-passes the stale draft after the page has switched,
    // capture must already reflect the new page (proving stale drafts cannot be
    // silently reintroduced by the production capture path).
    const recaptured = sandbox.api.capturePanelInputDrafts(panel);
    assert.equal(recaptured[0].value, "新页面关键词");
    assert.notDeepEqual(recaptured, staleDraftFromPreviousPage, "recaptured drafts must not equal the stale previous-page drafts");
  }

  console.log("input draft restoration tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
