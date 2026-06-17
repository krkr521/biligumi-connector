// ==UserScript==
// @name         Biligumi Connector
// @namespace    https://github.com/local/biligumi-connector
// @version      0.5.1
// @description  Embed a Bangumi collection/rating/progress panel into Bilibili watch pages.
// @author       local
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/video/*
// @connect      api.bgm.tv
// @connect      bgm.tv
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const API_BASE = "https://api.bgm.tv";
  const BGM_WEB_BASE = "https://bgm.tv";
  const PANEL_ID = "biligumi-connector-panel";
  const SUBJECT_INFO_ID = "biligumi-connector-subject-info";
  const CHARACTER_STRIP_ID = "biligumi-connector-characters";
  const SETTINGS_ID = "biligumi-connector-settings";
  const SCRIPT_VERSION = "0.5.1";
  const STORAGE = {
    token: "biligumi.token",
    bindings: "biligumi.bindings",
    whitelist: "biligumi.whitelist",
    whitelistLabels: "biligumi.whitelistLabels",
    panelCollapsed: "biligumi.panelCollapsed",
    syncHistory: "biligumi.syncHistory",
    nonMainPreview: "biligumi.nonMainPreview",
    officialBangumiLayout: "biligumi.officialBangumiLayout",
    autoWatchThresholds: "biligumi.autoWatchThresholds",
    subjectInfoPanel: "biligumi.subjectInfoPanel",
    characterStrip: "biligumi.characterStrip",
  };

  const SUBJECT_TYPES = {
    1: "想看",
    2: "看过",
    3: "在看",
    4: "搁置",
    5: "抛弃",
  };

  const EPISODE_TYPES = {
    0: "未看",
    1: "想看",
    2: "看过",
    3: "抛弃",
  };

  const EPISODE_PATTERNS = [
    /第\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[-~～至到]\s*[0-9]+(?:\.[0-9]+)?)?\s*[话話集]/i,
    /S\d+\s*E\s*([0-9]+(?:\.[0-9]+)?)/i,
    /EP\.?\s*([0-9]+(?:\.[0-9]+)?)/i,
    /#\s*([0-9]+(?:\.[0-9]+)?)\b/i,
    /[\[【]\s*([0-9]+(?:\.[0-9]+)?)\s*[\]】]/,
    /『[^』]*』\s*([0-9]+(?:\.[0-9]+)?)/,
    /(?:^|[\s#\[])([0-9]+(?:\.[0-9]+)?)(?:\s*[-~～至到]\s*[0-9]+(?:\.[0-9]+)?)?\s*(?:话|話|集|]|$)/i,
    /(?:^|[\s#])0*([0-9]{1,3})(?:\s*[\[【][^\]】]+[\]】])?\s*$/i,
    /(?:^|[\s#\[])([0-9]+(?:\.[0-9]+)?)\s*(?:话|集|]|$)/i,
  ];

  const COMMON_RESOLUTIONS = new Set([144, 240, 360, 480, 540, 720, 1080, 1440, 2160, 4320]);
  const TITLE_PROPERTY_TAGS = [
    "4K", "1080P", "720P", "480P", "HDR", "SDR", "BD", "BDRIP", "WEB", "WEBRIP",
    "简中", "繁中", "简体", "繁体", "中字", "中日", "中文字幕", "中文", "字幕", "字幕组", "汉化组", "漢化組", "压制",
    "超清", "高清", "标清", "新番", "完结", "全集",
  ];
  const NON_MAIN_EPISODE_PATTERN = /(?:^|[\s【】\[\]\(（\)）「」『』《》&＆])(?:(?:正式|主|第\s*\d+\s*(?:[弹彈]|话|話|集)|先导|先導|定档|定檔|特报|特報|预告|預告)\s*)?(?:PV|CM|Blu\s*-?\s*ray\s*(?:[&＆/+]\s*DVD)?|DVD|(?:NC\s*[-_ ]?\s*)?OP|(?:NC\s*[-_ ]?\s*)?ED|OVA|OAD|SP|MAD|MMD|LIVE|MV|PV\d+|OP\d+|ED\d+|番宣|预告|預告|预告片|預告片|正式预告|正式預告|主预告|主預告|先导预告|先導預告|先导|先導|特报|特報|特典|告知|情报|情報|回顾|回顧|映像|主题曲|主題曲|片头曲|片頭曲|片尾曲|片头|片尾|无字幕OP|无字幕ED)(?:$|[\s\d【】\[\]\(（\)）「」『』《》._&＆+＋-])/;
  const NON_MAIN_KEYWORD_PATTERN = /(?:^|[^A-Za-z])(?:(?:PV|Blu\s*-?\s*ray\s*(?:[&＆/+]\s*DVD)?|DVD|(?:NC\s*[-_ ]?\s*)?OP|(?:NC\s*[-_ ]?\s*)?ED)\s*\d*(?:\.\d+)?|(?:第\s*\d+\s*(?:话|話|集)\s*)?(?:番宣|预告|預告|预告片|預告片|特报|特報|告知|情报|情報|插入曲|插入歌|主题曲|主題曲|片头曲|片頭曲|片尾曲|片头|片尾)|无字幕OP|无字幕ED)/;
  const WHITELIST_NEWS_NON_MAIN_PATTERN = /(?:TV\s*)?(?:动画化|動畫化|アニメ化|anime化)\s*(?:决定|決定|确定|確定|企划|企劃|制作决定|制作決定|发表|發表|公布)|(?:剧场|劇場)?上映\s*(?:决定|決定|确定|確定)/i;

  const pendingRequests = new Map();
  const subjectBundleRequests = new Map();
  const nonMainPreviewRequests = new Map();
  const subjectInfoLinkRequests = new Map();
  const subjectInfoLinkCache = new Map();
  const COLLECTION_COMMENT_MAX_LENGTH = 380;
  const REQUEST_DEDUP_TTL = 500;
  const REQUEST_MAX_RETRIES = 3;
  const REQUEST_RETRY_BASE_MS = 800;
  const AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS = 5 * 60;

  const state = {
    pageKey: "",
    rawTitle: "",
    pageTitle: "",
    username: "",
    token: readValue(STORAGE.token, ""),
    bindings: readJsonValue(STORAGE.bindings, {}),
    whitelist: readListValue(STORAGE.whitelist, []),
    whitelistLabels: readJsonValue(STORAGE.whitelistLabels, {}),
    subjectId: null,
    subject: null,
    subjectInfoLinks: {},
    characters: [],
    characterError: "",
    previewSubject: null,
    previewCharacters: [],
    previewCharacterError: "",
    previewCharacterKey: "",
    previewCharacterBusy: false,
    previewCharacterFailedKey: "",
    collection: null,
    episodes: [],
    episodeCollections: [],
    currentEpisodeNo: null,
    busy: false,
    panelCollapsed: readValue(STORAGE.panelCollapsed, "0") === "1",
    settingsOpen: false,
    collectionEditorOpen: false,
    pendingCollection: null,
    message: "",
    error: "",
    searchResults: [],
    nonMainPreviewEnabled: readValue(STORAGE.nonMainPreview, "1") !== "0",
    officialBangumiLayoutEnabled: readValue(STORAGE.officialBangumiLayout, "1") !== "0",
    autoWatchThresholds: readJsonValue(STORAGE.autoWatchThresholds, {}),
    subjectInfoPanelEnabled: readValue(STORAGE.subjectInfoPanel, "0") === "1",
    characterStripEnabled: readValue(STORAGE.characterStrip, "1") !== "0",
    nonMainResults: [],
    nonMainKeyword: "",
    nonMainBusy: false,
    nonMainError: "",
    nonMainSearched: false,
    nonMainSearchSeq: 0,
    syncHistory: readJsonValue(STORAGE.syncHistory, {}),
    autoEpisodeSyncing: false,
    autoEpisodeSyncLastKey: "",
    autoWatchLastVideoKey: "",
    autoWatchLastVideoTime: 0,
    autoWatchSeekStartTime: null,
    autoWatchBlockedKey: "",
  };

  GM_addStyle(`
    #${PANEL_ID},
    #${SUBJECT_INFO_ID},
    #${CHARACTER_STRIP_ID} {
      --bgm-pink: #f07f95;
      --bgm-blue: #2f8cff;
      --bgm-ink: #1f2329;
      --bgm-muted: #7f8792;
      --bgm-border: #e6e9ef;
      --bgm-bg: #fff;
      --bgm-soft: #f7f8fa;
      box-sizing: border-box;
      position: relative;
      z-index: 20;
      pointer-events: auto;
      margin: 0;
      padding: 14px;
      width: 100%;
      border: 1px solid var(--bgm-border);
      border-radius: 8px;
      background: var(--bgm-bg);
      color: var(--bgm-ink);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #${PANEL_ID} {
      box-shadow: 0 4px 18px rgba(23, 27, 38, 0.08);
    }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${SUBJECT_INFO_ID} * { box-sizing: border-box; }
    #${CHARACTER_STRIP_ID} * { box-sizing: border-box; }
    #${PANEL_ID} button,
    #${PANEL_ID} input,
    #${PANEL_ID} select {
      font: inherit;
    }
    #${SUBJECT_INFO_ID} {
      margin: 14px 0 18px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--bgm-ink);
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-overview {
      display: grid;
      grid-template-columns: minmax(148px, 190px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
      padding: 14px 0 18px;
      border-top: 1px solid #edf0f5;
      border-bottom: 1px solid #edf0f5;
    }
    .left-container.biligumi-subject-side-layout {
      display: grid !important;
      grid-template-columns: minmax(150px, 188px) minmax(0, 1fr);
      column-gap: 16px;
      align-items: start;
      grid-auto-flow: row;
    }
    .left-container.biligumi-subject-side-layout > .video-info-container,
    .left-container.biligumi-subject-side-layout > .video-info,
    .left-container.biligumi-subject-side-layout > #viewbox_report {
      grid-column: 2;
      grid-row: 1;
      min-width: 0;
      width: 100% !important;
    }
    .left-container.biligumi-subject-side-layout > #${SUBJECT_INFO_ID} {
      grid-column: 1;
      grid-row: 1 / span 999;
      min-width: 0;
      margin: 0 0 18px;
    }
    .left-container.biligumi-subject-side-layout > #playerWrap {
      grid-column: 2;
      grid-row: 2;
      min-width: 0;
      width: 100% !important;
    }
    .left-container.biligumi-subject-side-layout > #playerWrap > #bilibili-player {
      width: 100% !important;
    }
    .left-container.biligumi-subject-side-layout > .video-toolbar-container,
    .left-container.biligumi-subject-side-layout > #arc_toolbar_report {
      grid-column: 2;
      grid-row: 3;
      min-width: 0;
      width: 100% !important;
    }
    .left-container.biligumi-subject-side-layout > #${CHARACTER_STRIP_ID},
    .left-container.biligumi-subject-side-layout > .video-tag-container,
    .left-container.biligumi-subject-side-layout > .tag-panel,
    .left-container.biligumi-subject-side-layout > .left-container-under-player,
    .left-container.biligumi-subject-side-layout > .video-desc-container,
    .left-container.biligumi-subject-side-layout > .video-note-container,
    .left-container.biligumi-subject-side-layout > .comment-m,
    .left-container.biligumi-subject-side-layout > #comment,
    .left-container.biligumi-subject-side-layout > .reply-warp,
    .left-container.biligumi-subject-side-layout > .reply-wrap,
    .left-container.biligumi-subject-side-layout > [class*='video-tag'],
    .left-container.biligumi-subject-side-layout > [class*='VideoTag'],
    .left-container.biligumi-subject-side-layout > [class*='reply'],
    .left-container.biligumi-subject-side-layout > [class*='comment'],
    .left-container.biligumi-subject-side-layout > [class*='Comment'] {
      grid-column: 2;
      min-width: 0;
      width: 100% !important;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar {
      display: block;
      padding: 0;
      border-top: 0;
      border-bottom: 0;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar .biligumi-subject-cover-wrap {
      width: 100%;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar .biligumi-subject-info-main {
      margin-top: 12px;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar .biligumi-subject-info-title {
      font-size: 18px;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar .biligumi-subject-info-box {
      max-height: none;
      overflow: visible;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar .biligumi-subject-info-row {
      display: block;
      padding: 6px 0;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-sidebar .biligumi-subject-info-key {
      margin-bottom: 2px;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-official-compact {
      display: block;
      margin: 14px 0 18px;
      padding: 14px 0 12px;
      border-top: 1px solid #edf0f5;
      border-bottom: 1px solid #edf0f5;
    }
    #${SUBJECT_INFO_ID}.biligumi-subject-official-compact .biligumi-subject-info-box {
      max-height: none;
      overflow: visible;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-cover-wrap {
      min-width: 0;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-cover {
      display: block;
      width: 100%;
      aspect-ratio: 3 / 4.25;
      object-fit: cover;
      object-position: top center;
      border: 1px solid #d9dde4;
      background: #f7f8fa;
      box-shadow: 0 3px 10px rgba(23, 27, 38, 0.14);
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-cover-placeholder {
      display: grid;
      place-items: center;
      color: #9aa4b2;
      font-size: 42px;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-name {
      margin-top: 8px;
      color: #18191c;
      font-size: 14px;
      line-height: 1.35;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-title {
      font-size: 20px;
      font-weight: 500;
      color: #18191c;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-more {
      color: #2f8cff;
      font-size: 13px;
      text-decoration: none;
      white-space: nowrap;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-box {
      max-height: 520px;
      overflow: auto;
      font-size: 14px;
      line-height: 1.42;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-row {
      display: grid;
      grid-template-columns: minmax(72px, max-content) minmax(0, 1fr);
      gap: 8px;
      padding: 7px 0;
      border-bottom: 1px solid #edf0f5;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-row:last-child {
      border-bottom: 0;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-key {
      color: #7b8794;
      white-space: nowrap;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-value {
      min-width: 0;
      color: #1f2329;
      overflow-wrap: anywhere;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-value a {
      color: #2080c0;
      text-decoration: none;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-value a:hover {
      color: #2f8cff;
    }
    #${SUBJECT_INFO_ID} .biligumi-subject-info-sep {
      color: #a0a8b2;
    }
    @media (max-width: 780px) {
      #${SUBJECT_INFO_ID}.biligumi-subject-overview {
        grid-template-columns: 116px minmax(0, 1fr);
        gap: 12px;
      }
      #${SUBJECT_INFO_ID} .biligumi-subject-info-title {
        font-size: 18px;
      }
      #${SUBJECT_INFO_ID} .biligumi-subject-info-row {
        grid-template-columns: 1fr;
        gap: 2px;
      }
    }
    #${CHARACTER_STRIP_ID} {
      width: 100%;
      margin: 14px 0 18px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--bgm-ink);
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-title {
      font-size: 18px;
      font-weight: 500;
      color: #18191c;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-more {
      color: #2f8cff;
      font-size: 13px;
      text-decoration: none;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-list {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 2px 2px 8px;
      scrollbar-width: thin;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-card {
      flex: 0 0 92px;
      min-width: 0;
      color: inherit;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-card a {
      color: inherit;
      text-decoration: none;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-card a:hover {
      color: #2f8cff;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-cover {
      width: 92px;
      height: 124px;
      border-radius: 8px;
      border: 1px solid #edf0f5;
      background: #f7f8fa;
      box-shadow: 0 4px 12px rgba(23, 27, 38, 0.08);
      object-fit: cover;
      object-position: top center;
      display: block;
      image-rendering: auto;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #9aa4b2;
      font-size: 28px;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-name {
      margin-top: 6px;
      color: #2080c0;
      font-size: 13px;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-relation {
      margin-top: 4px;
      color: #8a96a3;
      font-size: 12px;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-cv {
      margin-top: 4px;
      color: #6b7280;
      font-size: 12px;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${CHARACTER_STRIP_ID} .biligumi-character-empty {
      padding: 14px 16px;
      border-radius: 8px;
      background: #f7f8fa;
      color: #7b8794;
      font-size: 13px;
    }
    .biligumi-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .biligumi-title {
      min-width: 0;
      font-weight: 650;
      font-size: 16px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .biligumi-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    .biligumi-icon-btn,
    .biligumi-button {
      border: 1px solid var(--bgm-border);
      border-radius: 6px;
      background: #fff;
      color: var(--bgm-ink);
      cursor: pointer;
      transition: background .16s, border-color .16s, color .16s;
    }
    .biligumi-icon-btn {
      width: 30px;
      height: 30px;
      line-height: 28px;
      padding: 0;
      text-align: center;
    }
    .biligumi-button {
      min-height: 30px;
      padding: 4px 10px;
    }
    .biligumi-button.primary {
      border-color: var(--bgm-pink);
      background: var(--bgm-pink);
      color: #fff;
    }
    .biligumi-button:disabled,
    .biligumi-icon-btn:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
    .biligumi-icon-btn:hover,
    .biligumi-button:hover {
      border-color: var(--bgm-blue);
      color: var(--bgm-blue);
    }
    .biligumi-button.primary:hover {
      border-color: #e56a83;
      background: #e56a83;
      color: #fff;
    }
    .biligumi-row {
      margin-top: 10px;
    }
    .biligumi-label {
      margin-bottom: 5px;
      color: var(--bgm-muted);
      font-size: 12px;
    }
    .biligumi-field {
      display: flex;
      gap: 8px;
    }
    .biligumi-field input,
    .biligumi-field select,
    .biligumi-progress-input {
      min-width: 0;
      width: 100%;
      height: 32px;
      padding: 4px 8px;
      border: 1px solid var(--bgm-border);
      border-radius: 6px;
      background: #fff;
      color: var(--bgm-ink);
    }
    .biligumi-status-grid {
      display: grid;
      grid-template-columns: minmax(88px, 1fr) minmax(78px, .8fr);
      gap: 8px;
    }
    .biligumi-stars {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
    }
    .biligumi-star {
      border: 0;
      padding: 0 1px;
      background: transparent;
      color: #d4d8df;
      cursor: pointer;
      font-size: 18px;
      line-height: 1.1;
    }
    .biligumi-star.active {
      color: #f06a2a;
    }
    .biligumi-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      color: var(--bgm-muted);
      font-size: 12px;
    }
    .biligumi-meta strong {
      color: var(--bgm-ink);
    }
    .biligumi-progress-bar {
      position: relative;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #edf0f5;
    }
    .biligumi-progress-bar span {
      display: block;
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #38a2ff, #72d16f);
    }
    .biligumi-episode-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
      gap: 5px;
      max-height: 124px;
      overflow: auto;
      padding-right: 2px;
    }
    .biligumi-episode {
      height: 26px;
      border: 1px solid #c8ddff;
      border-radius: 5px;
      background: #edf5ff;
      color: #1167d8;
      cursor: pointer;
      font-size: 12px;
    }
    .biligumi-episode:hover {
      border-color: #77adff;
      background: #dfeeff;
    }
    .biligumi-episode.done {
      border-color: #4d8df7;
      background: #4d8df7;
      color: #fff;
    }
    .biligumi-episode.current {
      outline: 2px solid var(--bgm-pink);
      outline-offset: 1px;
    }
    .biligumi-search-results {
      display: grid;
      gap: 6px;
    }
    .biligumi-result {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) max-content;
      gap: 8px;
      align-items: center;
      padding: 6px;
      border: 1px solid var(--bgm-border);
      border-radius: 7px;
      background: var(--bgm-soft);
      min-width: 0;
    }
    .biligumi-result img {
      width: 44px;
      height: 58px;
      object-fit: cover;
      border-radius: 4px;
      background: #e8ebf0;
    }
    .biligumi-result-name {
      min-width: 0;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .biligumi-result-body {
      min-width: 0;
      overflow: hidden;
    }
    .biligumi-result .biligumi-button {
      justify-self: end;
      white-space: nowrap;
    }
    .biligumi-result-sub {
      margin-top: 2px;
      color: var(--bgm-muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .biligumi-lite-note {
      margin: 0 0 8px;
      color: var(--bgm-muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .biligumi-lite-results {
      display: grid;
      gap: 5px;
    }
    .biligumi-lite-result {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      gap: 8px;
      align-items: center;
      padding: 6px 7px;
      border: 1px solid var(--bgm-border);
      border-radius: 6px;
      background: var(--bgm-soft);
      min-width: 0;
    }
    .biligumi-lite-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #5a6d82;
      font-weight: 600;
      font-size: 13px;
    }
    .biligumi-lite-sub {
      margin-top: 1px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--bgm-muted);
      font-size: 11px;
    }
    .biligumi-lite-open {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 26px;
      padding: 3px 9px;
      border: 1px solid var(--bgm-pink);
      border-radius: 6px;
      background: var(--bgm-pink);
      color: #fff;
      text-decoration: none;
      white-space: nowrap;
      font-size: 12px;
    }
    .biligumi-lite-open:hover {
      border-color: #e56a83;
      background: #e56a83;
      color: #fff;
    }
    .biligumi-lite-actions {
      display: flex;
      align-items: center;
      gap: 5px;
      justify-self: end;
      white-space: nowrap;
    }
    .biligumi-lite-bind {
      min-height: 26px;
      padding: 3px 9px;
      border: 1px solid var(--bgm-border);
      border-radius: 6px;
      background: #fff;
      color: #5a6d82;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.45;
    }
    .biligumi-lite-bind:hover {
      border-color: var(--bgm-blue);
      color: var(--bgm-blue);
    }
    .biligumi-notice {
      margin-top: 10px;
      padding: 8px 9px;
      border-radius: 6px;
      background: #fff8e7;
      color: #8a6200;
      font-size: 12px;
    }
    .biligumi-notice.error {
      background: #fff0f2;
      color: #bd2441;
    }
    .biligumi-foot {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 10px;
      color: var(--bgm-muted);
      font-size: 12px;
    }
    .biligumi-foot a {
      color: var(--bgm-blue);
      text-decoration: none;
    }
    #${PANEL_ID}.biligumi-panel {
      --bgm-card-blue: #fff;
      --bgm-card-blue-top: #f0f0f0;
      --bgm-card-border: #dfe3e8;
      --bgm-line: rgba(210, 216, 224, .78);
      --bgm-link: #1489d4;
      --bgm-hot: #e96b2d;
      --bgm-pink-btn: #e68aa2;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--bgm-card-border);
      border-radius: 14px;
      background: #fff;
      color: #5f6f80;
      box-shadow: 0 8px 20px rgba(52, 64, 84, .12);
      font-family: Arial, "Microsoft YaHei", sans-serif;
    }
    #${PANEL_ID} .biligumi-head {
      margin: 0;
      padding: 12px 14px 10px;
      background: linear-gradient(#f7f7f7, var(--bgm-card-blue-top));
      border-bottom: 1px solid #e2e5e8;
      cursor: pointer;
    }
    #${PANEL_ID} .biligumi-title {
      font-size: 15px;
      font-weight: 400;
      color: #596a7a;
    }
    #${PANEL_ID} .biligumi-actions {
      cursor: default;
    }
    #${PANEL_ID} .biligumi-icon-btn {
      min-width: 24px;
      width: auto;
      height: 24px;
      line-height: 22px;
      padding: 0 6px;
      border-color: rgba(131, 161, 194, .55);
      border-radius: 5px;
      background: rgba(255, 255, 255, .48);
      color: #4a789d;
      font-size: 13px;
    }
    #${PANEL_ID} .biligumi-card-body {
      padding: 10px 14px 14px;
      background: #fff;
    }
    #${PANEL_ID} .biligumi-row {
      margin-top: 0;
      padding: 9px 0;
      border-top: 1px solid var(--bgm-line);
    }
    #${PANEL_ID} .biligumi-row:first-child {
      border-top: 0;
      padding-top: 0;
    }
    #${PANEL_ID} .biligumi-label {
      margin-bottom: 5px;
      color: #6d7886;
      font-size: 14px;
    }
    #${PANEL_ID} .biligumi-current {
      color: var(--bgm-link);
      font-size: 14px;
      line-height: 1.45;
    }
    #${PANEL_ID} .biligumi-current button {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--bgm-link);
      cursor: pointer;
      font-size: 13px;
    }
    #${PANEL_ID} .biligumi-current-meta {
      color: #7b8794;
      font-size: 13px;
    }
    #${PANEL_ID} .biligumi-collection-box {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      overflow: hidden;
      border: 1px solid #d9dde4;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 2px 8px rgba(52, 64, 84, .08);
    }
    #${PANEL_ID} .biligumi-collection-box button {
      min-width: 0;
      height: 34px;
      border: 0;
      border-left: 1px solid #e2e5e8;
      background: transparent;
      color: #596a7a;
      cursor: pointer;
      font-size: 14px;
    }
    #${PANEL_ID} .biligumi-collection-box button:first-child {
      border-left: 0;
    }
    #${PANEL_ID} .biligumi-collection-box button:hover {
      background: #edf5ff;
      color: var(--bgm-link);
    }
    #${PANEL_ID} .biligumi-card-line {
      border-top: 1px solid var(--bgm-line);
      margin: 8px 0;
    }
    #${PANEL_ID} .biligumi-rate-line {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    #${PANEL_ID} .biligumi-rate-text {
      color: #db4561;
      font-weight: 700;
    }
    #${PANEL_ID} .biligumi-stars {
      gap: 0;
      flex-wrap: nowrap;
    }
    #${PANEL_ID} .biligumi-star {
      font-size: 20px;
      color: #b7c7d6;
      text-shadow: 0 1px rgba(255,255,255,.65);
      transition: color .12s ease, transform .12s ease;
    }
    #${PANEL_ID} .biligumi-star.active,
    #${PANEL_ID} .biligumi-star.preview {
      color: var(--bgm-hot);
    }
    #${PANEL_ID} .biligumi-star:hover,
    #${PANEL_ID} .biligumi-star:focus-visible {
      transform: translateY(-1px);
    }
    #${PANEL_ID} .biligumi-rate-clear,
    #${SETTINGS_ID} .biligumi-rate-clear {
      width: 16px;
      height: 16px;
      border: 0;
      border-radius: 999px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      background: linear-gradient(#bfc3c8, #9298a0);
      color: #fff;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
      box-shadow: inset 0 1px rgba(255,255,255,.55);
    }
    #${PANEL_ID} .biligumi-rate-clear:hover,
    #${SETTINGS_ID} .biligumi-rate-clear:hover {
      background: linear-gradient(#aeb4bb, #7d858f);
    }
    #${PANEL_ID} .biligumi-progress-wrap {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
    }
    #${PANEL_ID} .biligumi-progress-bar {
      height: 28px;
      border: 1px solid #aab8c8;
      border-radius: 5px;
      background: rgba(255,255,255,.58);
    }
    #${PANEL_ID} .biligumi-progress-bar span {
      background: linear-gradient(135deg, #08a9fa 0%, #0cb5ff 42%, #25d5fb 42%, #179deb 100%);
    }
    #${PANEL_ID} .biligumi-progress-edit {
      display: grid;
      grid-template-columns: minmax(52px, 64px) auto minmax(72px, 84px);
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }
    #${PANEL_ID} .biligumi-progress-input {
      height: 30px;
      border-color: #b6c4d4;
      background: rgba(255,255,255,.75);
      text-align: center;
    }
    #${PANEL_ID} .biligumi-progress-total {
      color: #344252;
    }
    #${PANEL_ID} .biligumi-episode-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }
    #${PANEL_ID} .biligumi-progress-summary {
      color: #7b8794;
      font-size: 12px;
      white-space: nowrap;
    }
    #${PANEL_ID} .biligumi-button.primary {
      min-height: 32px;
      border: 0;
      border-radius: 999px;
      background: var(--bgm-pink-btn);
      color: #fff;
      font-weight: 700;
    }
    #${PANEL_ID} .biligumi-score-box {
      display: grid;
      grid-template-columns: 48px 1fr;
      gap: 8px;
      align-items: start;
    }
    #${PANEL_ID} .biligumi-score-icon {
      width: 45px;
      height: 38px;
      border-radius: 5px;
      background: linear-gradient(135deg, #ff8ad2, #ff38b0);
      color: #fff;
      font-weight: 700;
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 0 2px rgba(255,255,255,.48);
    }
    #${PANEL_ID} .biligumi-score-main {
      color: #7f8792;
      font-size: 13px;
    }
    #${PANEL_ID} .biligumi-score-value {
      color: #f0189b;
      font-size: 20px;
      font-weight: 800;
    }
    #${PANEL_ID} .biligumi-score-extra {
      margin-top: 2px;
      color: #7f8792;
      font-size: 12px;
    }
    #${PANEL_ID} .biligumi-histogram {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      align-items: end;
      gap: 5px;
      height: 112px;
      margin: 8px 8px 0;
    }
    #${PANEL_ID} .biligumi-hist-col {
      display: grid;
      align-items: end;
      gap: 3px;
      min-width: 0;
      color: #344252;
      text-align: center;
      font-size: 11px;
    }
    #${PANEL_ID} .biligumi-hist-bar {
      width: 100%;
      min-height: 2px;
      background: #397fb8;
      border-radius: 2px 2px 0 0;
    }
    #${PANEL_ID} .biligumi-hist-votes {
      margin-top: -2px;
      text-align: right;
      color: #7b8794;
      font-size: 14px;
    }
    #${PANEL_ID} .biligumi-hist-footer {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 4px;
      color: #344252;
      font-size: 13px;
    }
    #${PANEL_ID} .biligumi-search-pane {
      padding: 10px 14px 14px;
      background: #fff;
    }
    #${PANEL_ID} .biligumi-search-field {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 8px;
      align-items: center;
    }
    #${PANEL_ID} .biligumi-search-field input {
      grid-column: 1 / -1;
      height: 34px;
      padding: 4px 10px;
      border: 1px solid #b6c4d4;
      border-radius: 8px;
      background: rgba(255,255,255,.86);
      box-shadow: inset 0 1px 2px rgba(65, 87, 108, .08);
      appearance: none;
      -webkit-appearance: none;
      outline: none;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${PANEL_ID} .biligumi-search-field input:focus {
      border-color: #8aa9cc;
      box-shadow: 0 0 0 2px rgba(107, 153, 204, .18), inset 0 1px 2px rgba(65, 87, 108, .08);
    }
    #${PANEL_ID} .biligumi-search-button {
      min-height: 34px;
      height: 34px;
      min-width: 68px;
      padding: 0 16px;
      border: 1px solid #d27f99;
      border-radius: 8px;
      background: linear-gradient(#ee9ab1, #df7895);
      color: #fff;
      font-weight: 700;
      letter-spacing: 0;
      white-space: nowrap;
    }
    #${PANEL_ID} .biligumi-search-button:hover {
      border-color: #c86986;
      background: linear-gradient(#e890a9, #d96f8d);
      color: #fff;
    }
    #${PANEL_ID} .biligumi-search-help {
      min-width: 0;
      color: #7b8794;
      font-size: 12px;
      line-height: 1.35;
    }
    #${PANEL_ID} .biligumi-field input,
    #${PANEL_ID} .biligumi-field select {
      border-color: #b6c4d4;
      background: rgba(255,255,255,.78);
    }
    #${PANEL_ID} .biligumi-foot {
      padding: 8px 14px 11px;
      border-top: 1px solid var(--bgm-line);
      background: #fff;
      color: #7b8794;
    }
    #${PANEL_ID}.biligumi-panel-collapsed {
      background: #fff;
    }
    #${PANEL_ID}.biligumi-panel-collapsed .biligumi-head {
      border-bottom: 0;
    }
    #${SETTINGS_ID} {
      box-sizing: border-box;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(15, 23, 42, .28);
      font: 14px/1.45 Arial, "Microsoft YaHei", sans-serif;
    }
    #${SETTINGS_ID} * {
      box-sizing: border-box;
    }
    #${SETTINGS_ID} .biligumi-settings-dialog {
      width: min(760px, calc(100vw - 36px));
      max-height: calc(100vh - 36px);
      border: 1px solid #dfe3e8;
      border-radius: 10px;
      overflow: auto;
      background: #fff;
      box-shadow: 0 12px 28px rgba(52, 64, 84, .2);
    }
    #${SETTINGS_ID} .biligumi-settings-title {
      padding: 10px 12px;
      border-bottom: 1px solid #e2e5e8;
      background: linear-gradient(#f7f7f7, #f0f0f0);
      color: #596a7a;
      font-size: 14px;
    }
    #${SETTINGS_ID} .biligumi-collection-dialog .biligumi-settings-title {
      color: #e9829a;
      font-size: 18px;
      font-weight: 700;
    }
    #${SETTINGS_ID} .biligumi-settings-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
    }
    #${SETTINGS_ID} .biligumi-settings-field {
      min-width: 0;
    }
    #${SETTINGS_ID} .biligumi-settings-field label {
      display: block;
      margin-bottom: 6px;
      color: #6d7886;
      font-size: 13px;
    }
    #${SETTINGS_ID} .biligumi-comment-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    #${SETTINGS_ID} .biligumi-comment-count {
      color: #8a96a3;
      font-size: 12px;
      white-space: nowrap;
    }
    #${SETTINGS_ID} .biligumi-comment-count.warning {
      color: #d16b00;
    }
    #${SETTINGS_ID} .biligumi-settings-field input,
    #${SETTINGS_ID} .biligumi-settings-field textarea {
      width: 100%;
      border: 1px solid #cdd6e0;
      border-radius: 8px;
      background: #fff;
      color: #1f2329;
      outline: none;
      font: inherit;
    }
    #${SETTINGS_ID} .biligumi-settings-field input {
      height: 34px;
      padding: 4px 9px;
    }
    #${SETTINGS_ID} .biligumi-settings-field textarea {
      min-height: 112px;
      resize: vertical;
      padding: 8px 9px;
      line-height: 1.35;
    }
    #${SETTINGS_ID} .biligumi-settings-help {
      margin-top: 6px;
      color: #7b8794;
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    #${SETTINGS_ID} .biligumi-settings-help.compact {
      max-height: 52px;
      overflow: auto;
    }
    #${SETTINGS_ID} .biligumi-settings-help.warning {
      color: #d03030;
      font-weight: 600;
    }
    #${SETTINGS_ID} .biligumi-settings-check {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      color: #4f6072;
      font-size: 13px;
      line-height: 1.35;
    }
    #${SETTINGS_ID} .biligumi-settings-check input {
      width: auto;
      height: auto;
      margin: 2px 0 0;
      flex: 0 0 auto;
    }
    #${SETTINGS_ID} .biligumi-threshold-line {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 12px;
    }
    #${SETTINGS_ID} .biligumi-threshold-line input[type="range"] {
      height: auto;
      padding: 0;
      accent-color: #ea8fa3;
    }
    #${SETTINGS_ID} .biligumi-threshold-value {
      min-width: 42px;
      color: #4f6072;
      font-size: 13px;
      font-weight: 700;
      text-align: right;
    }
    #${SETTINGS_ID} .biligumi-settings-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 0 12px 12px;
    }
    #${SETTINGS_ID} .biligumi-collection-dialog .biligumi-settings-actions {
      justify-content: flex-start;
      align-items: center;
      gap: 10px;
      padding: 12px;
    }
    #${SETTINGS_ID} .biligumi-collection-dialog .biligumi-settings-actions .biligumi-edit-private {
      order: 2;
    }
    #${SETTINGS_ID} .biligumi-collection-dialog .biligumi-settings-actions .biligumi-button.primary {
      order: 1;
    }
    #${SETTINGS_ID} .biligumi-collection-dialog .biligumi-settings-actions .biligumi-button:not(.primary) {
      order: 3;
      margin-left: auto;
    }
    #${SETTINGS_ID} .biligumi-edit-types {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
      color: #5f6f80;
    }
    #${SETTINGS_ID} .biligumi-edit-types label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      font-size: 14px;
    }
    #${SETTINGS_ID} .biligumi-edit-stars {
      display: flex;
      gap: 0;
      margin-bottom: 10px;
    }
    #${SETTINGS_ID} .biligumi-edit-stars button {
      border: 0;
      padding: 0 1px;
      background: transparent;
      color: #b7c7d6;
      cursor: pointer;
      font-size: 22px;
      line-height: 1.1;
    }
    #${SETTINGS_ID} .biligumi-edit-stars .biligumi-rate-clear {
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
      margin: 4px 4px 0 0;
      padding: 0;
      font-size: 14px;
      color: #fff;
      background: linear-gradient(#bfc3c8, #9298a0);
      border-radius: 999px;
      box-shadow: inset 0 1px rgba(255,255,255,.55);
    }
    #${SETTINGS_ID} .biligumi-edit-stars button.active {
      color: #e96b2d;
    }
    #${SETTINGS_ID} .biligumi-edit-stars button.preview {
      color: #e96b2d;
      transform: translateY(-1px);
    }
    #${SETTINGS_ID} .biligumi-edit-rate-label {
      color: #db4561;
      font-weight: 700;
    }
    #${SETTINGS_ID} .biligumi-edit-rate-heading {
      margin-bottom: 4px;
      color: #1f2329;
    }
    #${SETTINGS_ID} .biligumi-tag-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    #${SETTINGS_ID} .biligumi-tag-pill {
      border: 0;
      border-radius: 999px;
      padding: 3px 9px;
      background: #edf0f3;
      color: #5f6f80;
      cursor: pointer;
      font-size: 12px;
    }
    #${SETTINGS_ID} .biligumi-tag-pill:hover,
    #${SETTINGS_ID} .biligumi-tag-pill.selected {
      background: #dfeeff;
      color: #1489d4;
    }
    #${SETTINGS_ID} .biligumi-edit-row {
      padding: 12px;
    }
    #${SETTINGS_ID} .biligumi-edit-row + .biligumi-edit-row {
      border-top: 1px solid #e2e5e8;
    }
    #${SETTINGS_ID} .biligumi-edit-private {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #344252;
      font-size: 13px;
    }
    #${SETTINGS_ID} .biligumi-button {
      min-height: 30px;
      padding: 4px 10px;
      border: 1px solid #dfe3e8;
      border-radius: 6px;
      background: #fff;
      color: #1f2329;
      cursor: pointer;
      font: inherit;
    }
    #${SETTINGS_ID} .biligumi-button.primary {
      border-color: #e68aa2;
      background: #e68aa2;
      color: #fff;
      font-weight: 700;
    }
    #${SETTINGS_ID} .biligumi-collection-dialog .biligumi-button.primary {
      min-height: 42px;
      padding: 0 26px;
      border-radius: 999px;
      background: #ea8fa3;
      font-size: 18px;
    }
    @media (max-width: 620px) {
      #${SETTINGS_ID} .biligumi-settings-body {
        grid-template-columns: 1fr;
      }
    }
    #${PANEL_ID}.biligumi-collapsed {
      border-radius: 10px;
      background: rgba(234, 244, 255, .96);
      box-shadow: 0 4px 14px rgba(92, 126, 164, .15);
    }
    #${PANEL_ID}.biligumi-collapsed .biligumi-head {
      padding: 9px 12px;
      border-bottom: 0;
    }
    #${PANEL_ID}.biligumi-collapsed .biligumi-title {
      font-size: 13px;
    }
    #${PANEL_ID} .biligumi-collapsed-note {
      padding: 0 12px 10px;
      color: #7b8794;
      font-size: 12px;
    }
  `);

  init();

  function init() {
    normalizeStoredWhitelist();
    refreshPageContext();
    state.subjectId = getCurrentBinding();
    injectWhenReady();
    observeRouteChanges();
    hookHistoryNavigation();
    bindAutoWatchProgressEvents();
  }

  function observeRouteChanges() {
    let lastHref = location.href;
    const observer = new MutationObserver(() => {
      if (lastHref === location.href) return;
      const previousRawTitle = state.rawTitle;
      lastHref = location.href;
      scheduleRouteRefresh(previousRawTitle);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  let routeRefreshSeq = 0;

  function hookHistoryNavigation() {
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      if (typeof original !== "function") return;
      history[method] = function (...args) {
        const previousHref = location.href;
        const previousRawTitle = state.rawTitle;
        const result = original.apply(this, args);
        if (previousHref !== location.href) scheduleRouteRefresh(previousRawTitle);
        return result;
      };
    });
    window.addEventListener("popstate", () => scheduleRouteRefresh(state.rawTitle));
  }

  function scheduleRouteRefresh(previousRawTitle) {
    const seq = ++routeRefreshSeq;
    state.busy = true;
    state.message = "正在等待 B站页面更新...";
    state.error = "";
    state.searchResults = [];
    render();
    [350, 900, 1800, 3000].forEach((delay, index, list) => {
      window.setTimeout(() => {
        refreshAfterRouteChange(seq, previousRawTitle, index === list.length - 1);
      }, delay);
    });
  }

  function refreshAfterRouteChange(seq, previousRawTitle, force) {
    if (seq !== routeRefreshSeq) return;
    const currentRawTitle = getPageTitle();
    const titleChanged = normalizeBindingToken(currentRawTitle) !== normalizeBindingToken(previousRawTitle);
    if (!force && previousRawTitle && !titleChanged) return;
    routeRefreshSeq += 1;

    refreshPageContext();
    state.subjectId = getCurrentBinding();
    state.subject = null;
    state.subjectInfoLinks = {};
    state.characters = [];
    state.characterError = "";
    state.previewSubject = null;
    state.previewCharacters = [];
    state.previewCharacterError = "";
    state.previewCharacterKey = "";
    state.previewCharacterBusy = false;
    state.collection = null;
    state.episodes = [];
    state.episodeCollections = [];
    state.busy = false;
    state.message = "";
    state.autoEpisodeSyncing = false;
    state.autoEpisodeSyncLastKey = "";
    state.autoWatchBlockedKey = "";
    injectWhenReady(true);
  }

  function refreshPageContext() {
    const rawTitle = getPageTitle();
    const seriesTitle = getSeriesTitle();
    state.pageKey = getPageKey();
    state.rawTitle = rawTitle;
    state.pageTitle = shouldUseRawTitleForPreview(rawTitle) ? cleanTitle(rawTitle) : cleanTitle(seriesTitle || rawTitle);
    state.currentEpisodeNo = detectCurrentEpisodeNo(rawTitle);
    const previewKeyword = shouldUseRawTitleForPreview(rawTitle) ? cleanTitle(rawTitle) : "";
    if (previewKeyword !== state.nonMainKeyword) {
      state.nonMainKeyword = "";
      state.nonMainResults = [];
      state.nonMainError = "";
      state.nonMainBusy = false;
      state.nonMainSearched = false;
      state.nonMainSearchSeq += 1;
    }
  }

  function getCurrentBinding() {
    for (const key of getBindingKeysForCurrentPage()) {
      if (state.bindings[key]) {
        migrateCurrentBindingKeys(state.bindings[key]);
        return state.bindings[key];
      }
    }
    const crossOwnerSubjectId = getCrossOwnerTitleBinding();
    if (crossOwnerSubjectId) {
      migrateCurrentBindingKeys(crossOwnerSubjectId);
      return crossOwnerSubjectId;
    }
    const nonMainSubjectId = getNonMainTitleBinding();
    if (nonMainSubjectId) {
      migrateCurrentBindingKeys(nonMainSubjectId);
      return nonMainSubjectId;
    }
    return null;
  }

  function migrateCurrentBindingKeys(subjectId) {
    let changed = false;
    for (const key of getBindingKeysForCurrentPage()) {
      if (!state.bindings[key]) {
        state.bindings[key] = subjectId;
        changed = true;
      }
    }
    if (changed) writeJsonValue(STORAGE.bindings, state.bindings);
  }

  function injectWhenReady(forceRefresh) {
    const existing = document.getElementById(PANEL_ID);
    if (existing && !forceRefresh) {
      repositionPanel();
      return;
    }
    if (existing) existing.remove();

    const host = findRightColumn();
    if (!host) {
      setTimeout(() => injectWhenReady(forceRefresh), 800);
      return;
    }

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "biligumi-panel";
    placePanel(host, panel);
    render();
    schedulePanelReposition();
    bindViewportLayoutEvents();

    if (shouldRenderFullPanel() && state.subjectId) {
      loadSubjectBundle().catch(showError);
    }
  }

  function findRightColumn() {
    const selectors = [
      ".right-container",
      ".bpx-player-sending-area + div",
      ".video-container-v1 .right-container",
      "#app .right",
      ".player-auxiliary-area",
      ".media-right",
      ".plp-r",
      ".plp-r-wrap",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetWidth > 240) return el;
    }

    const candidates = Array.from(document.querySelectorAll("aside, [class*='right'], [class*='Right']"));
    return candidates.find((el) => el.offsetWidth > 260 && el.offsetHeight > 120) || null;
  }

  function findPanelInsertReference(host) {
    const children = getVisibleChildren(host);
    const keywordReference = children.find((child) => {
      const text = (child.textContent || "").replace(/\s+/g, "");
      return ["弹幕列表", "接下来播放", "相关推荐", "相关视频", "视频推荐"].some((keyword) => text.includes(keyword));
    });
    if (keywordReference) return keywordReference;

    const deepKeywordReference = findDirectChildByText(host, ["弹幕列表", "接下来播放", "相关推荐", "相关视频", "视频推荐"]);
    if (deepKeywordReference) return deepKeywordReference;

    const directUpInfo = children.find((child) => {
      const text = (child.textContent || "").replace(/\s+/g, "");
      return text.includes("发消息") || text.includes("今天你想看些什么");
    });
    if (directUpInfo && directUpInfo.nextElementSibling && directUpInfo.nextElementSibling.id !== PANEL_ID) {
      return directUpInfo.nextElementSibling;
    }

    const deepUpInfo = findDirectChildByText(host, ["发消息", "今天你想看些什么"]);
    if (deepUpInfo && deepUpInfo.nextElementSibling && deepUpInfo.nextElementSibling.id !== PANEL_ID) {
      return deepUpInfo.nextElementSibling;
    }

    const selectorReference = [
      "[class*='danmaku']",
      "[class*='Danmaku']",
      "[class*='recommend']",
      "[class*='Recommend']",
      "[class*='rec-list']",
      "[class*='video-card']",
    ]
      .map((selector) => host.querySelector(selector))
      .map((node) => getDirectChild(host, node))
      .find((node) => node && node.id !== PANEL_ID && isVisible(node));
    if (selectorReference) return selectorReference;

    return children.length > 2 ? children[2] : null;
  }

  function placePanel(host, panel) {
    document.body.appendChild(panel);
    layoutPanelWithoutOwningBiliDom();
  }

  function schedulePanelReposition() {
    [250, 1000, 2500, 5000].forEach((delay) => {
      window.setTimeout(repositionPanel, delay);
    });
  }

  function bindViewportLayoutEvents() {
    if (window.__biligumiViewportEventsBound) return;
    window.__biligumiViewportEventsBound = true;
    window.addEventListener("scroll", () => window.requestAnimationFrame(repositionPanel), { passive: true });
    window.addEventListener("resize", () => window.requestAnimationFrame(repositionPanel), { passive: true });
  }

  function repositionPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    layoutPanelWithoutOwningBiliDom();
  }

  function layoutPanelWithoutOwningBiliDom() {
    const panel = document.getElementById(PANEL_ID);
    const rightColumn = findRightColumn();
    const inner = rightColumn && rightColumn.querySelector(".right-container-inner");
    const upPanel = inner && inner.querySelector(".up-panel-container, .up-info-container");
    const officialAnchor = rightColumn && findOfficialBangumiLayoutAnchor(rightColumn);
    const layoutAnchor = upPanel && isVisible(upPanel) ? upPanel : officialAnchor;
    if (!panel || !rightColumn || !layoutAnchor || !isVisible(layoutAnchor)) {
      if (panel) {
        panel.style.position = "fixed";
        panel.style.top = "";
        panel.style.left = "";
        panel.style.right = "";
      }
      clearReservedLayoutSpace();
      return;
    }

    panel.style.position = "absolute";
    panel.style.margin = "0";

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const rightRect = rightColumn.getBoundingClientRect();
    const anchorRect = layoutAnchor.getBoundingClientRect();
    panel.style.left = `${Math.round(rightRect.left + scrollX)}px`;
    panel.style.top = `${Math.round(anchorRect.bottom + scrollY + 12)}px`;
    panel.style.width = `${Math.round(rightRect.width)}px`;
    panel.style.right = "auto";

    const reserve = Math.ceil(panel.getBoundingClientRect().height + 24);
    reserveLayoutSpace(layoutAnchor, reserve);
  }

  function findOfficialBangumiLayoutAnchor(rightColumn) {
    if (!state.officialBangumiLayoutEnabled || !isOfficialBangumiPage()) return null;
    const modules = Array.from(rightColumn.querySelectorAll("#eplist_module, [class*='eplist_ep_list_wrapper']"))
      .filter(isVisible);
    const mainList = modules.find((node) => {
      const text = (node.textContent || "").replace(/\s+/g, "");
      return text.includes("正片") || text.includes("选集") || text.includes("剧集");
    });
    return mainList || modules[0] || null;
  }

  function reserveLayoutSpace(target, reserve) {
    const previous = window.__biligumiReservedLayoutTarget;
    if (previous && previous !== target) {
      previous.style.marginBottom = "";
      previous.__biligumiReserved = null;
    }
    if (target.__biligumiReserved !== reserve) {
      target.style.marginBottom = `${reserve}px`;
      target.__biligumiReserved = reserve;
    }
    window.__biligumiReservedLayoutTarget = target;
  }

  function clearReservedLayoutSpace() {
    const previous = window.__biligumiReservedLayoutTarget;
    if (!previous) return;
    previous.style.marginBottom = "";
    previous.__biligumiReserved = null;
    window.__biligumiReservedLayoutTarget = null;
  }

  function findDirectChildByText(host, keywords) {
    const normalizedKeywords = keywords.map((keyword) => keyword.replace(/\s+/g, ""));
    const nodes = Array.from(host.querySelectorAll("*")).slice(0, 400);
    for (const node of nodes) {
      if (node.id === PANEL_ID || node.closest(`#${PANEL_ID}`)) continue;
      const text = (node.textContent || "").replace(/\s+/g, "");
      if (!text || !normalizedKeywords.some((keyword) => text.includes(keyword))) continue;
      const child = getDirectChild(host, node);
      if (child && child.id !== PANEL_ID && isVisible(child)) return child;
    }
    return null;
  }

  function getVisibleChildren(host) {
    return Array.from(host.children).filter((child) => {
      const tagName = child.tagName && child.tagName.toLowerCase();
      return child.id !== PANEL_ID && tagName !== "script" && tagName !== "style" && isVisible(child);
    });
  }

  function getDirectChild(host, node) {
    let current = node;
    while (current && current.parentElement && current.parentElement !== host) {
      current = current.parentElement;
    }
    return current && current.parentElement === host ? current : null;
  }

  function isVisible(node) {
    return Boolean(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length));
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    updateCurrentWhitelistLabel();
    syncSettingsDialog();

    if (!shouldRenderFullPanel()) {
      removeSubjectInfoPanel();
      removeCharacterStrip();
      const nonMainKeyword = getNonMainPreviewKeyword();
      if (nonMainKeyword) {
        panel.className = "biligumi-panel";
        panel.innerHTML = renderNonMainPreview(nonMainKeyword);
        bindPanelEvents();
        layoutPanelWithoutOwningBiliDom();
        ensureNonMainPreviewSearch(nonMainKeyword);
        return;
      }

      panel.className = "biligumi-panel biligumi-collapsed";
      panel.innerHTML = `
        <div class="biligumi-head">
          <div class="biligumi-title">Bangumi 未在白名单</div>
          <div class="biligumi-actions">
            <button class="biligumi-icon-btn" data-action="add-whitelist" title="加入白名单">＋</button>
            <button class="biligumi-icon-btn" data-action="settings" title="设置 Access Token / 白名单">⚙</button>
          </div>
        </div>
        <div class="biligumi-collapsed-note">${escapeHtml(getWhitelistHint())}</div>
      `;
      bindPanelEvents();
      layoutPanelWithoutOwningBiliDom();
      return;
    }

    panel.className = `biligumi-panel${state.panelCollapsed ? " biligumi-panel-collapsed" : ""}`;
    const progress = getProgressInfo();
    const safeSubjectId = Number(state.subjectId) || 0;
    const bangumiUrl = safeSubjectId ? `${BGM_WEB_BASE}/subject/${safeSubjectId}` : `${BGM_WEB_BASE}/`;
    const subjectName = state.subject ? displaySubjectName(state.subject) : "Bangumi";
    const footerLink = state.subjectId
      ? `<a href="${bangumiUrl}" target="_blank" rel="noreferrer">打开 Bangumi</a>`
      : "";

    const headerHtml = `
      <div class="biligumi-head" data-action="toggle-panel" title="${state.panelCollapsed ? "展开 Bangumi 面板" : "折叠 Bangumi 面板"}">
        <div class="biligumi-title" title="${escapeHtml(subjectName)}">${escapeHtml(subjectName)}</div>
        <div class="biligumi-actions" data-action="noop">
          ${state.subjectId ? `<button class="biligumi-icon-btn" data-action="unbind" title="解绑当前 B站页面">解绑</button>` : `<button class="biligumi-icon-btn" disabled title="当前页面未绑定">未绑</button>`}
          <button class="biligumi-icon-btn" data-action="refresh" title="刷新">↻</button>
          <button class="biligumi-icon-btn" data-action="settings" title="设置 Access Token / 白名单">⚙</button>
        </div>
      </div>
    `;

    if (state.panelCollapsed) {
      panel.innerHTML = headerHtml;
      bindPanelEvents();
      layoutPanelWithoutOwningBiliDom();
      syncSubjectInfoPanel();
      syncCharacterStrip();
      return;
    }

    panel.innerHTML = `
      ${headerHtml}
      ${renderSearchOrSubject()}
      ${state.message ? `<div class="biligumi-notice">${escapeHtml(state.message)}</div>` : ""}
      ${state.error ? `<div class="biligumi-notice error">${escapeHtml(state.error)}</div>` : ""}
      <div class="biligumi-foot">
        <span>${state.busy ? "处理中..." : progress.summary} · v${SCRIPT_VERSION}</span>
        ${footerLink}
      </div>
    `;

    bindPanelEvents();
    layoutPanelWithoutOwningBiliDom();
    syncSubjectInfoPanel();
    syncCharacterStrip();
    const inlineAutoKeyword = getInlineAutoPreviewKeyword();
    if (inlineAutoKeyword) ensureNonMainPreviewSearch(inlineAutoKeyword);
  }

  function syncSubjectInfoPanel() {
    if (!state.subjectInfoPanelEnabled || !shouldRenderFullPanel() || !state.subjectId || !state.subject) {
      removeSubjectInfoPanel();
      return;
    }

    const host = findSubjectInfoInsertHost();
    if (!host) {
      window.setTimeout(syncSubjectInfoPanel, 900);
      return;
    }

    let box = document.getElementById(SUBJECT_INFO_ID);
    if (!box) {
      box = document.createElement("section");
      box.id = SUBJECT_INFO_ID;
    }
    box.className = host.officialCompact
      ? "biligumi-subject-overview biligumi-subject-official-compact"
      : host.sideLayout
        ? "biligumi-subject-overview biligumi-subject-sidebar"
        : "biligumi-subject-overview";

    if (host.mode === "after" && box.previousElementSibling !== host.node) {
      host.node.insertAdjacentElement("afterend", box);
    } else if (host.mode === "before" && box.nextElementSibling !== host.node) {
      host.node.parentElement.insertBefore(box, host.node);
    }
    syncSubjectSideLayout(host);

    box.innerHTML = renderSubjectInfoPanel();
  }

  function removeSubjectInfoPanel() {
    const box = document.getElementById(SUBJECT_INFO_ID);
    if (box) box.remove();
    clearSubjectSideLayout();
  }

  function syncCharacterStrip() {
    if (!state.characterStripEnabled || !shouldRenderFullPanel()) {
      removeCharacterStrip();
      return;
    }
    if (!getCharacterStripSubjectId() || !getCharacterStripSubject()) {
      if (isOfficialBangumiPage() && !state.subjectId) {
        ensureOfficialCharacterStripPreview();
        return;
      }
      removeCharacterStrip();
      return;
    }

    const host = findCharacterStripInsertHost();
    if (!host) {
      window.setTimeout(syncCharacterStrip, 900);
      return;
    }

    let strip = document.getElementById(CHARACTER_STRIP_ID);
    if (!strip) {
      strip = document.createElement("section");
      strip.id = CHARACTER_STRIP_ID;
    }

    const subjectInfo = document.getElementById(SUBJECT_INFO_ID);
    const shouldFollowSubjectInfo = subjectInfo
      && subjectInfo.parentElement
      && !subjectInfo.classList.contains("biligumi-subject-sidebar");
    if (shouldFollowSubjectInfo && strip.previousElementSibling !== subjectInfo) {
      subjectInfo.insertAdjacentElement("afterend", strip);
    } else if (host.mode === "after" && strip.previousElementSibling !== host.node && !shouldFollowSubjectInfo) {
      host.node.insertAdjacentElement("afterend", strip);
    } else if (host.mode === "before" && strip.nextElementSibling !== host.node) {
      host.node.parentElement.insertBefore(strip, host.node);
    }

    strip.innerHTML = renderCharacterStrip();
  }

  function ensureOfficialCharacterStripPreview() {
    if (!state.characterStripEnabled || state.subjectId || !isOfficialBangumiPage()) return;
    const keyword = getOfficialBangumiCharacterKeyword();
    if (!keyword) return;
    const key = normalizeBindingToken(keyword);
    if (state.previewCharacterBusy && state.previewCharacterKey === key) return;
    if (state.previewSubject && state.previewCharacterKey === key) return;
    if (state.previewCharacterFailedKey === key) return;

    state.previewCharacterBusy = true;
    state.previewCharacterKey = key;
    bgmRequest("/v0/search/subjects?limit=1", {
      method: "POST",
      body: { keyword, sort: "match", filter: { type: [2] } },
      dedup: true,
    })
      .then(async (response) => {
        const subject = response && Array.isArray(response.data) ? response.data[0] : null;
        if (!subject || !subject.id || state.subjectId || state.previewCharacterKey !== key) {
          if (!subject || !subject.id) state.previewCharacterFailedKey = key;
          return;
        }
        const charactersResult = await loadSubjectCharacters(subject.id);
        if (state.subjectId || state.previewCharacterKey !== key) return;
        state.previewSubject = subject;
        state.previewCharacters = charactersResult.characters;
        state.previewCharacterError = charactersResult.error;
        if (!charactersResult.characters.length && charactersResult.error) state.previewCharacterFailedKey = key;
      })
      .catch((error) => {
        if (state.previewCharacterKey !== key) return;
        state.previewSubject = null;
        state.previewCharacters = [];
        state.previewCharacterError = error && error.message ? error.message : "角色信息读取失败";
        state.previewCharacterFailedKey = key;
      })
      .finally(() => {
        if (state.previewCharacterKey === key) state.previewCharacterBusy = false;
        syncCharacterStrip();
      });
  }

  function getOfficialBangumiCharacterKeyword() {
    const mediaInfo = findOfficialBangumiMediaInfoNode();
    const titleEl = mediaInfo && (
      mediaInfo.querySelector("h1, h2, [class*='title'], [class*='Title'], [class*='mediaTitle']")
    );
    const fromNode = titleEl && (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
    return cleanTitle(fromNode || getSeriesTitle() || state.pageTitle || getPageTitle());
  }

  function removeCharacterStrip() {
    const strip = document.getElementById(CHARACTER_STRIP_ID);
    if (strip) strip.remove();
  }

  function renderSubjectInfoPanel() {
    const rows = getSubjectInfoRows();
    const isOfficialCompact = isOfficialBangumiPage();
    const subjectName = state.subject ? displaySubjectName(state.subject) : "Bangumi";
    const safeSubjectId = Number(state.subjectId) || 0;
    const bangumiUrl = `${BGM_WEB_BASE}/subject/${safeSubjectId}`;
    const image = getBestSubjectCover(state.subject);
    const body = rows.length
      ? rows.map(renderSubjectInfoRow).join("")
      : `<div class="biligumi-subject-info-row"><div class="biligumi-subject-info-value">暂时没有条目信息。</div></div>`;
    if (isOfficialCompact) {
      return `
        <div class="biligumi-subject-info-main">
          <div class="biligumi-subject-info-head">
            <div class="biligumi-subject-info-title">条目信息</div>
            <a class="biligumi-subject-info-more" href="${bangumiUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(subjectName)}">更多</a>
          </div>
          <div class="biligumi-subject-info-box">
            ${body}
          </div>
        </div>
      `;
    }
    return `
      <div class="biligumi-subject-cover-wrap">
        <a href="${bangumiUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(subjectName)}">
          ${image
            ? `<img class="biligumi-subject-cover" src="${escapeHtml(image)}" alt="${escapeHtml(subjectName)}" loading="lazy">`
            : `<div class="biligumi-subject-cover biligumi-subject-cover-placeholder">?</div>`}
        </a>
        <div class="biligumi-subject-name">${escapeHtml(subjectName)}</div>
      </div>
      <div class="biligumi-subject-info-main">
        <div class="biligumi-subject-info-head">
          <div class="biligumi-subject-info-title">条目信息</div>
          <a class="biligumi-subject-info-more" href="${bangumiUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(subjectName)}">更多</a>
        </div>
        <div class="biligumi-subject-info-box">
          ${body}
        </div>
      </div>
    `;
  }

  function getBestSubjectCover(subject) {
    const images = subject && subject.images ? subject.images : {};
    return images.large || images.common || images.medium || images.grid || images.small || "";
  }

  function getSubjectInfoRows() {
    const infobox = state.subject && Array.isArray(state.subject.infobox) ? state.subject.infobox : [];
    const rows = infobox
      .filter((item) => item && item.key && item.value != null)
      .map((item) => ({ key: String(item.key), value: item.value }));
    if (!isOfficialBangumiPage()) return rows;
    const startIndex = rows.findIndex((item) => isDirectorInfoKey(item.key));
    return startIndex >= 0 ? rows.slice(startIndex) : rows;
  }

  function isDirectorInfoKey(key) {
    return /^(?:导演|導演|監督|总导演|總導演|総監督)$/.test(String(key || "").trim());
  }

  function renderSubjectInfoRow(item) {
    return `
      <div class="biligumi-subject-info-row">
        <div class="biligumi-subject-info-key">${escapeHtml(item.key)}:</div>
        <div class="biligumi-subject-info-value">${renderSubjectInfoValue(item.value)}</div>
      </div>
    `;
  }

  function renderSubjectInfoValue(value) {
    if (Array.isArray(value)) {
      return value.map(renderSubjectInfoAtom).filter(Boolean).join('<span class="biligumi-subject-info-sep">、</span>');
    }
    return renderSubjectInfoAtom(value);
  }

  function renderSubjectInfoAtom(value) {
    if (value == null) return "";
    if (typeof value === "object") {
      const text = String(value.v || value.value || value.name || value.title || value.k || "").trim();
      if (!text) return "";
      const href = getSubjectInfoHref(value.href || value.url || value.k || text);
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>` : renderLinkedSubjectInfoText(text);
    }
    const text = String(value || "").trim();
    if (!text) return "";
    const href = getSubjectInfoHref(text);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>` : renderLinkedSubjectInfoText(text);
  }

  function renderLinkedSubjectInfoText(text) {
    const value = String(text || "");
    const exactHref = getSubjectInfoLinkByText(value);
    if (exactHref) {
      return `<a href="${escapeHtml(exactHref)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
    }
    const entries = getSubjectInfoLinkEntries();
    if (!entries.length) return escapeHtml(value);
    const matches = [];
    entries.forEach((entry) => {
      if (entry.text.length < 2) return;
      let start = 0;
      while (start < value.length) {
        const index = value.indexOf(entry.text, start);
        if (index < 0) break;
        matches.push({ index, end: index + entry.text.length, ...entry });
        start = index + entry.text.length;
      }
    });
    matches.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
    const picked = [];
    let cursor = 0;
    matches.forEach((match) => {
      if (match.index < cursor) return;
      picked.push(match);
      cursor = match.end;
    });
    if (!picked.length) return escapeHtml(value);
    let html = "";
    let offset = 0;
    picked.forEach((match) => {
      html += escapeHtml(value.slice(offset, match.index));
      html += `<a href="${escapeHtml(match.href)}" target="_blank" rel="noreferrer">${escapeHtml(value.slice(match.index, match.end))}</a>`;
      offset = match.end;
    });
    html += escapeHtml(value.slice(offset));
    return html;
  }

  function getSubjectInfoLinkByText(text) {
    const links = state.subjectInfoLinks || {};
    return links[normalizeSubjectInfoLinkText(text)] || "";
  }

  function getSubjectInfoLinkEntries() {
    const links = state.subjectInfoLinks || {};
    return Object.entries(links)
      .map(([text, href]) => ({ text, href }))
      .filter((entry) => entry.text && entry.href)
      .sort((a, b) => b.text.length - a.text.length);
  }

  function normalizeSubjectInfoLinkText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function getSubjectInfoHref(value) {
    const text = String(value || "").trim();
    if (/^https?:\/\//i.test(text)) return text;
    if (/^\/?(?:subject|person|character|ep|index|wiki)\//i.test(text)) {
      return `${BGM_WEB_BASE}/${text.replace(/^\/+/, "")}`;
    }
    return "";
  }

  function findSubjectInfoInsertHost() {
    const officialHost = findOfficialSubjectInfoInsertHost();
    if (officialHost) return officialHost;
    const sideHost = findPlayerSideSubjectHost();
    if (sideHost) return sideHost;
    clearSubjectSideLayout();
    return findLeftContentInsertHost();
  }

  function findOfficialSubjectInfoInsertHost() {
    if (!isOfficialBangumiPage()) return null;
    clearSubjectSideLayout();
    const mediaInfo = findOfficialBangumiMediaInfoNode();
    if (mediaInfo && mediaInfo.parentElement && isVisible(mediaInfo)) {
      return {
        node: mediaInfo,
        mode: "after",
        officialCompact: true,
      };
    }
    return null;
  }

  function findPlayerSideSubjectHost() {
    if (isOfficialBangumiPage()) return null;
    const player = document.querySelector("#playerWrap");
    const leftContainer = player && player.parentElement && player.parentElement.closest(".left-container");
    if (!isVisible(player) || !isVisible(leftContainer)) return null;
    const rect = leftContainer.getBoundingClientRect();
    if (rect.width < 620) return null;
    return { node: player, mode: "before", sideLayout: true, layoutContainer: leftContainer };
  }

  function syncSubjectSideLayout(host) {
    clearSubjectSideLayout(host && host.layoutContainer);
    if (host && host.sideLayout && host.layoutContainer) {
      host.layoutContainer.classList.add("biligumi-subject-side-layout");
    }
  }

  function clearSubjectSideLayout(except) {
    document.querySelectorAll(".biligumi-subject-side-layout").forEach((node) => {
      if (node !== except) node.classList.remove("biligumi-subject-side-layout");
    });
  }

  function findLeftContentInsertHost() {
    if (isOfficialBangumiPage()) {
      const officialSelectors = [
        ".media-info",
        ".media-info-wrp",
        ".media-info-wrap",
        ".media-info-container",
        ".media-desc",
        ".media-title",
        ".media-name",
        ".left-container-under-player",
        ".video-info-container",
        ".video-info",
        ".player-left-components",
        "[class*='under-player']",
        "[class*='video-info']",
        ".bangumi-info",
        ".bangumi-title",
        "[class*='media-info']",
        "[class*='bangumi-info']",
        "[class*='season-info']",
      ];
      for (const selector of officialSelectors) {
        const node = document.querySelector(selector);
        if (isVisible(node)) return { node, mode: "after" };
      }
    }

    const contentSelectors = [
      ".video-toolbar-container",
      ".left-container-under-player",
      ".video-info-container",
      ".video-info",
      "#viewbox_report",
      "#arc_toolbar_report",
      "[class*='under-player']",
      "[class*='video-info']",
      "[class*='toolbar']",
    ];
    for (const selector of contentSelectors) {
      const node = document.querySelector(selector);
      if (isVisible(node)) return { node, mode: "after" };
    }

    const tagSelectors = [
      ".video-tag-container",
      ".tag-panel",
      "[class*='video-tag']",
      "[class*='VideoTag']",
    ];
    for (const selector of tagSelectors) {
      const node = document.querySelector(selector);
      if (isVisible(node)) return { node, mode: "after" };
    }

    const commentSelectors = [
      "#comment",
      ".reply-warp",
      ".reply-wrap",
      ".comment-container",
      ".bili-comment-container",
      ".bb-comment",
      "[class*='comment']",
      "[class*='Comment']",
    ];
    for (const selector of commentSelectors) {
      const node = document.querySelector(selector);
      if (node && node.parentElement && isVisible(node)) return { node, mode: "before" };
    }

    return null;
  }

  function findCharacterStripInsertHost() {
    if (!isOfficialBangumiPage()) return findLeftContentInsertHost();

    const mediaInfo = findOfficialBangumiMediaInfoNode();
    if (mediaInfo && mediaInfo.parentElement && isVisible(mediaInfo)) {
      return { node: mediaInfo, mode: "after" };
    }

    const commentSelectors = [
      "#comment",
      ".reply-warp",
      ".reply-wrap",
      ".comment-container",
      ".bili-comment-container",
      "[class*='comment']",
      "[class*='Comment']",
    ];
    for (const selector of commentSelectors) {
      const node = document.querySelector(selector);
      if (node && node.parentElement && isVisible(node)) return { node, mode: "before" };
    }

    const player = findOfficialBangumiPlayerNode();
    if (player && player.parentElement && isVisible(player)) {
      return { node: player, mode: "after" };
    }

    return findLeftContentInsertHost();
  }

  function findOfficialBangumiMediaInfoNode() {
    const scopedSelectors = [
      ".player-left-components [class*='mediaInfoWrap']",
      ".player-left-components [class*='mediainfo']",
      ".player-left-components .media-info",
      ".player-left-components .media-info-wrp",
      ".player-left-components .media-info-wrap",
      ".player-left-components .media-info-container",
      ".player-left-components .media-desc",
    ];
    for (const selector of scopedSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (nodes.length) return nodes[nodes.length - 1];
    }

    const fallbackSelectors = [
      "[class*='mediaInfoWrap']",
      "[class*='mediainfo']",
      ".media-info",
      ".media-info-wrp",
      ".media-info-wrap",
      ".media-info-container",
    ];
    for (const selector of fallbackSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (nodes.length) return nodes[nodes.length - 1];
    }
    return null;
  }

  function findOfficialBangumiPlayerNode() {
    const candidates = [
      "#playerWrap",
      "#bilibili-player",
      ".bpx-player-container",
      "[class*='player-wrap']",
      "[class*='PlayerWrap']",
    ];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (!isVisible(node)) continue;
      const wrapper = node.closest("#playerWrap, [class*='player-wrap'], [class*='PlayerWrap']");
      return wrapper && wrapper.parentElement ? wrapper : node;
    }
    return null;
  }

  function renderCharacterStrip() {
    const subject = getCharacterStripSubject();
    const subjectId = getCharacterStripSubjectId();
    const subjectName = subject ? displaySubjectName(subject) : "Bangumi";
    const safeSubjectId = Number(subjectId) || 0;
    const bangumiCharactersUrl = `${BGM_WEB_BASE}/subject/${safeSubjectId}/characters`;
    const characters = getDisplayCharacters();
    const body = characters.length
      ? `<div class="biligumi-character-list">${characters.map(renderCharacterCard).join("")}</div>`
      : `<div class="biligumi-character-empty">${escapeHtml(getCharacterStripError() || "暂时没有角色/CV 信息。")}</div>`;
    return `
      <div class="biligumi-character-head">
        <div class="biligumi-character-title">角色 / CV</div>
        <a class="biligumi-character-more" href="${bangumiCharactersUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(subjectName)}">更多</a>
      </div>
      ${body}
    `;
  }

  function getDisplayCharacters() {
    const source = state.subjectId ? state.characters : state.previewCharacters;
    const characters = Array.isArray(source) ? source : [];
    return characters
      .filter((character) => character && character.name)
      .slice(0, 12);
  }

  function getCharacterStripSubjectId() {
    return state.subjectId || (state.previewSubject && state.previewSubject.id) || null;
  }

  function getCharacterStripSubject() {
    return state.subject || state.previewSubject || null;
  }

  function getCharacterStripError() {
    return state.subjectId ? state.characterError : state.previewCharacterError;
  }

  function renderCharacterCard(character) {
    const actor = Array.isArray(character.actors) ? character.actors[0] : null;
    const image = getBestCharacterImage(character);
    const characterId = Number(character.id) || 0;
    const characterUrl = characterId ? `${BGM_WEB_BASE}/character/${characterId}` : "";
    const actorName = actor && actor.name ? String(actor.name) : "";
    const actorId = Number(actor && actor.id) || 0;
    const actorUrl = actorId ? `${BGM_WEB_BASE}/person/${actorId}` : "";
    return `
      <div class="biligumi-character-card" title="${escapeHtml(character.name)}">
        ${characterUrl ? `<a href="${characterUrl}" target="_blank" rel="noreferrer">` : "<div>"}
          ${image
            ? `<img class="biligumi-character-cover" src="${escapeHtml(image)}" alt="${escapeHtml(character.name)}" loading="lazy">`
            : `<div class="biligumi-character-cover biligumi-character-placeholder">?</div>`}
        ${characterUrl ? "</a>" : "</div>"}
        ${characterUrl
          ? `<a class="biligumi-character-name" href="${characterUrl}" target="_blank" rel="noreferrer">${escapeHtml(character.name)}</a>`
          : `<div class="biligumi-character-name">${escapeHtml(character.name)}</div>`}
        <div class="biligumi-character-relation">${escapeHtml(character.relation || "角色")}</div>
        <div class="biligumi-character-cv">CV ${actorUrl ? `<a href="${actorUrl}" target="_blank" rel="noreferrer">${escapeHtml(actorName)}</a>` : escapeHtml(actorName || "未录入")}</div>
      </div>
    `;
  }

  function getBestCharacterImage(character) {
    const images = character && character.images ? character.images : {};
    const source = images.large || images.medium || images.grid || images.small || "";
    return getBgmCharacterCoverUrl(source) || images.large || normalizeBgmImageUrl(images.medium) || images.grid || normalizeBgmImageUrl(images.small) || "";
  }

  function getBgmCharacterCoverUrl(url) {
    const value = normalizeBgmImageUrl(url);
    return value
      .replace(/\/pic\/crt\/[lgs]\//, "/pic/crt/m/")
      .replace(/\/pic\/crt\/m\//, "/pic/crt/m/");
  }

  function normalizeBgmImageUrl(url) {
    return String(url || "").replace(/\/r\/(?:100|200|400)\//, "/");
  }

  function shouldRenderFullPanel() {
    return isWhitelistedPage() || isOfficialBangumiPage() || (isNonMainPreviewPage() && Boolean(state.subjectId));
  }

  function shouldAutoShowOfficialBangumiPanel() {
    return isOfficialBangumiPage();
  }

  function renderSearchOrSubject() {
    if (!state.subjectId || !state.subject) {
      return `
        <div class="biligumi-search-pane">
          <div class="biligumi-row">
            <div class="biligumi-label">绑定 Bangumi 条目</div>
            <div class="biligumi-search-field">
              <input data-role="search-keyword" value="${escapeHtml(suggestSearchKeyword())}" placeholder="输入番名或 Bangumi subject ID">
              <div class="biligumi-search-help">也可以直接粘贴 Bangumi 链接，例如 bgm.tv/subject/576351。</div>
              <button class="biligumi-search-button" data-action="search">搜索</button>
            </div>
          </div>
          ${renderInlineAutoPreview()}
          ${state.searchResults.length ? `<div class="biligumi-row biligumi-search-results">${state.searchResults.map(renderSearchResult).join("")}</div>` : ""}
          ${state.subjectId ? `<div class="biligumi-row"><button class="biligumi-button" data-action="unbind">解绑当前页面</button></div>` : ""}
        </div>
      `;
    }

    return `
      <div class="biligumi-card-body">
        ${renderCollectionSection()}
        <div class="biligumi-row">
          ${renderScoreBox()}
        </div>
      </div>
    `;
  }

  function renderCollectionSection() {
    if (!state.token) {
      return `
        <div class="biligumi-row">
          <div class="biligumi-current">未设置 Access Token，无法读取收藏盒。</div>
          <div class="biligumi-current-meta">设置 token 后可查看和同步收藏、评分、章节进度。</div>
        </div>
      `;
    }
    if (!hasCollection()) {
      return `
        <div class="biligumi-row">
          <div class="biligumi-label">收藏盒</div>
          <div class="biligumi-collection-box">
            ${Object.entries(SUBJECT_TYPES).map(([value, label]) => `
              <button data-action="set-collection-type" data-type="${value}" title="收藏为${escapeHtml(label)}">${escapeHtml(label)}</button>
            `).join("")}
          </div>
        </div>
      `;
    }
    return `
      <div class="biligumi-row">
        <div class="biligumi-current">
          ${escapeHtml(getCollectionSentence())}
          <button data-action="edit-collection" title="修改 Bangumi 记录">修改</button>
          <button data-action="delete-collection" title="删除 Bangumi 收藏记录">删除</button>
        </div>
        <div class="biligumi-current-meta">${escapeHtml(getCollectionUpdatedText())}</div>
      </div>
      <div class="biligumi-row">
        <div class="biligumi-label">我的评价 <span class="biligumi-rate-text" data-role="rate-preview">${escapeHtml(formatRatePreview(getRate()))}</span></div>
        <div class="biligumi-rate-line">
          <div class="biligumi-stars" data-role="rate-stars">
            <button class="biligumi-rate-clear" data-action="rate-clear" title="清除评分">−</button>
            ${Array.from({ length: 10 }, (_, i) => {
              const value = i + 1;
              return `<button class="biligumi-star ${value <= getRate() ? "active" : ""}" data-action="rate-star" data-rate="${value}" title="${value} 分">★</button>`;
            }).join("")}
          </div>
        </div>
      </div>
      ${renderEpisodeGrid()}
    `;
  }

  function renderNonMainPreview(keyword) {
    const rows = state.nonMainResults.slice(0, 2).map((subject) => renderNonMainCandidate(subject)).join("");
    const status = renderNonMainPreviewStatus(rows);
    return `
      <div class="biligumi-head">
        <div class="biligumi-title" title="${escapeHtml(keyword)}">${escapeHtml(keyword)}</div>
        <div class="biligumi-actions">
          ${isWhitelistedPage() ? "" : '<button class="biligumi-icon-btn" data-action="add-whitelist" title="加入白名单">＋</button>'}
          <button class="biligumi-icon-btn" data-action="settings" title="设置 Access Token / 白名单">⚙</button>
        </div>
      </div>
      <div class="biligumi-lite-note">检测到 OP / ED / PV / 预告，仅显示前 2 个 Bangumi 候选。</div>
      ${status}
      <div class="biligumi-foot">
        <span>轻量匹配 · v${SCRIPT_VERSION}</span>
        <a href="${BGM_WEB_BASE}/" target="_blank" rel="noreferrer">Bangumi</a>
      </div>
    `;
  }

  function renderInlineAutoPreview() {
    const keyword = getInlineAutoPreviewKeyword();
    if (!keyword) return "";
    const isNonMain = isNonMainPreviewPage();
    const rows = state.nonMainResults
      .slice(0, 2)
      .map((subject) => renderNonMainCandidate(subject, { canBind: true, canOpen: isNonMain }))
      .join("");
    const note = isNonMain
      ? `检测到 OP / ED / PV / 预告，下面是按「${escapeHtml(keyword)}」匹配的跳转候选。`
      : `下面是按「${escapeHtml(keyword)}」自动匹配的候选。`;
    return `
      <div class="biligumi-row">
        <div class="biligumi-lite-note">${note}</div>
        ${renderNonMainPreviewStatus(rows)}
      </div>
    `;
  }

  function renderNonMainPreviewStatus(rows) {
    return state.nonMainBusy
      ? '<div class="biligumi-lite-note">正在轻量匹配 Bangumi...</div>'
      : state.nonMainError
        ? `<div class="biligumi-lite-note">${escapeHtml(state.nonMainError)} <button class="biligumi-lite-bind" data-action="refresh-non-main">重试</button></div>`
        : rows
          ? `<div class="biligumi-lite-results">${rows}</div>`
          : '<div class="biligumi-lite-note">暂时没有匹配候选。</div>';
  }

  function renderNonMainCandidate(subject, options = {}) {
    const canBind = typeof options === "boolean" ? options : Boolean(options.canBind);
    const canOpen = typeof options === "boolean" ? true : options.canOpen !== false;
    const subjectId = Number(subject && subject.id) || 0;
    if (!subjectId) return "";
    const name = displaySubjectName(subject);
    const date = subject.date || "未知日期";
    const eps = subject.eps ? `${subject.eps} 话` : "话数未知";
    const bindButton = canBind ? `<button class="biligumi-lite-bind" data-action="bind" data-subject-id="${subjectId}">绑定</button>` : "";
    const openLink = canOpen ? `<a class="biligumi-lite-open" href="${BGM_WEB_BASE}/subject/${subjectId}" target="_blank" rel="noreferrer">打开</a>` : "";
    return `
      <div class="biligumi-lite-result">
        <div>
          <div class="biligumi-lite-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="biligumi-lite-sub">${escapeHtml(date)} · ${escapeHtml(eps)}</div>
        </div>
        <div class="biligumi-lite-actions">
          ${openLink}
          ${bindButton}
        </div>
      </div>
    `;
  }

  function renderSettingsDialog() {
    const currentHints = formatWhitelistHintCandidates();
    const autoWatchThreshold = getAutoWatchThreshold();
    const autoWatchScopeLabel = getAutoWatchScopeLabel();
    return `
      <div class="biligumi-settings-dialog" data-action="noop">
        <div class="biligumi-settings-title">设置</div>
        <div class="biligumi-settings-body">
          <div class="biligumi-settings-field">
            <label for="biligumi-token-input">Bangumi Access Token</label>
            <input id="biligumi-token-input" data-role="settings-token" value="${escapeHtml(state.token || "")}" placeholder="粘贴 Bangumi Access Token">
            <div class="biligumi-settings-help">可在 next.bgm.tv/demo/access-token 生成；留空表示只读取公开信息。</div>
          </div>
          <div class="biligumi-settings-field">
            <label for="biligumi-whitelist-input">Bilibili 白名单</label>
            <textarea id="biligumi-whitelist-input" data-role="settings-whitelist" placeholder="每行一个 UP 主 UID/名称、BV、页面 key 或 URL 片段">${escapeHtml(formatWhitelistForSettings())}</textarea>
            <div class="biligumi-settings-help compact">当前页面候选：${escapeHtml(currentHints || "无")}</div>
          </div>
          <div class="biligumi-settings-field">
            <label class="biligumi-settings-check">
              <input type="checkbox" data-role="settings-non-main-preview" ${state.nonMainPreviewEnabled ? "checked" : ""}>
              <span>OP / ED / PV / 预告页面无视白名单显示 2 个轻量 Bangumi 候选。</span>
            </label>
            <div class="biligumi-settings-help">如果清洗出的番名已经绑定过，会直接显示正常面板。</div>
          </div>
          <div class="biligumi-settings-field">
            <label class="biligumi-settings-check">
              <input type="checkbox" data-role="settings-character-strip" ${state.characterStripEnabled ? "checked" : ""}>
              <span>在 Bilibili 正文评论区上方显示 Bangumi 角色 / CV 横栏。</span>
            </label>
            <div class="biligumi-settings-help">关闭后只隐藏正文横栏，右侧 Bangumi 面板不受影响。</div>
          </div>
          <div class="biligumi-settings-field">
            <label class="biligumi-settings-check">
              <input type="checkbox" data-role="settings-subject-info-panel" ${state.subjectInfoPanelEnabled ? "checked" : ""}>
              <span>在 Bilibili 正文显示 Bangumi 风格条目信息栏。</span>
            </label>
            <div class="biligumi-settings-help">默认关闭；会显示封面和公开 infobox 字段，并尽量解析 Bangumi 页面补全制作人员链接。</div>
            <div class="biligumi-settings-help warning">注意：此功能会对界面排版进行大量更改，并且带来一定性能开销。</div>
          </div>
          <div class="biligumi-settings-field">
            <label class="biligumi-settings-check">
              <input type="checkbox" data-role="settings-official-bangumi-layout" ${state.officialBangumiLayoutEnabled ? "checked" : ""}>
              <span>实验兼容 Bilibili 官方番剧页右侧布局，把 PV / 相关推荐列表下移给面板让位。</span>
            </label>
            <div class="biligumi-settings-help">官方源不是推荐使用场景；如果页面布局异常，可以关闭这个开关。</div>
          </div>
          <div class="biligumi-settings-field">
            <label for="biligumi-auto-watch-threshold">自动标记本集已看</label>
            <div class="biligumi-threshold-line">
              <input id="biligumi-auto-watch-threshold" type="range" min="10" max="100" step="10" data-role="settings-auto-watch-threshold" value="${autoWatchThreshold}">
              <span class="biligumi-threshold-value" data-role="settings-auto-watch-threshold-value">${autoWatchThreshold}%</span>
            </div>
            <div class="biligumi-settings-help">当前来源：${escapeHtml(autoWatchScopeLabel)}。播放器进度达到此比例后自动把当前集标为看过；单次向前跳转超过 5 分钟并越过标准线时不会触发。</div>
          </div>
        </div>
        <div class="biligumi-settings-actions">
          <button class="biligumi-button" data-action="settings-cancel">取消</button>
          <button class="biligumi-button primary" data-action="settings-save">保存</button>
        </div>
      </div>
    `;
  }

  function formatWhitelistHintCandidates() {
    const candidates = getWhitelistCandidates()
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => value.length > 42 ? `${value.slice(0, 39)}...` : value)
      .filter((value, index, list) => list.indexOf(value) === index);
    return candidates.slice(0, 5).join(", ");
  }

  function formatWhitelistForSettings() {
    return state.whitelist
      .map((item) => {
        const label = getWhitelistLabel(item);
        return label ? `${item} # ${label}` : item;
      })
      .join("\n");
  }

  function renderCollectionEditorDialog() {
    const type = getCollectionType();
    const rate = getRate();
    const currentTags = state.collection && Array.isArray(state.collection.tags) ? state.collection.tags : [];
    const tags = currentTags.join(" ");
    const commonTags = getCommonTags();
    const comment = state.collection && state.collection.comment ? state.collection.comment : "";
    const isPrivate = Boolean(state.collection && state.collection.private);
    return `
      <div class="biligumi-settings-dialog biligumi-collection-dialog" data-action="noop">
        <div class="biligumi-settings-title">修改收藏</div>
        <div class="biligumi-edit-row">
          <div class="biligumi-edit-types">
            ${Object.entries(SUBJECT_TYPES).map(([value, label]) => `
              <label><input type="radio" name="biligumi-edit-type" data-role="edit-type" value="${value}" ${Number(value) === type ? "checked" : ""}> ${escapeHtml(label)}</label>
            `).join("")}
          </div>
          <div class="biligumi-edit-rate-heading">我的评价 <span class="biligumi-edit-rate-label" data-role="edit-rate-label">${escapeHtml(formatRatePreview(rate))}</span></div>
          <div class="biligumi-edit-stars" data-role="edit-rate-stars">
            <button class="biligumi-rate-clear" data-action="edit-rate" data-rate="0" title="清除评分">−</button>
            ${Array.from({ length: 10 }, (_, i) => {
              const value = i + 1;
              return `<button data-action="edit-rate" data-rate="${value}" class="${value <= rate ? "active" : ""}" title="${value} 分">★</button>`;
            }).join("")}
          </div>
          <input type="hidden" data-role="edit-rate" value="${rate}">
        </div>
        <div class="biligumi-edit-row">
          <div class="biligumi-settings-field">
            <label for="biligumi-edit-tags">标签（使用半角空格或逗号隔开，至多10个）</label>
            <input id="biligumi-edit-tags" data-role="edit-tags" value="${escapeHtml(tags)}">
            ${commonTags.length ? `
              <div class="biligumi-settings-help">常用标签</div>
              <div class="biligumi-tag-pills">
                ${commonTags.map((tag) => `<button class="biligumi-tag-pill ${currentTags.includes(tag) ? "selected" : ""}" data-action="add-edit-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
              </div>
            ` : ""}
            ${currentTags.length ? `
              <div class="biligumi-settings-help">我的标签</div>
              <div class="biligumi-tag-pills">
                ${currentTags.map((tag) => `<button class="biligumi-tag-pill selected" data-action="add-edit-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
              </div>
            ` : ""}
          </div>
        </div>
        <div class="biligumi-edit-row">
          <div class="biligumi-settings-field">
            <label class="biligumi-comment-label" for="biligumi-edit-comment">
              <span>吐槽</span>
              <span class="biligumi-comment-count" data-role="edit-comment-count"></span>
            </label>
            <textarea id="biligumi-edit-comment" data-role="edit-comment" maxlength="${COLLECTION_COMMENT_MAX_LENGTH}">${escapeHtml(comment)}</textarea>
            <div class="biligumi-settings-help">最多 ${COLLECTION_COMMENT_MAX_LENGTH} 字。</div>
          </div>
        </div>
        <div class="biligumi-settings-actions">
          <button class="biligumi-button primary" data-action="collection-save">保存</button>
          <label class="biligumi-edit-private"><input type="checkbox" data-role="edit-private" ${isPrivate ? "checked" : ""}> 仅自己可见</label>
          <button class="biligumi-button" data-action="collection-cancel">取消</button>
        </div>
      </div>
    `;
  }

  function renderSearchResult(subject) {
    const subjectId = Number(subject && subject.id) || 0;
    if (!subjectId) return "";
    const image = subject.images && (subject.images.grid || subject.images.small || subject.images.common);
    const name = displaySubjectName(subject);
    const date = subject.date || "未知日期";
    const eps = subject.eps ? `${subject.eps} 话` : "话数未知";
    return `
      <div class="biligumi-result">
        ${image ? `<img src="${escapeHtml(image)}" alt="">` : "<div></div>"}
        <div class="biligumi-result-body">
          <div class="biligumi-result-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="biligumi-result-sub">${escapeHtml(date)} · ${escapeHtml(eps)}</div>
        </div>
        <button class="biligumi-button primary" data-action="bind" data-subject-id="${subjectId}">绑定</button>
      </div>
    `;
  }

  function renderScoreBox() {
    const rating = state.subject && state.subject.rating ? state.subject.rating : {};
    const score = Number(rating.score) || 0;
    const total = Number(rating.total) || getRatingTotal();
    const rank = Number(rating.rank) || 0;
    return `
      <div class="biligumi-score-box">
        <div class="biligumi-score-icon">BGM</div>
        <div>
          <div class="biligumi-score-main">
            <span class="biligumi-score-value">${escapeHtml(formatPublicScore(score))}</span>
            ${escapeHtml(getScoreLabel(score))}
          </div>
          <div class="biligumi-score-extra">${rank ? `Bangumi Anime Ranked:#${rank}` : "Bangumi Anime Ranked: 暂无"}</div>
          <div class="biligumi-hist-votes">${escapeHtml(formatNumber(total))} votes</div>
          ${renderRatingHistogram()}
          <div class="biligumi-hist-footer">
            <span>标准差： ${escapeHtml(getRatingStdDev())}</span>
            <span>争议度： <span style="color:#159c62">${escapeHtml(getDisputeLabel())}</span></span>
          </div>
        </div>
      </div>
    `;
  }

  function renderRatingHistogram() {
    const counts = getRatingCounts();
    const max = Math.max(1, ...counts.map((item) => item.count));
    return `
      <div class="biligumi-histogram">
        ${counts.map((item) => {
          const height = Math.max(2, Math.round((item.count / max) * 94));
          return `
            <div class="biligumi-hist-col" title="${item.score}: ${item.count}">
              <div class="biligumi-hist-bar" style="height:${height}px"></div>
              <div>${item.score}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function getRatingCounts() {
    const count = state.subject && state.subject.rating && state.subject.rating.count;
    return Array.from({ length: 10 }, (_, i) => {
      const score = 10 - i;
      return { score, count: Number(count && count[score]) || 0 };
    });
  }

  function getRatingTotal() {
    return getRatingCounts().reduce((sum, item) => sum + item.count, 0);
  }

  function getRatingStdDev() {
    const counts = getRatingCounts();
    const total = counts.reduce((sum, item) => sum + item.count, 0);
    if (!total) return "暂无";
    const mean = counts.reduce((sum, item) => sum + item.score * item.count, 0) / total;
    const variance = counts.reduce((sum, item) => sum + Math.pow(item.score - mean, 2) * item.count, 0) / total;
    return Math.sqrt(variance).toFixed(4);
  }

  function getDisputeLabel() {
    const std = Number(getRatingStdDev());
    if (!Number.isFinite(std)) return "暂无";
    if (std < 1) return "异口同声";
    if (std < 1.15) return "基本一致";
    if (std < 1.3) return "略有分歧";
    if (std < 1.45) return "莫衷一是";
    if (std < 1.6) return "各执一词";
    if (std < 1.75) return "你死我活";
    return "厨大战";
  }

  function getScoreLabel(score) {
    const value = Number(score) || 0;
    return value ? getRateLevel(Math.round(value)) : "";
  }

  function formatPublicScore(score) {
    const value = Number(score) || 0;
    return value ? value.toFixed(1) : "暂无";
  }

  function getCommonTags() {
    const tags = state.subject && Array.isArray(state.subject.tags) ? state.subject.tags : [];
    return tags
      .map((tag) => ({
        name: String(tag.name || "").trim(),
        count: Number(tag.count) || 0,
      }))
      .filter((tag) => tag.name)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 16)
      .map((tag) => tag.name);
  }

  function renderEpisodeGrid() {
    const episodes = getNormalEpisodes();
    const progress = getProgressInfo();
    if (!episodes.length) {
      return `
        <div class="biligumi-row">
          <div class="biligumi-episode-head">
            <div class="biligumi-label">我的完成度</div>
            <span class="biligumi-progress-summary">${escapeHtml(progress.summary)}</span>
          </div>
        </div>
      `;
    }
    return `
      <div class="biligumi-row">
        <div class="biligumi-episode-head">
          <div class="biligumi-label">我的完成度</div>
          <span class="biligumi-progress-summary">${escapeHtml(progress.summary)}</span>
        </div>
        <div class="biligumi-episode-grid">
          ${episodes.map((ep) => {
            const sort = Number(ep.sort);
            const episodeId = Number(ep.id) || 0;
            const done = getEpisodeCollectionType(ep.id) === 2;
            const current = state.currentEpisodeNo && sort === state.currentEpisodeNo;
            return `<button class="biligumi-episode ${done ? "done" : ""} ${current ? "current" : ""}" data-action="toggle-episode" data-episode-id="${episodeId}" data-done="${done ? "1" : "0"}">${escapeHtml(formatEpisodeSort(sort))}</button>`;
          }).join("")}
        </div>
        <div class="biligumi-progress-edit">
          <input class="biligumi-progress-input" data-role="progress" type="number" min="0" max="${progress.total}" value="${progress.watched}">
          <span class="biligumi-progress-total">/ ${progress.total || "??"}</span>
          <button class="biligumi-button primary" data-action="save-progress">更新</button>
        </div>
      </div>
    `;
  }

  function bindPanelEvents() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const typeSelect = panel.querySelector("[data-role='subject-type']");
    if (typeSelect) {
      typeSelect.addEventListener("change", () => updateCollection({ type: Number(typeSelect.value) }).catch(showError));
    }

    const rateSelect = panel.querySelector("[data-role='rate']");
    if (rateSelect) {
      rateSelect.addEventListener("change", () => updateCollection({ rate: Number(rateSelect.value) }).catch(showError));
    }

    const starBox = panel.querySelector("[data-role='rate-stars']");
    if (starBox) {
      starBox.addEventListener("mouseover", handleRatePreviewEvent);
      starBox.addEventListener("focusin", handleRatePreviewEvent);
      starBox.addEventListener("mouseout", handleRatePreviewLeave);
      starBox.addEventListener("focusout", handleRatePreviewLeave);
    }
  }

  document.addEventListener("click", handlePanelClick, true);

  function handlePanelClick(event) {
    const panel = document.getElementById(PANEL_ID);
    const settings = document.getElementById(SETTINGS_ID);
    const inPanel = Boolean(panel && panel.contains(event.target));
    const inSettings = Boolean(settings && settings.contains(event.target));
    if (!inPanel && !inSettings) return;

    const target = event.target.closest("[data-action]");
    if (!target || !(inPanel ? panel.contains(target) : settings.contains(target))) return;

    const action = target.dataset.action;
    if (action === "noop") return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    if (action === "toggle-panel") togglePanelCollapsed();
    if (action === "settings") openSettings();
    if (action === "settings-cancel") closeSettings();
    if (action === "settings-save") saveSettings();
    if (action === "edit-rate") setEditorRate(Number(target.dataset.rate));
    if (action === "add-edit-tag") addEditorTag(target.dataset.tag || "");
    if (action === "add-whitelist") addCurrentPageToWhitelist();
    if (action === "refresh") loadSubjectBundle().catch(showError);
    if (action === "refresh-non-main") retryNonMainPreviewSearch();
    if (action === "search") searchSubjects().catch(showError);
    if (action === "bind") bindSubject(Number(target.dataset.subjectId)).catch(showError);
    if (action === "unbind") unbindSubject();
    if (action === "edit-collection") openCollectionEditor();
    if (action === "collection-cancel") closeCollectionEditor();
    if (action === "collection-save") saveCollectionEditor().catch(showError);
    if (action === "set-collection-type") updateCollection({ type: Number(target.dataset.type) }).catch(showError);
    if (action === "delete-collection") deleteCollection().catch(showError);
    if (action === "cycle-type") cycleCollectionType().catch(showError);
    if (action === "rate-star") rateSubject(Number(target.dataset.rate)).catch(showError);
    if (action === "rate-clear") rateSubject(0).catch(showError);
    if (action === "save-progress") saveProgressFromInput().catch(showError);
    if (action === "toggle-episode") toggleEpisode(Number(target.dataset.episodeId), target.dataset.done === "1").catch(showError);
  }

  function handleRatePreviewEvent(event) {
    const star = event.target.closest("[data-rate]");
    if (!star) return;
    previewRate(Number(star.dataset.rate));
  }

  function handleRatePreviewLeave(event) {
    const starBox = event.currentTarget;
    const next = event.relatedTarget;
    if (next && starBox.contains(next)) return;
    previewRate(getRate());
  }

  function previewRate(score) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const safeScore = Math.max(0, Math.min(10, Number(score) || 0));
    const label = panel.querySelector("[data-role='rate-preview']");
    if (label) label.textContent = formatRatePreview(safeScore);
    panel.querySelectorAll(".biligumi-star").forEach((star) => {
      const value = Number(star.dataset.rate) || 0;
      star.classList.toggle("preview", value <= safeScore);
      star.classList.toggle("active", value <= safeScore);
    });
  }

  function setEditorRate(rate) {
    const safeRate = Math.max(0, Math.min(10, Math.round(Number(rate) || 0)));
    const dialog = document.getElementById(SETTINGS_ID);
    if (!dialog) return;
    const input = dialog.querySelector("[data-role='edit-rate']");
    const label = dialog.querySelector("[data-role='edit-rate-label']");
    if (input) input.value = String(safeRate);
    if (label) label.textContent = formatRatePreview(safeRate);
    dialog.querySelectorAll("[data-action='edit-rate']").forEach((star) => {
      star.classList.toggle("active", Number(star.dataset.rate) <= safeRate);
      star.classList.toggle("preview", false);
    });
  }

  function previewEditorRate(rate) {
    const dialog = document.getElementById(SETTINGS_ID);
    if (!dialog) return;
    const safeRate = Math.max(0, Math.min(10, Math.round(Number(rate) || 0)));
    const label = dialog.querySelector("[data-role='edit-rate-label']");
    if (label) label.textContent = formatRatePreview(safeRate);
    dialog.querySelectorAll("[data-action='edit-rate']").forEach((star) => {
      star.classList.toggle("preview", Number(star.dataset.rate) <= safeRate);
    });
  }

  function restoreEditorRatePreview() {
    const dialog = document.getElementById(SETTINGS_ID);
    const input = dialog && dialog.querySelector("[data-role='edit-rate']");
    if (!input) return;
    previewEditorRate(Number(input.value));
    dialog.querySelectorAll("[data-action='edit-rate']").forEach((star) => star.classList.remove("preview"));
  }

  function addEditorTag(tag) {
    const input = document.querySelector(`#${SETTINGS_ID} [data-role='edit-tags']`);
    if (!input || !tag) return;
    const tags = parseTags(input.value);
    if (!tags.includes(tag) && tags.length < 10) tags.push(tag);
    input.value = tags.join(" ");
  }

  function togglePanelCollapsed() {
    state.panelCollapsed = !state.panelCollapsed;
    writeValue(STORAGE.panelCollapsed, state.panelCollapsed ? "1" : "0");
    render();
  }

  async function cycleCollectionType() {
    const order = [3, 2, 1, 4, 5];
    const current = getCollectionType();
    const next = order[(Math.max(0, order.indexOf(current)) + 1) % order.length];
    await updateCollection({ type: next });
  }

  async function searchSubjects() {
    const input = document.querySelector(`#${PANEL_ID} [data-role='search-keyword']`);
    const keyword = (input && input.value.trim()) || suggestSearchKeyword();
    if (!keyword) throw new Error("请输入番名再搜索");

    const directSubjectId = parseBangumiSubjectId(keyword);
    if (directSubjectId) {
      await bindSubjectFromDirectInput(directSubjectId);
      return;
    }

    setBusy("正在搜索 Bangumi...");
    const response = await bgmRequest("/v0/search/subjects?limit=8", {
      method: "POST",
      body: { keyword, sort: "match", filter: { type: [2] } },
      dedup: true,
    });
    state.searchResults = response.data || [];
    state.message = state.searchResults.length ? "请选择正确的 Bangumi 条目绑定。" : "没有搜到结果，可以换个关键词。";
    state.error = "";
    state.busy = false;
    render();
    checkAutoWatchProgress().catch(showError);
  }

  function ensureNonMainPreviewSearch(keyword) {
    const searchKeyword = String(keyword || "").trim();
    if (!searchKeyword) return;
    if (state.nonMainKeyword === searchKeyword && (state.nonMainBusy || state.nonMainSearched || state.nonMainError)) return;
    const seq = ++state.nonMainSearchSeq;
    state.nonMainKeyword = searchKeyword;
    state.nonMainBusy = true;
    state.nonMainError = "";
    state.nonMainResults = [];
    state.nonMainSearched = false;
    const promise = loadNonMainPreviewCandidates(searchKeyword, seq)
      .catch((error) => {
        if (seq !== state.nonMainSearchSeq) return;
        state.nonMainBusy = false;
        state.nonMainSearched = true;
        state.nonMainError = error && error.message ? error.message : "轻量匹配失败。";
        render();
      })
      .finally(() => {
        if (nonMainPreviewRequests.get(searchKeyword) === promise) nonMainPreviewRequests.delete(searchKeyword);
      });
    nonMainPreviewRequests.set(searchKeyword, promise);
    render();
  }

  function retryNonMainPreviewSearch() {
    const keyword = state.nonMainKeyword || getNonMainPreviewKeyword() || getInlineAutoPreviewKeyword();
    state.nonMainKeyword = "";
    state.nonMainResults = [];
    state.nonMainError = "";
    state.nonMainBusy = false;
    state.nonMainSearched = false;
    state.nonMainSearchSeq += 1;
    ensureNonMainPreviewSearch(keyword);
  }

  async function loadNonMainPreviewCandidates(keyword, seq) {
    const response = await bgmRequest("/v0/search/subjects?limit=2", {
      method: "POST",
      body: { keyword, sort: "match", filter: { type: [2] } },
      dedup: true,
    });
    if (seq !== state.nonMainSearchSeq) return;
    state.nonMainResults = (response.data || []).slice(0, 2);
    state.nonMainBusy = false;
    state.nonMainError = "";
    state.nonMainSearched = true;
    render();
  }

  async function bindSubjectFromDirectInput(subjectId) {
    setBusy(`正在读取 Bangumi 条目 ${subjectId}...`);
    const subject = await bgmRequest(`/v0/subjects/${subjectId}`);
    state.searchResults = [];
    state.message = `已通过 Bangumi 链接/ID 绑定：${displaySubjectName(subject)}`;
    state.error = "";
    state.subject = subject;
    await bindSubject(subjectId);
  }

  async function bindSubject(subjectId) {
    state.subjectId = subjectId;
    state.subjectInfoLinks = {};
    state.characters = [];
    state.characterError = "";
    state.previewSubject = null;
    state.previewCharacters = [];
    state.previewCharacterError = "";
    state.previewCharacterKey = "";
    state.previewCharacterBusy = false;
    state.previewCharacterFailedKey = "";
    for (const key of getBindingKeysForCurrentPage()) {
      state.bindings[key] = subjectId;
    }
    writeJsonValue(STORAGE.bindings, state.bindings);
    state.searchResults = [];
    await loadSubjectBundle();
  }

  function unbindSubject() {
    if (!state.subjectId) {
      state.message = "当前页面没有绑定 Bangumi 条目。";
      state.error = "";
      render();
      return;
    }
    const ok = window.confirm("只解除当前 B站页面和 Bangumi 条目的绑定，不会删除 Bangumi 记录。确定解绑吗？");
    if (!ok) return;
    for (const key of getBindingKeysForCurrentPage()) {
      delete state.bindings[key];
    }
    writeJsonValue(STORAGE.bindings, state.bindings);
    state.subjectId = null;
    state.subject = null;
    state.subjectInfoLinks = {};
    state.characters = [];
    state.characterError = "";
    state.previewSubject = null;
    state.previewCharacters = [];
    state.previewCharacterError = "";
    state.previewCharacterKey = "";
    state.previewCharacterBusy = false;
    state.previewCharacterFailedKey = "";
    state.collection = null;
    state.episodes = [];
    state.episodeCollections = [];
    state.message = "已解除当前 B站页面和 Bangumi 条目的绑定。";
    state.error = "";
    removeSubjectInfoPanel();
    removeCharacterStrip();
    render();
  }

  function getBindingKeysForCurrentPage() {
    return [
      state.pageKey,
      getStableBiliSubjectKey(),
      getTitleBindingKey(),
      location.pathname,
      getBvIdFromUrl(),
    ].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index);
  }

  async function loadSubjectBundle() {
    if (!state.subjectId) {
      state.message = "还没有绑定 Bangumi 条目。";
      state.error = "";
      render();
      return;
    }
    const subjectId = Number(state.subjectId);
    const requestKey = `${subjectId}|${state.token || ""}`;
    if (subjectBundleRequests.has(requestKey)) return subjectBundleRequests.get(requestKey);
    const promise = loadSubjectBundleFresh(subjectId, state.token || "")
      .finally(() => subjectBundleRequests.delete(requestKey));
    subjectBundleRequests.set(requestKey, promise);
    return promise;
  }

  async function loadSubjectBundleFresh(subjectId, tokenSnapshot) {
    setBusy("正在读取 Bangumi 数据...");
    const collectionPath = tokenSnapshot ? await getCollectionReadPath(subjectId, tokenSnapshot) : "";
    if (Number(state.subjectId) !== Number(subjectId) || String(state.token || "") !== String(tokenSnapshot || "")) return;
    const [subject, episodes, charactersResult, collection, episodeCollections] = await Promise.all([
      bgmRequest(`/v0/subjects/${subjectId}`),
      bgmRequestPagedData(`/v0/episodes?subject_id=${subjectId}&type=0`, { pageSize: 200 }),
      loadSubjectCharacters(subjectId),
      collectionPath ? bgmRequest(collectionPath, { auth: true, authToken: tokenSnapshot, allow404: true }) : Promise.resolve(null),
      tokenSnapshot ? bgmRequestPagedData(`/v0/users/-/collections/${subjectId}/episodes?episode_type=0`, { auth: true, authToken: tokenSnapshot, allow404: true, pageSize: 200 }) : Promise.resolve(null),
    ]);
    if (Number(state.subjectId) !== Number(subjectId) || String(state.token || "") !== String(tokenSnapshot || "")) return;
    state.subject = subject;
    state.subjectInfoLinks = {};
    state.episodes = episodes.data || [];
    state.characters = charactersResult.characters;
    state.characterError = charactersResult.error;
    state.collection = mergePendingCollection(collection);
    state.episodeCollections = episodeCollections && episodeCollections.data ? episodeCollections.data : [];
    state.message = state.token ? "已同步 Bangumi 数据。" : "未设置 Access Token，只能查看公开条目信息。";
    state.error = "";
    state.busy = false;
    render();
    refreshSubjectInfoLinksInBackground(subjectId);
  }

  async function loadSubjectBundlePreservingLocal(localCollection) {
    const optimistic = localCollection ? { ...localCollection } : null;
    if (!state.subjectId) return;
    const subjectId = Number(state.subjectId);
    const tokenSnapshot = state.token || "";
    const collectionPath = tokenSnapshot ? await getCollectionReadPath(subjectId, tokenSnapshot) : "";
    if (Number(state.subjectId) !== Number(subjectId) || String(state.token || "") !== String(tokenSnapshot || "")) return;
    const [subject, episodes, charactersResult, collection, episodeCollections] = await Promise.all([
      bgmRequest(`/v0/subjects/${subjectId}`),
      bgmRequestPagedData(`/v0/episodes?subject_id=${subjectId}&type=0`, { pageSize: 200 }),
      loadSubjectCharacters(subjectId),
      collectionPath ? bgmRequest(collectionPath, { auth: true, authToken: tokenSnapshot, allow404: true }) : Promise.resolve(null),
      tokenSnapshot ? bgmRequestPagedData(`/v0/users/-/collections/${subjectId}/episodes?episode_type=0`, { auth: true, authToken: tokenSnapshot, allow404: true, pageSize: 200 }) : Promise.resolve(null),
    ]);
    if (Number(state.subjectId) !== Number(subjectId) || String(state.token || "") !== String(tokenSnapshot || "")) return;
    state.subject = subject;
    state.subjectInfoLinks = {};
    state.episodes = episodes.data || [];
    state.characters = charactersResult.characters;
    state.characterError = charactersResult.error;
    state.collection = mergePendingCollection(collection);
    state.episodeCollections = episodeCollections && episodeCollections.data ? episodeCollections.data : [];
    if (optimistic && (!state.collection || Number(state.collection.rate || 0) !== Number(optimistic.rate || 0))) {
      state.collection = { ...(state.collection || {}), ...optimistic };
    }
    state.busy = false;
    state.error = "";
    render();
    refreshSubjectInfoLinksInBackground(subjectId);
    checkAutoWatchProgress().catch(showError);
  }

  async function loadSubjectCharacters(subjectId) {
    try {
      const apiResponse = await bgmRequest(`/v0/subjects/${subjectId}/characters`, { dedup: true });
      const characters = Array.isArray(apiResponse) ? apiResponse : [];
      return { characters: sortCharactersLikeBangumi(characters), error: "" };
    } catch (error) {
      return {
        characters: [],
        error: error && error.message ? error.message : "角色信息读取失败",
      };
    }
  }

  async function loadSubjectInfoLinks(subjectId) {
    if (!state.subjectInfoPanelEnabled || !subjectId) return {};
    const key = String(subjectId);
    if (subjectInfoLinkCache.has(key)) return subjectInfoLinkCache.get(key);
    if (subjectInfoLinkRequests.has(key)) return subjectInfoLinkRequests.get(key);
    const promise = bgmWebRequest(`/subject/${encodeURIComponent(key)}`)
      .then(parseSubjectInfoLinks)
      .catch(() => ({}))
      .then((links) => {
        subjectInfoLinkCache.set(key, links);
        return links;
      })
      .finally(() => subjectInfoLinkRequests.delete(key));
    subjectInfoLinkRequests.set(key, promise);
    return promise;
  }

  function refreshSubjectInfoLinksInBackground(subjectId) {
    if (!state.subjectInfoPanelEnabled || !subjectId) return;
    const expectedSubjectId = Number(subjectId);
    loadSubjectInfoLinks(subjectId)
      .then((links) => {
        if (Number(state.subjectId) !== expectedSubjectId) return;
        state.subjectInfoLinks = links || {};
        syncSubjectInfoPanel();
      })
      .catch(() => {});
  }

  function parseSubjectInfoLinks(html) {
    const links = {};
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const anchors = doc.querySelectorAll("#infobox a[href], .infobox a[href]");
    anchors.forEach((anchor) => {
      const text = normalizeSubjectInfoLinkText(anchor.textContent || "");
      const href = getSubjectInfoHref(anchor.getAttribute("href") || "");
      if (text && href && !links[text]) links[text] = href;
    });
    return links;
  }

  function sortCharactersLikeBangumi(characters) {
    return [...characters]
      .map((character, index) => {
        return { character, index, rank: getCharacterRelationRank(character && character.relation) };
      })
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.index - b.index;
      })
      .map((entry) => entry.character);
  }

  function getCharacterRelationRank(relation) {
    const text = String(relation || "");
    if (text.includes("主")) return 0;
    if (text.includes("配")) return 1;
    if (text.includes("客串")) return 2;
    if (text.includes("旁白")) return 3;
    if (text.includes("闲") || text.includes("路人")) return 4;
    return 2;
  }

  function mergePendingCollection(collection) {
    const pending = state.pendingCollection;
    if (!pending || Number(pending.subjectId) !== Number(state.subjectId)) return collection;
    if (Date.now() - Number(pending.createdAt || 0) > 5 * 60 * 1000) {
      state.pendingCollection = null;
      return collection;
    }
    if (collection && pending.rate != null && Number(collection.rate || 0) === Number(pending.rate || 0)) {
      state.pendingCollection = null;
      return collection;
    }
    return { ...(collection || {}), ...pending };
  }

  async function getCollectionReadPath(subjectId = state.subjectId, tokenSnapshot = state.token || "") {
    const username = await getCurrentUsername(tokenSnapshot);
    return username ? `/v0/users/${encodeURIComponent(username)}/collections/${subjectId}` : "";
  }

  async function getCurrentUsername(tokenSnapshot = state.token || "") {
    if (!tokenSnapshot) return "";
    if (state.username && String(tokenSnapshot) === String(state.token || "")) return state.username;
    const me = await bgmRequest("/v0/me", { auth: true, authToken: tokenSnapshot });
    if (String(state.token || "") !== String(tokenSnapshot || "")) return "";
    state.username = me && me.username ? String(me.username) : "";
    return state.username;
  }

  async function updateCollection(patch) {
    ensureToken();
    if (!state.subjectId) throw new Error("请先绑定 Bangumi 条目");
    setBusy("正在更新记录...");
    const payload = { ...patch };
    if (!state.collection && payload.type == null) payload.type = 3;
    await bgmRequest(`/v0/users/-/collections/${state.subjectId}`, {
      method: state.collection ? "PATCH" : "POST",
      auth: true,
      body: payload,
      expectNoContent: true,
    });
    await loadSubjectBundle();
  }

  async function rateSubject(rate) {
    ensureToken();
    if (!state.subjectId) throw new Error("请先绑定 Bangumi 条目");
    const safeRate = Math.max(0, Math.min(10, Math.round(Number(rate) || 0)));

    const previousCollection = state.collection ? { ...state.collection } : null;
    const type = getCollectionType();
    state.collection = { ...(state.collection || {}), type, rate: safeRate };
    state.pendingCollection = { ...(state.pendingCollection || {}), subjectId: state.subjectId, type, rate: safeRate, createdAt: Date.now() };
    state.message = safeRate ? `正在更新评分为 ${safeRate} ${getRateLevel(safeRate)}...` : "正在清除评分...";
    state.error = "";
    state.busy = true;
    render();

    try {
      await bgmRequest(`/v0/users/-/collections/${state.subjectId}`, {
        method: previousCollection ? "PATCH" : "POST",
        auth: true,
        body: { type, rate: safeRate },
        expectNoContent: true,
      });
      await loadSubjectBundlePreservingLocal(state.collection);
      state.message = safeRate ? `评分已更新为 ${safeRate} ${getRateLevel(safeRate)}。` : "评分已清除。";
      state.error = "";
      render();
      window.setTimeout(() => loadSubjectBundlePreservingLocal(state.collection).catch(showError), 1200);
    } catch (error) {
      state.collection = previousCollection;
      state.pendingCollection = null;
      throw error;
    }
  }

  async function deleteCollection() {
    ensureToken();
    if (!state.subjectId) throw new Error("请先绑定 Bangumi 条目");
    if (!hasCollection()) {
      state.message = "这个条目当前没有 Bangumi 收藏记录。";
      state.error = "";
      render();
      return;
    }
    const ok = window.confirm("确定删除这个 Bangumi 收藏记录吗？评分、标签、吐槽和章节进度会一起移除。");
    if (!ok) return;

    setBusy("正在删除 Bangumi 收藏记录...");
    const subjectId = Number(state.subjectId);
    const pageHtml = await bgmWebRequest(`/subject/${subjectId}`);
    const webUsername = parseBangumiWebUsername(pageHtml);
    const tokenUsername = await getCurrentUsername();
    if (!webUsername) {
      throw new Error("无法读取 Bangumi 网页登录状态，请先在 bgm.tv 登录后再删除收藏。");
    }
    if (tokenUsername && webUsername !== tokenUsername) {
      throw new Error(`Bangumi 网页登录账号（${webUsername}）和 Access Token 账号（${tokenUsername}）不一致，已停止删除。`);
    }
    const gh = parseSubjectRemoveHash(pageHtml, subjectId);
    if (!gh) {
      throw new Error("无法从 Bangumi 页面读取删除令牌，请刷新页面或确认这个条目仍在网页端收藏中。");
    }

    await bgmWebRequest(`/subject/${subjectId}/remove?gh=${encodeURIComponent(gh)}`);
    state.collection = null;
    state.episodeCollections = [];
    state.pendingCollection = null;
    state.busy = false;
    state.message = "Bangumi 收藏记录已删除。";
    state.error = "";
    render();
    window.setTimeout(() => loadSubjectBundle().catch(showError), 900);
  }

  async function saveProgressFromInput() {
    ensureToken();
    ensureCollectionForEpisodeSync();
    const input = document.querySelector(`#${PANEL_ID} [data-role='progress']`);
    const episodes = getNormalEpisodes();
    const count = Math.max(0, Math.min(episodes.length, Number(input && input.value) || 0));
    const wantedDone = new Set(episodes.slice(0, count).map((ep) => Number(ep.id)));
    const toDone = [];
    const toUndone = [];

    for (const ep of episodes) {
      const episodeId = Number(ep.id);
      const isDone = getEpisodeCollectionType(episodeId) === 2;
      if (wantedDone.has(episodeId) && !isDone) toDone.push(episodeId);
      if (!wantedDone.has(episodeId) && isDone) toUndone.push(episodeId);
    }

    if (!toDone.length && !toUndone.length) {
      state.message = `章节进度已经是 ${count}/${episodes.length}。`;
      state.error = "";
      render();
      return;
    }

    setBusy("正在同步章节进度...");
    if (toDone.length) await patchEpisodes(toDone, 2, "正在标记已看章节...", false);
    if (toUndone.length) await patchEpisodes(toUndone, 0, "正在取消多余章节...", false);
    applyLocalEpisodeProgress(wantedDone);
    state.busy = false;
    state.message = `章节进度已提交为 ${count}/${episodes.length}。`;
    state.error = "";
    render();
    window.setTimeout(() => loadSubjectBundle().catch(showError), 900);
  }

  async function toggleEpisode(episodeId, isDone) {
    ensureToken();
    ensureCollectionForEpisodeSync();
    await patchEpisodes([episodeId], isDone ? 0 : 2, isDone ? "正在取消章节标记..." : "正在标记章节看过...");
  }

  async function patchEpisodes(episodeIds, type, message, reload = true) {
    if (!state.subjectId) throw new Error("请先绑定 Bangumi 条目");
    ensureCollectionForEpisodeSync();
    if (!episodeIds.length) {
      if (reload) await loadSubjectBundle();
      return;
    }
    if (message) setBusy(message);
    await bgmRequest(`/v0/users/-/collections/${state.subjectId}/episodes`, {
      method: "PATCH",
      auth: true,
      body: { episode_id: episodeIds, type },
      expectNoContent: true,
    });
    if (type === 2) recordEpisodeSync(episodeIds);
    if (reload) await loadSubjectBundle();
  }

  function recordEpisodeSync(episodeIds) {
    const byId = new Map(getNormalEpisodes().map((ep) => [Number(ep.id), ep]));
    const now = Date.now();
    let changed = false;
    for (const episodeId of episodeIds) {
      const ep = byId.get(Number(episodeId));
      if (!ep) continue;
      const sort = Number(ep.sort);
      const key = `${state.subjectId}_${Number.isFinite(sort) ? sort : episodeId}`;
      state.syncHistory[key] = {
        subjectId: state.subjectId,
        episodeId: Number(episodeId),
        episodeSort: Number.isFinite(sort) ? sort : null,
        subjectName: state.subject ? displaySubjectName(state.subject) : "",
        syncedAt: now,
      };
      changed = true;
    }
    if (changed) {
      pruneSyncHistory();
      writeJsonValue(STORAGE.syncHistory, state.syncHistory);
    }
  }

  function pruneSyncHistory() {
    const entries = Object.entries(state.syncHistory || {})
      .sort((a, b) => Number(b[1] && b[1].syncedAt || 0) - Number(a[1] && a[1].syncedAt || 0));
    state.syncHistory = Object.fromEntries(entries.slice(0, 300));
  }

  function applyLocalEpisodeProgress(wantedDone) {
    const byId = new Map(state.episodeCollections.map((entry) => [Number(entry.episode && entry.episode.id), entry]));
    for (const ep of getNormalEpisodes()) {
      const episodeId = Number(ep.id);
      const nextType = wantedDone.has(episodeId) ? 2 : 0;
      const existing = byId.get(episodeId);
      if (existing) {
        existing.type = nextType;
      } else {
        state.episodeCollections.push({ episode: ep, type: nextType, updated_at: 0 });
      }
    }
    render();
  }

  function bindAutoWatchProgressEvents() {
    if (window.__biligumiAutoWatchEventsBound) return;
    window.__biligumiAutoWatchEventsBound = true;
    ["timeupdate", "playing", "loadedmetadata", "durationchange"].forEach((eventName) => {
      document.addEventListener(eventName, () => {
        checkAutoWatchProgress().catch(showError);
      }, true);
    });
    document.addEventListener("seeking", (event) => {
      const video = event.target && event.target.tagName === "VIDEO" ? event.target : null;
      if (video) state.autoWatchSeekStartTime = Number(video.currentTime) || 0;
    }, true);
    document.addEventListener("seeked", (event) => {
      const video = event.target && event.target.tagName === "VIDEO" ? event.target : null;
      if (video) handleAutoWatchSeekEnd(video);
      checkAutoWatchProgress().catch(showError);
    }, true);
    window.setInterval(() => {
      checkAutoWatchProgress().catch(showError);
    }, 5000);
  }

  async function checkAutoWatchProgress() {
    if (!state.token || !state.subjectId || !hasCollection() || state.autoEpisodeSyncing) return;
    const currentEpisode = getCurrentNormalEpisode();
    if (!currentEpisode || getEpisodeCollectionType(currentEpisode.id) === 2) return;
    const video = getActiveVideoElement();
    if (!video) return;
    const duration = Number(video.duration);
    const currentTime = Number(video.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime) || currentTime <= 0) return;
    const watchedPercent = Math.floor((currentTime / duration) * 100);
    const syncKey = `${state.subjectId}:${Number(currentEpisode.id)}:${getAutoWatchScopeKey()}`;
    updateAutoWatchJumpState(video, syncKey, watchedPercent);
    if (watchedPercent < getAutoWatchThreshold()) return;
    if (state.autoWatchBlockedKey === syncKey) return;
    if (state.autoEpisodeSyncLastKey === syncKey) return;

    state.autoEpisodeSyncing = true;
    state.autoEpisodeSyncLastKey = syncKey;
    try {
      await patchEpisodes([Number(currentEpisode.id)], 2, "", false);
      applySingleEpisodeProgress(Number(currentEpisode.id), 2);
      state.busy = false;
      state.message = `已自动标记第 ${formatEpisodeSort(Number(currentEpisode.sort))} 集看过。`;
      state.error = "";
      render();
      window.setTimeout(() => loadSubjectBundle().catch(showError), 900);
    } catch (error) {
      state.autoEpisodeSyncLastKey = "";
      throw error;
    } finally {
      state.autoEpisodeSyncing = false;
    }
  }

  function getActiveVideoElement() {
    return Array.from(document.querySelectorAll("video"))
      .filter((video) => {
        const rect = video.getBoundingClientRect();
        return video.readyState > 0 && rect.width > 120 && rect.height > 80;
      })
      .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  }

  function handleAutoWatchSeekEnd(video) {
    const start = Number(state.autoWatchSeekStartTime);
    const end = Number(video.currentTime);
    state.autoWatchSeekStartTime = null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const currentEpisode = getCurrentNormalEpisode();
    if (!currentEpisode) return;
    const syncKey = `${state.subjectId}:${Number(currentEpisode.id)}:${getAutoWatchScopeKey()}`;
    const duration = Number(video.duration);
    const threshold = getAutoWatchThreshold();
    const watchedPercent = Number.isFinite(duration) && duration > 0 ? Math.floor((end / duration) * 100) : 0;
    if (end - start >= AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS && watchedPercent >= threshold) {
      state.autoWatchBlockedKey = syncKey;
    }
  }

  function updateAutoWatchJumpState(video, syncKey, watchedPercent) {
    const currentTime = Number(video.currentTime);
    if (!Number.isFinite(currentTime)) return;
    if (state.autoWatchLastVideoKey && state.autoWatchLastVideoKey !== syncKey) {
      state.autoWatchBlockedKey = "";
      state.autoWatchSeekStartTime = null;
    }
    const lastTime = state.autoWatchLastVideoKey === syncKey ? Number(state.autoWatchLastVideoTime) : 0;
    const jumpedForward = lastTime > 0 && currentTime - lastTime >= AUTO_WATCH_LARGE_FORWARD_JUMP_SECONDS;
    if (jumpedForward && watchedPercent >= getAutoWatchThreshold()) {
      state.autoWatchBlockedKey = syncKey;
    } else if (state.autoWatchBlockedKey === syncKey && watchedPercent < getAutoWatchThreshold()) {
      state.autoWatchBlockedKey = "";
    }
    state.autoWatchLastVideoKey = syncKey;
    state.autoWatchLastVideoTime = currentTime;
  }

  function getCurrentNormalEpisode() {
    const currentNo = Number(state.currentEpisodeNo);
    if (!Number.isFinite(currentNo)) return null;
    return getNormalEpisodes().find((ep) => Number(ep.sort) === currentNo) || null;
  }

  function applySingleEpisodeProgress(episodeId, type) {
    const byId = new Map(getNormalEpisodes().map((ep) => [Number(ep.id), ep]));
    const episode = byId.get(Number(episodeId));
    if (!episode) return;
    const existing = state.episodeCollections.find((entry) => entry.episode && Number(entry.episode.id) === Number(episodeId));
    if (existing) {
      existing.type = type;
    } else {
      state.episodeCollections.push({ episode, type, updated_at: 0 });
    }
  }

  function openSettings() {
    state.settingsOpen = true;
    state.collectionEditorOpen = false;
    state.error = "";
    mountModal("settings-cancel", renderSettingsDialog());
    render();
  }

  function closeSettings() {
    state.settingsOpen = false;
    removeModal();
    render();
  }

  function saveSettings() {
    const tokenInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-token']`);
    const whitelistInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-whitelist']`);
    const nonMainPreviewInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-non-main-preview']`);
    const characterStripInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-character-strip']`);
    const subjectInfoPanelInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-subject-info-panel']`);
    const officialBangumiLayoutInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-official-bangumi-layout']`);
    const autoWatchThresholdInput = document.querySelector(`#${SETTINGS_ID} [data-role='settings-auto-watch-threshold']`);
    const nextToken = String(tokenInput && tokenInput.value || "").trim();
    const nextNonMainPreviewEnabled = Boolean(nonMainPreviewInput && nonMainPreviewInput.checked);
    const nextCharacterStripEnabled = Boolean(characterStripInput && characterStripInput.checked);
    const nextSubjectInfoPanelEnabled = Boolean(subjectInfoPanelInput && subjectInfoPanelInput.checked);
    const nextOfficialBangumiLayoutEnabled = Boolean(officialBangumiLayoutInput && officialBangumiLayoutInput.checked);
    const nextAutoWatchThreshold = normalizeAutoWatchThreshold(autoWatchThresholdInput && autoWatchThresholdInput.value);
    if (nextToken !== state.token) {
      state.username = "";
      pendingRequests.clear();
    }
    state.token = nextToken;
    state.officialBangumiLayoutEnabled = nextOfficialBangumiLayoutEnabled;
    const parsedWhitelist = parseWhitelistInput(String(whitelistInput && whitelistInput.value || ""));
    state.whitelist = parsedWhitelist.items;
    state.whitelistLabels = pruneWhitelistLabels({ ...state.whitelistLabels, ...parsedWhitelist.labels }, state.whitelist);
    setAutoWatchThreshold(nextAutoWatchThreshold);
    if (nextNonMainPreviewEnabled !== state.nonMainPreviewEnabled) {
      state.nonMainPreviewEnabled = nextNonMainPreviewEnabled;
      state.nonMainKeyword = "";
      state.nonMainResults = [];
      state.nonMainError = "";
      state.nonMainBusy = false;
      state.nonMainSearched = false;
      state.nonMainSearchSeq += 1;
    }
    if (nextCharacterStripEnabled !== state.characterStripEnabled) {
      state.characterStripEnabled = nextCharacterStripEnabled;
      if (!state.characterStripEnabled) removeCharacterStrip();
    }
    if (nextSubjectInfoPanelEnabled !== state.subjectInfoPanelEnabled) {
      state.subjectInfoPanelEnabled = nextSubjectInfoPanelEnabled;
      if (!state.subjectInfoPanelEnabled) removeSubjectInfoPanel();
    }
    writeValue(STORAGE.token, state.token);
    writeListValue(STORAGE.whitelist, state.whitelist);
    writeJsonValue(STORAGE.whitelistLabels, state.whitelistLabels);
    writeValue(STORAGE.nonMainPreview, state.nonMainPreviewEnabled ? "1" : "0");
    writeValue(STORAGE.characterStrip, state.characterStripEnabled ? "1" : "0");
    writeValue(STORAGE.subjectInfoPanel, state.subjectInfoPanelEnabled ? "1" : "0");
    writeValue(STORAGE.officialBangumiLayout, state.officialBangumiLayoutEnabled ? "1" : "0");
    writeJsonValue(STORAGE.autoWatchThresholds, state.autoWatchThresholds);
    state.settingsOpen = false;
    removeModal();
    state.message = `设置已保存。白名单共 ${state.whitelist.length} 项。`;
    state.error = "";
    render();
    if (shouldRenderFullPanel() && state.subjectId) loadSubjectBundle().catch(showError);
  }

  function openCollectionEditor() {
    state.collectionEditorOpen = true;
    state.settingsOpen = false;
    state.error = "";
    mountModal("collection-cancel", renderCollectionEditorDialog());
  }

  function closeCollectionEditor() {
    state.collectionEditorOpen = false;
    removeModal();
    render();
  }

  async function saveCollectionEditor() {
    ensureToken();
    if (!state.subjectId) throw new Error("请先绑定 Bangumi 条目");
    const typeInput = document.querySelector(`#${SETTINGS_ID} [data-role='edit-type']:checked`);
    const rateInput = document.querySelector(`#${SETTINGS_ID} [data-role='edit-rate']`);
    const tagsInput = document.querySelector(`#${SETTINGS_ID} [data-role='edit-tags']`);
    const commentInput = document.querySelector(`#${SETTINGS_ID} [data-role='edit-comment']`);
    const privateInput = document.querySelector(`#${SETTINGS_ID} [data-role='edit-private']`);
    const comment = String(commentInput && commentInput.value || "");
    if (comment.length > COLLECTION_COMMENT_MAX_LENGTH) {
      throw new Error(`吐槽最多 ${COLLECTION_COMMENT_MAX_LENGTH} 字，当前 ${comment.length} 字。`);
    }
    const payload = {
      type: Number(typeInput && typeInput.value) || getCollectionType(),
      rate: Math.max(0, Math.min(10, Math.round(Number(rateInput && rateInput.value) || 0))),
      tags: parseTags(tagsInput && tagsInput.value),
      comment,
      private: Boolean(privateInput && privateInput.checked),
    };
    const hadCollection = hasCollection();
    state.collectionEditorOpen = false;
    removeModal();
    state.collection = { ...(state.collection || {}), ...payload };
    state.pendingCollection = { ...(state.pendingCollection || {}), subjectId: state.subjectId, ...payload, createdAt: Date.now() };
    setBusy("正在保存记录...");
    await bgmRequest(`/v0/users/-/collections/${state.subjectId}`, {
      method: hadCollection ? "PATCH" : "POST",
      auth: true,
      body: payload,
      expectNoContent: true,
    });
    await loadSubjectBundlePreservingLocal(state.collection);
    state.message = "记录已保存。";
    render();
  }

  function mountModal(cancelAction, html) {
    removeModal();
    const wrapper = document.createElement("div");
    wrapper.id = SETTINGS_ID;
    wrapper.dataset.action = cancelAction;
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    bindModalEvents(wrapper);
  }

  function bindModalEvents(wrapper) {
    const editStars = wrapper.querySelector("[data-role='edit-rate-stars']");
    if (editStars) {
      editStars.addEventListener("mouseover", (event) => {
        const star = event.target.closest("[data-action='edit-rate'][data-rate]");
        if (star) previewEditorRate(Number(star.dataset.rate));
      });
      editStars.addEventListener("focusin", (event) => {
        const star = event.target.closest("[data-action='edit-rate'][data-rate]");
        if (star) previewEditorRate(Number(star.dataset.rate));
      });
      editStars.addEventListener("mouseout", (event) => {
        if (event.relatedTarget && editStars.contains(event.relatedTarget)) return;
        restoreEditorRatePreview();
      });
      editStars.addEventListener("focusout", (event) => {
        if (event.relatedTarget && editStars.contains(event.relatedTarget)) return;
        restoreEditorRatePreview();
      });
    }

    const commentInput = wrapper.querySelector("[data-role='edit-comment']");
    if (commentInput) {
      commentInput.addEventListener("input", () => updateCollectionCommentCounter(wrapper));
      updateCollectionCommentCounter(wrapper);
    }

    const autoWatchThresholdInput = wrapper.querySelector("[data-role='settings-auto-watch-threshold']");
    if (autoWatchThresholdInput) {
      autoWatchThresholdInput.addEventListener("input", () => updateAutoWatchThresholdPreview(wrapper));
      updateAutoWatchThresholdPreview(wrapper);
    }
  }

  function updateCollectionCommentCounter(wrapper) {
    const commentInput = wrapper.querySelector("[data-role='edit-comment']");
    const count = wrapper.querySelector("[data-role='edit-comment-count']");
    if (!commentInput || !count) return;
    const remaining = COLLECTION_COMMENT_MAX_LENGTH - String(commentInput.value || "").length;
    count.textContent = `剩余 ${remaining}`;
    count.classList.toggle("warning", remaining <= 20);
  }

  function updateAutoWatchThresholdPreview(wrapper) {
    const input = wrapper.querySelector("[data-role='settings-auto-watch-threshold']");
    const value = wrapper.querySelector("[data-role='settings-auto-watch-threshold-value']");
    if (!input || !value) return;
    value.textContent = `${normalizeAutoWatchThreshold(input.value)}%`;
  }

  function removeModal() {
    const existing = document.getElementById(SETTINGS_ID);
    if (existing) existing.remove();
  }

  function syncSettingsDialog() {
    const existing = document.getElementById(SETTINGS_ID);
    if (state.settingsOpen && !existing) mountModal("settings-cancel", renderSettingsDialog());
    if (state.collectionEditorOpen && !existing) mountModal("collection-cancel", renderCollectionEditorDialog());
    if (!state.settingsOpen && !state.collectionEditorOpen && existing) removeModal();
  }

  function addCurrentPageToWhitelist() {
    const candidate = getPreferredWhitelistCandidate();
    if (!candidate) {
      state.error = "没有找到可加入白名单的当前页面标识。";
      render();
      return;
    }
    if (!state.whitelist.includes(candidate)) {
      state.whitelist.push(candidate);
      state.whitelist = parseList(state.whitelist.join("\n"));
      writeListValue(STORAGE.whitelist, state.whitelist);
    }
    updateCurrentWhitelistLabel(candidate);
    state.message = `已加入白名单：${candidate}`;
    state.error = "";
    render();
    if (state.subjectId) loadSubjectBundle().catch(showError);
  }

  function ensureToken() {
    if (!state.token) throw new Error("请先点右上角设置 Bangumi Access Token");
  }

  function setBusy(message) {
    state.busy = true;
    state.message = message;
    state.error = "";
    render();
  }

  function showError(error) {
    state.busy = false;
    state.error = error && error.message ? error.message : String(error);
    render();
  }

  function bgmRequest(path, options = {}) {
    const method = options.method || "GET";
    const url = `${API_BASE}${path}`;
    const data = options.body ? JSON.stringify(options.body) : undefined;
    const shouldDedup = options.dedup === true || (options.dedup !== false && method === "GET");
    const authToken = options.authToken != null ? String(options.authToken || "") : String(state.token || "");
    const authKey = options.auth ? `auth:${authToken}` : "public";
    const dedupKey = `${method} ${url} ${authKey} ${data || ""}`;
    if (shouldDedup && pendingRequests.has(dedupKey)) return pendingRequests.get(dedupKey);

    const promise = bgmRequestWithRetry(method, url, data, { ...options, authToken });
    if (shouldDedup) {
      pendingRequests.set(dedupKey, promise);
      promise.then(() => {
        window.setTimeout(() => pendingRequests.delete(dedupKey), REQUEST_DEDUP_TTL);
      }, () => {
        window.setTimeout(() => pendingRequests.delete(dedupKey), REQUEST_DEDUP_TTL);
      });
    }
    return promise;
  }

  async function bgmRequestPagedData(path, options = {}) {
    const { pageSize = 100, ...requestOptions } = options;
    const limit = Math.max(1, Math.min(1000, Number(pageSize) || 100));
    let offset = 0;
    let total = null;
    const data = [];

    for (;;) {
      const response = await bgmRequest(appendQuery(path, { limit, offset }), requestOptions);
      if (!response) break;
      const pageData = Array.isArray(response.data) ? response.data : [];
      data.push(...pageData);

      const responseTotal = Number(response.total);
      if (Number.isFinite(responseTotal)) total = responseTotal;
      const responseLimit = Math.max(1, Number(response.limit) || limit);
      const responseOffset = Math.max(0, Number(response.offset) || offset);

      if (!pageData.length) break;
      if (total != null && data.length >= total) break;
      if (pageData.length < responseLimit && total == null) break;
      offset = responseOffset + responseLimit;
      if (offset <= responseOffset) break;
    }

    return {
      data,
      total: total == null ? data.length : total,
      limit,
      offset: 0,
    };
  }

  function appendQuery(path, params) {
    const query = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${path}${path.includes("?") ? "&" : "?"}${query}`;
  }

  async function bgmRequestWithRetry(method, url, data, options) {
    let lastError = null;
    for (let attempt = 0; attempt <= REQUEST_MAX_RETRIES; attempt += 1) {
      try {
        return await bgmRequestOnce(method, url, data, options);
      } catch (error) {
        lastError = error;
        if (!isRetryableApiError(error) || attempt >= REQUEST_MAX_RETRIES) throw error;
        await sleep(REQUEST_RETRY_BASE_MS * Math.pow(2, attempt));
      }
    }
    throw lastError || new Error("Bangumi API 请求失败");
  }

  function bgmRequestOnce(method, url, data, options) {
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": `biligumi-connector/${SCRIPT_VERSION} (https://github.com/local/biligumi-connector)`,
    };
    if (options.auth) headers.Authorization = `Bearer ${options.authToken != null ? options.authToken : state.token}`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        responseType: "json",
        timeout: 30000,
        onload: (response) => {
          if (options.allow404 && response.status === 404) {
            resolve(null);
            return;
          }
          if (options.expectNoContent && response.status === 204) {
            resolve(null);
            return;
          }
          if (response.status < 200 || response.status >= 300) {
            reject(makeApiError(response));
            return;
          }
          resolve(response.response || tryParseJson(response.responseText) || {});
        },
        onerror: () => reject(makeNetworkError("Bangumi API 请求失败，可能是网络或 userscript 跨域权限问题")),
        ontimeout: () => reject(makeNetworkError("Bangumi API 请求超时")),
      });
    });
  }

  function bgmWebRequest(path) {
    const url = `${BGM_WEB_BASE}${path}`;
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": `biligumi-connector/${SCRIPT_VERSION} (https://github.com/local/biligumi-connector)`,
        },
        anonymous: false,
        withCredentials: true,
        timeout: 30000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(`Bangumi 网页请求返回 ${response.status}`));
            return;
          }
          resolve(response.responseText || "");
        },
        onerror: () => reject(makeNetworkError("Bangumi 网页请求失败，可能是网络或 userscript 跨域权限问题")),
        ontimeout: () => reject(makeNetworkError("Bangumi 网页请求超时")),
      });
    });
  }

  function makeApiError(response) {
    const error = new Error(extractApiError(response));
    error.status = Number(response.status) || 0;
    return error;
  }

  function makeNetworkError(message) {
    const error = new Error(message);
    error.status = 0;
    return error;
  }

  function parseBangumiWebUsername(html) {
    const match = String(html || "").match(/\bCHOBITS_USERNAME\s*=\s*'((?:\\'|[^'])*)'/);
    return match ? decodeJsString(match[1]).trim() : "";
  }

  function parseSubjectRemoveHash(html, subjectId) {
    const id = String(Number(subjectId));
    const text = String(html || "");
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const callPattern = new RegExp(`eraseSubjectCollect\\(\\s*${escapedId}\\s*,\\s*'((?:\\\\'|[^'])+)'\\s*\\)`);
    const callMatch = text.match(callPattern);
    if (callMatch) return decodeJsString(callMatch[1]);
    const hrefPattern = new RegExp(`/subject/${escapedId}/remove\\?gh=([^"'&\\s<>]+)`);
    const hrefMatch = text.match(hrefPattern);
    return hrefMatch ? decodeURIComponent(hrefMatch[1]) : "";
  }

  function decodeJsString(value) {
    return String(value || "")
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  function isRetryableApiError(error) {
    const status = Number(error && error.status);
    return status === 0 || status >= 500;
  }

  function extractApiError(response) {
    const data = response.response || tryParseJson(response.responseText) || {};
    return data.description || data.title || data.message || `Bangumi API 返回 ${response.status}`;
  }

  function getPageKey() {
    return getStableBiliSubjectKey() || getCurrentRouteKey();
  }

  function getCurrentRouteKey() {
    const url = new URL(location.href);
    const match = url.pathname.match(/\/bangumi\/play\/(ss\d+|ep\d+|md\d+)|\/video\/(BV[\w]+)/i);
    return match ? match[0] : url.pathname;
  }

  function isOfficialBangumiPage() {
    return /\/bangumi\/play\//i.test(location.pathname);
  }

  function getStableBiliSubjectKey() {
    const initial = window.__INITIAL_STATE__ || {};
    const mediaInfo = initial.mediaInfo || initial.media_info || {};
    const seasonId = initial.season_id || mediaInfo.season_id || mediaInfo.seasonId || mediaInfo.season_id_str;
    const mediaId = initial.media_id || mediaInfo.media_id || mediaInfo.mediaId || mediaInfo.media_id_str;
    const season = getPathToken("ss") || seasonId;
    const media = getPathToken("md") || mediaId;
    if (season) return `bili:ss${stripBiliPrefix(season, "ss")}`;
    if (media) return `bili:md${stripBiliPrefix(media, "md")}`;
    return "";
  }

  function getTitleBindingKey() {
    const titleToken = getTitleBindingTitleToken();
    if (!titleToken) return "";
    const owner = getPageOwnerInfo();
    const ownerKey = owner.mid || owner.uid || owner.name || "";
    return `title:${normalizeBindingToken(ownerKey)}|${titleToken}`;
  }

  function getTitleBindingTitleToken() {
    const title = cleanTitle(getSeriesTitle() || getPageTitle());
    return title ? normalizeBindingToken(title) : "";
  }

  function getCrossOwnerTitleBinding() {
    if (!isWhitelistedOwner()) return null;
    const titleToken = getTitleBindingTitleToken();
    return getUniqueTitleBindingByToken(titleToken, getTitleBindingKey());
  }

  function getNonMainTitleBinding() {
    if (!isNonMainPreviewPage()) return null;
    const titleToken = getNonMainPreviewTitleToken();
    return getUniqueTitleBindingByToken(titleToken, getTitleBindingKey());
  }

  function getUniqueTitleBindingByToken(titleToken, excludeKey) {
    if (!titleToken) return null;
    const titleSuffix = `|${titleToken}`;
    const subjectIds = Object.entries(state.bindings || {})
      .filter(([key, subjectId]) => key.startsWith("title:") && key.endsWith(titleSuffix) && key !== excludeKey && subjectId)
      .map(([, subjectId]) => String(subjectId));
    const uniqueSubjectIds = subjectIds.filter((subjectId, index, list) => list.indexOf(subjectId) === index);
    return uniqueSubjectIds.length === 1 ? uniqueSubjectIds[0] : null;
  }

  function getPathToken(prefix) {
    const match = location.pathname.match(new RegExp(`\\/${prefix}(\\d+)`, "i"));
    return match ? `${prefix}${match[1]}` : "";
  }

  function stripBiliPrefix(value, prefix) {
    return String(value || "").replace(new RegExp(`^${prefix}`, "i"), "");
  }

  function normalizeBindingToken(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function parseBangumiSubjectId(value) {
    const text = String(value || "").trim();
    if (/^\d{1,9}$/.test(text)) return Number(text);
    const match = text.match(/(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/(\d{1,9})/i)
      || text.match(/\/subject\/(\d{1,9})/i);
    return match ? Number(match[1]) : null;
  }

  function isWhitelistedPage() {
    if (!state.whitelist.length) return false;
    const candidates = getWhitelistCandidates().map(normalizeWhitelistToken).filter(Boolean);
    return state.whitelist.some((entry) => {
      const normalized = normalizeWhitelistToken(entry);
      return normalized && candidates.some((candidate) => candidate === normalized || candidate.includes(normalized));
    });
  }

  function isWhitelistedOwner() {
    if (!state.whitelist.length) return false;
    const owner = getPageOwnerInfo();
    const candidates = [owner.mid, owner.uid, owner.name, owner.username]
      .map(normalizeWhitelistToken)
      .filter(Boolean);
    if (!candidates.length) return false;
    return state.whitelist.some((entry) => {
      const normalized = normalizeWhitelistToken(entry);
      return normalized && candidates.some((candidate) => candidate === normalized || candidate.includes(normalized));
    });
  }

  function getWhitelistCandidates() {
    const owner = getPageOwnerInfo();
    return [
      state.pageKey,
      location.pathname,
      location.href,
      owner.mid,
      sanitizeWhitelistToken(owner.name),
      sanitizeWhitelistToken(owner.username),
      owner.uid,
      getBvIdFromUrl(),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
  }

  function getPreferredWhitelistCandidate() {
    const owner = getPageOwnerInfo();
    return String(
      owner.mid
      || owner.uid
      || sanitizeWhitelistToken(owner.name)
      || getStableBiliSubjectKey()
      || getCurrentRouteKey()
      || ""
    ).trim();
  }

  function getAutoWatchScopeKey() {
    return normalizeWhitelistToken(getPreferredWhitelistCandidate())
      || normalizeWhitelistToken(getStableBiliSubjectKey())
      || normalizeWhitelistToken(getCurrentRouteKey())
      || "default";
  }

  function getAutoWatchScopeLabel() {
    const preferred = getPreferredWhitelistCandidate();
    if (preferred) return getDisplayNameForWhitelistCandidate(preferred);
    return getStableBiliSubjectKey() || getCurrentRouteKey() || "默认";
  }

  function getAutoWatchThreshold() {
    return normalizeAutoWatchThreshold(state.autoWatchThresholds[getAutoWatchScopeKey()]);
  }

  function setAutoWatchThreshold(value) {
    state.autoWatchThresholds = {
      ...(state.autoWatchThresholds || {}),
      [getAutoWatchScopeKey()]: normalizeAutoWatchThreshold(value),
    };
  }

  function normalizeAutoWatchThreshold(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 50;
    return Math.max(10, Math.min(100, Math.round(raw / 10) * 10));
  }

  function getWhitelistHint() {
    const preferred = getPreferredWhitelistCandidate();
    const label = getDisplayNameForWhitelistCandidate(preferred);
    return preferred ? `当前页面标识：${label}。点 + 加入白名单后展开。` : "点齿轮设置白名单后展开。";
  }

  function getDisplayNameForWhitelistCandidate(candidate) {
    const token = String(candidate || "").trim();
    if (!token) return "";
    const owner = getPageOwnerInfo();
    const name = cleanOwnerName(owner.name || owner.username || getOfficialBangumiWhitelistLabel() || getWhitelistLabel(token));
    return name && name !== token ? `${name}（${token}）` : token;
  }

  function updateCurrentWhitelistLabel(preferredToken = "") {
    const owner = getPageOwnerInfo();
    const label = cleanOwnerName(owner.name || owner.username || getOfficialBangumiWhitelistLabel());
    if (!label) return;
    const ownerTokens = [owner.mid, owner.uid, preferredToken, getStableBiliSubjectKey(), getCurrentRouteKey()]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!ownerTokens.length) return;
    let changed = false;
    const nextLabels = { ...state.whitelistLabels };
    for (const entry of state.whitelist) {
      const entryToken = normalizeWhitelistToken(stripWhitelistComment(entry));
      if (!entryToken) continue;
      const matched = ownerTokens.some((token) => normalizeWhitelistToken(token) === entryToken);
      if (matched && nextLabels[entry] !== label) {
        nextLabels[entry] = label;
        changed = true;
      }
    }
    if (changed) {
      state.whitelistLabels = pruneWhitelistLabels(nextLabels, state.whitelist);
      writeJsonValue(STORAGE.whitelistLabels, state.whitelistLabels);
    }
  }

  function getOfficialBangumiWhitelistLabel() {
    if (!isOfficialBangumiPage()) return "";
    return cleanTitle(getSeriesTitle() || getPageTitle() || document.title);
  }

  function getWhitelistLabel(item) {
    const direct = state.whitelistLabels[item];
    if (direct) return direct;
    const normalized = normalizeWhitelistToken(item);
    const matchedKey = Object.keys(state.whitelistLabels || {}).find((key) => normalizeWhitelistToken(key) === normalized);
    return matchedKey ? state.whitelistLabels[matchedKey] : "";
  }

  function pruneWhitelistLabels(labels, whitelist) {
    const valid = new Set(whitelist.map((item) => normalizeWhitelistToken(item)).filter(Boolean));
    return Object.fromEntries(Object.entries(labels || {})
      .filter(([key, value]) => valid.has(normalizeWhitelistToken(key)) && String(value || "").trim())
      .map(([key, value]) => [stripWhitelistComment(key), cleanOwnerName(value)]));
  }

  function getPageOwnerInfo() {
    const initial = window.__INITIAL_STATE__ || {};
    const videoData = initial.videoData || {};
    const owner = getInitialOwnerInfo(initial, videoData);
    const domOwner = getPrimaryDomOwnerInfo();
    const mid = owner.mid || owner.uid || videoData.mid || domOwner.mid || "";
    const name = cleanOwnerName(owner.name || domOwner.name || findDomOwnerNameByMid(mid));
    return {
      mid,
      uid: owner.uid || domOwner.uid || "",
      name,
      username: owner.username || "",
    };
  }

  function getInitialOwnerInfo(initial, videoData) {
    const candidates = [
      videoData.owner,
      initial.owner,
      initial.aidData && initial.aidData.owner,
      initial.videoInfo && initial.videoInfo.owner,
      initial.arc && initial.arc.owner,
      initial.view && initial.view.owner,
    ];
    return candidates.find((owner) => owner && (owner.mid || owner.uid || owner.name || owner.username)) || {};
  }

  function getPrimaryDomOwnerInfo() {
    const teamOwner = findDomOwnerByRole();
    if (teamOwner.mid || teamOwner.name) return teamOwner;
    const directAnchor = document.querySelector(
      ".up-name[href*='space.bilibili.com'], .upname[href*='space.bilibili.com'], .up-detail-top a[href*='space.bilibili.com'], .up-detail a[href*='space.bilibili.com'], .up-info-container a[href*='space.bilibili.com'], .up-panel-container a[href*='space.bilibili.com']"
    );
    if (directAnchor && !isNonOwnerSpaceAnchor(directAnchor)) return ownerInfoFromAnchor(directAnchor);
    const domName = document.querySelector(".up-name, .upname, .up-detail-top a, .up-detail a")?.textContent;
    return { mid: "", uid: "", name: cleanOwnerName(domName), username: "" };
  }

  function findDomOwnerByRole() {
    const roots = Array.from(document.querySelectorAll(
      ".membersinfo-container, .membersinfo-upcard-wrap, .membersinfo-upcard, .membersinfo-normalcard, .membersinfo-card, .up-card, .up-panel-container, .up-info-container, .up-info--left, .up-detail, .up-detail-top"
    ));
    const anchors = uniqueElements(roots.flatMap((root) => Array.from(root.querySelectorAll("a[href*='space.bilibili.com']"))));
    for (const anchor of anchors) {
      if (isNonOwnerSpaceAnchor(anchor)) continue;
      const card = anchor.closest(".membersinfo-upcard-wrap, .membersinfo-upcard, .membersinfo-normalcard, .membersinfo-card, .up-card")
        || findOwnerRoleContainer(anchor);
      const text = String(card && card.textContent || anchor.textContent || "");
      if (/UP主/i.test(text)) return ownerInfoFromAnchor(anchor, card);
    }
    return { mid: "", uid: "", name: "", username: "" };
  }

  function uniqueElements(elements) {
    return elements.filter((element, index, list) => element && list.indexOf(element) === index);
  }

  function isNonOwnerSpaceAnchor(anchor) {
    return Boolean(anchor && anchor.closest(
      ".video-desc-container, .desc-info, .basic-desc-info, .video-desc, .reply, .comment, .bili-comment, .activity-m-v1, .tag-panel, .video-tag-container"
    ));
  }

  function findOwnerRoleContainer(anchor) {
    let node = anchor;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const text = String(node.textContent || "");
      if (/UP主/i.test(text)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function ownerInfoFromAnchor(anchor, card) {
    const href = anchor && anchor.getAttribute("href") || "";
    const mid = getSpaceMidFromHref(href);
    const name = getOwnerNameNearAnchor(anchor, card);
    return { mid, uid: mid, name, username: "" };
  }

  function findDomOwnerNameByMid(mid) {
    const ownerMid = String(mid || "").trim();
    if (!ownerMid) return "";
    const anchors = Array.from(document.querySelectorAll(`a[href*='space.bilibili.com/${ownerMid}']`));
    for (const anchor of anchors) {
      if (isNonOwnerSpaceAnchor(anchor)) continue;
      const name = getOwnerNameNearAnchor(anchor, anchor.closest(".membersinfo-upcard-wrap, .membersinfo-upcard, .membersinfo-normalcard, .membersinfo-card, .up-card, .up-panel-container, .up-info-container, .up-info--left, .up-detail, .up-detail-top"));
      if (name) return name;
    }
    return "";
  }

  function getOwnerNameNearAnchor(anchor, card) {
    const direct = cleanOwnerName(anchor && (anchor.getAttribute("title") || anchor.getAttribute("aria-label") || anchor.textContent) || "");
    if (direct) return direct;
    const imageName = cleanOwnerName(anchor && anchor.querySelector("img") && (anchor.querySelector("img").getAttribute("alt") || anchor.querySelector("img").getAttribute("title")) || "");
    if (imageName) return imageName;
    return extractOwnerNameFromText(card && card.textContent || "");
  }

  function extractOwnerNameFromText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const beforeRole = text.split(/UP主|发消息|已关注|关注|充电|谢谢大家|个人认证|bilibili个人认证|bilibili机构认证|参演|策划/)[0];
    return cleanOwnerName(beforeRole);
  }

  function getSpaceMidFromHref(href) {
    const match = String(href || "").match(/space\.bilibili\.com\/(\d+)/i) || String(href || "").match(/\/space\/(\d+)/i);
    return match ? match[1] : "";
  }

  function cleanOwnerName(value) {
    const text = String(value || "")
      .replace(/UP主/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return isSuspiciousOwnerName(text) ? "" : text;
  }

  function isSuspiciousOwnerName(value) {
    const text = String(value || "").trim();
    return !text
      || text.length > 40
      || /[{};]/.test(text)
      || /\b(?:window|document|function|var|let|const|performance|playerInfo|embedPlayer)\b/i.test(text);
  }

  function getBvIdFromUrl() {
    const match = location.pathname.match(/\/video\/(BV[\w]+)/i);
    return match ? match[1] : "";
  }

  function normalizeWhitelistToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?bilibili\.com/i, "")
      .replace(/\s+/g, "");
  }

  function getPageTitle() {
    const titleSelectors = [
      "h1.video-title",
      ".video-title",
      ".media-title",
      ".tit",
      "h1",
    ];
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      const text = el && (el.getAttribute("title") || el.textContent || "").trim();
      if (text) return text;
    }
    return document.title;
  }

  function getSeriesTitle() {
    const initial = window.__INITIAL_STATE__ || {};
    const mediaInfo = initial.mediaInfo || initial.media_info || {};
    const epInfo = initial.epInfo || initial.ep_info || {};
    const candidates = [
      mediaInfo.title,
      mediaInfo.name,
      mediaInfo.season_title,
      mediaInfo.seasonTitle,
      initial.season_title,
      initial.seasonTitle,
      epInfo.season_title,
      epInfo.seasonTitle,
      document.querySelector(".media-title, .media-info-title, .media-name")?.textContent,
    ];
    return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
  }

  function cleanTitle(title) {
    const raw = normalizeTitleText(title);
    if (!raw) return "";

    const animeWorkTitle = extractAnimeWorkTitle(raw);
    if (animeWorkTitle) return cleanupAnimeTitle(animeWorkTitle);

    if (isNonMainEpisodeTitle(raw) || isWhitelistNewsNonMainTitle(raw)) {
      const edgeStrippedTitle = stripNonMainEdgeBracketTags(raw);
      const markerStrippedTitle = stripNonMainMarkerTail(edgeStrippedTitle);
      const promoStrippedTitle = stripNonMainPromoSuffix(markerStrippedTitle);
      const strippedTitle = cleanupAnimeTitle(extractQuotedWorkTitle(promoStrippedTitle) || getNonMainTitleSource(promoStrippedTitle));
      return strippedTitle;
    }

    const titleBeforeEpisode = extractTitleBeforeEpisodeMarker(raw);
    if (titleBeforeEpisode) return cleanupAnimeTitle(titleBeforeEpisode);

    const titleAfterJapaneseQuote = extractTitleAfterJapaneseQuoteBeforeEpisode(raw);
    if (titleAfterJapaneseQuote) return cleanupAnimeTitle(titleAfterJapaneseQuote);

    const bookTitle = raw.match(/《([^》]+)》/);
    if (bookTitle && !isTitlePropertyTag(bookTitle[1])) return cleanupAnimeTitle(bookTitle[1]);

    const cornerTitle = raw.match(/『([^』]+)』/);
    if (cornerTitle && !isTitlePropertyTag(cornerTitle[1])) return cleanupAnimeTitle(cornerTitle[1]);

    const fullBracket = raw.match(/【([^】]+)】/);
    if (fullBracket) {
      const content = fullBracket[1].trim();
      const afterBracket = raw.replace(/【[^】]+】/, " ").trim();
      const afterTitle = cleanupAnimeTitle(afterBracket);
      if (isNonMainEpisodeTitle(afterBracket) && !isTitleMetaTag(content)) return cleanupAnimeTitle(content);
      if (afterTitle && (isTitleMetaTag(content) || detectEpisodeNo(afterBracket))) return afterTitle;
      if (!isTitleMetaTag(content)) return cleanupAnimeTitle(content);
      if (afterTitle) return afterTitle;
    }

    const squareBracket = raw.match(/\[([^\]]+)\]/);
    if (squareBracket) {
      const content = squareBracket[1].trim();
      const afterBracket = raw.replace(/\[[^\]]+\]/, " ").trim();
      const afterTitle = cleanupAnimeTitle(afterBracket);
      if (isNonMainEpisodeTitle(afterBracket) && !isTitleMetaTag(content) && !/^[0-9]+(?:\.[0-9]+)?$/.test(content)) return cleanupAnimeTitle(content);
      if (afterTitle && (isTitleMetaTag(content) || detectEpisodeNo(afterBracket))) return afterTitle;
      if (!isTitleMetaTag(content) && !/^[0-9]+(?:\.[0-9]+)?$/.test(content)) return cleanupAnimeTitle(content);
      if (afterTitle) return afterTitle;
    }

    return cleanupAnimeTitle(raw);
  }

  function extractAnimeWorkTitle(title) {
    const text = String(title || "");
    const patterns = [
      /(?:TV\s*)?(?:动画|動畫|アニメ|anime|ANIME|电视动画|電視動畫)[^「」『』《》【】"'“”]{0,18}[「『《【"'“]([^」』》】"'”]+)[」』》】"'”]/i,
      /[「『《【"'“]([^」』》】"'”]+)[」』》】"'”]\s*(?:TV\s*)?(?:动画|動畫|アニメ|anime|ANIME|电视动画|電視動畫)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && !isTitleMetaTag(match[1])) return match[1].trim();
    }
    return "";
  }

  function extractQuotedWorkTitle(title) {
    const text = String(title || "");
    const patterns = [
      /《([^》]+)》/,
      /『([^』]+)』/,
      /「([^」]+)」/,
      /“([^”]+)”/,
      /"([^"]+)"/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && !isTitleMetaTag(match[1])) return match[1].trim();
    }
    return "";
  }

  function getNonMainTitleSource(title) {
    const withoutLeadingMeta = String(title || "").replace(/^[【\[]([^】\]]+)[】\]]\s*/i, (match, content) => (isTitleMetaTag(content) ? " " : match)).trim();
    const parts = withoutLeadingMeta.split(/\s*[\/／]\s*/).map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : withoutLeadingMeta;
  }

  function extractTitleBeforeEpisodeMarker(title) {
    const text = String(title || "");
    const match = text.match(/^(?:\s*[【\[][^\]】]+[\]】])?\s*(.+?)\s+第\s*\d+(?:\.\d+)?(?:\s*[-~～至到]\s*\d+(?:\.\d+)?)?\s*[话話集](?:\s|$|[【\[])/i);
    return match && match[1] ? match[1].trim() : "";
  }

  function extractTitleAfterJapaneseQuoteBeforeEpisode(title) {
    const text = String(title || "");
    const match = text.match(/^[\s【\[][^\]】]+[\]】]\s*[「『][^」』]+[」』]\s*(.+?)\s+(?:S\d+\s*)?0*\d{1,3}(?:\s*[\[【]|$)/i)
      || text.match(/^[「『][^」』]+[」』]\s*(.+?)\s+(?:S\d+\s*)?0*\d{1,3}(?:\s*[\[【]|$)/i);
    return match && match[1] ? match[1].trim() : "";
  }

  function stripNonMainEdgeBracketTags(title) {
    return String(title || "")
      .replace(/^(?:\s*[【\[][^\]】]+[\]】])+\s*/i, " ")
      .replace(/\s*(?:[【\[][^\]】]+[\]】]\s*)+$/i, " ")
      .trim();
  }

  function stripNonMainMarkerTail(title) {
    return String(title || "")
      .replace(/\s*(?:(?:TV\s*)?(?:动画化|動畫化|アニメ化|anime化)\s*(?:决定|決定|确定|確定|企划|企劃|制作决定|制作決定|发表|發表|公布)|(?:剧场|劇場)?上映\s*(?:决定|決定|确定|確定)).*$/i, "")
      .replace(/(^|[^A-Za-z])(?:(?:正式|主|第\s*\d+\s*(?:[弹彈]|话|話|集)|先导|先導|定档|定檔|超|特报|特報|预告|預告)\s*)?(?:PV|CM|Blu\s*-?\s*ray\s*(?:[&＆/+]\s*DVD)?|DVD|(?:NC\s*[-_ ]?\s*)?OP|(?:NC\s*[-_ ]?\s*)?ED|番宣|预告|預告|预告片|預告片|正式预告|正式預告|主预告|主預告|先导预告|先導預告|先导|先導|特报|特報|告知|情报|情報|回顾|回顧|映像|插入曲|插入歌|主题曲|主題曲|片头曲|片頭曲|片尾曲|片头|片尾|无字幕OP|无字幕ED)\s*\d*(?:\.\d+)?.*$/, "$1")
      .trim();
  }

  function stripNonMainPromoSuffix(title) {
    return String(title || "")
      .replace(/\s*(?:新|主|先导|先導)?\s*(?:视觉图|視覺圖|主视觉图|主視覺圖|视觉海报|視覺海報|海报|海報)\s*(?:公开|公開|解禁|释出|釋出)?\s*(?:[&＆+＋]\s*)?$/i, "")
      .replace(/\s*(?:公开|公開|解禁|释出|釋出)\s*(?:[&＆+＋]\s*)?$/i, "")
      .trim();
  }

  function normalizeTitleText(title) {
    return String(title || "")
      .replace(/_哔哩哔哩_bilibili.*$/i, "")
      .replace(/\s*-\s*(?:番剧|番劇|国创|國創|动漫|動畫|动画|全集|高清|独家|獨家|在线观看|線上觀看)(?:\s*-\s*[^-]+)*\s*-\s*(?:bilibili|哔哩哔哩|嗶哩嗶哩).*$/i, "")
      .replace(/\s*-\s*哔哩哔哩.*$/i, "")
      .replace(/[~～〜－–—―|｜·・•、，,;；:：]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanupAnimeTitle(title) {
    return String(title || "")
      .replace(/^第\s*\d+(?:\.\d+)?\s*[话集][：:\s]*/, "")
      .replace(/\s*第\s*\d+(?:\.\d+)?(?:\s*[-~]\s*\d+(?:\.\d+)?)?\s*[话集].*$/i, "")
      .replace(/\s*全\s*\d+(?:\.\d+)?\s*[话話集].*$/i, "")
      .replace(/\s*\d+(?:\.\d+)?(?:\s*[-~]\s*\d+(?:\.\d+)?)?\s*话.*$/i, "")
      .replace(/\s*S0*(\d+)\s*E\s*\d+(?:\.\d+)?\s*$/i, (_, season) => ` S${Number(season)}`)
      .replace(/\s*(?:EP\.?|#)\s*\d+(?:\.\d+)?\s*$/i, "")
      .replace(/\s*[\[【]\s*\d+(?:\.\d+)?\s*[\]】]\s*$/i, "")
      .replace(/^[【\[]([^】\]]+)[】\]]\s*/i, (match, content) => (isTitleMetaTag(content) ? " " : match))
      .replace(/【[^】]*(?:4K|1080P|720P|480P|HDR|SDR|BDRIP|WEBRIP|BD|WEB|简中|繁中|简体|繁体|中字|中日|中文字幕|中文|字幕组?|汉化组|漢化組|压制|超清|高清|标清|新番|完结|全集)[^】]*】/gi, " ")
      .replace(/\[[^\]]*(?:4K|1080P|720P|480P|HDR|SDR|BDRIP|WEBRIP|BD|WEB|简中|繁中|简体|繁体|中字|中日|中文字幕|中文|字幕组?|汉化组|漢化組|压制|超清|高清|标清|新番|完结|全集)[^\]]*\]/gi, " ")
      .replace(/\s+0*([0-9]{1,3})\s*$/i, (match, value) => (isCommonResolutionNumber(value) ? match : " "))
      .replace(/\s+(?:NC\s*[-_ ]?\s*)?(?:OP|ED)\s*\d*(?:\s*[&＆/+]\s*(?:NC\s*[-_ ]?\s*)?(?:OP|ED)\s*\d*)+(?:\s*[【\[].*?[】\]])?\s*$/, "")
      .replace(/[《》『』【】\[\]]/g, " ")
      .replace(/\s*(?:NC\s*[-_ ]?\s*)?(?:OP|ED)\s*\d*(?:\s*[&＆/+]\s*(?:NC\s*[-_ ]?\s*)?(?:OP|ED)\s*\d*)+\s*$/, "")
      .replace(/\s*(?:(?:定档|定檔|放送|播出|开播|開播)\s*)?(?:告知|情报|情報)(?:\s*[+＋&＆/]\s*(?:(?:第\s*)?[一二三四五六七八九十\d]+\s*季\s*)?(?:回顾|回顧|回顾映像|回顧映像|映像|总集篇|總集篇))*\s*$/i, "")
      .replace(/\s*(?:(?:第\s*)?[一二三四五六七八九十\d]+\s*季\s*)?(?:回顾|回顧|回顾映像|回顧映像|映像|总集篇|總集篇)\s*$/i, "")
      .replace(/\s*(?:(?:正式|主|第\s*\d+\s*[弹彈]|先导|先導)\s*)?(?:PV|CM|(?:NC\s*[-_ ]?\s*)?OP|(?:NC\s*[-_ ]?\s*)?ED|OVA|OAD|SP|MAD|MMD|LIVE|MV|PV\d+|OP\d+|ED\d+|番宣|预告|預告|先导|先導|特报|特報|特典|片头|片尾|无字幕OP|无字幕ED)(?:\s*\d+(?:\.\d+)?)?\s*$/, "")
      .replace(/[\s\-~～〜－–—―|｜·・•、，,;；:：／/]+/g, " ")
      .trim();
  }

  function isTitleMetaTag(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    return isTitlePropertyTag(text) || isSeasonMarker(text) || isReleaseInfoTag(text);
  }

  function isTitlePropertyTag(value) {
    const upper = String(value || "").trim().toUpperCase();
    if (!upper) return false;
    return TITLE_PROPERTY_TAGS.some((tag) => upper.includes(tag.toUpperCase()));
  }

  function isSeasonMarker(value) {
    return /^(\d{1,2})\s*月\s*(?:新番)?$/i.test(String(value || "").trim());
  }

  function isCommonResolutionNumber(value) {
    const number = Number(String(value || "").trim());
    return Number.isInteger(number) && COMMON_RESOLUTIONS.has(number);
  }

  function isReleaseInfoTag(value) {
    const dateTag = /(?:\d{4}\s*年\s*)?\d{1,2}\s*(?:月|[/.])\s*\d{0,2}\s*(?:日|号|號)?/.source;
    const releaseTag = /(?:定档|定檔|放送|播出|开播|開播)\s*(?:\d{1,2}\s*月|\d{1,2}\s*(?:月|[/.])\s*\d{0,2}\s*(?:日|号|號)?)/.source;
    const broadcastTag = /(?:首日|初回|首播)?\s*(?:[一二两兩三四五六七八九十\d]+\s*)?(?:集|话|話)?\s*(?:连播|連播|连续放送|連續放送|连续播出|連續播出)/.source;
    const infoTag = `(?:${releaseTag}|${dateTag}|${broadcastTag}|插入曲|插入歌|主题曲|主題曲|片头曲|片頭曲|片尾曲|附歌词|附歌詞|歌词|歌詞|最终章|最終章|完结篇|完結篇|剧场版|劇場版|特别篇|特別篇)`;
    return new RegExp(`^${infoTag}(?:\\s*[/／|｜-]\\s*${infoTag})*$`, "i").test(String(value || "").trim());
  }

  function isNonMainEpisodeTitle(value) {
    const title = normalizeTitleText(value);
    return NON_MAIN_KEYWORD_PATTERN.test(title) || NON_MAIN_EPISODE_PATTERN.test(title);
  }

  function isWhitelistNewsNonMainTitle(value) {
    return WHITELIST_NEWS_NON_MAIN_PATTERN.test(normalizeTitleText(value));
  }

  function shouldUseRawTitleForPreview(rawTitle = state.rawTitle || getPageTitle()) {
    return state.nonMainPreviewEnabled
      && (isNonMainEpisodeTitle(rawTitle) || (isWhitelistedPage() && isWhitelistNewsNonMainTitle(rawTitle)));
  }

  function isNonMainPreviewPage() {
    return shouldUseRawTitleForPreview();
  }

  function getNonMainPreviewKeyword() {
    if (!isNonMainPreviewPage()) return "";
    return cleanTitle(state.rawTitle || getPageTitle());
  }

  function getInlineAutoPreviewKeyword() {
    if (!(isWhitelistedPage() || shouldAutoShowOfficialBangumiPanel()) || state.subjectId || state.subject) return "";
    return suggestSearchKeyword();
  }

  function getNonMainPreviewTitleToken() {
    const keyword = getNonMainPreviewKeyword();
    return keyword ? normalizeBindingToken(keyword) : "";
  }

  function suggestSearchKeyword() {
    return state.subject ? displaySubjectName(state.subject) : state.pageTitle;
  }

  function detectEpisodeNo(text) {
    const title = String(text || "");
    if (isNonMainEpisodeTitle(title)) return null;
    for (const pattern of EPISODE_PATTERNS) {
      const match = title.match(pattern);
      if (!match) continue;
      if (isTotalEpisodeCountMatch(title, match)) continue;
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value <= 0) continue;
      if (isCommonResolutionNumber(value)) continue;
      return value;
    }
    return null;
  }

  function isTotalEpisodeCountMatch(title, match) {
    const index = typeof match.index === "number" ? match.index : -1;
    if (index < 0) return false;
    return /全\s*$/.test(String(title || "").slice(0, index));
  }

  function detectCurrentEpisodeNo(rawTitle) {
    const activeText = getActiveEpisodeText();
    return detectEpisodeNo(activeText) || detectEpisodeNo(rawTitle);
  }

  function getActiveEpisodeText() {
    const selectors = [
      ".video-episode-card__info-playing",
      ".video-episode-card__info-title--active",
      ".cur-list .on",
      ".episode-list .active",
      ".ep-list .active",
      ".list-box .on",
      "[class*='eplist'][class*='active']",
      "[class*='episode'][class*='active']",
      "[class*='Episode'][class*='active']",
      "[class*='playing']",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el && (el.getAttribute("title") || el.textContent || "").trim();
      if (text && detectEpisodeNo(text)) return text;
    }
    const initial = window.__INITIAL_STATE__ || {};
    const epInfo = initial.epInfo || initial.ep_info || initial.epInfoV2 || {};
    return epInfo.long_title || epInfo.title || epInfo.share_copy || "";
  }

  function displaySubjectName(subject) {
    return subject.name_cn || subject.name || `subject ${subject.id}`;
  }

  function getCollectionType() {
    return hasCollection() ? Number(state.collection.type) : 3;
  }

  function hasCollection() {
    return Boolean(state.collection && Number(state.collection.type));
  }

  function ensureCollectionForEpisodeSync() {
    if (!hasCollection()) {
      throw new Error("请先在收藏盒选择想看、看过、在看、搁置或抛弃，再同步章节进度。");
    }
  }

  function getCollectionSentence() {
    const label = SUBJECT_TYPES[getCollectionType()] || "在看";
    const verb = label === "看过" ? "看过" : label === "想看" ? "想看" : label === "搁置" ? "搁置" : label === "抛弃" ? "抛弃" : "在看";
    return `我${verb}这部动画`;
  }

  function getRate() {
    return state.collection && Number(state.collection.rate) ? Number(state.collection.rate) : 0;
  }

  function getRateLabel() {
    return getRateLevel(getRate());
  }

  function formatRatePreview(score) {
    const safeScore = Math.max(0, Math.min(10, Number(score) || 0));
    return safeScore ? `${safeScore} ${getRateLevel(safeScore)}` : "未评价";
  }

  function getRateLevel(score) {
    const labels = {
      1: "不忍直视",
      2: "很差",
      3: "差",
      4: "较差",
      5: "不过不失",
      6: "还行",
      7: "推荐",
      8: "力荐",
      9: "神作",
      10: "超神作",
    };
    const value = Math.max(1, Math.min(10, Math.round(Number(score) || 0)));
    const suffix = value === 1 || value === 10 ? "（请谨慎评价）" : "";
    return labels[value] ? `${labels[value]}${suffix}` : "未评价";
  }

  function getCollectionUpdatedText() {
    const raw = state.collection && state.collection.updated_at;
    if (!raw) return "尚未同步记录时间";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function getNormalEpisodes() {
    return state.episodes
      .filter((ep) => Number(ep.type) === 0)
      .sort((a, b) => Number(a.sort) - Number(b.sort));
  }

  function getEpisodeCollectionType(episodeId) {
    const item = state.episodeCollections.find((entry) => entry.episode && Number(entry.episode.id) === Number(episodeId));
    return item ? Number(item.type) : 0;
  }

  function getWatchedCount() {
    return getNormalEpisodes().filter((ep) => getEpisodeCollectionType(ep.id) === 2).length;
  }

  function getProgressInfo() {
    const total = getNormalEpisodes().length;
    const watched = getWatchedCount();
    const percent = total ? Math.min(100, Math.round((watched / total) * 100)) : 0;
    return {
      total,
      watched,
      percent,
      summary: total ? `${watched}/${total} 已看` : "未读取章节",
    };
  }

  function formatEpisodeSort(sort) {
    if (!Number.isFinite(sort)) return "?";
    return sort < 10 ? `0${sort}` : String(sort);
  }

  function formatScore(score) {
    return Number(score) ? Number(score).toFixed(2) : "暂无";
  }

  function formatRank(rank) {
    return Number(rank) ? `#${rank}` : "暂无";
  }

  function formatNumber(value) {
    return Number(value) ? String(value) : "0";
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function tryParseJson(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function readValue(key, fallback) {
    try {
      return GM_getValue(key, fallback);
    } catch (_) {
      return localStorage.getItem(key) || fallback;
    }
  }

  function writeValue(key, value) {
    try {
      GM_setValue(key, value);
    } catch (_) {
      localStorage.setItem(key, value);
    }
  }

  function readJsonValue(key, fallback) {
    const value = readValue(key, "");
    if (!value) return fallback;
    return tryParseJson(value) || fallback;
  }

  function writeJsonValue(key, value) {
    writeValue(key, JSON.stringify(value));
  }

  function readListValue(key, fallback) {
    const value = readValue(key, "");
    if (!value) return fallback;
    const parsed = tryParseJson(value);
    if (Array.isArray(parsed)) return parseList(parsed.join("\n"));
    return parseList(value);
  }

  function writeListValue(key, value) {
    writeValue(key, JSON.stringify(parseList(value.join("\n"))));
  }

  function parseList(value) {
    return String(value || "")
      .split(/[\n,，;；]+/)
      .map(stripWhitelistComment)
      .map(sanitizeWhitelistToken)
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }

  function parseWhitelistInput(value) {
    const labels = {};
    const items = String(value || "")
      .split(/[\n,，;；]+/)
      .map((rawItem) => {
        const raw = String(rawItem || "").trim();
        const item = sanitizeWhitelistToken(stripWhitelistComment(raw));
        const label = getWhitelistComment(raw);
        if (item && label) labels[item] = label;
        return item;
      })
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
    return { items, labels };
  }

  function stripWhitelistComment(value) {
    return String(value || "").replace(/\s*#.*$/, "").trim();
  }

  function sanitizeWhitelistToken(value) {
    const token = String(value || "").trim();
    if (!token || isSuspiciousWhitelistToken(token)) return "";
    return token;
  }

  function isSuspiciousWhitelistToken(value) {
    const token = String(value || "").trim();
    return token.length > 120
      || /[{};]/.test(token)
      || /\b(?:window|document|function|var|let|const|performance|playerInfo|embedPlayer)\b/i.test(token);
  }

  function normalizeStoredWhitelist() {
    const rawWhitelist = readValue(STORAGE.whitelist, "");
    const parsedRaw = tryParseJson(rawWhitelist);
    const rawWhitelistText = Array.isArray(parsedRaw) ? parsedRaw.join("\n") : rawWhitelist;
    const migrated = parseWhitelistInput(rawWhitelistText);
    const cleanedWhitelist = parseList([...state.whitelist, ...migrated.items].join("\n"));
    const changedWhitelist = cleanedWhitelist.join("\n") !== state.whitelist.join("\n");
    state.whitelist = cleanedWhitelist;
    state.whitelistLabels = pruneWhitelistLabels({ ...state.whitelistLabels, ...migrated.labels }, state.whitelist);
    if (changedWhitelist || Object.keys(migrated.labels).length) writeListValue(STORAGE.whitelist, state.whitelist);
    writeJsonValue(STORAGE.whitelistLabels, state.whitelistLabels);
  }

  function getWhitelistComment(value) {
    const match = String(value || "").match(/#\s*(.+)$/);
    return match ? cleanOwnerName(match[1]) : "";
  }

  function parseTags(value) {
    return String(value || "")
      .split(/[\s,，;；]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 10);
  }
})();
