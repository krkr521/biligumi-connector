(() => {
  "use strict";

  const COMMAND_SKIP_OPED = "skip-oped";
  const MSG_PAGE_STATE = "biligumi-oped-page-state";
  const MSG_EXECUTE_SKIP = "biligumi-oped-execute-skip";
  const MSG_HTTP_REQUEST = "biligumi-http-request";
  const MSG_OPEN_DELETE_BRIDGE = "biligumi-open-delete-bridge";
  const MSG_FOCUS_DELETE_BRIDGE = "biligumi-focus-delete-bridge";
  const MSG_CLOSE_DELETE_BRIDGE = "biligumi-close-delete-bridge";
  const MSG_READ_PAGE_STATE = "biligumi-read-page-state-v1";
  const MSG_CHECK_EXTENSION_UPDATE = "biligumi-check-extension-update";
  const MSG_OPEN_EXTENSION_UPDATE = "biligumi-open-extension-update";
  const RUNTIME_STATE_KEY = "__biligumiOpedRuntimeState";
  const EXTENSION_UPDATE_CACHE_KEY = "biligumi.extensionUpdateCache";
  const EXTENSION_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const EXTENSION_UPDATE_TIMEOUT_MS = 4000;
  const EXTENSION_UPDATE_MAX_RESPONSE_BYTES = 64 * 1024;
  const EXTENSION_UPDATE_SOURCES = Object.freeze([
    Object.freeze({
      id: "github",
      label: "GitHub",
      manifestUrl: "https://raw.githubusercontent.com/krkr521/biligumi-connector/master/extension/manifest.json",
      pageUrl: "https://github.com/krkr521/biligumi-connector",
    }),
    Object.freeze({
      id: "gitcode",
      label: "GitCode",
      branchUrl: "https://api.gitcode.com/api/v5/repos/krkr521/biligumi-connector/branches/master",
      rawUrl: "https://api.gitcode.com/api/v5/repos/krkr521/biligumi-connector/raw/extension/manifest.json",
      pageUrl: "https://gitcode.com/krkr521/biligumi-connector",
    }),
  ]);
  const BILIBILI_URL_PATTERNS = [
    "https://www.bilibili.com/video/*",
    "https://www.bilibili.com/bangumi/play/*",
  ];
  let runtimeStateUpdateQueue = Promise.resolve();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === MSG_OPEN_DELETE_BRIDGE) {
      openDeleteBridgeTab(message.url, message.active, sender).then(
        (tab) => sendResponse({ ok: true, tabId: tab && tab.id }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
      );
      return true;
    }

    if (message && message.type === MSG_FOCUS_DELETE_BRIDGE) {
      focusDeleteBridgeTab(sender, message.tabId).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
      );
      return true;
    }

    if (message && message.type === MSG_CLOSE_DELETE_BRIDGE) {
      closeDeleteBridgeTab(sender, message.tabId).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
      );
      return true;
    }

    if (message && message.type === MSG_READ_PAGE_STATE) {
      readBilibiliPublicPageState(sender).then(
        (state) => sendResponse({ ok: true, state }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
      );
      return true;
    }

    if (message && message.type === MSG_CHECK_EXTENSION_UPDATE) {
      if (!isAllowedExtensionUpdateSender(sender)) {
        sendResponse({ ok: false, error: "Blocked extension update sender" });
        return false;
      }
      checkExtensionUpdate(Boolean(message.force)).then(
        (update) => sendResponse({ ok: true, update }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
      );
      return true;
    }

    if (message && message.type === MSG_OPEN_EXTENSION_UPDATE) {
      if (!isAllowedExtensionUpdateSender(sender)) {
        sendResponse({ ok: false, error: "Blocked extension update sender" });
        return false;
      }
      openExtensionUpdatePage(message.sourceId).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
      );
      return true;
    }

    if (message && message.type === MSG_HTTP_REQUEST) {
      handleHttpRequest(message.request, sender).then(
        (response) => sendResponse({ ok: true, response }),
        (error) => sendResponse({
          ok: false,
          error: String(error && error.message || error),
          errorKind: String(error && error.errorKind || "network"),
        }),
      );
      return true;
    }

    if (!message || message.type !== MSG_PAGE_STATE || !sender.tab || !sender.tab.id) return false;
    recordBilibiliTab(sender.tab, message).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
    );
    return true;
  });

  async function openDeleteBridgeTab(url, active, sender) {
    if (!isDeleteBridgeUrl(url)) throw new Error("Blocked delete bridge URL");
    if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) || !isBilibiliVideoUrl(sender.tab.url)) {
      throw new Error("Blocked delete bridge sender");
    }
    const createProperties = { url, active: Boolean(active) };
    createProperties.openerTabId = sender.tab.id;
    return tabsCreate(createProperties);
  }

  async function focusDeleteBridgeTab(sender, requestedTabId) {
    const senderTab = sender && sender.tab;
    const tab = Number.isInteger(requestedTabId) ? await tabsGet(requestedTabId) : null;
    if (
      !senderTab
      || !Number.isInteger(senderTab.id)
      || !tab
      || tab.openerTabId !== senderTab.id
      || !isDeleteBridgeTabUrl(tab.url)
    ) {
      throw new Error("Blocked delete bridge tab focus");
    }
    await tabsUpdate(tab.id, { active: true });
  }

  async function closeDeleteBridgeTab(sender, requestedTabId) {
    const senderTab = sender && sender.tab;
    let tab = senderTab;
    if (Number.isInteger(requestedTabId)) {
      tab = await tabsGet(requestedTabId);
      if (!senderTab || !Number.isInteger(senderTab.id) || !tab || tab.openerTabId !== senderTab.id) {
        throw new Error("Blocked delete bridge tab close");
      }
    }
    if (!tab || !Number.isInteger(tab.id) || !isDeleteBridgeTabUrl(tab.url)) {
      throw new Error("Blocked delete bridge tab close");
    }
    await tabsRemove(tab.id);
  }

  async function readBilibiliPublicPageState(sender) {
    if (
      !sender
      || sender.frameId !== 0
      || !sender.tab
      || !Number.isInteger(sender.tab.id)
      || !isBilibiliVideoUrl(sender.url || sender.tab.url)
    ) {
      throw new Error("Blocked page-state sender");
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [0] },
      world: "MAIN",
      func: collectBilibiliPublicPageState,
    });
    const result = Array.isArray(results) && results[0] ? results[0].result : null;
    return normalizeBilibiliPublicPageState(result);
  }

  function collectBilibiliPublicPageState() {
    const initial = window.__INITIAL_STATE__;
    if (!initial || typeof initial !== "object") {
      return { schemaVersion: 1, href: location.href };
    }
    const mediaInfo = initial.mediaInfo || initial.media_info || {};
    const epInfo = initial.epInfo || initial.ep_info || initial.epInfoV2 || {};
    const videoData = initial.videoData || initial.videoInfo || {};
    const ownerCandidates = [
      videoData.owner,
      initial.owner,
      initial.aidData && initial.aidData.owner,
      initial.videoInfo && initial.videoInfo.owner,
      initial.arc && initial.arc.owner,
      initial.view && initial.view.owner,
    ];
    const owner = ownerCandidates.find((candidate) => (
      candidate && typeof candidate === "object"
      && (candidate.mid || candidate.uid || candidate.name || candidate.username)
    )) || {};
    return {
      schemaVersion: 1,
      href: location.href,
      identity: {
        bvid: videoData.bvid || initial.bvid || "",
        seasonId: initial.season_id || mediaInfo.season_id || mediaInfo.seasonId || mediaInfo.season_id_str || "",
        mediaId: initial.media_id || mediaInfo.media_id || mediaInfo.mediaId || mediaInfo.media_id_str || "",
        episodeId: epInfo.id || epInfo.ep_id || epInfo.epId || initial.ep_id || initial.epId || "",
      },
      titles: {
        mediaTitle: mediaInfo.title || mediaInfo.name || "",
        seasonTitle: mediaInfo.season_title || mediaInfo.seasonTitle || initial.season_title || initial.seasonTitle || epInfo.season_title || epInfo.seasonTitle || "",
        episodeTitle: epInfo.title || "",
        episodeLongTitle: epInfo.long_title || epInfo.longTitle || "",
        shareCopy: epInfo.share_copy || epInfo.shareCopy || "",
      },
      owner: {
        mid: owner.mid || "",
        uid: owner.uid || "",
        name: owner.name || "",
        username: owner.username || "",
      },
      durationSeconds: videoData.duration || initial.duration || 0,
    };
  }

  function normalizeBilibiliPublicPageState(value) {
    const input = value && typeof value === "object" ? value : {};
    const href = normalizeBilibiliStateHref(input.href);
    if (!href) throw new Error("Invalid page-state URL");
    const identity = input.identity && typeof input.identity === "object" ? input.identity : {};
    const titles = input.titles && typeof input.titles === "object" ? input.titles : {};
    const owner = input.owner && typeof input.owner === "object" ? input.owner : {};
    const duration = Number(input.durationSeconds);
    return {
      schemaVersion: 1,
      href,
      identity: {
        bvid: /^BV[a-z0-9]{5,20}$/i.test(String(identity.bvid || "")) ? String(identity.bvid) : "",
        seasonId: normalizeNumericId(identity.seasonId),
        mediaId: normalizeNumericId(identity.mediaId),
        episodeId: normalizeNumericId(identity.episodeId),
      },
      titles: {
        mediaTitle: normalizePublicText(titles.mediaTitle, 500),
        seasonTitle: normalizePublicText(titles.seasonTitle, 500),
        episodeTitle: normalizePublicText(titles.episodeTitle, 500),
        episodeLongTitle: normalizePublicText(titles.episodeLongTitle, 500),
        shareCopy: normalizePublicText(titles.shareCopy, 500),
      },
      owner: {
        mid: normalizeNumericId(owner.mid),
        uid: normalizeNumericId(owner.uid),
        name: normalizePublicText(owner.name, 100),
        username: normalizePublicText(owner.username, 100),
      },
      durationSeconds: Number.isFinite(duration) && duration > 0 && duration <= 7 * 24 * 60 * 60 ? duration : 0,
    };
  }

  function normalizeBilibiliStateHref(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:"
        && parsed.hostname === "www.bilibili.com"
        && (parsed.pathname.startsWith("/video/") || parsed.pathname.startsWith("/bangumi/play/"))
        ? parsed.href
        : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeNumericId(value) {
    const text = String(value == null ? "" : value).trim();
    return /^\d{1,20}$/.test(text) ? text : "";
  }

  function normalizePublicText(value, maxLength) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function isDeleteBridgeUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.protocol === "https:"
        && parsed.hostname === "bgm.tv"
        && /^\/subject\/\d+\/?$/.test(parsed.pathname)
        && /^[a-f0-9]{32}$/.test(parsed.searchParams.get("biligumi_delete_bridge") || "");
    } catch (_error) {
      return false;
    }
  }

  function isAllowedExtensionUpdateSender(sender) {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    const senderUrl = String(sender.url || "");
    if (senderUrl === chrome.runtime.getURL("options.html")) {
      return sender.frameId === undefined || sender.frameId === 0;
    }
    return Boolean(sender.frameId === 0
      && sender.tab
      && Number.isInteger(sender.tab.id)
      && isBilibiliVideoUrl(senderUrl || sender.tab.url));
  }

  function isValidExtensionVersion(value) {
    const parts = String(value || "").split(".");
    return parts.length >= 1
      && parts.length <= 4
      && parts.every((part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 65535);
  }

  function compareExtensionVersions(left, right) {
    const a = String(left || "").split(".").map(Number);
    const b = String(right || "").split(".").map(Number);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function parseExtensionUpdateManifest(source) {
    const manifest = JSON.parse(String(source || ""));
    const version = String(manifest && manifest.version || "").trim();
    if (
      !manifest
      || manifest.manifest_version !== 3
      || manifest.name !== "Biligumi Connector"
      || !isValidExtensionVersion(version)
    ) {
      throw new Error("Update source returned an invalid extension manifest");
    }
    return { version };
  }

  function normalizeExtensionUpdateCache(value, currentVersion) {
    if (!value || typeof value !== "object") return null;
    const checkedAt = Number(value.checkedAt) || 0;
    const age = Date.now() - checkedAt;
    const remoteVersion = String(value.remoteVersion || "");
    const source = EXTENSION_UPDATE_SOURCES.find((item) => item.id === value.sourceId);
    if (
      !source
      || !isValidExtensionVersion(remoteVersion)
      || checkedAt <= 0
      || age < 0
      || age > EXTENSION_UPDATE_CACHE_TTL_MS
    ) return null;
    return {
      status: compareExtensionVersions(remoteVersion, currentVersion) > 0 ? "available" : "current",
      currentVersion,
      remoteVersion,
      source: { id: source.id, label: source.label },
      checkedAt,
    };
  }

  async function checkExtensionUpdate(force = false) {
    const currentVersion = String(chrome.runtime.getManifest().version || "");
    if (!force) {
      const cached = normalizeExtensionUpdateCache(await getExtensionUpdateCache(), currentVersion);
      if (cached) return cached;
    }

    for (const configuredSource of EXTENSION_UPDATE_SOURCES) {
      try {
        const source = await resolveExtensionUpdateSource(configuredSource);
        const manifestText = await fetchExtensionUpdateText(source.manifestUrl);
        const remote = parseExtensionUpdateManifest(manifestText);
        const result = {
          status: compareExtensionVersions(remote.version, currentVersion) > 0 ? "available" : "current",
          currentVersion,
          remoteVersion: remote.version,
          source: { id: source.id, label: source.label },
          checkedAt: Date.now(),
        };
        await setExtensionUpdateCache({
          remoteVersion: result.remoteVersion,
          sourceId: result.source.id,
          checkedAt: result.checkedAt,
        });
        return result;
      } catch (_error) {
        // GitHub is preferred; resolve and check the GitCode commit-specific fallback next.
      }
    }

    return {
      status: "error",
      currentVersion,
      remoteVersion: "",
      source: null,
      checkedAt: Date.now(),
    };
  }

  async function resolveExtensionUpdateSource(source) {
    if (source.id !== "gitcode") return source;
    const branchText = await fetchExtensionUpdateText(source.branchUrl, "application/json");
    const branch = JSON.parse(branchText);
    const commit = String(branch && branch.commit && (branch.commit.id || branch.commit.sha) || "").trim();
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("GitCode returned an invalid commit");
    return {
      ...source,
      manifestUrl: `${source.rawUrl}?ref=${commit}`,
    };
  }

  async function fetchExtensionUpdateText(url, accept = "application/json,text/plain,*/*") {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXTENSION_UPDATE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: accept },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Update source response failed (${response.status})`);
      const text = await readBoundedExtensionUpdateText(response);
      if (!text) throw new Error(`Update source response failed (${response.status})`);
      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function readBoundedExtensionUpdateText(response) {
    const declaredLength = Number(response.headers && response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > EXTENSION_UPDATE_MAX_RESPONSE_BYTES) {
      throw new Error("Update source response is too large");
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > EXTENSION_UPDATE_MAX_RESPONSE_BYTES) {
        throw new Error("Update source response is too large");
      }
      return text;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > EXTENSION_UPDATE_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("Update source response is too large");
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  async function openExtensionUpdatePage(sourceId) {
    const source = EXTENSION_UPDATE_SOURCES.find((item) => item.id === String(sourceId || ""))
      || EXTENSION_UPDATE_SOURCES[0];
    await tabsCreate({ url: source.pageUrl, active: true });
  }

  function getExtensionUpdateCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get(EXTENSION_UPDATE_CACHE_KEY, (items) => {
        resolve(items && items[EXTENSION_UPDATE_CACHE_KEY] && typeof items[EXTENSION_UPDATE_CACHE_KEY] === "object"
          ? items[EXTENSION_UPDATE_CACHE_KEY]
          : null);
      });
    });
  }

  function setExtensionUpdateCache(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [EXTENSION_UPDATE_CACHE_KEY]: value }, resolve);
    });
  }

  function isDeleteBridgeTabUrl(url) {
    if (isDeleteBridgeUrl(url)) return true;
    try {
      const parsed = new URL(String(url || ""));
      return parsed.protocol === "https:" && parsed.hostname === "bgm.tv" && parsed.pathname === "/login";
    } catch (_error) {
      return false;
    }
  }

  async function handleHttpRequest(request, sender) {
    if (!isAllowedHttpSender(sender)) throw makeHttpProxyError("Blocked extension request sender", "validation");
    const normalized = normalizeHttpRequest(request);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), normalized.timeout);
    try {
      const response = await fetch(normalized.url, {
        method: normalized.method,
        headers: normalized.headers,
        body: normalized.body,
        credentials: normalized.credentials,
        redirect: normalized.redirect,
        signal: controller.signal,
      });
      const responseText = await response.text();
      const responseHeaders = [];
      response.headers.forEach((value, key) => {
        responseHeaders.push(`${key}: ${value}`);
      });
      if (normalized.redirect === "error" && response.url && response.url !== normalized.url) {
        throw makeHttpProxyError("Blocked API redirect", "validation");
      }
      return {
        status: response.status,
        statusText: response.statusText,
        responseText,
        response: normalized.responseType === "json" ? tryParseJson(responseText) : responseText,
        responseHeaders: responseHeaders.join("\r\n"),
        finalUrl: response.url,
      };
    } catch (error) {
      if (error && error.name === "AbortError") throw makeHttpProxyError("Extension HTTP request timed out", "timeout");
      if (error && error.errorKind) throw error;
      throw makeHttpProxyError(String(error && error.message || error), "network");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function normalizeHttpRequest(request) {
    const url = String(request && request.url || "");
    const target = classifyHttpTarget(url);
    if (!target) throw makeHttpProxyError("Blocked extension request URL", "validation");
    const method = String(request && request.method || "GET").toUpperCase();
    const allowedMethods = target === "web" ? new Set(["GET"]) : new Set(["GET", "POST", "PATCH"]);
    if (!allowedMethods.has(method)) throw makeHttpProxyError("Blocked extension request method", "validation");
    const body = request && request.data != null ? String(request.data) : undefined;
    if (method === "GET" && body) throw makeHttpProxyError("Blocked GET request body", "validation");
    if (body && body.length > 64 * 1024) throw makeHttpProxyError("Blocked oversized request body", "validation");
    const headers = filterRequestHeaders(request && request.headers, target);
    return {
      url,
      method,
      headers,
      body,
      responseType: String(request && request.responseType || ""),
      credentials: target === "web" && request && request.withCredentials ? "include" : "omit",
      redirect: target === "api" ? "error" : "follow",
      timeout: Math.max(1000, Math.min(120000, Number(request && request.timeout) || 30000)),
    };
  }

  function isAllowedHttpSender(sender) {
    if (!sender || sender.frameId !== 0 || !sender.tab || !Number.isInteger(sender.tab.id)) return false;
    const url = sender.url || sender.tab.url || "";
    return isBilibiliVideoUrl(url) || isDeleteBridgeTabUrl(url);
  }

  function classifyHttpTarget(url) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || parsed.hash) return "";
      const apiHosts = new Set(["api.bgm.tv", "api.bgmapi.com"]);
      if (apiHosts.has(parsed.hostname) && parsed.pathname.startsWith("/v0/")) return "api";
      if (parsed.hostname === "bgm.tv" && /^\/(?:subject\/\d+|login)(?:\/)?$/.test(parsed.pathname)) return "web";
      return "";
    } catch (_error) {
      return "";
    }
  }

  function isAllowedHttpUrl(url) {
    return Boolean(classifyHttpTarget(url));
  }

  function filterRequestHeaders(headers, target = "api") {
    const allowed = target === "web"
      ? new Set(["accept"])
      : new Set(["accept", "content-type", "authorization"]);
    const result = {};
    Object.entries(headers && typeof headers === "object" ? headers : {}).forEach(([key, value]) => {
      const normalizedKey = String(key || "").toLowerCase();
      if (!allowed.has(normalizedKey)) return;
      result[key] = String(value);
    });
    return result;
  }

  function makeHttpProxyError(message, errorKind) {
    const error = new Error(message);
    error.errorKind = errorKind;
    return error;
  }


  function tryParseJson(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch (_error) {
      return null;
    }
  }

  chrome.commands.onCommand.addListener((command) => {
    if (command === COMMAND_SKIP_OPED) {
      executeSkipCommand().catch((error) => {
        console.warn("[Biligumi OP/ED] command failed:", error);
      });
    }
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError || !isBilibiliVideoUrl(tab && tab.url)) return;
      recordBilibiliTab(tab, { reason: "tab-activated" }).catch(() => {});
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const nextUrl = changeInfo.url || tab.url;
    if (!isBilibiliVideoUrl(nextUrl)) return;
    recordBilibiliTab({ ...tab, id: tabId, url: nextUrl }, { reason: "tab-updated" }).catch(() => {});
  });

  async function executeSkipCommand() {
    const candidates = await getCandidateTabs();
    for (const tab of candidates) {
      const response = await sendSkipMessage(tab.id);
      if (response && response.ok) return response;
    }
    return { ok: false, reason: "no-bilibili-tab" };
  }

  async function getCandidateTabs() {
    await runtimeStateUpdateQueue.catch(() => {});
    const state = await getRuntimeState();
    const candidateIds = [];

    const activeTabs = await tabsQuery({ active: true, lastFocusedWindow: true });
    for (const tab of activeTabs) {
      if (isBilibiliVideoUrl(tab.url)) candidateIds.push(tab.id);
    }

    candidateIds.push(state.lastPiPTabId, state.lastActiveBilibiliTabId, state.lastBilibiliTabId);

    const queriedTabs = await tabsQuery({ url: BILIBILI_URL_PATTERNS });
    queriedTabs
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
      })
      .forEach((tab) => candidateIds.push(tab.id));

    const uniqueIds = Array.from(new Set(candidateIds.filter((id) => Number.isInteger(id))));
    const tabs = [];
    for (const id of uniqueIds) {
      const tab = await tabsGet(id);
      if (tab && isBilibiliVideoUrl(tab.url)) tabs.push(tab);
    }
    return tabs;
  }

  async function sendSkipMessage(tabId) {
    try {
      const response = await tabsSendMessage(tabId, { type: MSG_EXECUTE_SKIP, source: "command" });
      return response && typeof response === "object" ? { delivered: true, ...response } : { delivered: true, ok: false, reason: "empty-response" };
    } catch (error) {
      return { delivered: false, ok: false, reason: "message-failed", error: String(error && error.message || error) };
    }
  }

  async function recordBilibiliTab(tab, pageState) {
    const tabUrl = (tab && tab.url) || (pageState && pageState.url) || "";
    if (!tab || !tab.id || !isBilibiliVideoUrl(tabUrl)) return;
    const now = Date.now();
    // Each event must read the preceding event's committed state before merging.
    const update = runtimeStateUpdateQueue.catch(() => {}).then(async () => {
      const state = await getRuntimeState();
      const nextState = {
        ...state,
        lastBilibiliTabId: tab.id,
        lastBilibiliUrl: tabUrl,
        lastUpdatedAt: now,
      };

      if (tab.active || pageState.reason === "focus" || pageState.reason === "visibility-visible") {
        nextState.lastActiveBilibiliTabId = tab.id;
      }

      if (pageState.pip === true) {
        nextState.lastPiPTabId = tab.id;
        nextState.lastPiPUrl = tabUrl;
        nextState.lastPiPAt = now;
      } else if (pageState.pip === false && state.lastPiPTabId === tab.id) {
        nextState.lastPiPTabId = null;
        nextState.lastPiPUrl = "";
      }

      await setRuntimeState(nextState);
    });
    runtimeStateUpdateQueue = update;
    await update;
  }

  function isBilibiliVideoUrl(url) {
    try {
      const parsed = new URL(url || "");
      return parsed.protocol === "https:"
        && parsed.hostname === "www.bilibili.com"
        && (parsed.pathname.startsWith("/video/") || parsed.pathname.startsWith("/bangumi/play/"));
    } catch (_error) {
      return false;
    }
  }

  function getStorageArea() {
    return chrome.storage.session || chrome.storage.local;
  }

  function getRuntimeState() {
    return new Promise((resolve) => {
      getStorageArea().get(RUNTIME_STATE_KEY, (items) => {
        resolve(items && items[RUNTIME_STATE_KEY] && typeof items[RUNTIME_STATE_KEY] === "object"
          ? items[RUNTIME_STATE_KEY]
          : {});
      });
    });
  }

  function setRuntimeState(state) {
    return new Promise((resolve) => {
      getStorageArea().set({ [RUNTIME_STATE_KEY]: state }, resolve);
    });
  }

  function tabsQuery(queryInfo) {
    return new Promise((resolve) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  function tabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(tab || null);
      });
    });
  }

  function tabsRemove(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function tabsGet(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tab || null);
      });
    });
  }

  function tabsUpdate(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, updateProperties, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(tab || null);
      });
    });
  }

  function tabsSendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }
})();
