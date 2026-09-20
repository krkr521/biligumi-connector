# Biligumi Connector Browser Extension

这是 Biligumi Connector 的 Chrome/Edge Manifest V3 插件版。它尽量复用油猴版 userscript 的完整页面功能，并额外通过浏览器级 `commands` 快捷键触发 OP/ED 跳过，因此页面非焦点或画中画时，也会尽量把命令发给当前或最近的 Bilibili 视频页。

**注意：目前我没有实际使用插件版，因此插件版尚未做完整功能测试，不能保证行为和油猴脚本完全一致；如遇问题请提交 issue。**

## 功能

- 修改收藏保存成功后，仅刷新收藏与观看进度；读取遇到短暂 500 或网络错误时自动有限重试，保留已提交的状态、标签和吐槽。旧响应不会因评分相同而覆盖本次修改，持续读取失败时明确区分“已保存”与“暂时无法刷新”。
- 注入 `https://www.bilibili.com/video/*` 和 `https://www.bilibili.com/bangumi/play/*`。
- 复用 userscript 主体逻辑：Bangumi 面板、Token 设置、白名单、绑定、搜索、PV / 预告轻量候选、收藏/评分/章节同步、角色/CV 横栏、条目信息栏、自动标记已看、OP/ED 跳过按钮等。
- 使用 `chrome.storage.local` 保存原 userscript 的本地设置与绑定数据。
- 使用 background service worker 代理 Bangumi API / Bangumi 网页请求，替代 `GM_xmlhttpRequest`。
- 默认命令快捷键为 `Alt+Shift+Right`。
- 后台 service worker 会记录最近活跃的 Bilibili 视频标签页和最近进入 PiP 的标签页。命令触发时优先当前 Bilibili 标签页，其次 PiP/最近记录的 Bilibili 标签页。
- 面板处于活动状态或打开设置、扩展选项页时会自动检查插件更新。GitHub 为首选源，连接失败后使用 GitCode 提交固定清单作为备用；只读取 `manifest.json` 并比较版本，不下载或执行远程代码。

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
- 角色/CV 横栏、条目信息栏、始终启用的官方番剧页布局兼容。
- 自动标记已看阈值。
- 长视频 UP 级首集开始时间；本视频专属首集起点在分集推测提示条内取当前进度 / 清除。
- 普通投稿多季度合集可按分 P 的季度与集数范围分别绑定 Bangumi；支持 `1.1 / 1.2`、上下篇、`第二季0`、`S2E13` 等写法。绑定时可直接选择本条目首集对应的分P，查看当前集与上传范围预览，无需切换播放或重新搜索；已绑定范围可点「调整映射」。资料齐全的带季度合集尚未上传齐时也可确认，普通连续 `1…N` 仍可使用整 BV 绑定；拆分集需全部分段看完后才自动标记。
- 自动首集建议会核对作品、季号、同季前后作及正片编号：放送中最多落后明确已播进度 1 集，今天/明天的绿色章节不必已上传；完结后核对整季总数。证据不足或列表异常时手选。确认的带季度映射（含分段）预留条目的完整范围，后续正常新增分P沿用；保存前重新检查已有范围和独立分P绑定冲突。
- 多季标题支持 `S4E12 / S4-12 / S4.12`、`4x12`、`第四季第十二集 / 第4期第12话`、`4th Season / Fourth Season / Season Four / Season IV` 与日文 `シーズン4`，兼容大小写、全角、括号和作品名前缀。`4.12.1 / 4.12.2` 表示季、集、段；显式集号后可用上下半、A/B、Part/Pt 或第N段（1–8）。同季可混用等价写法。没有季号的 `1.1 / 1.2` 仍表示集、段；`S412`、日期、版本号及多集范围不猜作单集。
- 分段合集的放送进度按逻辑集数核对，不把每段当一集；首集选择只列每集第一段。末尾仍在上传的分段集保留同季已知最大段数要求，下一集出现后再按该集实际段数判断，避免尚缺后续段时提前标记；无分段标记的整集不受此限制。
- 绑定确认期间若当前集或分P列表改变，会停止保存并要求重新确认；仅页面重绘不会丢失已选起点。建议起点缺少首段时仍可打开首集选择，不能把未确认草稿直接保存。
- 合集从第0集开始时默认按 Bangumi 第一条正片对齐并顺延；API 正片列表明确含 `sort=0` 时则按真正的 EP0 对齐。
- 官方番剧页按右侧 `(当前项/总数)` 选择 Bangumi 正片，面板用 Bangumi 实际 `sort` 显示；包含真实 EP0 的条目会显示 `0, 01, …`，后续各集不会错位。
- 官方番剧切换季度时使用当前页面实时 `md/ss/分区` 标识；旧初始化数据和其他季度的标题绑定不会串到当前季度，检测到已有错误迁移时会要求重新绑定。
- 主面板「我的完成度」右侧可按视频切换「自动 / 暂停」进度追踪（不在设置里）。
- OP/ED 按钮默认常驻，未绑定番剧也可点击或使用浏览器快捷键。跳过秒数在设置面板中调整，播放器按钮不显示悬停滑条。未绑定时的显示开关保存为全局默认；已有的每番显示开关与专属时长仍优先，恢复默认可清除当前番剧的旧专属时长。
- 页面面板里只提示浏览器级/PiP 快捷键入口；实际键位请到扩展快捷键页查看或修改。
- 设置中的「官方 API 连接失败后自动使用 api.bgmapi.com」默认关闭；启用后仍先探测官方 api.bgm.tv，但探测超时缩短为约 2 秒且不额外重试，连接失败或超时后自动回退并跳过确认弹窗。

