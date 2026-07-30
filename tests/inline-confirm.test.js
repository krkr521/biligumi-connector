"use strict";

// Inline confirm dialog tests.
//
// window.confirm was replaced by an in-panel inline confirm row and an
// in-settings overlay card: requestInlineConfirm() parks a pending object on
// state.inlineConfirm and returns a promise; the shared click dispatcher
// resolves it through settleInlineConfirm(). These tests run the extracted
// production functions inside a node:vm sandbox with a tiny fake DOM and also
// pin that neither build calls window.confirm anymore.

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

// ---------------------------------------------------------------------------
// Source-level guards: window.confirm is gone, state slot and dispatch exist.
// ---------------------------------------------------------------------------

assert.ok(!/window\.confirm/.test(userscriptSource), "userscript must not call window.confirm anymore");
assert.ok(!/window\.confirm/.test(extensionSource), "extension must not call window.confirm anymore");

for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  assert.ok(source.includes("inlineConfirm: null,"), `${label} state must carry the inlineConfirm slot`);
  assert.ok(
    source.includes('if (action === "inline-confirm-accept") settleInlineConfirm(true);'),
    `${label} click dispatcher must settle accepts`,
  );
  assert.ok(
    source.includes('if (action === "inline-confirm-cancel") settleInlineConfirm(false);'),
    `${label} click dispatcher must settle cancels`,
  );
  assert.ok(
    source.includes('if (event.key === "Escape") {') && source.includes("!(settings && settings.contains(event.target))"),
    `${label} panel keydown must settle the pending panel confirm on Escape (even with focus on body)`,
  );
  assert.ok(
    extractFunction(source, "scheduleRouteRefresh").includes("settleInlineConfirm(false);"),
    `${label} scheduleRouteRefresh must settle pending confirms immediately`,
  );
  const bindBody = extractFunction(source, "bindSubject", { async: true });
  const guard = label === "userscript" ? "if (!isCurrentPageContext(context)) return;" : "if (!isRouteContextCurrent(routeContext)) return;";
  assert.ok(
    bindBody.includes(`${guard}\n      state.busy = false;`),
    `${label} collection bind cancel must not write the cancel message onto a new page`,
  );
  const unbindBody = extractFunction(source, "unbindSubject", { async: true });
  const captureLine = label === "userscript"
    ? "const context = { pageKey: state.pageKey, routeSeq: routeRefreshSeq };"
    : "const routeContext = captureRouteContext();";
  assert.ok(
    unbindBody.indexOf(captureLine) !== -1 && unbindBody.indexOf(captureLine) < unbindBody.indexOf("const ok = await requestInlineConfirm"),
    `${label} unbindSubject must capture the route context before the confirm`,
  );
  assert.ok(
    unbindBody.includes(`if (!ok || ${label === "userscript" ? "!isCurrentPageContext(context)" : "!isRouteContextCurrent(routeContext)"}) return;`),
    `${label} unbindSubject must re-validate the route context after the confirm`,
  );
}

// The confirm row must be reachable from every panel render path that can
// trigger it: the unbound search branch, the bound subject card (unbind), and
// the collapsed-panel header (which still exposes the unbind button).
for (const [label, source] of [["userscript", userscriptSource], ["extension", extensionSource]]) {
  const searchOrSubject = extractFunction(source, "renderSearchOrSubject");
  const slotCount = searchOrSubject.split("${renderInlineConfirm()}").length - 1;
  assert.equal(slotCount, 2, `${label} renderSearchOrSubject must mount the confirm row in both branches`);
  const renderBody = extractFunction(source, "render");
  assert.ok(
    renderBody.includes("${headerHtml}${renderInlineConfirm()}"),
    `${label} collapsed panel must still render the confirm row`,
  );
}

const { SETTINGS_ID, PANEL_ID } = extractConstants(userscriptSource, ["SETTINGS_ID", "PANEL_ID"]);

