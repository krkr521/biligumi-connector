"use strict";

// Singleton-timer tests for the panel inject retry, subject-info sync retry
// and character-strip sync retry loops.
//
// All production code under test is extracted from the userscript source; the
// extraction helpers fail loudly when an anchor disappears, so these tests can
// never silently degrade into testing stale hand-copied logic.
//
// We drive the extracted functions inside a fresh node:vm sandbox with a tiny
// fake DOM and a fake timer registry. The fake timers let us assert (a) only one
// outstanding timer ever exists per loop and (b) cancelled timers never fire.

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
// Anti-drift: the timer bookkeeping code must stay byte-identical between builds.
// ---------------------------------------------------------------------------

const IDENTICAL_FUNCTIONS = [
  "syncSubjectInfoPanel",
  "scheduleSubjectInfoSyncRetry",
  "cancelSubjectInfoSyncRetry",
  "removeSubjectInfoPanel",
  "syncCharacterStrip",
  "scheduleCharacterStripSyncRetry",
  "cancelCharacterStripSyncRetry",
  "removeCharacterStrip",
  "injectWhenReady",
  "scheduleInjectRetry",
  "cancelInjectRetry",
];
for (const name of IDENTICAL_FUNCTIONS) {
  const userscriptBlock = extractFunction(userscriptSource, name);
  const extensionBlock = extractFunction(extensionSource, name);
  assert.equal(extensionBlock, userscriptBlock, `${name} must stay identical between userscript and extension`);
}

// ---------------------------------------------------------------------------
// Shared fake timer registry + minimal fake DOM.
// ---------------------------------------------------------------------------

function createTimerRegistry() {
  // Map of id -> { fire, label, cancelled }. IDs are 1-based and never reused
  // so a test can distinguish "second schedule" from "same schedule".
  const timers = new Map();
  let nextId = 1;

  const setTimeout = (fn, _delay, label) => {
    const id = nextId++;
    timers.set(id, { fire: fn, label: label || "", cancelled: false });
    return id;
  };
  const clearTimeout = (id) => {
    const entry = timers.get(id);
    if (!entry) return;
    entry.cancelled = true;
    // We keep the entry in the map so pendingCount only counts live timers and
    // so a leaked callback can still be observed (it just won't fire).
  };
  const fireAll = () => {
    // Snapshot keys so callbacks that re-schedule do not extend the loop.
    const live = [...timers.values()].filter((entry) => !entry.cancelled);
    for (const entry of live) entry.cancelled = true; // consume exactly once
    for (const entry of live) entry.fire();
  };
  const liveEntries = () => [...timers.values()].filter((entry) => !entry.cancelled);

  return {
    setTimeout,
    clearTimeout,
    fireAll,
    liveEntries,
    pendingCount: () => liveEntries().length,
    pendingLabels: () => liveEntries().map((entry) => entry.label),
    scheduledCount: () => timers.size,
  };
}

// A minimal element that supports the few DOM calls the extracted functions use:
// getElementById, createElement, classList, insertAdjacentElement,
// insertBefore, previousElementSibling, nextElementSibling, parentElement,
// remove, innerHTML, id, offsetWidth/Height, getBoundingClientRect, isVisible.
function makeElement(opts = {}) {
  const children = [];
  const el = {
    id: opts.id || "",
    className: opts.className || "",
    innerHTML: opts.innerHTML || "",
    style: opts.style || {},
    offsetWidth: opts.offsetWidth != null ? opts.offsetWidth : 300,
    offsetHeight: opts.offsetHeight != null ? opts.offsetHeight : 300,
    _children: children,
    parentElement: null,
    previousElementSibling: null,
    nextElementSibling: null,
    classList: {
      _set: new Set((opts.classList || "").split(/\s+/).filter(Boolean)),
      contains(token) { return this._set.has(token); },
      add(token) { this._set.add(token); },
      remove(token) { this._set.delete(token); },
    },
    getBoundingClientRect() { return { width: el.offsetWidth, height: el.offsetHeight }; },
    appendChild(child) { children.push(child); child.parentElement = el; return child; },
    insertBefore(child, ref) {
      const idx = ref ? children.indexOf(ref) : children.length;
      children.splice(idx, 0, child);
      child.parentElement = el;
      return child;
    },
    insertAdjacentElement(where, child) {
      // Only "afterend"/"beforebegin" are used by the sync functions; both land
      // the new node next to this one via the parent.
      const parent = el.parentElement;
      if (!parent) return child;
      const siblingIndex = parent._children.indexOf(el);
      if (where === "afterend") parent._children.splice(siblingIndex + 1, 0, child);
      else parent._children.splice(siblingIndex, 0, child);
      child.parentElement = parent;
      return child;
    },
    remove() {
      const parent = el.parentElement;
      if (parent) {
        const idx = parent._children.indexOf(el);
        if (idx !== -1) parent._children.splice(idx, 1);
      }
      el.parentElement = null;
    },
    querySelector: opts.querySelector || null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  };
  return el;
}

