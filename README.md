# Biligumi Connector

把 Bangumi 的收藏状态、评分、观看进度和条目补充信息嵌入 Bilibili 网页端播放页。

当前脚本版本：`0.5.6`。

这是一个非官方 Tampermonkey / Violentmonkey userscript 原型，目标先验证三件事：

- 能稳定插入到 Bilibili 播放页右侧栏。
- 能搜索并绑定 Bangumi 动画条目。
- 能读取和更新 Bangumi 收藏状态、评分、章节看过状态。

本项目由人工需求驱动，并通过 Codex vibe coding 协作实现和整理。

## 安装

1. 安装 Tampermonkey 或 Violentmonkey。
2. 新建脚本，把 [`userscript/biligumi-connector.user.js`](./userscript/biligumi-connector.user.js) 的内容粘进去。
3. 打开 Bilibili 番剧或视频播放页：
   - `https://www.bilibili.com/bangumi/play/*`
   - `https://www.bilibili.com/video/*`
4. 在右侧面板点击设置按钮，填入 Bangumi Access Token。

不建议把 Bilibili 官方番剧源作为主要使用场景；脚本会做实验性右侧栏兼容，但官方页面结构变化更频繁，出问题时建议改用普通视频源或在设置里关闭官方番剧页布局兼容。

Access Token 可以在 Bangumi 官方页面生成：

<https://next.bgm.tv/demo/access-token>

## 当前能力

- 在 Bilibili 右侧栏顶部插入 Bangumi 面板。
- 根据当前页面标题搜索 Bangumi 动画条目。
- 把当前 Bilibili 页面和 Bangumi subject id 绑定到本地 userscript 存储。
- 读取 Bangumi 条目公开评分、排名、投票数。
- 读取当前用户对该条目的收藏状态和评分。
- 读取普通章节列表与当前用户章节收藏状态。
- 更新收藏状态：想看、看过、在看、搁置、抛弃。
- 删除当前条目的 Bangumi 收藏记录；删除前会校验 Bangumi 网页登录账号和 Access Token 账号一致。
- 更新评分：0 到 10 分。
- 编辑收藏吐槽，并按 Bangumi 的 380 字限制显示剩余字数和保存校验。
- 按总进度把前 N 集批量标为看过。
- 单集切换：看过 / 未收藏。
- 播放器进度达到标准线后自动把当前集标为看过；标准线默认 50%，可在设置里按当前 UP / 页面来源以 10% 步长调整。单次向前跳转超过 5 分钟并越过标准线时不会自动标记，避免拖进度条误触发。
- 可在设置里为当前绑定的 Bangumi 条目开启播放器下边栏“一键跳过 OP/ED”按钮，并按番剧保存跳过秒数，默认 85 秒。
- 可在评论区上方显示 Bangumi 角色 / CV 横栏，CV 名称会尽量链接到对应 Bangumi 人物页。
- 可选显示 Bangumi 风格条目信息栏；普通视频页会尝试做左侧信息栏布局，官方番剧页会显示精简紧凑版。
- 支持类似 `bilibili2bangumi` 的 Bilibili 白名单；不匹配白名单的页面只显示折叠栏，不展开面板。
- 白名单优先使用 UP 主 UID，并在设置里显示为 `UID # 昵称`；访问对应页面时会尽量刷新昵称备注，方便后续清理。
- 支持更稳的 UP 主标题解析：`第X话`、`第1-6话`、尾部 `02`、`全12话`、`EP.XX`、`#X`、`SxxExx`（保留季号）、`[XX]`、`『作品名』XX`，并跳过常见分辨率数字。
- 白名单 UP 的清洗番名如果已由其他 UP 绑定过同一个 Bangumi 条目，会自动复用并迁移为当前 UP 自己的绑定。
- 白名单未绑定页面会自动按清洗番名显示前 2 个 Bangumi 候选，支持打开条目页或直接绑定。
- 非白名单 OP / ED / PV / 预告 / 告知 / Blu-ray&DVD / 动画化决定 / 上映决定等页面可选显示轻量跳转候选，仅展示前 2 个 Bangumi 结果。
- 可选实验兼容 Bilibili 官方番剧页右侧布局，把官方 PV / 相关推荐列表下移给 Bangumi 面板让位。
- 标题清洗会尝试剥离字幕组、月份、首播信息、话数、PV/OP/ED 等尾部标记，并支持 `日文名 / 中文名 PV` 这类标题优先使用后半段番名。
- Bangumi API 读取请求支持短时间去重和 5xx/网络错误自动重试。
- 本地记录最近 300 条章节同步历史，为后续自动同步防重复做准备。

## 已知限制

- 自动匹配仍以搜索后手动绑定为主；跨 UP 同名番剧、白名单自动候选和 OP / ED / PV 轻量候选可复用已有绑定，但还没有相似度排序。
- Bilibili 页面结构经常变化，右侧栏选择器可能需要按真实页面继续适配。
- 合作投稿、创作团队、简介 `@` 提及等 DOM 结构比较复杂，UP 主识别已做多层兜底，但仍可能需要按真实页面继续修正。
- Bilibili 番剧页的当前集数会优先读取页面激活选集和标题，但复杂分集命名仍可能需要人工确认。
- 多季度番剧如果 Bangumi 章节编号使用全系列累计数，面板会按本季内序号显示和匹配当前集，同时在悬浮提示里保留 Bangumi 原始 ep 编号。
- 章节进度走 Bangumi `/v0/users/-/collections/{subject_id}/episodes`，如果 Bangumi API 返回具体错误，面板会直接显示出来。
- 还没有接入 Bilibili API，也没有做播放完成后自动同步。
- 角色 / CV 横栏依赖 Bangumi 条目角色接口，官方番剧页未绑定时会额外做一次轻量搜索预览，失败时不会反复重试。
- Bangumi 风格条目信息栏会解析 Bangumi 页面以补全 API 缺失的 infobox 字段和制作人员链接，对界面排版改动较大，也会带来一定性能开销；默认关闭，可在设置里手动开启。
- 官方番剧源的右侧栏兼容属于实验功能，不推荐作为主要同步入口；齿轮设置里可以关闭“官方番剧页右侧布局兼容”。
- 白名单支持 UP 主 UID/名称、BV 号、页面 key 或 URL 片段；齿轮按钮会同时配置 Access Token、白名单、轻量候选开关、角色 / CV 横栏、条目信息栏、官方番剧页布局兼容开关、自动标记已看的进度标准线和当前番剧的 OP/ED 跳过按钮。

## 参考

- [Bangumi API 文档](https://bangumi.github.io/api/)：用于 Bangumi 条目、收藏、评分、章节进度相关接口。
- [Bangumi](https://bgm.tv/)：面板信息结构和视觉风格参考自 Bangumi 条目页、收藏盒、评分区域与章节列表。
- [Noneqin57/bilibili2bangumi](https://github.com/Noneqin57/bilibili2bangumi)：重点参考了 Bilibili 标题解析、UP 主白名单、同步流程、防重复和请求稳定性等思路。
- [wopub/Bilibili2Bangumi](https://github.com/wopub/Bilibili2Bangumi)：作为同类项目参考。

本项目不隶属于 Bangumi、Bilibili 或上述参考项目。引用、改写或继续开发时请注明相应来源。
