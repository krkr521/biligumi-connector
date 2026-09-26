"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { repoRoot } = require("./_source");

const source = fs.readFileSync(path.join(repoRoot, "extension", "background.js"), "utf8");
const pendingKey = "biligumi.extensionUpdatePendingTabs";
const videoA = "https://www.bilibili.com/video/BV1111111111";
const videoB = "https://www.bilibili.com/video/BV2222222222";

function createWorker({
  store = {},
  tabs = [
    { id: 1, windowId: 10, url: videoA, active: false, status: "complete" },
    { id: 2, windowId: 11, url: videoB, active: false, status: "complete" },
  ],
  version = "0.3.27",
  now = 1_700_000_000_000,
} = {}) {
  const listeners = {};
  const reloaded = [];
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const event = (name) => ({ addListener(listener) { listeners[name] = listener; } });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const area = {
    get(key, callback) {
      queueMicrotask(() => callback({ [key]: Object.hasOwn(store, key) ? clone(store[key]) : undefined }));
    },
    set(items, callback) {
      queueMicrotask(() => {
        for (const [key, value] of Object.entries(items)) store[key] = clone(value);
        callback();
      });
    },
    remove(key, callback) {
      queueMicrotask(() => {
        delete store[key];
        callback();
      });
    },
  };
  const sandbox = {
    URL,
    Date: class extends Date { static now() { return now; } },
    chrome: {
      runtime: {
        onMessage: event("message"),
        onInstalled: event("installed"),
        onStartup: event("startup"),
        getManifest: () => ({ version }),
      },
      commands: { onCommand: event("command") },
      storage: { local: area, session: area },
      tabs: {
        onActivated: event("activated"),
        onUpdated: event("updated"),
        onRemoved: event("removed"),
        query(query, callback) {
          queueMicrotask(() => callback(Array.from(tabMap.values()).filter((tab) => {
            if (query.url) return /^https:\/\/www\.bilibili\.com\/(?:video|bangumi\/play)\//.test(tab.url);
            if (query.active && query.windowId !== undefined) return tab.active && tab.windowId === query.windowId;
            return query.active ? tab.active : true;
          })));
        },
        get(tabId, callback) { queueMicrotask(() => callback(tabMap.get(tabId))); },
        reload(tabId, callback) {
          reloaded.push(tabId);
          queueMicrotask(callback);
        },
      },
      windows: { WINDOW_ID_NONE: -1, onFocusChanged: event("focused") },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.waitForPendingUpdate = () => pendingUpdateQueue;
  })();`), sandbox);
  return {
    store,
    tabMap,
    reloaded,
    emit: listeners,
    wait: () => sandbox.waitForPendingUpdate(),
    setNow: (value) => { now = value; },
  };
}

test("first upgrade marks all existing Bilibili tabs and reloads each only on return", async () => {
  const worker = createWorker({
    tabs: [
      { id: 1, windowId: 10, url: videoA, active: false, status: "complete" },
      { id: 2, windowId: 11, url: videoB, active: true, status: "complete" },
      { id: 3, windowId: 11, url: "https://www.bilibili.com/", active: false, status: "complete" },
      { id: 4, windowId: 11, url: videoA, active: false, status: "loading" },
      { id: 5, windowId: 11, url: videoA, active: false, status: "complete", discarded: true },
    ],
  });
  worker.emit.installed({ reason: "update", previousVersion: "0.3.26" });
  await worker.wait();
  assert.deepEqual(worker.store[pendingKey].tabs.map((tab) => tab.id), [1, 2]);
  assert.equal(worker.store[pendingKey].oldVersion, "0.3.26");
  assert.equal(worker.store[pendingKey].newVersion, "0.3.27");
  assert.deepEqual(worker.reloaded, [], "upgrade must not interrupt the active video");

  worker.tabMap.get(1).active = true;
  worker.emit.activated({ tabId: 1, windowId: 10 });
  worker.emit.focused(10);
  await worker.wait();
  assert.deepEqual(worker.reloaded, [1], "activation and focus must not reload twice");
  assert.deepEqual(worker.store[pendingKey].tabs.map((tab) => tab.id), [2]);

  worker.emit.focused(11);
  await worker.wait();
  assert.deepEqual(worker.reloaded, [1, 2]);
  assert.equal(worker.store[pendingKey], undefined);
});

test("pending tabs survive MV3 worker suspension; ordinary switches before a real upgrade do nothing", async () => {
  const store = {};
  const tabs = [{ id: 7, windowId: 9, url: videoA, active: true, status: "complete" }];
  const first = createWorker({ store, tabs });
  first.emit.activated({ tabId: 7, windowId: 9 });
  first.emit.installed({ reason: "update", previousVersion: "0.3.27" });
  await first.wait();
  assert.deepEqual(first.reloaded, []);
  assert.equal(store[pendingKey], undefined);

  first.emit.installed({ reason: "update", previousVersion: "0.3.26" });
  await first.wait();
  const resumed = createWorker({ store, tabs });
  resumed.emit.activated({ tabId: 7, windowId: 9 });
  await resumed.wait();
  assert.deepEqual(resumed.reloaded, [7]);
  assert.equal(store[pendingKey], undefined);
});

test("SPA URL changes retain the marker, while natural reloads and tab closure clear it", async () => {
  const worker = createWorker();
  worker.emit.installed({ reason: "update", previousVersion: "0.3.26" });
  await worker.wait();

  const tabA = worker.tabMap.get(1);
  tabA.url = `${videoA}?p=2`;
  worker.emit.updated(1, { url: tabA.url }, tabA);
  await worker.wait();
  assert.deepEqual(worker.store[pendingKey].tabs.map((tab) => tab.id), [1, 2]);

  worker.emit.updated(1, { status: "loading" }, { ...tabA, status: "loading" });
  await worker.wait();
  assert.deepEqual(worker.store[pendingKey].tabs.map((tab) => tab.id), [2]);
  tabA.active = true;
  worker.emit.activated({ tabId: 1, windowId: 10 });
  await worker.wait();
  assert.deepEqual(worker.reloaded, []);

  worker.tabMap.delete(2);
  worker.emit.removed(2);
  await worker.wait();
  assert.equal(worker.store[pendingKey], undefined);
});

test("browser restart, expiry, and version mismatch fail closed", async () => {
  const worker = createWorker();
  worker.emit.installed({ reason: "update", previousVersion: "0.3.26" });
  await worker.wait();
  worker.emit.startup();
  await worker.wait();
  worker.tabMap.get(1).active = true;
  worker.emit.activated({ tabId: 1, windowId: 10 });
  await worker.wait();
  assert.deepEqual(worker.reloaded, []);

  worker.emit.installed({ reason: "update", previousVersion: "0.3.26" });
  await worker.wait();
  worker.setNow(1_700_000_000_000 + 24 * 60 * 60 * 1000 + 1);
  worker.emit.activated({ tabId: 1, windowId: 10 });
  await worker.wait();
  assert.deepEqual(worker.reloaded, []);
  assert.equal(worker.store[pendingKey], undefined);

  worker.store[pendingKey] = {
    oldVersion: "0.3.26",
    newVersion: "0.3.28",
    createdAt: 1_700_000_000_000 + 24 * 60 * 60 * 1000 + 1,
    tabs: [{ id: 1, url: videoA }],
  };
  worker.emit.activated({ tabId: 1, windowId: 10 });
  await worker.wait();
  assert.deepEqual(worker.reloaded, []);
  assert.equal(worker.store[pendingKey], undefined);
});
