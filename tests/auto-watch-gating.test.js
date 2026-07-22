"use strict";

// Auto-watch gating state machine tests.
// All production code under test is extracted from the userscript source; the
// extraction helpers fail loudly when an anchor disappears, so these tests can
// never silently degrade into testing stale hand-copied logic.

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

const GATING_CONSTANTS = extractConstants(userscriptSource, [
  "AUTO_WATCH_TIMEUPDATE_MIN_INTERVAL_MS",
  "AUTO_WATCH_FAILURE_COOLDOWN_BASE_MS",
  "AUTO_WATCH_MAX_FAILURE_ROUNDS",
  "AUTO_WATCH_FAILURE_RECORD_MAX_KEYS",
  "AUTO_WATCH_RATE_LIMIT_DEFAULT_SECONDS",
  "AUTO_WATCH_RATE_LIMIT_MAX_SECONDS",
  "AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS",
]);

// ---------------------------------------------------------------------------
// Anti-drift: the gating code must stay byte-identical between the two builds.
// ---------------------------------------------------------------------------

const GATING_FUNCTIONS = [
  ["checkAutoWatchProgress", { async: true }],
  ["getAutoWatchFailureRecord"],
  ["writeAutoWatchFailureRecord"],
  ["clearAutoWatchFailureRecord"],
  ["handleAutoWatchSyncFailure"],
  ["showAutoWatchSyncNotice"],
  ["isRetryableApiError"],
  ["makeApiError"],
  ["parseRetryAfterSeconds"],
  ["handleAutoWatchSeekEnd"],
  ["updateAutoWatchJumpState"],
  ["resetAutoWatchObservationState"],
  ["isSupportedWatchPage"],
];
for (const [name, options] of GATING_FUNCTIONS) {
  const userscriptBlock = extractFunction(userscriptSource, name, options);
  const extensionBlock = extractFunction(extensionSource, name, options);
  assert.equal(extensionBlock, userscriptBlock, `${name} must stay identical between userscript and extension`);
}

// handleAutoWatchSeekEnd must carry its own long-video guard; it must not rely
// on checkAutoWatchProgress happening to match a shared regex.
const seekFunctionSource = extractFunction(userscriptSource, "handleAutoWatchSeekEnd");
assert.match(
  seekFunctionSource,
  /getLongVideoEpisodeModeDecision\(\) === true && \(!longVideoGuess \|\| !longVideoGuess\.active \|\| !longVideoGuess\.episode \|\| !longVideoGuess\.autoMarkSafe\)\) return;/,
  "handleAutoWatchSeekEnd needs its own confirmed-long-video guard",
);
const checkFunctionSource = extractFunction(userscriptSource, "checkAutoWatchProgress", { async: true });
assert.ok(!checkFunctionSource.includes("autoWatchSeekStartTime = null"), "check and seek concerns must stay separated");

// Token changes must release the auth gate in both builds (source-level guard).
assert.ok(
  extractFunction(userscriptSource, "applySettingsFromDialog").includes("state.autoWatchAuthBlocked = false;"),
  "userscript settings save must release the auth gate on token change",
);
assert.ok(
  extractFunction(userscriptSource, "clearSavedAccessToken").includes("state.autoWatchAuthBlocked = false;"),
  "userscript token clear must release the auth gate",
);
assert.ok(
  extractFunction(extensionSource, "applySettingsFromDialog", { async: true }).includes("state.autoWatchAuthBlocked = false;"),
  "extension settings save must release the auth gate on token change",
);
assert.ok(
  extractFunction(extensionSource, "clearSavedAccessToken", { async: true }).includes("state.autoWatchAuthBlocked = false;"),
  "extension token clear must release the auth gate",
);

// ---------------------------------------------------------------------------
// Functional tests against the extracted production code.
// ---------------------------------------------------------------------------

