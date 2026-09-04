"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { repoRoot } = require("./_source");

const backgroundSource = fs.readFileSync(path.join(repoRoot, "extension", "background.js"), "utf8");
const pipTab = { id: 1, url: "https://www.bilibili.com/video/BV1234567890", active: false, lastAccessed: 20 };
const recentTab = { id: 2, url: "https://www.bilibili.com/video/BV2234567890", active: false, lastAccessed: 10 };

function createBackground(initialState = { lastActiveBilibiliTabId: recentTab.id }) {
  let storedState = { ...initialState };
  let failNextRead = false;
  const sentTargets = [];
  const event = () => ({ addListener() {} });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const storage = {
    get(key, callback) {
      if (failNextRead) {
        failNextRead = false;
        throw new Error("storage unavailable");
      }
      const snapshot = clone(storedState);
      queueMicrotask(() => callback({ [key]: snapshot }));
    },
    set(items, callback) {
      const nextState = clone(Object.values(items)[0]);
      queueMicrotask(() => {
        storedState = nextState;
        callback();
      });
    },
  };
  const sandbox = {
    URL,
    chrome: {
      runtime: { onMessage: event() },
      commands: { onCommand: event() },
      storage: { session: storage, local: storage },
      tabs: {
        onActivated: event(),
        onUpdated: event(),
        query(query, callback) {
          queueMicrotask(() => callback(query.active
            ? [{ id: 3, url: "https://example.org/", active: true }]
            : [pipTab, recentTab]));
        },
        get(id, callback) {
          queueMicrotask(() => callback([pipTab, recentTab].find((tab) => tab.id === id)));
        },
        sendMessage(id, _message, callback) {
          sentTargets.push(id);
          queueMicrotask(() => callback({ ok: true }));
        },
      },
    },
  };
  assert.match(backgroundSource, /\}\)\(\);\s*$/);
  vm.createContext(sandbox);
  // Evaluate the whole worker so queue initialization and event registration use
  // the production order, including the state restored after a worker restart.
  vm.runInContext(backgroundSource.replace(/\}\)\(\);\s*$/, `
    globalThis.api = { recordBilibiliTab, executeSkipCommand };
  })();`), sandbox);
  return {
    ...sandbox.api,
    sentTargets,
    getState: () => storedState,
    failNextRead: () => { failNextRead = true; },
  };
}

test("concurrent tab updates preserve PiP and an immediate command waits for them", async () => {
  const worker = createBackground();
  const entering = worker.recordBilibiliTab(pipTab, { pip: true, reason: "enterpictureinpicture" });
  const updating = worker.recordBilibiliTab(recentTab, { reason: "tab-updated" });
  const command = worker.executeSkipCommand();
  await Promise.all([entering, updating, command]);

  assert.equal(worker.getState().lastPiPTabId, pipTab.id);
  assert.equal(worker.getState().lastBilibiliTabId, recentTab.id);
  assert.deepEqual(worker.sentTargets, [pipTab.id]);
});

test("queued leave-PiP event clears PiP without a later tab update resurrecting it", async () => {
  const worker = createBackground();
  await Promise.all([
    worker.recordBilibiliTab(pipTab, { pip: true, reason: "enterpictureinpicture" }),
    worker.recordBilibiliTab(pipTab, { pip: false, reason: "leavepictureinpicture" }),
    worker.recordBilibiliTab(recentTab, { reason: "tab-updated" }),
  ]);
  await worker.executeSkipCommand();

  assert.equal(worker.getState().lastPiPTabId, null);
  assert.deepEqual(worker.sentTargets, [recentTab.id]);
});

test("a failed queued update does not prevent the next update or command", async () => {
  const worker = createBackground();
  worker.failNextRead();
  const failed = assert.rejects(
    worker.recordBilibiliTab(recentTab, { reason: "tab-updated" }),
    /storage unavailable/,
  );
  const next = worker.recordBilibiliTab(pipTab, { pip: true, reason: "enterpictureinpicture" });
  await Promise.all([failed, next, worker.executeSkipCommand()]);

  assert.equal(worker.getState().lastPiPTabId, pipTab.id);
  assert.deepEqual(worker.sentTargets, [pipTab.id]);
});

test("a newly initialized worker selects the persisted PiP tab", async () => {
  const worker = createBackground({ lastPiPTabId: pipTab.id, lastActiveBilibiliTabId: recentTab.id });
  await worker.executeSkipCommand();
  assert.deepEqual(worker.sentTargets, [pipTab.id]);
});