扩展详情页的“扩展程序选项”提供插件版说明、快捷键状态和更新检查入口。数据保存在 `chrome.storage.local`，与油猴脚本管理器存储相互独立。

## 更新

插件版当前通过“加载已解压的扩展程序”安装，因此浏览器不会自动替换本地扩展文件。发现新版本后：

1. 在面板设置或扩展选项页点击“下载新版”。
2. 从项目页下载新版，覆盖原来的扩展目录。
3. 打开 `chrome://extensions/` 或 `edge://extensions/`，点击 Biligumi Connector 的“重新加载”。
4. 刷新已经打开的 Bilibili 页面。

请覆盖原目录，不要把新版加载为另一个扩展；这样可以保留原扩展 ID 及 `chrome.storage.local` 中的设置。将来改为浏览器商店分发后，可以再接入浏览器原生的自动安装更新。

## 限制

<span style="color:#bd2441"><strong>危险：</strong>手动选择 <code>api.bgmapi.com</code> 或启用自动回退后，失败请求的 Bangumi Access Token、<code>Authorization</code> 请求头和 API 内容会经过第三方服务器；它不是 Bangumi 官方服务，可能读取或记录这些信息。</span>
- Manifest commands 能否在浏览器完全非焦点时触发，取决于 Chrome/Edge、操作系统和快捷键是否被系统占用。
- 插件版由 userscript 主体迁移而来，后续如果 userscript 更新，需要同步重新生成或移植 `extension/content.js`。
- 当前更新功能只自动检测版本；已解压扩展需要人工覆盖文件并重新加载。
- 如果目标标签页还没有加载 content script，或 Bilibili 页面结构阻止脚本访问播放器，命令可能不会生效。
- 删除 Bangumi 收藏时会在后台打开 `bgm.tv` 第一方标签页完成登录态与账号校验；仅在未登录、需要手动操作时切到前台，登录并删除成功后自动关闭。扩展不会读取、复制或记录登录 Cookie。
- 画中画追踪依赖页面触发 `enterpictureinpicture` / `leavepictureinpicture` 事件；service worker 被回收后会从 `chrome.storage.session` 恢复最近记录，旧版浏览器会回退到 `chrome.storage.local` 的运行时记录。
