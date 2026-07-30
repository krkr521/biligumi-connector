"use strict";

// OP/ED skip duration: global default + per-subject override + hover slider.
// The seconds in the settings dialog are global; the hover slider on the
// player "跳OP/ED" button stores a per-subject override (20-100s, 5s step).
// Legacy per-subject entries that already carry `seconds` keep working as
// overrides.

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  extractConstants,
  runInSandbox,
} = require("./_source");

const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);

const CONFIG_FUNCTIONS = [
  "getOpedSkipConfig",
  "getGlobalOpedSkipSeconds",
  "hasOpedSkipSecondsOverride",
  "setOpedSkipEnabled",
  "setOpedSkipSecondsOverride",
  "clearOpedSkipSecondsOverride",
  "applyOpedHoverSliderSeconds",
  "formatOpedHoverSecondsLabel",
  "normalizeOpedSkipSeconds",
  "normalizeOpedHoverSliderSeconds",
];

// Userscript and extension must keep this logic mirrored byte-for-byte.
for (const name of CONFIG_FUNCTIONS) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

// The hover-panel UI layer must stay mirrored too (identity-only guard;
// these functions need a DOM, so behavior is reviewed rather than sandboxed).
const HOVER_UI_FUNCTIONS = [
  "refreshOpedSkipButton",
  "buildOpedSkipHoverPanel",
  "syncOpedSkipHoverPanel",
  "handleOpedSkipButtonMouseEnter",
  "handleOpedSkipButtonMouseLeave",
  "handleOpedSkipButtonFocusOut",
  "cancelOpedSkipHoverHide",
  "scheduleOpedSkipHoverHide",
  "handleOpedHoverSliderPointerDown",
  "handleOpedHoverGlobalPointerUp",
  "handleOpedHoverSliderInput",
  "handleOpedHoverSliderChange",
  "isOpedSkipHoverEvent",
  "findOpedSkipButtonPlacement",
  "handleOpedSkipButtonClick",
  "handleOpedSkipButtonMouseDown",
  "handleOpedSkipButtonKeydown",
];
for (const name of HOVER_UI_FUNCTIONS) {
  assert.equal(
    extractFunction(extensionSource, name),
    extractFunction(userscriptSource, name),
    `${name} must stay identical between userscript and extension`,
  );
}

const CONSTANTS = [
  "DEFAULT_OPED_SKIP_SECONDS",
  "OPED_SKIP_SLIDER_MIN",
  "OPED_SKIP_SLIDER_MAX",
  "OPED_SKIP_SLIDER_STEP",
];
for (const source of [userscriptSource, extensionSource]) {
  const constants = extractConstants(source, CONSTANTS);
  assert.equal(constants.DEFAULT_OPED_SKIP_SECONDS, 85);
  assert.equal(constants.OPED_SKIP_SLIDER_MIN, 20);
  assert.equal(constants.OPED_SKIP_SLIDER_MAX, 100);
  assert.equal(constants.OPED_SKIP_SLIDER_STEP, 5);
  assert.equal(
    extractConstants(source, ["OPED_SKIP_HOVER_HIDE_DELAY_MS"]).OPED_SKIP_HOVER_HIDE_DELAY_MS,
    300,
  );
}

