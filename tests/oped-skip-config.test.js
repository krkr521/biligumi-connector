"use strict";

// Persistent OP/ED controls use the settings duration without a hover slider.
// Legacy per-subject seconds and visibility preferences stay compatible.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  extractConstants,
  extractObjectConstant,
  runInSandbox,
} = require("./_source");

const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);

const CONFIG_FUNCTIONS = [
  "getOpedSkipConfig",
  "getGlobalOpedSkipSeconds",
  "hasOpedSkipSecondsOverride",
  "setOpedSkipEnabled",
  "clearOpedSkipSecondsOverride",
  "normalizeOpedSkipSeconds",
];

// Userscript and extension must keep this logic mirrored byte-for-byte.
for (const name of CONFIG_FUNCTIONS) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

// The button UI layer must stay mirrored too; real DOM interactions
// are additionally exercised by the isolated browser QA fixture.
const BUTTON_UI_FUNCTIONS = [
  "refreshOpedSkipButton",
  "findOpedSkipButtonPlacement",
  "shouldShowOpedSkipButton",
  "skipOpedForActiveVideo",
  "handleOpedSkipButtonClick",
  "handleOpedSkipButtonMouseDown",
  "handleOpedSkipButtonKeydown",
];
for (const name of BUTTON_UI_FUNCTIONS) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

const CONSTANTS = ["DEFAULT_OPED_SKIP_SECONDS"];
for (const source of [userscriptSource, extensionSource]) {
  assert.equal(extractConstants(source, CONSTANTS).DEFAULT_OPED_SKIP_SECONDS, 85);
}

function buildApi(source) {
  const constants = extractConstants(source, CONSTANTS);
  const sandbox = {
    ...constants,
    state: { subjectId: 0, opedSkips: {}, opedSkipSeconds: constants.DEFAULT_OPED_SKIP_SECONDS },
  };
  const code = CONFIG_FUNCTIONS.map((name) => extractFunction(source, name)).join("\n");
  runInSandbox(`${code}\n;globalThis.api = { ${CONFIG_FUNCTIONS.join(", ")} };`, sandbox);
  return { api: sandbox.api, state: sandbox.state, sandbox };
}

// vm-realm objects fail deepStrictEqual prototypes; compare plain snapshots.
const snapshot = (value) => JSON.parse(JSON.stringify(value));

for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const { api, state } = buildApi(source);
  state.subjectId = 123;

  // No entry: falls back to the global default, enabled by default.
  assert.deepEqual(snapshot(api.getOpedSkipConfig()), { enabled: true, seconds: 85 }, label);

  // Legacy per-subject entry keeps acting as an override.
  state.opedSkips = { "123": { enabled: false, seconds: 90 } };
  assert.deepEqual(snapshot(api.getOpedSkipConfig()), { enabled: false, seconds: 90 }, label);
  state.opedSkipSeconds = 40;
  assert.equal(api.getOpedSkipConfig().seconds, 90, `${label}: override ignores global changes`);
  assert.equal(api.hasOpedSkipSecondsOverride(), true, label);

  // Entry without seconds follows the global default.
  state.opedSkips = { "123": { enabled: false } };
  assert.deepEqual(snapshot(api.getOpedSkipConfig()), { enabled: false, seconds: 40 }, label);
  assert.equal(api.hasOpedSkipSecondsOverride(), false, label);

  // Clearing a legacy override preserves the visibility setting.
  state.opedSkips["123"].seconds = 65;
  api.clearOpedSkipSecondsOverride();
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: false }, label);
  assert.equal(api.getOpedSkipConfig().seconds, 40, label);
  assert.equal(api.hasOpedSkipSecondsOverride(), false, label);
  api.clearOpedSkipSecondsOverride();
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: false }, label);

  // Toggling visibility preserves an existing duration override.
  state.opedSkips["123"].seconds = 75;
  api.setOpedSkipEnabled(true);
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: true, seconds: 75 }, label);

  // Global seconds normalization still accepts the wider 1-600 range.
  state.opedSkipSeconds = 150;
  assert.equal(api.getGlobalOpedSkipSeconds(), 150, label);
  assert.equal(api.getOpedSkipConfig().seconds, 75, `${label}: override wins over wide global`);
}

// Buttons keep keyboard activation while no hover slider can change settings.
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const refreshBlock = extractFunction(source, "refreshOpedSkipButton");
  assert.match(refreshBlock, /label\.setAttribute\("role", "button"\)/, label);
  assert.match(refreshBlock, /label\.addEventListener\("keydown", handleOpedSkipButtonKeydown, true\)/, label);
  assert.ok(!source.includes("oped-hover-slider"), label);
  assert.ok(!source.includes("handleOpedHoverSliderChange"), label);
}

