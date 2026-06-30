# Biligumi Connector

把 Bangumi 的收藏状态、评分、观看进度和条目补充信息嵌入 Bilibili 网页端播放页。

当前脚本版本：`0.6.1`。

这是一个非官方 Biligumi Connector 原型，现在提供两种安装形态：

- **油猴版**：使用 Tampermonkey / Violentmonkey 安装 [`userscript/biligumi-connector.user.js`](./userscript/biligumi-connector.user.js)，适合继续使用已有脚本管理器。
- **浏览器插件版**：使用 Chrome / Edge 加载 [`extension/`](./extension/) 已解压扩展，功能目标与油猴版一致，并额外支持浏览器级 commands 快捷键，尽量在画中画或页面非焦点时触发 OP/ED 跳过。

油猴版和插件版可以二选一使用；如果同时启用，页面上可能出现重复面板或重复事件处理。

当前原型目标先验证三件事：

- 能稳定插入到 Bilibili 播放页右侧栏。
- 能搜索并绑定 Bangumi 动画条目。
- 能读取和更新 Bangumi 收藏状态、评分、章节看过状态。

本项目由人工需求驱动，并通过 Codex vibe coding 协作实现和整理。

## 安装油猴版

1. 安装 Tampermonkey 或 Violentmonkey。
2. 新建脚本，把 [`userscript/biligumi-connector.user.js`](./userscript/biligumi-connector.user.js) 的内容粘进去。
3. 打开 Bilibili 番剧或视频播放页：
   - `https://www.bilibili.com/bangumi/play/*`
   - `https://www.bilibili.com/video/*`
4. 在右侧面板点击设置按钮，填入 Bangumi Access Token。

不建议把 Bilibili 官方番剧源作为主要使用场景；脚本会做实验性右侧栏兼容，但官方页面结构变化更频繁，出问题时建议改用普通视频源或在设置里关闭官方番剧页布局兼容。

Access Token 可以在 Bangumi 官方页面生成：

<https://next.bgm.tv/demo/access-token>

## 安装浏览器插件版

1. 打开 Chrome 的 `chrome://extensions/` 或 Edge 的 `edge://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 [`extension/`](./extension/) 目录。
5. 打开 Bilibili 番剧或视频播放页：
   - `https://www.bilibili.com/bangumi/play/*`
   - `https://www.bilibili.com/video/*`

插件版的核心设置仍在 Bilibili 页面内的 Biligumi 面板里。扩展详情页的“扩展程序选项”主要用于说明安装状态和浏览器快捷键入口。默认 OP/ED 跳过命令快捷键为 `Alt+Shift+Right`；可在 Chrome 的 `chrome://extensions/shortcuts` 或 Edge 的 `edge://extensions/shortcuts` 修改。Chrome/Edge 扩展默认快捷键不接受 `Ctrl+Alt` 组合；油猴版页面内快捷键仍可使用 `Ctrl+Alt+→`。

## 当前能力

- 在 Bilibili 播放页加入 Bangumi 面板，显示条目、评分、收藏状态和观看进度。
- 支持搜索并绑定 Bangumi 条目，之后可直接更新收藏状态、评分、吐槽和单集看过状态。
- 支持按播放进度自动标记当前集看过，也可以手动批量同步前 N 集。
- 支持按番剧保存 OP/ED 跳过按钮和快捷键。
- 支持弹幕悬停 `+1`、本地弹幕收藏，并复用 Bilibili 当前弹幕发送设置。
- 可选显示角色 / CV 横栏、Bangumi 风格条目信息栏、Bilibili 白名单和轻量候选提示。

## 已知限制

- 需要自行提供 Bangumi Access Token；多数番剧第一次使用仍需要手动确认绑定。
- Bilibili 页面结构变动可能影响面板位置、弹幕按钮或官方番剧页兼容。
- 标题解析和候选推荐不能保证完全准确，遇到多季度、合集、PV/OP/ED 或特殊标题时可能需要手动调整。
- 同步依赖 Bangumi 接口和当前登录状态；网络错误、权限问题或账号不一致时会在面板里提示。
- 绑定、设置、弹幕收藏和同步历史保存在本地浏览器环境中，不会自动跨浏览器同步。
- 油猴版和插件版建议二选一使用，同时启用可能出现重复界面。

## 参考

- [Bangumi API 文档](https://bangumi.github.io/api/)：用于 Bangumi 条目、收藏、评分、章节进度相关接口。
- [Bangumi](https://bgm.tv/)：面板信息结构和视觉风格参考自 Bangumi 条目页、收藏盒、评分区域与章节列表。
- [Noneqin57/bilibili2bangumi](https://github.com/Noneqin57/bilibili2bangumi)：重点参考了 Bilibili 标题解析、UP 主白名单、同步流程、防重复和请求稳定性等思路。
- [wopub/Bilibili2Bangumi](https://github.com/wopub/Bilibili2Bangumi)：作为同类项目参考。
- [qianjiachun/douyuEx](https://github.com/qianjiachun/douyuEx)：弹幕 `+1` 和弹幕收藏交互参考。

本项目不隶属于 Bangumi、Bilibili 或上述参考项目。引用、改写或继续开发时请注明相应来源。