const CONFIRM_SOURCE = [
  extractFunction(userscriptSource, "escapeHtml"),
  extractFunction(userscriptSource, "requestInlineConfirm"),
  extractFunction(userscriptSource, "settleInlineConfirm"),
  extractFunction(userscriptSource, "focusInlineConfirmButton"),
  extractFunction(userscriptSource, "renderInlineConfirm"),
  extractFunction(userscriptSource, "renderSettingsInlineConfirm"),
  extractFunction(userscriptSource, "mountSettingsInlineConfirm"),
  extractFunction(userscriptSource, "removeSettingsInlineConfirm"),
].join("\n");

// ---------------------------------------------------------------------------
// Tiny fake DOM for the settings confirm bar.
// ---------------------------------------------------------------------------

function makeSettingsDom() {
  const dom = {
    overlay: null,
    appended: [],
  };
  dom.settings = {
    appendChild(node) {
      dom.appended.push(node);
      dom.overlay = node;
    },
    querySelector(selector) {
      if (selector === ".biligumi-settings-confirm-overlay") return dom.overlay;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return dom;
}

function createSandbox({ withSettings = false } = {}) {
  const dom = withSettings ? makeSettingsDom() : null;
  const sandbox = {
    SETTINGS_ID,
    PANEL_ID,
    state: { inlineConfirm: null },
    renders: 0,
    render() {
      sandbox.renders += 1;
    },
    document: {
      getElementById(id) {
        return id === SETTINGS_ID && dom ? dom.settings : null;
      },
      createElement(tag) {
        const el = {
          tagName: String(tag).toUpperCase(),
          className: "",
          dataset: {},
          innerHTML: "",
          removed: false,
          remove() {
            this.removed = true;
            if (dom && dom.overlay === el) dom.overlay = null;
          },
        };
        return el;
      },
    },
  };
  runInSandbox(
    `${CONFIRM_SOURCE}\n;globalThis.api = { requestInlineConfirm, settleInlineConfirm, renderInlineConfirm, renderSettingsInlineConfirm, mountSettingsInlineConfirm, removeSettingsInlineConfirm };`,
    sandbox,
  );
  return { sandbox, dom };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
  // 1) A panel request parks the pending object and re-renders once.
  {
    const { sandbox } = createSandbox();
    const promise = sandbox.api.requestInlineConfirm({ message: "确定解绑吗？", danger: true });
    const pending = sandbox.state.inlineConfirm;
    assert.ok(pending, "request must write the pending object to state");
    assert.equal(pending.message, "确定解绑吗？");
    assert.equal(pending.context, "panel", "context defaults to panel");
    assert.equal(pending.confirmLabel, "确定", "default confirm label");
    assert.equal(pending.cancelLabel, "取消", "default cancel label");
    assert.equal(pending.danger, true);
    assert.equal(typeof pending.resolve, "function");
    assert.equal(sandbox.renders, 1, "panel context triggers one render");

    sandbox.api.settleInlineConfirm(true);
    assert.equal(await promise, true, "accept resolves the request promise with true");
    assert.equal(sandbox.state.inlineConfirm, null, "settle clears the pending object");
    assert.equal(sandbox.renders, 2, "panel settle re-renders");
  }

  // 2) Cancel resolves with false.
  {
    const { sandbox } = createSandbox();
    const promise = sandbox.api.requestInlineConfirm({ message: "继续吗？" });
    sandbox.api.settleInlineConfirm(false);
    assert.equal(await promise, false, "cancel resolves the request promise with false");
  }

  // 3) settleInlineConfirm with no pending is a no-op.
  {
    const { sandbox } = createSandbox();
    sandbox.api.settleInlineConfirm(true);
    sandbox.api.settleInlineConfirm(false);
    assert.equal(sandbox.renders, 0, "empty settle must not render");
    assert.equal(sandbox.state.inlineConfirm, null);
  }

  // 4) A second request supersedes the first, resolving it with false.
  {
    const { sandbox } = createSandbox();
    const first = sandbox.api.requestInlineConfirm({ message: "第一条" });
    const second = sandbox.api.requestInlineConfirm({ message: "第二条" });
    assert.equal(await first, false, "the superseded request resolves false");
    assert.equal(sandbox.state.inlineConfirm.message, "第二条", "the newer pending wins");
    sandbox.api.settleInlineConfirm(true);
    assert.equal(await second, true);
  }

  // 5) renderInlineConfirm escapes HTML and picks the button class by danger.
  {
    const { sandbox } = createSandbox();
    assert.equal(sandbox.api.renderInlineConfirm(), "", "no pending renders an empty string");
    sandbox.state.inlineConfirm = {
      message: "删除 <b>标签</b>？\n第二行",
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
      context: "panel",
      resolve() {},
    };
    const html = sandbox.api.renderInlineConfirm();
    assert.ok(html.includes("biligumi-row biligumi-inline-confirm"), "row wrapper");
    assert.ok(html.includes("删除 &lt;b&gt;标签&lt;/b&gt;？"), "message must be HTML-escaped");
    assert.ok(!html.includes("<b>标签</b>"), "raw markup must not leak into the row");
    assert.ok(html.includes('class="biligumi-button danger"'), "danger pending renders a danger button");
    assert.ok(html.includes('data-action="inline-confirm-accept"'), "accept button action");
    assert.ok(html.includes('data-action="inline-confirm-cancel"'), "cancel button action");
    assert.ok(html.includes(">删除</button>"), "custom confirm label");
    assert.ok(html.includes(">取消</button>"), "custom cancel label");

    sandbox.state.inlineConfirm.danger = false;
    assert.ok(
      sandbox.api.renderInlineConfirm().includes('class="biligumi-button primary"'),
      "non-danger pending renders a primary button",
    );

    sandbox.state.inlineConfirm.context = "settings";
    assert.equal(sandbox.api.renderInlineConfirm(), "", "settings pending is not rendered into the panel");
  }

  // 6) Settings context mounts an overlay card instead of re-rendering the panel.
  {
    const { sandbox, dom } = createSandbox({ withSettings: true });
    const promise = sandbox.api.requestInlineConfirm({
      context: "settings",
      danger: true,
      confirmLabel: "恢复默认",
      message: "将界面相关设置恢复为默认值？\nAccess Token 与白名单不会被清除。",
    });
    assert.equal(sandbox.renders, 0, "settings context must not re-render the panel");
    assert.equal(sandbox.state.inlineConfirm.context, "settings");
    const overlay = dom.overlay;
    assert.ok(overlay, "the confirm overlay is appended to the settings wrapper");
    assert.equal(overlay.className, "biligumi-settings-confirm-overlay");
    assert.equal(overlay.dataset.action, "inline-confirm-cancel", "backdrop click cancels the confirm");
    assert.equal(dom.appended.length, 1);
    assert.ok(overlay.innerHTML.includes("biligumi-settings-confirm-card"), "overlay carries the centered card");
    assert.ok(overlay.innerHTML.includes('data-action="noop"'), "card itself must not trigger the backdrop action");
    assert.ok(overlay.innerHTML.includes("将界面相关设置恢复为默认值？"), "card carries the message");
    assert.ok(overlay.innerHTML.includes('data-action="inline-confirm-accept"'), "card carries the accept button");
    assert.ok(overlay.innerHTML.includes('class="biligumi-button danger"'), "danger styling inside the settings card");

    // Re-mounting replaces the overlay instead of stacking a second one.
    sandbox.api.mountSettingsInlineConfirm();
    assert.equal(dom.appended.length, 2, "re-mount appends a fresh overlay");
    assert.ok(overlay.removed, "re-mount removes the previous overlay first");
    assert.notEqual(dom.overlay, overlay);

    sandbox.api.settleInlineConfirm(true);
    assert.equal(await promise, true);
    assert.equal(dom.overlay, null, "settle removes the settings overlay");
    assert.equal(sandbox.renders, 0, "settings settle never touches panel render");
  }

  // 7) A queued settings confirm auto-cancels if the dialog was closed before
  // the request executes. This keeps extension persistence queues from parking
  // forever on an invisible, unreachable confirmation.
  {
    const { sandbox } = createSandbox();
    assert.doesNotThrow(() => sandbox.api.mountSettingsInlineConfirm(), "mount without dialog is a no-op");
    assert.doesNotThrow(() => sandbox.api.removeSettingsInlineConfirm(), "remove without dialog is a no-op");
    const promise = sandbox.api.requestInlineConfirm({ context: "settings", message: "x" });
    assert.equal(await promise, false);
    assert.equal(sandbox.state.inlineConfirm, null, "a missing settings dialog must not leave an unreachable pending request");
  }

  // 8) renderSettingsInlineConfirm mirrors the pending state.
  {
    const { sandbox } = createSandbox();
    assert.equal(sandbox.api.renderSettingsInlineConfirm(), "", "no pending renders an empty string");
    sandbox.state.inlineConfirm = {
      message: "确定删除白名单「test」吗？",
      confirmLabel: "确定",
      cancelLabel: "取消",
      danger: true,
      context: "settings",
      resolve() {},
    };
    const html = sandbox.api.renderSettingsInlineConfirm();
    assert.ok(html.includes("biligumi-settings-confirm-card"), "settings overlay card node");
    assert.ok(html.includes("biligumi-settings-confirm-text"), "settings card message node");
    assert.ok(html.includes("确定删除白名单「test」吗？"), "settings card carries the message");
    assert.ok(html.includes('data-action="inline-confirm-accept"'));
    assert.ok(html.includes('data-action="inline-confirm-cancel"'));

    sandbox.state.inlineConfirm.context = "panel";
    assert.equal(sandbox.api.renderSettingsInlineConfirm(), "", "panel pending is not rendered into the settings bar");
  }

  // 9) Backdrop cancel requires a complete click (down AND up on the backdrop).
  {
    const MODAL_SOURCE = [
      extractFunction(userscriptSource, "isModalBackdropTarget"),
      extractFunction(userscriptSource, "handleModalPointerDown"),
      extractFunction(userscriptSource, "handleModalPointerUp"),
      extractFunction(userscriptSource, "shouldHandleModalAction"),
    ].join("\n");
    const overlay = { classList: { contains: (name) => name === "biligumi-settings-confirm-overlay" } };
    const card = { classList: { contains: () => false } };
    const wrapper = { dataset: {} };
    const sandbox = { wrapper };
    runInSandbox(
      `${MODAL_SOURCE}\n;globalThis.api = { handleModalPointerDown, handleModalPointerUp, shouldHandleModalAction };`,
      sandbox,
    );
    const { api } = sandbox;
    const pointer = (target) => ({ currentTarget: wrapper, target });

    // Full click on the confirm overlay backdrop cancels.
    api.handleModalPointerDown(pointer(overlay));
    api.handleModalPointerUp(pointer(overlay));
    assert.equal(
      api.shouldHandleModalAction({ target: overlay }, wrapper, overlay, "inline-confirm-cancel"),
      true,
      "down+up on the overlay is a complete backdrop click",
    );

    // Press starts inside the card, release lands on the backdrop: not a cancel.
    api.handleModalPointerDown(pointer(card));
    api.handleModalPointerUp(pointer(overlay));
    assert.equal(
      api.shouldHandleModalAction({ target: overlay }, wrapper, overlay, "inline-confirm-cancel"),
      false,
      "down inside the card + up on the backdrop must not cancel",
    );

    // Release inside the card: click resolves to the card, not the backdrop.
    api.handleModalPointerDown(pointer(overlay));
    api.handleModalPointerUp(pointer(card));
    assert.equal(
      api.shouldHandleModalAction({ target: card }, wrapper, card, "noop"),
      true,
      "non-backdrop actions pass through untouched",
    );

    // The cancel button keeps working with any plain click.
    assert.equal(
      api.shouldHandleModalAction({ target: card }, wrapper, card, "inline-confirm-cancel"),
      true,
      "button clicks are not gated by the backdrop rule",
    );

    // Settings modal backdrop keeps its original complete-click behavior.
    api.handleModalPointerDown(pointer(wrapper));
    api.handleModalPointerUp(pointer(wrapper));
    assert.equal(
      api.shouldHandleModalAction({ target: wrapper }, wrapper, wrapper, "settings-cancel"),
      true,
      "settings backdrop full click still closes",
    );
    api.handleModalPointerDown(pointer(card));
    api.handleModalPointerUp(pointer(wrapper));
    assert.equal(
      api.shouldHandleModalAction({ target: wrapper }, wrapper, wrapper, "settings-cancel"),
      false,
      "settings backdrop drag-out still does not close",
    );
  }

  // 10) Escape settles a pending panel confirm even after re-render drops focus to body.
  {
    const KEY_SOURCE = [
      extractFunction(userscriptSource, "settleInlineConfirm"),
      extractFunction(userscriptSource, "removeSettingsInlineConfirm"),
      extractFunction(userscriptSource, "handlePanelKeydown"),
    ].join("\n");
    const makeKeySandbox = (settingsNode) => {
      const sandbox = {
        SETTINGS_ID,
        state: { inlineConfirm: { message: "x", context: "panel", resolve() {} } },
        renders: 0,
        render() { sandbox.renders += 1; },
        document: { getElementById: () => settingsNode || null },
      };
      runInSandbox(`${KEY_SOURCE}\n;globalThis.api = { handlePanelKeydown };`, sandbox);
      return sandbox;
    };
    const makeEvent = (target) => ({
      isTrusted: true,
      key: "Escape",
      target,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    });

    // Focus sits on document.body (the trigger button was replaced by render()).
    const sandbox = makeKeySandbox(null);
    const event = makeEvent({ note: "body" });
    sandbox.api.handlePanelKeydown(event);
    assert.equal(sandbox.state.inlineConfirm, null, "Escape on body still settles the pending panel confirm");
    assert.equal(sandbox.renders, 1, "settle re-renders the panel");
    assert.ok(event.defaultPrevented && event.propagationStopped, "the Escape is consumed");

    // Focus inside the settings modal: the modal's own keydown handles Escape.
    const modalSandbox = makeKeySandbox({ contains: () => true });
    modalSandbox.api.handlePanelKeydown(makeEvent({ note: "inside settings" }));
    assert.ok(modalSandbox.state.inlineConfirm, "Escape inside the settings modal must not touch the panel confirm");
    assert.equal(modalSandbox.renders, 0);
  }

  // 11) focusInlineConfirmButton focuses cancel for danger, accept otherwise.
  {
    const FOCUS_SOURCE = extractFunction(userscriptSource, "focusInlineConfirmButton");
    const makeFocusSandbox = (pending) => {
      const cancel = { focusCount: 0, focus() { this.focusCount += 1; } };
      const accept = { focusCount: 0, focus() { this.focusCount += 1; } };
      const sandbox = {
        SETTINGS_ID,
        PANEL_ID,
        state: { inlineConfirm: pending },
        cancel,
        accept,
        document: {
          getElementById: () => ({ querySelectorAll: () => [cancel, accept] }),
        },
      };
      runInSandbox(`${FOCUS_SOURCE}\n;globalThis.api = { focusInlineConfirmButton };`, sandbox);
      return sandbox;
    };

    const dangerSandbox = makeFocusSandbox({ context: "panel", danger: true });
    dangerSandbox.api.focusInlineConfirmButton();
    assert.equal(dangerSandbox.cancel.focusCount, 1, "danger confirm focuses cancel by default");
    assert.equal(dangerSandbox.accept.focusCount, 0);

    const primarySandbox = makeFocusSandbox({ context: "settings", danger: false });
    primarySandbox.api.focusInlineConfirmButton();
    assert.equal(primarySandbox.accept.focusCount, 1, "non-danger confirm focuses accept");
    assert.equal(primarySandbox.cancel.focusCount, 0);

    const idleSandbox = makeFocusSandbox(null);
    assert.doesNotThrow(() => idleSandbox.api.focusInlineConfirmButton(), "no pending is a no-op");
  }

  console.log("inline confirm tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