// Settings dialog: the seconds input binds the global value and stays enabled
// even without a bound subject.
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const renderBlock = extractFunction(source, "renderSettingsDialog");
  assert.match(
    renderBlock,
    /data-role="settings-oped-skip-seconds" value="\$\{getGlobalOpedSkipSeconds\(\)\}">/,
    `${label}: settings seconds input must render the global value`,
  );
  assert.ok(
    !/settings-oped-skip-seconds"[^>]*disabled/.test(renderBlock),
    `${label}: settings seconds input must not be subject-gated anymore`,
  );
  assert.ok(
    !/settings-oped-skip-enabled"[^>]*disabled/.test(renderBlock),
    `${label}: unbound pages can change the default button visibility`,
  );
}

// Unbound video pages have working skip controls, not just a visible label.
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const { api, state, sandbox } = buildApi(source);
  const writes = [];
  const video = { currentTime: 10, duration: 300 };
  Object.assign(sandbox, {
    STORAGE: extractObjectConstant(source, "STORAGE"),
    OPED_SKIP_BUTTON_CLASS: "biligumi-oped-skip-btn",
    getActiveVideoElement: () => video,
    render: () => {},
    showError: (error) => { throw error; },
    writeValue: (key, value) => writes.push([key, value]),
    writeJsonValue: (key, value) => writes.push([key, snapshot(value)]),
    document: { title: "普通视频", pictureInPictureElement: null },
    location: { href: "https://www.bilibili.com/video/BV1test" },
    notifyExtensionPageState: () => {},
    isCapturingOpedSkipHotkey: () => false,
    isEditableTarget: (target) => target.editable,
    getKeyboardEventHotkey: () => "Ctrl+Alt+ArrowRight",
  });
  const names = ["shouldShowOpedSkipButton", "skipOpedForActiveVideo", "handleOpedSkipHotkey"];
  if (label === "extension") names.push("executeExtensionOpedSkipCommand");
  runInSandbox(names.map((name) => extractFunction(source, name)).join("\n"), sandbox);
  state.opedSkipHotkey = "Ctrl+Alt+ArrowRight";
  assert.equal(sandbox.shouldShowOpedSkipButton(), true, `${label}: visible without a subject`);
  sandbox.skipOpedForActiveVideo();
  assert.equal(video.currentTime, 95, `${label}: unbound skip advances by the global duration`);
  assert.equal(state.autoWatchLastVideoTime, 95, `${label}: skip still updates the auto-watch baseline`);

  const event = { target: {}, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
  sandbox.handleOpedSkipHotkey(event);
  assert.equal(video.currentTime, 180, `${label}: unbound hotkey works`);
  sandbox.handleOpedSkipHotkey({ ...event, repeat: true });
  sandbox.handleOpedSkipHotkey({ ...event, target: { editable: true } });
  assert.equal(video.currentTime, 180, `${label}: repeated and editable-target keys are ignored`);

  state.opedSkips = { "123": { enabled: false, seconds: 90 } };
  assert.deepEqual(writes, [], label + ": button and hotkey never write duration settings");
  assert.equal(state.opedSkipSeconds, 85, label);
  video.currentTime = 280;
  sandbox.skipOpedForActiveVideo();
  assert.equal(video.currentTime, 300, `${label}: skip clamps to the video end`);

  api.setOpedSkipEnabled(false);
  assert.equal(sandbox.shouldShowOpedSkipButton(), false, `${label}: unbound default can be disabled`);
  video.currentTime = 10;
  sandbox.skipOpedForActiveVideo();
  assert.equal(video.currentTime, 10, `${label}: disabled controls cannot seek`);
  state.subjectId = 456;
  assert.equal(api.getOpedSkipConfig().enabled, false, `${label}: a new subject follows the default visibility`);
  api.setOpedSkipEnabled(true);
  assert.equal(sandbox.shouldShowOpedSkipButton(), true, `${label}: explicit subject preference overrides the default`);
  state.subjectId = 0;
  assert.equal(sandbox.shouldShowOpedSkipButton(), false, `${label}: leaving the subject restores the default`);
  api.setOpedSkipEnabled(true);
  state.subjectId = 123;
  assert.deepEqual(snapshot(api.getOpedSkipConfig()), { enabled: false, seconds: 90 }, `${label}: legacy subject preference remains intact`);
  state.subjectId = 0;
  assert.deepEqual(snapshot(api.getOpedSkipConfig()), { enabled: true, seconds: 85 }, `${label}: unbinding restores global controls`);
  assert.ok(!Object.hasOwn(state.opedSkips, "0") && !Object.hasOwn(state.opedSkips, ""), `${label}: no synthetic subject settings`);

  if (label === "extension") {
    assert.equal(sandbox.executeExtensionOpedSkipCommand().ok, true, "extension: actual browser-command entry point works without a binding");
    assert.equal(video.currentTime, 95);
    api.setOpedSkipEnabled(false);
    assert.deepEqual(snapshot(sandbox.executeExtensionOpedSkipCommand()), { ok: false, handled: true, reason: "disabled" });
    api.setOpedSkipEnabled(true);
    sandbox.getActiveVideoElement = () => null;
    assert.equal(sandbox.executeExtensionOpedSkipCommand().reason, "no-video");
  }
}

