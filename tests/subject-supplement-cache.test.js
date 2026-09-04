"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { USERSCRIPT_PATH, EXTENSION_PATH, readSource, extractFunction } = require("./_source");

function createSupplementLoader(sourcePath, parse = (html) => ({
  links: { official: html }, rows: [{ key: "website", value: html }], actorRelations: {},
})) {
  const requests = [];
  const sandbox = {
    state: { subjectInfoPanelEnabled: true },
    subjectInfoLinkCache: new Map(),
    subjectInfoLinkRequests: new Map(),
    parseSubjectInfoSupplement: parse,
    bgmWebRequest(url) {
      return new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(readSource(sourcePath), "loadSubjectInfoSupplement", { async: true })
    + "\n;globalThis.load = loadSubjectInfoSupplement;", sandbox);
  return { ...sandbox, requests };
}

for (const [label, sourcePath] of [["userscript", USERSCRIPT_PATH], ["extension", EXTENSION_PATH]]) {
  test(`${label}: failed concurrent loads can retry and successful data remains cached`, async () => {
    const loader = createSupplementLoader(sourcePath);
    const failedLoads = [loader.load(1), loader.load(1)];
    assert.equal(loader.requests.length, 1, "concurrent loads should share the network request");
    loader.requests[0].reject(new Error("temporary network timeout"));
    for (const result of await Promise.all(failedLoads)) {
      assert.deepEqual(JSON.parse(JSON.stringify(result)), { links: {}, rows: [], actorRelations: {} });
    }
    assert.equal(loader.subjectInfoLinkRequests.size, 0);
    assert.equal(loader.subjectInfoLinkCache.has("1"), false, "a failed request must not become a permanent empty cache entry");

    const recoveredLoads = [loader.load(1), loader.load(1)];
    assert.equal(loader.requests.length, 2, "network recovery must permit a new shared request");
    loader.requests[1].resolve("https://example.org/recovered");
    const [recovered, sibling] = await Promise.all(recoveredLoads);
    assert.equal(recovered.links.official, "https://example.org/recovered");
    assert.equal(sibling, recovered);
    assert.equal(loader.subjectInfoLinkRequests.size, 0);
    assert.equal(await loader.load(1), recovered);
    assert.equal(loader.requests.length, 2, "successful data should still be cached");
  });

  test(`${label}: parser failures are retryable but valid empty data can be cached`, async () => {
    const loader = createSupplementLoader(sourcePath, (html) => {
      if (html === "invalid") throw new Error("parse failed");
      return { links: {}, rows: [], actorRelations: {} };
    });
    const failed = loader.load(1);
    loader.requests[0].resolve("invalid");
    await failed;
    assert.equal(loader.subjectInfoLinkCache.has("1"), false);

    const valid = loader.load(1);
    loader.requests[1].resolve("valid empty subject");
    const empty = await valid;
    assert.equal(loader.subjectInfoLinkCache.get("1"), empty);
    assert.equal(await loader.load(1), empty);
    assert.equal(loader.requests.length, 2);
  });
}
