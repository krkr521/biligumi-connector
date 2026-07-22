"use strict";

// Userscript/extension drift guards for the long-video binding flow.
// - Functions without adapter usage must stay byte-identical.
// - Functions touching the extension-only route/storage adapters are compared
//   after explicit canonicalization; the raw sources are also asserted to be
//   different, so a lost adapter cannot hide behind the normalization.

const assert = require("node:assert/strict");

const {
  USERSCRIPT_PATH,
  EXTENSION_PATH,
  readSource,
  extractFunction,
  canonicalizeAdapterSyntax,
  runInSandbox,
} = require("./_source");

const userscriptSource = readSource(USERSCRIPT_PATH);
const extensionSource = readSource(EXTENSION_PATH);

// No route/storage adapter usage: must be byte-identical across both builds.
const IDENTICAL_FUNCTIONS = [
  "renderLongVideoBindingPrompt",
  "resolveLongVideoBindingSubject",
  "buildLongVideoBindingPromptState",
  "showLongVideoBindingPrompt",
  "clearLongVideoBindingPrompt",
  "cancelLongVideoBindingPrompt",
  "stopLongVideoBindingWaitLoop",
  "getLongVideoIdentifyDismissKey",
];
for (const name of IDENTICAL_FUNCTIONS) {
  const userscriptBlock = extractFunction(userscriptSource, name);
  const extensionBlock = extractFunction(extensionSource, name);
  assert.equal(extensionBlock, userscriptBlock, `${name} must stay identical between userscript and extension`);
}

// Adapter-touching functions: normalize the intentional extension adapters,
// then require full equality.
const ADAPTER_FUNCTIONS = [
  ["requestBindSubject", { async: true }],
  ["applyLongVideoAutoAccept", { async: true }],
  ["beginLongVideoBindingWait"],
  ["retryLongVideoBindingWait"],
  ["resolveLongVideoBindingPrompt", { async: true }],
  ["bindSubject", { async: true }],
  ["unbindSubject", { async: true }],
  ["maybeOfferLongVideoAutoIdentify"],
];
for (const [name, options] of ADAPTER_FUNCTIONS) {
  const userscriptBlock = extractFunction(userscriptSource, name, options);
  const extensionBlock = extractFunction(extensionSource, name, options);
  assert.match(userscriptBlock, /capturePageContext|isCurrentPageContext/, `${name}: userscript must keep its route guard`);
  assert.match(extensionBlock, /captureRouteContext|isRouteContextCurrent|ensureRouteContext/, `${name}: extension must keep its route guard`);
  assert.notEqual(extensionBlock, userscriptBlock, `${name}: raw sources are expected to differ by adapters only`);
  assert.equal(
    canonicalizeAdapterSyntax(extensionBlock),
    canonicalizeAdapterSyntax(userscriptBlock),
    `${name}: adapter-normalized sources must match between userscript and extension`,
  );
}

// Canonicalizer self-checks: it must only collapse the known adapters.
assert.equal(canonicalizeAdapterSyntax("captureRouteContext()"), canonicalizeAdapterSyntax("capturePageContext()"));
assert.equal(canonicalizeAdapterSyntax("isRouteContextCurrent(x)"), canonicalizeAdapterSyntax("isCurrentPageContext(x)"));
assert.equal(
  canonicalizeAdapterSyntax("{ pageKey: state.pageKey, routeSeq: routeRefreshSeq }"),
  "__ROUTE_CTX__()",
);
assert.equal(
  canonicalizeAdapterSyntax('ensureRouteContext(routeContext, "页面已切换");'),
  "if (!__IS_ROUTE_CTX_CURRENT__(__ctx)) return;",
);
assert.equal(
  canonicalizeAdapterSyntax("updateStoredBindings(fn)"),
  canonicalizeAdapterSyntax("updateBindings(fn)"),
);
const canonicalSelfCheck = "state.collection = null; render();";
assert.equal(canonicalizeAdapterSyntax(canonicalSelfCheck), canonicalSelfCheck, "canonicalizer must leave unrelated code untouched");

// ---------------------------------------------------------------------------
// Extension route adapter: independent behavioral test.
// ---------------------------------------------------------------------------

const routeAdapterSource = [
  extractFunction(extensionSource, "captureRouteContext"),
  extractFunction(extensionSource, "isRouteContextCurrent"),
  extractFunction(extensionSource, "ensureRouteContext"),
].join("\n");
const routeSandbox = {
  state: { pageKey: "page-1" },
  location: { href: "https://www.bilibili.com/video/BV1TEST" },
  routeRefreshSeq: 7,
};
runInSandbox(`${routeAdapterSource}\n;globalThis.adapter = { captureRouteContext, isRouteContextCurrent, ensureRouteContext };`, routeSandbox);

const captured = routeSandbox.adapter.captureRouteContext();
assert.equal(captured.href, "https://www.bilibili.com/video/BV1TEST");
assert.equal(captured.pageKey, "page-1");
assert.equal(captured.routeSeq, 7);
assert.equal(routeSandbox.adapter.isRouteContextCurrent(captured), true);
assert.equal(routeSandbox.adapter.isRouteContextCurrent({ ...captured, href: "https://www.bilibili.com/video/BV2OTHER" }), false, "href change invalidates the context");
assert.equal(routeSandbox.adapter.isRouteContextCurrent({ ...captured, pageKey: "page-2" }), false, "pageKey change invalidates the context");
assert.equal(routeSandbox.adapter.isRouteContextCurrent({ ...captured, routeSeq: 8 }), false, "routeSeq change invalidates the context");
assert.equal(routeSandbox.adapter.isRouteContextCurrent(null), false);
routeSandbox.adapter.ensureRouteContext(captured, "unused");
assert.throws(
  () => routeSandbox.adapter.ensureRouteContext({ ...captured, routeSeq: 9 }, "页面已切换，已取消绑定"),
  /页面已切换，已取消绑定/,
  "stale contexts must abort the pending write",
);

// ---------------------------------------------------------------------------
// Extension storage adapter: structural assertions (it intentionally differs
// from the userscript GM_* storage path and must not be "unified" by mistake).
// ---------------------------------------------------------------------------

const extUpdateBindings = extractFunction(extensionSource, "updateBindings", { async: true });
assert.ok(extUpdateBindings.includes("withBindingsLock("), "extension updateBindings must take the bindings lock");
assert.ok(extUpdateBindings.includes("readJsonValueFresh("), "extension updateBindings must fresh-read inside the lock");
assert.ok(!extractFunction(extensionSource, "bindSubject", { async: true }).includes("updateStoredBindings("), "extension bindSubject must go through the fresh-read adapter");
assert.ok(extractFunction(userscriptSource, "bindSubject", { async: true }).includes("updateStoredBindings("), "userscript bindSubject keeps the GM_* storage adapter");

console.log("extension drift guard tests passed");
