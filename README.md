# Biligumi Connector

把 Bangumi 的收藏状态、评分和观看进度面板嵌入 Bilibili 网页端播放页右侧。

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
- 更新评分：0 到 10 分。
- 按总进度把前 N 集批量标为看过。
- 单集切换：看过 / 未收藏。
- 支持类似 `bilibili2bangumi` 的 Bilibili 白名单；不匹配白名单的页面只显示折叠栏，不展开面板。
- 支持更稳的 UP 主标题解析：`第X话`、`EP.XX`、`#X`、`SxxExx`、`[XX]`、`『作品名』XX`，并跳过常见分辨率数字。
- Bangumi API 读取请求支持短时间去重和 5xx/网络错误自动重试。
- 本地记录最近 300 条章节同步历史，为后续自动同步防重复做准备。

## 已知限制

- 自动匹配仍以搜索后手动绑定为主；标题清洗已增强，但还没有相似度排序和首次确认后的自动匹配。
- Bilibili 页面结构经常变化，右侧栏选择器可能需要按真实页面继续适配。
- Bilibili 番剧页的当前集数会优先读取页面激活选集和标题，但复杂分集命名仍可能需要人工确认。
- 章节进度走 Bangumi `/v0/users/-/collections/{subject_id}/episodes`，如果 Bangumi API 返回具体错误，面板会直接显示出来。
- 还没有接入 Bilibili API，也没有做播放完成后自动同步。
- 白名单支持 UP 主 UID/名称、BV 号、页面 key 或 URL 片段；齿轮按钮会同时配置 Access Token 和白名单。

## 参考

- [Bangumi API 文档](https://bangumi.github.io/api/)：用于 Bangumi 条目、收藏、评分、章节进度相关接口。
- [Bangumi](https://bgm.tv/)：面板信息结构和视觉风格参考自 Bangumi 条目页、收藏盒、评分区域与章节列表。
- [Noneqin57/bilibili2bangumi](https://github.com/Noneqin57/bilibili2bangumi)：重点参考了 Bilibili 标题解析、UP 主白名单、同步流程、防重复和请求稳定性等思路。
- [wopub/Bilibili2Bangumi](https://github.com/wopub/Bilibili2Bangumi)：作为同类项目参考。

本项目不隶属于 Bangumi、Bilibili 或上述参考项目。引用、改写或继续开发时请注明相应来源。