const GATING_SOURCE = [
  extractFunction(userscriptSource, "checkAutoWatchProgress", { async: true }),
  extractFunction(userscriptSource, "getAutoWatchFailureRecord"),
  extractFunction(userscriptSource, "writeAutoWatchFailureRecord"),
  extractFunction(userscriptSource, "clearAutoWatchFailureRecord"),
  extractFunction(userscriptSource, "handleAutoWatchSyncFailure"),
  extractFunction(userscriptSource, "showAutoWatchSyncNotice"),
  extractFunction(userscriptSource, "isRetryableApiError"),
  extractFunction(userscriptSource, "makeApiError"),
  extractFunction(userscriptSource, "parseRetryAfterSeconds"),
  extractFunction(userscriptSource, "extractApiError"),
  extractFunction(userscriptSource, "tryParseJson"),
  extractFunction(userscriptSource, "handleAutoWatchSeekEnd"),
  extractFunction(userscriptSource, "updateAutoWatchJumpState"),
  extractFunction(userscriptSource, "resetAutoWatchObservationState"),
  extractFunction(userscriptSource, "isSupportedWatchPage"),
  extractFunction(userscriptSource, "isOfficialBangumiPage"),
].join("\n");

function createSandbox() {
  const sandbox = {
    ...GATING_CONSTANTS,
    URL,
    state: {
      token: "token",
      subjectId: 7,
      autoEpisodeSyncing: false,
      autoEpisodeSyncLastKey: "",
      autoWatchLastVideoKey: "",
      autoWatchLastVideoTime: 0,
      autoWatchSeekStartTime: null,
      autoWatchBlockedKey: "",
      autoWatchAuthBlocked: false,
      autoWatchRateLimitRetryAt: 0,
      autoWatchFailures: {},
      busy: true,
      message: "",
      error: "",
    },
    location: new URL("https://www.bilibili.com/video/BV1TEST"),
    window: { setTimeout: () => 1 },
    video: { currentTime: 0, duration: 14400 },
    currentEpisode: { id: 11, sort: 1 },
    seekGuess: null,
    longVideoMode: null,
    autoProgressDisabled: false,
    patchCalls: 0,
    patchImpl: async () => {},
    renderCount: 0,
  };
  Object.assign(sandbox, {
    isCurrentVideoAutoProgressDisabled: () => sandbox.autoProgressDisabled,
    getActiveVideoElement: () => sandbox.video,
    maybeOfferLongVideoAutoIdentify: () => false,
    refreshLongVideoEpisodeGuess: () => sandbox.seekGuess,
    getLongVideoEpisodeModeDecision: () => sandbox.longVideoMode,
    hasCollection: () => true,
    getCurrentNormalEpisode: () => sandbox.currentEpisode,
    getEpisodeCollectionType: () => 0,
    getAutoWatchScopeKey: () => "scope",
    getAutoWatchThreshold: () => 50,
    patchEpisodes: (...args) => {
      sandbox.patchCalls += 1;
      return sandbox.patchImpl(...args);
    },
    applySingleEpisodeProgress: () => {},
    formatEpisodeSort: (value) => String(value),
    getEpisodeLocalNo: () => 1,
    render: () => { sandbox.renderCount += 1; },
    loadSubjectBundle: async () => {},
    showError: () => { throw new Error("showError must not be reached from the gating paths"); },
  });
  runInSandbox(`${GATING_SOURCE}\n;globalThis.api = {
    checkAutoWatchProgress,
    handleAutoWatchSeekEnd,
    resetAutoWatchObservationState,
    makeApiError,
    parseRetryAfterSeconds,
  };`, sandbox);
  return sandbox;
}

async function playTo(sandbox, times) {
  for (const time of times) {
    sandbox.video.currentTime = time;
    await sandbox.api.checkAutoWatchProgress();
  }
}

// Drives playback across the 50% threshold with realistic (< 5 min) deltas so
// the seek/jump guard stays quiet, exactly like natural playback.
async function crossThresholdNaturally(sandbox) {
  await playTo(sandbox, [100, 7000, 7100, 7200]);
}

function rejectWith(status, extra = {}) {
  return async () => {
    const error = new Error(`status ${status}`);
    error.status = status;
    Object.assign(error, extra);
    throw error;
  };
}