// A fake document owning element-by-id lookups plus createElement. The sync
// functions only ever look up SUBJECT_INFO_ID / CHARACTER_STRIP_ID / PANEL_ID.
function createDocument(opts = {}) {
  const byId = new Map();
  const doc = {
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return makeElement({ id: "" }); },
    querySelector() { return opts.querySelectorResult != null ? opts.querySelectorResult : null; },
    querySelectorAll() { return []; },
    _setElement(id, el) { el.id = id; byId.set(id, el); return el; },
    _removeElement(id) {
      const el = byId.get(id);
      if (el) el.remove();
      byId.delete(id);
    },
    body: makeElement({ id: "body" }),
    activeElement: null,
  };
  return doc;
}

const SUBJECT_INFO_ID = "biligumi-connector-subject-info";
const CHARACTER_STRIP_ID = "biligumi-connector-characters";

const TIMER_SOURCE = [
  extractFunction(userscriptSource, "syncSubjectInfoPanel"),
  extractFunction(userscriptSource, "scheduleSubjectInfoSyncRetry"),
  extractFunction(userscriptSource, "cancelSubjectInfoSyncRetry"),
  extractFunction(userscriptSource, "removeSubjectInfoPanel"),
  extractFunction(userscriptSource, "syncCharacterStrip"),
  extractFunction(userscriptSource, "scheduleCharacterStripSyncRetry"),
  extractFunction(userscriptSource, "cancelCharacterStripSyncRetry"),
  extractFunction(userscriptSource, "removeCharacterStrip"),
  extractFunction(userscriptSource, "injectWhenReady"),
  extractFunction(userscriptSource, "scheduleInjectRetry"),
  extractFunction(userscriptSource, "cancelInjectRetry"),
].join("\n");

