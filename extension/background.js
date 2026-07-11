(() => {
  "use strict";

  const COMMAND_SKIP_OPED = "skip-oped";
  const MSG_PAGE_STATE = "biligumi-oped-page-state";
  const MSG_EXECUTE_SKIP = "biligumi-oped-execute-skip";
  const MSG_HTTP_REQUEST = "biligumi-http-request";
  const RUNTIME_STATE_KEY = "__biligumiOpedRuntimeState";
  const BILIBILI_URL_PATTERNS = [
    "https://www.bilibili.com/video/*",
    "https://www.bilibili.com/bangumi/play/*",
  ];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === MSG_HTTP_REQUEST) {
      handleHttpRequest(message.request).then(
        (response) => sendResponse({ ok: true, response }),
        (error) => sendResponse({ ok: false, error: String(error && error.message || error) }),
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

  async function handleHttpRequest(request) {
    const normalized = normalizeHttpRequest(request);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), normalized.timeout);
    try {
      const response = await fetch(normalized.url, {
        method: normalized.method,
        headers: normalized.headers,
        body: normalized.body,
        credentials: normalized.credentials,
        signal: controller.signal,
      });
      const responseText = await response.text();
      const responseHeaders = [];
      response.headers.forEach((value, key) => {
        responseHeaders.push(`${key}: ${value}`);
      });
      return {
        status: response.status,
        statusText: response.statusText,
        responseText,
        response: normalized.responseType === "json" ? tryParseJson(responseText) : responseText,
        responseHeaders: responseHeaders.join("\r\n"),
        finalUrl: response.url,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function normalizeHttpRequest(request) {
    const url = String(request && request.url || "");
    if (!isAllowedHttpUrl(url)) throw new Error("Blocked extension request URL");
    const method = String(request && request.method || "GET").toUpperCase();
    const headers = filterRequestHeaders(request && request.headers);
    return {
      url,
      method,
      headers,
      body: request && request.data != null ? String(request.data) : undefined,
      responseType: String(request && request.responseType || ""),
      credentials: request && request.withCredentials ? "include" : "omit",
      timeout: Math.max(1000, Math.min(120000, Number(request && request.timeout) || 30000)),
    };
  }

  function isAllowedHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && (
        parsed.hostname === "api.bgm.tv"
        || parsed.hostname === "bgm.tv"
        || parsed.hostname === "www.bilibili.com"
      );
    } catch (_error) {
      return false;
    }
  }

  function filterRequestHeaders(headers) {
    const blocked = new Set([
      "accept-encoding",
      "connection",
      "content-length",
      "cookie",
      "host",
      "origin",
      "referer",
      "user-agent",
    ]);
    const result = {};
    Object.entries(headers && typeof headers === "object" ? headers : {}).forEach(([key, value]) => {
      const normalizedKey = String(key || "").toLowerCase();
      if (!normalizedKey || blocked.has(normalizedKey)) return;
      result[key] = String(value);
    });
    return result;
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
  }

  function isBilibiliVideoUrl(url) {
    try {
      const parsed = new URL(url || "");
      return parsed.hostname === "www.bilibili.com"
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
