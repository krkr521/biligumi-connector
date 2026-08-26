# Biligumi Connector Browser Extension

这是 Biligumi Connector 的 Chrome/Edge Manifest V3 插件版。它尽量复用油猴版 userscript 的完整页面功能，并额外通过浏览器级 `commands` 快捷键触发 OP/ED 跳过，因此页面非焦点或画中画时，也会尽量把命令发给当前或最近的 Bilibili 视频页。

**注意：目前我没有实际使用插件版，因此插件版尚未做完整功能测试，不能保证行为和油猴脚本完全一致；如遇问题请提交 issue。**

## 功能

- 注入 `https://www.bilibili.com/video/*` 和 `https://www.bilibili.com/bangumi/play/*`。
- 复用 userscript 主体逻辑：Bangumi 面板、Token 设置、白名单、绑定、搜索、PV / 预告轻量候选、收藏/评分/章节同步、角色/CV 横栏、条目信息栏、自动标记已看、OP/ED 跳过按钮等。
- 使用 `chrome.storage.local` 保存原 userscript 的本地设置与绑定数据。
- 使用 background service worker 代理 Bangumi API / Bangumi 网页请求，替代 `GM_xmlhttpRequest`。
- 默认命令快捷键为 `Alt+Shift+Right`。
- 后台 service worker 会记录最近活跃的 Bilibili 视频标签页和最近进入 PiP 的标签页。命令触发时优先当前 Bilibili 标签页，其次 PiP/最近记录的 Bilibili 标签页。

## 安装

1. 打开 Chrome 的 `chrome://extensions/` 或 Edge 的 `edge://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 `extension/` 目录。
5. 打开 Bilibili 视频页或番剧播放页，页面内会出现 Biligumi 面板。
6. 面板内设置 Bangumi Access Token、白名单和各项功能；使用 `Alt+Shift+Right` 触发 OP/ED 跳过命令。

## 修改快捷键

快捷键由浏览器扩展系统控制，不在扩展自己的设置页中直接录入：

- Chrome: `chrome://extensions/shortcuts`
- Edge: `edge://extensions/shortcuts`

找到 “Biligumi Connector” 的 “Skip OP/ED on the active or recent Bilibili video tab” 命令后修改即可。Chrome/Edge 扩展默认快捷键不接受 `Ctrl+Alt` 组合；如果想用别的键位，需要在这里重新分配。

## 设置

核心设置仍在 Bilibili 页面里的 Biligumi 面板中，包括：

- Bangumi Access Token。
- 官方 `api.bgm.tv` 超时或无法连接后，按次选择“重试官方 API”或第三方 API 中继；中继不会自动启用或保存。
- 白名单。
- 条目绑定、Bangumi 站内搜索、PV / 预告搜索候选、收藏状态、评分、章节状态。
- 角色/CV 横栏、条目信息栏、官方番剧页布局兼容。
- 自动标记已看阈值。
- 长视频 UP 级首集开始时间；本视频专属首集起点在分集推测提示条内取当前进度 / 清除。
- 普通投稿多季度合集可按分 P 的季度与集数范围分别绑定 Bangumi；支持 `1.1 / 1.2`、上下篇、`第二季0`、`S2E13` 等常见写法。仅当 Bangumi 明确提供 `total_episodes` 且当前季度已覆盖该总集数时才触发范围确认；总集数缺失或仍在更新时不做分批检测。普通连续 `1…N` 可继续使用整 BV 绑定，未完结的分段、季度和 EP0 结构仍保持隔离。拆分集需全部分段看完后才自动标记。
- 合集从第0集开始时默认按 Bangumi 第一条正片对齐并顺延；API 正片列表明确含 `sort=0` 时则按真正的 EP0 对齐。
- 官方番剧页按右侧 `(当前项/总数)` 选择 Bangumi 正片，面板用 Bangumi 实际 `sort` 显示；包含真实 EP0 的条目会显示 `0, 01, …`，后续各集不会错位。
- 官方番剧切换季度时使用当前页面实时 `md/ss/分区` 标识；旧初始化数据和其他季度的标题绑定不会串到当前季度，检测到已有错误迁移时会要求重新绑定。
- 主面板「我的完成度」右侧可按视频切换「自动 / 暂停」进度追踪（不在设置里）。
- 当前条目的 OP/ED 跳过开关（按番剧保存）和全局默认秒数；悬停播放器「跳OP/ED」按钮可用滑条为当前番剧设置专属时长。
- 页面面板里只提示浏览器级/PiP 快捷键入口；实际键位请到扩展快捷键页查看或修改。

扩展详情页的“扩展程序选项”只提供插件版说明和快捷键入口提示。数据保存在 `chrome.storage.local`，与油猴脚本管理器存储相互独立。

## 限制

<span style="color:#bd2441"><strong>危险：</strong>手动选择 <code>api.bangumi.pro</code> 或 <code>bgmapi.anibt.net</code> 后，当前失败请求的 Bangumi Access Token、<code>Authorization</code> 请求头和 API 内容会经过第三方服务器；它们不是 Bangumi 官方服务，可能读取或记录这些信息。</span>
- Manifest commands 能否在浏览器完全非焦点时触发，取决于 Chrome/Edge、操作系统和快捷键是否被系统占用。
- 插件版由 userscript 主体迁移而来，后续如果 userscript 更新，需要同步重新生成或移植 `extension/content.js`。
- 如果目标标签页还没有加载 content script，或 Bilibili 页面结构阻止脚本访问播放器，命令可能不会生效。
- 删除 Bangumi 收藏时会在后台打开 `bgm.tv` 第一方标签页完成登录态与账号校验；仅在未登录、需要手动操作时切到前台，登录并删除成功后自动关闭。扩展不会读取、复制或记录登录 Cookie。
- 画中画追踪依赖页面触发 `enterpictureinpicture` / `leavepictureinpicture` 事件；service worker 被回收后会从 `chrome.storage.session` 恢复最近记录，旧版浏览器会回退到 `chrome.storage.local` 的运行时记录。
