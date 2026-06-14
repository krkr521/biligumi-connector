# Biligumi Connector

把 Bangumi 的收藏状态、评分和观看进度面板嵌入 Bilibili 网页端播放页右侧。

当前是最小 Tampermonkey 原型，目标先验证三件事：

- 能稳定插入到 Bilibili 播放页右侧栏。
- 能搜索并绑定 Bangumi 动画条目。
- 能读取和更新 Bangumi 收藏状态、评分、章节看过状态。

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

## 已知限制

- 自动匹配还很粗糙，目前主要靠搜索后手动绑定。
- Bilibili 页面结构经常变化，右侧栏选择器可能需要按真实页面继续适配。
- Bilibili 番剧页的当前集数只从标题里猜测，例如 `第10话`。
- 章节进度走 Bangumi `/v0/users/-/collections/{subject_id}/episodes`，如果 Bangumi API 返回具体错误，面板会直接显示出来。
- 还没有接入 Bilibili API，也没有做播放完成后自动同步。
- 白名单支持 UP 主 UID/名称、BV 号、页面 key 或 URL 片段；齿轮按钮会同时配置 Access Token 和白名单。

## 下一步

优先顺序建议：

1. 在真实 Bilibili 番剧页上调右侧插入位置，确保它正好插在选集/推荐之间。
2. 做 Bilibili `ss/ep/md/BV` 到 Bangumi subject 的自动匹配缓存。
3. 监听播放器进度，在播放到片尾后自动把当前集标为看过。
4. 把 UI 拆成可维护模块，再考虑浏览器扩展版本。

## 参考

- [Bangumi API 文档](https://bangumi.github.io/api/)
- [Noneqin57/bilibili2bangumi](https://github.com/Noneqin57/bilibili2bangumi)
- [wopub/Bilibili2Bangumi](https://github.com/wopub/Bilibili2Bangumi)