// Placement: the button anchors to the rendered time label only. The bare
// bottom-left container fallback made it flash at the video corner on load.
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const placementBlock = extractFunction(source, "findOpedSkipButtonPlacement");
  assert.ok(
    !/control-bottom-left/.test(placementBlock),
    `${label}: placement must not fall back to the bare bottom-left container`,
  );
}

for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  test(`${label}: unbound settings save and reset persist the default controls`, async () => {
    const { api, state, sandbox } = buildApi(source);
    const store = {};
    const noop = () => {};
    const inputs = {
      "settings-oped-skip-enabled": { checked: false },
      "settings-oped-skip-seconds": { value: "45" },
      "settings-oped-skip-hotkey": { value: "", dataset: {} },
    };
    const settings = { querySelector: (selector) => inputs[selector.match(/settings-[\w-]+/)[0]] || null };
    Object.assign(state, {
      token: "", whitelist: [], whitelistLabels: {}, longVideoEpisodeOffsets: {}, autoWatchThresholds: {},
      characterStripEnabled: false, subjectInfoPanelEnabled: false, longVideoEpisodeGuessEnabled: false,
      opedSkips: { "123": { enabled: false, seconds: 90 } },
    });
    const write = (key, value) => { store[key] = snapshot(value); };
    Object.assign(sandbox, {
      STORAGE: extractObjectConstant(source, "STORAGE"), SETTINGS_ID: "settings",
      ...extractConstants(source, ["DEFAULT_CHARACTER_STRIP_ENABLED", "DEFAULT_SUBJECT_INFO_PANEL_ENABLED", "DEFAULT_AUTO_WATCH_THRESHOLD", "DEFAULT_OPED_SKIP_HOTKEY"]),
      document: { getElementById: () => settings }, isSettingsDialogOpen: () => true,
      normalizeAccessTokenInput: () => "", isValidAccessToken: () => false,
      getApiRelayAutoFallbackSetting: () => false, getLongVideoSettingsContext: () => ({ ownerKey: "" }),
      parseTimecode: () => 0, normalizeLongVideoOffsetSeconds: () => 0,
      normalizeAutoWatchThreshold: () => 80, normalizeHotkey: () => "",
      parseWhitelistInput: () => ({ items: [], labels: {} }), pruneWhitelistLabels: () => ({}),
      setAccessTokenState: (token) => { state.token = token; },
      requestInlineConfirm: async () => true,
      writeValue: write, writeJsonValue: write, writeListValue: write,
      writeValueAsync: async (...args) => write(...args),
      writeJsonValueAsync: async (...args) => write(...args), writeListValueAsync: async (...args) => write(...args),
    });
    for (const name of ["setAutoWatchThreshold", "refreshSettingsTokenHelp", "updateAutoWatchThresholdPreview", "syncSubjectInfoPanel", "syncCharacterStrip", "layoutPanelWithoutOwningBiliDom", "refreshOpedSkipButton", "resetAutoWatchObservationState", "remountSettingsDialog", "render"]) sandbox[name] = noop;
    runInSandbox(
      extractFunction(source, "applySettingsFromDialog", { async: label === "extension" })
      + extractFunction(source, "resetSettingsToDefaults", { async: true }), sandbox,
    );
    assert.equal(await sandbox.applySettingsFromDialog(), true);
    assert.deepEqual(store[sandbox.STORAGE.opedSkips], {
      "123": { enabled: false, seconds: 90 }, default: { enabled: false },
    });
    assert.equal(store[sandbox.STORAGE.opedSkipSeconds], "45");
    const reloaded = buildApi(source);
    reloaded.state.opedSkips = store[sandbox.STORAGE.opedSkips];
    reloaded.state.opedSkipSeconds = store[sandbox.STORAGE.opedSkipSeconds];
    assert.deepEqual(snapshot(reloaded.api.getOpedSkipConfig()), { enabled: false, seconds: 45 });

    await sandbox.resetSettingsToDefaults();
    assert.deepEqual(snapshot(api.getOpedSkipConfig()), { enabled: true, seconds: 85 });
    assert.deepEqual(store[sandbox.STORAGE.opedSkips], {
      "123": { enabled: false, seconds: 90 }, default: { enabled: true },
    });
    assert.equal(store[sandbox.STORAGE.opedSkipSeconds], "85");

    state.opedSkips.default.enabled = false;
    state.opedSkips["456"] = { enabled: false, seconds: 60 };
    state.subjectId = 123;
    await sandbox.resetSettingsToDefaults();
    assert.deepEqual(store[sandbox.STORAGE.opedSkips], {
      "123": { enabled: true }, "456": { enabled: false, seconds: 60 }, default: { enabled: true },
    }, "reset from a bound page restores the global default and current subject, preserving other subjects");
    state.subjectId = 0;
    assert.equal(api.getOpedSkipConfig().enabled, true);
  });
}

console.log("oped skip config tests passed");