(async () => {
  // 1) Natural threshold crossing writes exactly once.
  {
    const sandbox = createSandbox();
    await crossThresholdNaturally(sandbox);
    assert.equal(sandbox.patchCalls, 1, "crossing the threshold must trigger one write");
    assert.match(sandbox.state.message, /自动标记/);
    assert.equal(sandbox.state.error, "");
    assert.equal(sandbox.state.autoEpisodeSyncLastKey, "7:11:scope");
    await playTo(sandbox, [7300, 7400, 7500]);
    assert.equal(sandbox.patchCalls, 1, "the same episode must never be marked twice");
  }

  // 2a) 401 blocks auto-marking and repeated timeupdate checks do not retry.
  const authSandbox = createSandbox();
  {
    authSandbox.patchImpl = rejectWith(401);
    await crossThresholdNaturally(authSandbox);
    assert.equal(authSandbox.patchCalls, 1);
    assert.equal(authSandbox.state.autoWatchAuthBlocked, true);
    assert.match(authSandbox.state.error, /401/);
    const rendersAfterBlock = authSandbox.renderCount;
    await playTo(authSandbox, [7300, 7400, 7500, 7600]);
    assert.equal(authSandbox.patchCalls, 1, "auth-blocked checks must not retry");
    assert.equal(authSandbox.renderCount, rendersAfterBlock, "blocked gates must not re-render at timeupdate frequency");
  }

  // 2b) 403 follows the same gate.
  {
    const sandbox = createSandbox();
    sandbox.patchImpl = rejectWith(403);
    await crossThresholdNaturally(sandbox);
    assert.equal(sandbox.state.autoWatchAuthBlocked, true);
    assert.match(sandbox.state.error, /403/);
    await playTo(sandbox, [7300, 7400]);
    assert.equal(sandbox.patchCalls, 1);
  }

  // 3) Releasing the gate after a token change allows exactly one recovery write.
  {
    authSandbox.state.autoWatchAuthBlocked = false; // what the token-change paths set
    authSandbox.state.error = "";
    authSandbox.patchImpl = async () => {};
    await playTo(authSandbox, [7200]);
    assert.equal(authSandbox.patchCalls, 2, "auto-marking must resume once the token is fixed");
    assert.equal(authSandbox.state.autoEpisodeSyncLastKey, "7:11:scope");
    await playTo(authSandbox, [7300]);
    assert.equal(authSandbox.patchCalls, 2, "recovery must not double-mark");
  }

  // 4a) 429 with Retry-After gates until retryAt, then recovers at most once.
  {
    const sandbox = createSandbox();
    sandbox.patchImpl = rejectWith(429, { retryAfterSeconds: 45 });
    await crossThresholdNaturally(sandbox);
    assert.equal(sandbox.patchCalls, 1);
    const retryAt = sandbox.state.autoWatchRateLimitRetryAt;
    assert.ok(retryAt > Date.now() + 40000 && retryAt <= Date.now() + 46000, `retryAt must honor Retry-After, got ${retryAt - Date.now()}ms`);
    assert.match(sandbox.state.error, /429/);
    await playTo(sandbox, [7300, 7400]);
    assert.equal(sandbox.patchCalls, 1, "rate-limit gate must block retries before retryAt");
    sandbox.state.autoWatchRateLimitRetryAt = Date.now() - 1;
    sandbox.patchImpl = async () => {};
    await playTo(sandbox, [7200]);
    assert.equal(sandbox.patchCalls, 2, "after retryAt exactly one recovery write may happen");
    await playTo(sandbox, [7300, 7400]);
    assert.equal(sandbox.patchCalls, 2, "recovery after 429 must not double-mark");
  }

  // 4b) 429 without a usable Retry-After falls back to the default cooldown.
  {
    const sandbox = createSandbox();
    sandbox.patchImpl = rejectWith(429);
    await crossThresholdNaturally(sandbox);
    const expectedMs = GATING_CONSTANTS.AUTO_WATCH_RATE_LIMIT_DEFAULT_SECONDS * 1000;
    const remaining = sandbox.state.autoWatchRateLimitRetryAt - Date.now();
    assert.ok(remaining > expectedMs - 5000 && remaining <= expectedMs, `missing Retry-After must use the default cooldown, got ${remaining}ms`);
  }

  // 4c) makeApiError attaches retryAfterSeconds parsed from response headers.
  {
    const sandbox = createSandbox();
    const error = sandbox.api.makeApiError({ status: 429, responseHeaders: "content-type: application/json\r\nretry-after: 30\r\n", response: { description: "rate" } });
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 30);
    const future = new Date(Date.now() + 45000).toUTCString();
    const dateSeconds = sandbox.api.parseRetryAfterSeconds({ responseHeaders: `Retry-After: ${future}\n` });
    assert.ok(dateSeconds > 40 && dateSeconds <= 45, `HTTP-date Retry-After must parse, got ${dateSeconds}`);
    assert.equal(sandbox.api.parseRetryAfterSeconds({ responseHeaders: "retry-after: soon\n" }), null);
    assert.equal(sandbox.api.parseRetryAfterSeconds({ responseHeaders: "" }), null);
    assert.equal(sandbox.api.parseRetryAfterSeconds({}), null);
  }

  // 5) Network errors cool down between rounds and circuit-break at the limit.
  const networkSandbox = createSandbox();
  {
    networkSandbox.patchImpl = rejectWith(0);
    await crossThresholdNaturally(networkSandbox);
    assert.equal(networkSandbox.patchCalls, 1);
    const syncKey = "7:11:scope";
    let record = networkSandbox.state.autoWatchFailures[syncKey];
    assert.equal(record.count, 1);
    assert.ok(record.retryAt > Date.now(), "a failed round must schedule a cooldown");
    assert.equal(record.circuitOpen, false);
    await playTo(networkSandbox, [7300, 7400]);
    assert.equal(networkSandbox.patchCalls, 1, "cooldown must prevent an immediate next round");

    record.retryAt = Date.now() - 1;
    await playTo(networkSandbox, [7200]);
    assert.equal(networkSandbox.patchCalls, 2, "retry is allowed once the cooldown expires");
    record = networkSandbox.state.autoWatchFailures[syncKey];
    assert.equal(record.count, 2);
    const expectedSecondCooldown = GATING_CONSTANTS.AUTO_WATCH_FAILURE_COOLDOWN_BASE_MS * 2;
    assert.ok(record.retryAt - Date.now() > expectedSecondCooldown - 5000, "backoff must grow exponentially");

    record.retryAt = Date.now() - 1;
    await playTo(networkSandbox, [7200]);
    assert.equal(networkSandbox.patchCalls, 3);
    record = networkSandbox.state.autoWatchFailures[syncKey];
    assert.equal(record.count, GATING_CONSTANTS.AUTO_WATCH_MAX_FAILURE_ROUNDS);
    assert.equal(record.circuitOpen, true, "reaching the failure limit must open the circuit");
    assert.match(networkSandbox.state.error, /熔断/);
    record.retryAt = 0;
    await playTo(networkSandbox, [7200, 7300]);
    assert.equal(networkSandbox.patchCalls, 3, "an open circuit must not retry");
  }

  // 5b) 5xx errors share the same bounded retry path.
  {
    const sandbox = createSandbox();
    sandbox.patchImpl = rejectWith(500);
    await crossThresholdNaturally(sandbox);
    assert.equal(sandbox.patchCalls, 1);
    const record = sandbox.state.autoWatchFailures["7:11:scope"];
    assert.equal(record.count, 1);
    await playTo(sandbox, [7300]);
    assert.equal(sandbox.patchCalls, 1, "5xx must cool down instead of storming");
  }

  // 6) A later success clears the failure state.
  {
    const sandbox = createSandbox();
    sandbox.patchImpl = rejectWith(0);
    await crossThresholdNaturally(sandbox);
    assert.equal(sandbox.state.autoWatchFailures["7:11:scope"].count, 1);
    sandbox.state.autoWatchFailures["7:11:scope"].retryAt = Date.now() - 1;
    sandbox.patchImpl = async () => {};
    await playTo(sandbox, [7200]);
    assert.equal(sandbox.patchCalls, 2);
    assert.equal(sandbox.state.autoWatchFailures["7:11:scope"], undefined, "success must clear the failure record");
    assert.equal(sandbox.state.autoWatchAuthBlocked, false);
    assert.equal(sandbox.state.error, "");
  }

  // 7) A new syncKey is not blocked by the previous episode's circuit.
  {
    networkSandbox.currentEpisode = { id: 12, sort: 2 };
    networkSandbox.patchImpl = async () => {};
    networkSandbox.api.resetAutoWatchObservationState();
    await crossThresholdNaturally(networkSandbox);
    assert.equal(networkSandbox.patchCalls, 4, "a new episode must not inherit the old episode's circuit");
    assert.equal(networkSandbox.state.autoWatchFailures["7:11:scope"].circuitOpen, true, "the old episode stays circuit-open");
    assert.equal(networkSandbox.state.autoEpisodeSyncLastKey, "7:12:scope");
  }

  // 8) Leaving the watch routes stops checks; returning resumes them.
  {
    const sandbox = createSandbox();
    await playTo(sandbox, [100]);
    sandbox.location = new URL("https://www.bilibili.com/");
    await playTo(sandbox, [7000, 7100, 7200]);
    assert.equal(sandbox.patchCalls, 0, "checks must stop outside /video/* and /bangumi/play/*");
    sandbox.location = new URL("https://www.bilibili.com/video/BV1TEST");
    await crossThresholdNaturally(sandbox);
    assert.equal(sandbox.patchCalls, 1, "checks must resume on a supported page");
  }

  // -------------------------------------------------------------------------
  // Seek safety (handleAutoWatchSeekEnd executed directly).
  // -------------------------------------------------------------------------

  function primeSeek(sandbox, start = 1000, end = 1300) {
    sandbox.video.duration = 1440;
    sandbox.state.autoWatchSeekStartTime = start;
    sandbox.state.autoWatchBlockedKey = "";
    sandbox.video.currentTime = end;
  }

  // Auto-progress disabled: seek bookkeeping is dropped and nothing is blocked.
  {
    const sandbox = createSandbox();
    sandbox.autoProgressDisabled = true;
    primeSeek(sandbox);
    sandbox.api.handleAutoWatchSeekEnd(sandbox.video);
    assert.equal(sandbox.state.autoWatchSeekStartTime, null);
    assert.equal(sandbox.state.autoWatchBlockedKey, "");
  }

  // Confirmed long-video mode: missing guess must return without blocking.
  {
    const sandbox = createSandbox();
    sandbox.longVideoMode = true;
    sandbox.seekGuess = null;
    primeSeek(sandbox);
    sandbox.api.handleAutoWatchSeekEnd(sandbox.video);
    assert.equal(sandbox.state.autoWatchBlockedKey, "", "missing guess must not block or mark");
  }

  // Confirmed long-video mode: a guess without an episode (prelude/outro) returns.
  {
    const sandbox = createSandbox();
    sandbox.longVideoMode = true;
    sandbox.seekGuess = { active: true, episode: null, autoMarkSafe: false };
    primeSeek(sandbox);
    sandbox.api.handleAutoWatchSeekEnd(sandbox.video);
    assert.equal(sandbox.state.autoWatchBlockedKey, "");
  }

  // Confirmed long-video mode: an unsafe guess must return.
  {
    const sandbox = createSandbox();
    sandbox.longVideoMode = true;
    sandbox.seekGuess = { active: true, episode: { id: 5 }, autoMarkSafe: false, episodeDuration: 1440, episodeElapsed: 1300 };
    primeSeek(sandbox);
    sandbox.api.handleAutoWatchSeekEnd(sandbox.video);
    assert.equal(sandbox.state.autoWatchBlockedKey, "", "unsafe guesses must never gate or trigger marks");
  }

  // Confirmed long-video mode with a safe guess: a large forward jump past the
  // threshold blocks the current syncKey.
  {
    const sandbox = createSandbox();
    sandbox.longVideoMode = true;
    sandbox.seekGuess = { active: true, episode: { id: 11 }, autoMarkSafe: true, episodeDuration: 1440, episodeElapsed: 1300 };
    primeSeek(sandbox);
    sandbox.api.handleAutoWatchSeekEnd(sandbox.video);
    assert.equal(sandbox.state.autoWatchBlockedKey, "7:11:scope", "large forward jumps past the threshold stay blocked");
  }

  // Normal video mode: the same jump blocks; a small jump does not.
  {
    const sandbox = createSandbox();
    primeSeek(sandbox);
    sandbox.api.handleAutoWatchSeekEnd(sandbox.video);
    assert.equal(sandbox.state.autoWatchBlockedKey, "7:11:scope");

    const smallJump = createSandbox();
    primeSeek(smallJump, 1200, 1300);
    smallJump.api.handleAutoWatchSeekEnd(smallJump.video);
    assert.equal(smallJump.state.autoWatchBlockedKey, "", "small seeks must not block");
  }

  console.log("auto-watch gating tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