// Build a sandbox pre-loaded with the three timer loops and their shared
// collaborators (host finders, render stubs, route checks). Each helper below
// toggles behaviour via the returned sandbox so individual tests stay readable.
function createSandbox(opts = {}) {
  const timers = createTimerRegistry();
  const document = createDocument({ querySelectorResult: opts.querySelectorResult != null ? opts.querySelectorResult : null });
  const state = {
    subjectInfoPanelEnabled: opts.subjectInfoPanelEnabled != null ? opts.subjectInfoPanelEnabled : true,
    characterStripEnabled: opts.characterStripEnabled != null ? opts.characterStripEnabled : true,
    subjectId: opts.subjectId != null ? opts.subjectId : 7,
    subject: opts.subject != null ? opts.subject : { id: 7, name: "S" },
    previewSubject: null,
  };
  const location = { pathname: opts.pathname || "/video/BV1TEST", hostname: "www.bilibili.com" };

  const sandbox = {
    SUBJECT_INFO_ID,
    CHARACTER_STRIP_ID,
    PANEL_ID: "biligumi-connector-panel",
    state,
    location,
    document,
    window: { setTimeout: (fn, d) => timers.setTimeout(fn, d, "window"), clearTimeout: (id) => timers.clearTimeout(id) },
    // Stubs; tests override these to control host discovery / render.
    shouldRenderFullPanel: () => opts.shouldRenderFullPanel != null ? opts.shouldRenderFullPanel : true,
    isSupportedWatchPage: () => opts.isSupportedWatchPage != null ? opts.isSupportedWatchPage : true,
    isOfficialBangumiPage: () => false,
    findSubjectInfoInsertHost: () => opts.subjectInfoHost != null ? opts.subjectInfoHost : null,
    findCharacterStripInsertHost: () => opts.characterStripHost != null ? opts.characterStripHost : null,
    findRightColumn: () => opts.rightColumn != null ? opts.rightColumn : null,
    syncSubjectSideLayout: () => {},
    clearSubjectSideLayout: () => {},
    renderSubjectInfoPanel: () => "<subject>",
    renderCharacterStrip: () => "<characters>",
    ensureOfficialCharacterStripPreview: () => {},
    getCharacterStripSubjectId: () => state.subjectId || null,
    getCharacterStripSubject: () => state.subject || null,
    render: () => {},
    repositionPanel: () => {},
    placePanel: () => {},
    schedulePanelReposition: () => {},
    bindViewportLayoutEvents: () => {},
    scheduleEpisodeContextRefresh: () => {},
    shouldRenderFullPanelForInject: () => opts.shouldRenderFullPanelForInject != null ? opts.shouldRenderFullPanelForInject : true,
    loadSubjectBundle: () => Promise.resolve(),
    showError: () => {},
  };
  // Module-level timer handles that the extracted code reads/writes.
  sandbox.subjectInfoSyncTimer = 0;
  sandbox.characterStripSyncTimer = 0;
  sandbox.injectRetryTimer = 0;

  runInSandbox(
    `${TIMER_SOURCE}\n;globalThis.api = {
       syncSubjectInfoPanel,
       scheduleSubjectInfoSyncRetry,
       cancelSubjectInfoSyncRetry,
       removeSubjectInfoPanel,
       syncCharacterStrip,
       scheduleCharacterStripSyncRetry,
       cancelCharacterStripSyncRetry,
       removeCharacterStrip,
       injectWhenReady,
       scheduleInjectRetry,
       cancelInjectRetry,
       getTimers: () => ({ subjectInfoSyncTimer, characterStripSyncTimer, injectRetryTimer }),
     };`,
    sandbox,
  );
  sandbox.timers = timers;
  return sandbox;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
  // 1) syncSubjectInfoPanel: many calls while the host is missing schedule at
  //    most one 900ms retry timer.
  {
    const sandbox = createSandbox({ subjectInfoHost: null });
    const { timers, api } = sandbox;
    for (let i = 0; i < 5; i += 1) api.syncSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 1, "subject-info retry must stay a singleton while host is missing");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 1, "subjectInfoSyncTimer handle must be set");
    // Firing once must consume the timer and then reschedule at most one new one.
    timers.fireAll();
    assert.equal(timers.pendingCount(), 1, "after one fire exactly one retry is pending again");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 2, "a fresh handle is issued after firing");
  }

  // 2) syncSubjectInfoPanel: once the host appears the timer is cancelled and
  //    never rescheduled.
  {
    const sandbox = createSandbox({ subjectInfoHost: null });
    const { timers, api } = sandbox;
    api.syncSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 1);
    sandbox.findSubjectInfoInsertHost = () => ({ node: makeElement({ id: "anchor" }), mode: "after" });
    api.syncSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 0, "finding the host must cancel the pending retry");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 0, "subjectInfoSyncTimer handle cleared after host found");
  }

  // 3) syncSubjectInfoPanel: when the feature is disabled the panel is removed
  //    and any pending retry timer is cleared, with no reschedule.
  {
    const sandbox = createSandbox({ subjectInfoHost: null });
    const { timers, api } = sandbox;
    api.syncSubjectInfoPanel(); // schedules a retry
    assert.equal(timers.pendingCount(), 1);
    sandbox.state.subjectInfoPanelEnabled = false;
    api.syncSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 0, "disabling must clear the pending retry");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 0);
    // Driving more syncs while disabled must never schedule again.
    api.syncSubjectInfoPanel();
    api.syncSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 0, "disabled feature must not reschedule");
  }

  // 4) syncSubjectInfoPanel: leaving a supported route mid-retry cancels and
  //    does not renew. scheduleSubjectInfoSyncRetry returns early when off-route.
  {
    const sandbox = createSandbox({ subjectInfoHost: null, isSupportedWatchPage: false });
    const { timers, api } = sandbox;
    api.syncSubjectInfoPanel(); // feature still on, but route unsupported -> removeSubjectInfoPanel (cancel)
    assert.equal(timers.pendingCount(), 0, "off-route must not leave a pending retry");
    // An explicit schedule attempt must also refuse.
    api.scheduleSubjectInfoSyncRetry();
    assert.equal(timers.pendingCount(), 0, "scheduleSubjectInfoSyncRetry must refuse off-route");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 0);
  }

  // 5) syncCharacterStrip: many calls while the host is missing schedule at
  //    most one retry timer.
  {
    const sandbox = createSandbox({ characterStripHost: null });
    const { timers, api } = sandbox;
    for (let i = 0; i < 5; i += 1) api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 1, "character-strip retry must stay a singleton while host is missing");
    assert.equal(api.getTimers().characterStripSyncTimer, 1);
    timers.fireAll();
    assert.equal(timers.pendingCount(), 1, "after one fire exactly one retry is pending again");
    assert.equal(api.getTimers().characterStripSyncTimer, 2, "a fresh handle is issued after firing");
  }

  // 6) syncCharacterStrip: host appears -> cancel and no reschedule.
  {
    const sandbox = createSandbox({ characterStripHost: null });
    const { timers, api } = sandbox;
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 1);
    sandbox.findCharacterStripInsertHost = () => ({ node: makeElement({ id: "anchor" }), mode: "after" });
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 0, "finding the host must cancel the pending retry");
    assert.equal(api.getTimers().characterStripSyncTimer, 0);
  }

  // 7) syncCharacterStrip: feature disabled -> cancel + no reschedule.
  {
    const sandbox = createSandbox({ characterStripHost: null });
    const { timers, api } = sandbox;
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 1);
    sandbox.state.characterStripEnabled = false;
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 0, "disabling must clear the pending retry");
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 0, "disabled feature must not reschedule");
  }

  // 8) syncCharacterStrip: off-route -> cancel + schedule refuses.
  {
    const sandbox = createSandbox({ characterStripHost: null, isSupportedWatchPage: false });
    const { timers, api } = sandbox;
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 0, "off-route must not leave a pending retry");
    api.scheduleCharacterStripSyncRetry();
    assert.equal(timers.pendingCount(), 0, "scheduleCharacterStripSyncRetry must refuse off-route");
    assert.equal(api.getTimers().characterStripSyncTimer, 0);
  }

  // 9) injectWhenReady: when the panel host is missing, repeated calls schedule
  //    at most one 800ms retry timer.
  {
    const sandbox = createSandbox({ rightColumn: null, querySelectorResult: null });
    const { timers, api } = sandbox;
    for (let i = 0; i < 4; i += 1) api.injectWhenReady(false);
    assert.equal(timers.pendingCount(), 1, "inject retry must stay a singleton while host is missing");
    assert.equal(api.getTimers().injectRetryTimer, 1);
    timers.fireAll();
    assert.equal(timers.pendingCount(), 1, "after one fire exactly one retry is pending again");
    assert.equal(api.getTimers().injectRetryTimer, 2, "a fresh handle is issued after firing");
  }

  // 10) injectWhenReady: once the host appears the retry timer is cancelled and
  //     not rescheduled.
  {
    const sandbox = createSandbox({ rightColumn: null });
    const { timers, api } = sandbox;
    api.injectWhenReady(true);
    assert.equal(timers.pendingCount(), 1);
    sandbox.findRightColumn = () => makeElement({ id: "right" });
    api.injectWhenReady(true);
    assert.equal(timers.pendingCount(), 0, "finding the host must cancel the pending retry");
    assert.equal(api.getTimers().injectRetryTimer, 0);
  }

  // 11) injectWhenReady: leaving the supported route cancels the retry, and the
  //     pending callback does not re-enter injectWhenReady once off-route (the
  //     guard inside the timer callback must drop the renewal).
  {
    const sandbox = createSandbox({ rightColumn: null, isSupportedWatchPage: true });
    const { timers, api } = sandbox;
    api.injectWhenReady(true);
    assert.equal(timers.pendingCount(), 1, "on-route with no host schedules one retry");
    // Simulate navigation away before the retry fires.
    sandbox.isSupportedWatchPage = () => false;
    timers.fireAll();
    assert.equal(api.getTimers().injectRetryTimer, 0, "the fired callback must not reschedule off-route");
    assert.equal(timers.pendingCount(), 0, "off-route renewal is suppressed");

    // A fresh injectWhenReady off-route also clears any stray handle.
    api.injectWhenReady(true);
    assert.equal(timers.pendingCount(), 0, "off-route inject must cancel any pending retry");
    assert.equal(api.getTimers().injectRetryTimer, 0);
  }

  // 12) Cross-feature cleanup: turning a feature off mid-flight clears its own
  //     timer but leaves the other feature's timer untouched, proving the three
  //     loops do not share state by accident.
  {
    const sandbox = createSandbox({ subjectInfoHost: null, characterStripHost: null, rightColumn: null });
    const { timers, api } = sandbox;
    // No panel exists, so all three hosts are missing and each schedules once.
    api.syncSubjectInfoPanel();
    api.syncCharacterStrip();
    api.injectWhenReady(true);
    assert.equal(timers.pendingCount(), 3, "all three loops can coexist with independent timers");
    // Disabling subject-info clears only its own timer.
    sandbox.state.subjectInfoPanelEnabled = false;
    api.syncSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 2, "disabling one feature must not cancel the others");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 0);
    assert.equal(api.getTimers().characterStripSyncTimer, 2, "character-strip timer survives");
    assert.equal(api.getTimers().injectRetryTimer, 3, "inject timer survives");
  }

  // 13) Direct cancel* calls are idempotent and never throw with no timer set.
  {
    const sandbox = createSandbox();
    const { api } = sandbox;
    assert.doesNotThrow(() => api.cancelSubjectInfoSyncRetry(), "cancel with no timer is a no-op");
    assert.doesNotThrow(() => api.cancelCharacterStripSyncRetry());
    assert.doesNotThrow(() => api.cancelInjectRetry());
    // Calling cancel twice after scheduling also stays clean.
    sandbox.findSubjectInfoInsertHost = () => null;
    api.syncSubjectInfoPanel();
    api.cancelSubjectInfoSyncRetry();
    api.cancelSubjectInfoSyncRetry();
    assert.equal(api.getTimers().subjectInfoSyncTimer, 0);
  }

  // 14) removeSubjectInfoPanel / removeCharacterStrip clear their retry timer
  //     (the render() cleanup path relies on this when the panel is torn down).
  {
    const sandbox = createSandbox({ subjectInfoHost: null, characterStripHost: null });
    const { timers, api } = sandbox;
    api.syncSubjectInfoPanel();
    api.syncCharacterStrip();
    assert.equal(timers.pendingCount(), 2);
    api.removeSubjectInfoPanel();
    assert.equal(timers.pendingCount(), 1, "removeSubjectInfoPanel cancels its own retry");
    assert.equal(api.getTimers().subjectInfoSyncTimer, 0);
    api.removeCharacterStrip();
    assert.equal(timers.pendingCount(), 0, "removeCharacterStrip cancels its own retry");
    assert.equal(api.getTimers().characterStripSyncTimer, 0);
  }

  console.log("timer singleton tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