function buildApi(source) {
  const constants = extractConstants(source, CONSTANTS);
  const sandbox = {
    ...constants,
    state: { subjectId: 0, opedSkips: {}, opedSkipSeconds: constants.DEFAULT_OPED_SKIP_SECONDS },
  };
  const code = CONFIG_FUNCTIONS.map((name) => extractFunction(source, name)).join("\n");
  runInSandbox(`${code}\n;globalThis.api = { ${CONFIG_FUNCTIONS.join(", ")} };`, sandbox);
  return { api: sandbox.api, state: sandbox.state };
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

  // Slider commit stores a per-subject override and keeps the enabled flag.
  assert.equal(api.applyOpedHoverSliderSeconds(65), 65, label);
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: false, seconds: 65 }, label);
  assert.equal(api.getOpedSkipConfig().seconds, 65, label);

  // Returning the slider to the global value clears the override without
  // touching the per-subject enabled flag.
  assert.equal(api.applyOpedHoverSliderSeconds(40), 40, label);
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: false }, label);
  assert.equal(api.getOpedSkipConfig().seconds, 40, label);
  assert.equal(api.hasOpedSkipSecondsOverride(), false, label);
  api.clearOpedSkipSecondsOverride();
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: false }, `${label}: clearing twice is a no-op`);

  // Toggling the button visibility preserves the seconds override.
  api.setOpedSkipSecondsOverride(75);
  api.setOpedSkipEnabled(true);
  assert.deepEqual(snapshot(state.opedSkips["123"]), { enabled: true, seconds: 75 }, label);

  // Slider normalization: 20-100 range, 5s step, clamped ends.
  assert.equal(api.normalizeOpedHoverSliderSeconds(20), 20, label);
  assert.equal(api.normalizeOpedHoverSliderSeconds(100), 100, label);
  assert.equal(api.normalizeOpedHoverSliderSeconds(87), 85, label);
  assert.equal(api.normalizeOpedHoverSliderSeconds(88), 90, label);
  assert.equal(api.normalizeOpedHoverSliderSeconds(150), 100, label);
  assert.equal(api.normalizeOpedHoverSliderSeconds(3), 20, label);
  assert.equal(api.normalizeOpedHoverSliderSeconds("not-a-number"), 20, label);

  // Values beyond the quick slider range are clearly marked as custom instead
  // of silently presenting a clamped thumb as the exact stored value.
  assert.equal(api.formatOpedHoverSecondsLabel(180, false), "180 秒 · 自定义", label);
  assert.equal(api.formatOpedHoverSecondsLabel(180, true), "180 秒 · 自定义", label);
  assert.equal(api.formatOpedHoverSecondsLabel(85, false), "85 秒 · 全局", label);
  assert.equal(api.formatOpedHoverSecondsLabel(90, true), "90 秒", label);

  // Global seconds normalization still accepts the wider 1-600 range.
  state.opedSkipSeconds = 150;
  assert.equal(api.getGlobalOpedSkipSeconds(), 150, label);
  assert.equal(api.getOpedSkipConfig().seconds, 75, `${label}: override wins over wide global`);
}

// Hover interaction: input previews only; change commits once. Pointer
// cancellation and window blur share the drag cleanup path.
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const bindBlock = extractFunction(source, "bindOpedSkipButtonEvents");
  assert.match(bindBlock, /addEventListener\("pointercancel", handleOpedHoverGlobalPointerUp, true\)/, label);
  assert.match(bindBlock, /addEventListener\("blur", handleOpedHoverGlobalPointerUp\)/, label);

  const buildBlock = extractFunction(source, "buildOpedSkipHoverPanel");
  assert.match(buildBlock, /addEventListener\("change", handleOpedHoverSliderChange\)/, label);
  assert.match(buildBlock, /aria-label="当前番剧 OP\/ED 跳过时长"/, label);

  const refreshBlock = extractFunction(source, "refreshOpedSkipButton");
  assert.ok(!/button\.setAttribute\("role", "button"\)/.test(refreshBlock), `${label}: wrapper must not own button semantics`);
  assert.match(refreshBlock, /label\.setAttribute\("role", "button"\)/, label);
  assert.match(refreshBlock, /label\.addEventListener\("keydown", handleOpedSkipButtonKeydown, true\)/, label);
  assert.match(refreshBlock, /button\.addEventListener\("focusin", handleOpedSkipButtonMouseEnter\)/, label);
  assert.match(refreshBlock, /button\.addEventListener\("focusout", handleOpedSkipButtonFocusOut\)/, label);

  const inputBlock = extractFunction(source, "handleOpedHoverSliderInput");
  assert.ok(!/writeJsonValue/.test(inputBlock), `${label}: input must not persist`);
  assert.ok(!/setOpedSkipSecondsOverride/.test(inputBlock), `${label}: input must not mutate the saved config`);

  const changeBlock = extractFunction(source, "handleOpedHoverSliderChange");
  assert.match(changeBlock, /applyOpedHoverSliderSeconds\(slider\.value\)/, label);
  assert.match(changeBlock, /writeJsonValue\(STORAGE\.opedSkips, state\.opedSkips\)/, label);
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

console.log("oped skip config tests passed");
