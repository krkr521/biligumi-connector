# 测试与发布验收

在仓库根目录运行：

```text
node --test
```

测试使用 Node 内置模块，无需安装依赖或提供账号凭证。[CI](../.github/workflows/ci.yml) 使用 Ubuntu / Node 22，逐一运行 `tests/*.test.js`；新增同后缀文件会自动纳入 CI。发布前还应检查四份运行脚本的语法、manifest JSON、版本一致性和 `git diff --check`。

自动测试从两份实际脚本提取函数执行，使用可控的 Promise、DOM 和存储夹具；后台 PiP 测试执行完整 background 脚本。模拟网络不会访问真实账号。共享关键函数还会核对双端一致性，平台存储、路由适配器保留各自实现。

## 本次 14 项修复的回归矩阵

下表的反例既包括原故障，也包括修复不能破坏的正常行为。文件链接指向 CI 自动执行的用例；同一测试文件可能覆盖多个异步步骤，不以 Node 输出的用例数量代表场景数量。

| 编号与故障触发 | 应有行为 | 自动用例及保护的反例 |
| --- | --- | --- |
| R1：批量进度第一批 PATCH 等待期间切账号或页面，第二批使用了新凭证 | 所有请求固定原 Token、条目与页面；失效后不发后续写请求 | [write-context-isolation](write-context-isolation.test.js)：手动两批写、自动进度的存储等待和重复触发；正常上下文仍完成两批；旧请求不修改新页、不排队旧刷新 |
| R2：`【第二季】` / `[S2]` 清洗后继承同 UP 的第一季标题绑定 | 清洗前季度证据参与复用判断，拒绝旧季度迁移 | [title-season-reuse](title-season-reuse.test.js)：第二季拒绝第一季；正确第二季和普通第一季仍可复用；作品主体提取优先级保留；英文 `Season 2` 及原始 `[S2]` 也受校验 |
| R3：把普通 EP 标签当官方列表序号，EP0 / 1.5 导致选错集 | 区分集号来源，显式范围先定位实际集号，再生成本地序号与时间线 | [episode-number-source](episode-number-source.test.js)、[official-episode-zero](official-episode-zero.test.js)、[long-video-logic](long-video-logic.test.js)：普通第 1 集不会选 EP0、第 2 集不会选 1.5；官方 `(2/13)` 保留序号含义；延迟收到 0 与来源改变能刷新；后季 sort 从 13、来源从 1 编号，显式全局范围、合集 EP0 顺延、分段集、小数集和长视频范围均保持语义 |
| R4：旧 bundle 在存储 await 后写入新页；旧评分失败回滚或删除完成清空新页 | 每次等待后的状态修改仍属于原页面、条目与账号 | [write-context-isolation](write-context-isolation.test.js)：两个 loader 等待元数据存储时换页/换账号，含迟到存储失败；评分成功、失败、延迟刷新，删除完成与固定凭证的删除确认；正常操作不被 guard 误取消；远端评分写成功后读取失败不能回滚已提交评分 |
| R5：A 标签清空或更换 Token，B 保存无关设置恢复旧 Token | 无关设置不持久化旧凭证；真实 GM / Chrome 存储监听更新当前账号 | [write-context-isolation](write-context-isolation.test.js)：事件尚未到达时也不能恢复旧值；清除、替换、空输入、明确新 Token、过期清除确认；Chrome 非 local 事件不改账号；相同 Token 事件保留当前收藏/编辑器，不同 Token 清除旧收藏与编辑器上下文 |
| R6：首次收藏 POST 失败，乐观状态残留；重试错误地 PATCH；或成功写后读取失败被误回滚 | 写失败恢复原收藏和 pending，保留可重试草稿；成功写后的读取失败不撤销已提交内容 | [write-context-isolation](write-context-isolation.test.js)：无收藏失败后 `mergePendingCollection(null)` 仍为空，重试 `POST→POST`；已有收藏 `PATCH→PATCH` 且恢复原评论/评分；保存中禁用控件并阻止重复提交；换账号让旧编辑器失效；成功 POST/PATCH 后读取失败保留已提交评论 |
| R7：从未编辑的进度输入在 render 后恢复旧值，覆盖刚更新的已看进度 | 未修改输入跟随新数据；真实编辑草稿只在相同上下文恢复 | [input-draft-restoration](input-draft-restoration.test.js)：未聚焦/仅聚焦的旧进度不覆盖新值；已编辑、失焦、空值、多次重绘、保存后变干净；搜索选区保留；不支持 selection 的数字输入可用；换页、路由序号、URL、条目或账号不继承草稿 |
| R8：旧搜索响应或直接 ID 的后续绑定等待覆盖新搜索 | 搜索身份贯穿读取、元数据存储、长视频准备、绑定与持久化等待；过期结果和错误不改变当前状态 | [search-request-isolation](search-request-isolation.test.js)：同页新搜索、换页/条目/Token、清除、旧成功/失败；直接 ID 的 GET、元数据存储、readiness、模式保存；真实 `bindSubject` 的合集/长视频 proposal、共享锁及扩展存储读取等待；确认弹窗保存、wait→auto/bind、超时重试保留取消身份；无显式回调的候选点击也受保护；取消不污染已绑定 subject，正常同/不同 ID 可绑定；自动/手动 identify 不能反绑旧条目。[write-context-isolation](write-context-isolation.test.js) 另检查有效 bundle 可以刷新条目数据，但迟到成功/失败不得覆盖新搜索的结果、提示、错误与 busy |
| R9：PiP 标签和另一标签同时更新后台整对象，快捷键发给错误视频 | 排队串行更新，命令等待已排队变化并选择 PiP 标签 | [background-pip-state](background-pip-state.test.js)：并发进入 PiP、立即快捷键、退出 PiP 后旧更新不复活；一次存储失败不阻塞后续操作；新 worker 从持久状态恢复目标 |
| R10：补充网页请求短暂失败，被永久缓存为空 | 失败可重试；仅成功响应进入结果缓存 | [subject-supplement-cache](subject-supplement-cache.test.js)：并发请求去重，网络/解析失败后重试；成功缓存复用；合法空结果可以缓存，不因空内容无止境请求 |
| O1：官方 ss 页面按历史播放附属短篇，但 document.title 只有父番；新版分区未识别 | 从实际播放 EP 的 `SectionPanel` 读取标题，列表与数字网格均支持；不按浏览标签猜当前作品 | [official-active-section](official-active-section.test.js)：父标题 + 元祖 47；同时存在正片/元祖已选标签；`activeItem` / `activeNumber`；EP 路由优先于旧 active；隐藏旧节点与冲突候选；虚拟卸载/浏览其他标签保留已确认分区，新播放证据更新；换 URL/媒体、离开后返回清理缓存；旧布局与页面标题回退保持可用 |
| O2：元祖分区已正确绑定，但被父番“第三季”证据拒绝 | 精确当前 section key 独立保存/读取，父季度不能否定已明确选择的分区条目 | [official-section-binding-persistence](official-section-binding-persistence.test.js)：实际 bind 与存储链，47→44→47 仍读取分区绑定；未绑定分区不借父番、绑定短篇不覆盖父番；另一分区、旧 section key、伪造 key 不获豁免；回正片继续核对季度 |
| L1：主面板 z-index 20 压在网页小窗祖先 z-index 3 之上 | 主面板所有显示形态处于播放器祖先之下；独立弹窗和其他组件不被一起降低 | [mini-player-stacking](mini-player-stacking.test.js)：读取实际注入 CSS，按根 ID/class 的优先级与顺序检查普通、折叠、加载、独立搜索面板；音乐浮层覆盖仍为 0；角色/信息栏保持 20，设置弹窗/章节提示保持独立高层级，弹窗实际挂到 body。真实重叠点击与浏览器层叠仍按 M1 验收 |
| L2：官方布局开关允许退回不适用的普通视频布局 | 官方页始终使用官方布局，正确挂在整个选集模块下方；异常时安全回退 | [official-bangumi-panel-layout](official-bangumi-panel-layout.test.js)、[panel-collapse-reserve](panel-collapse-reserve.test.js)：不存在旧开关/存储项；新版嵌套分区映射到右栏直接模块；语义标题回退；找不到官方锚点不借普通锚点，右栏缺失仍在视口；普通视频原锚点有效，折叠释放旧占位 |

配套保护包括 [extension-drift](extension-drift.test.js) 的共享逻辑一致性，以及 [extension-page-state-bridge](extension-page-state-bridge.test.js) 的 MAIN world 字段白名单、当前 URL / EP 身份、SPA 过期响应和重试。它们不能代替已安装扩展的真实浏览器验收。

R8 还通过真实搜索→绑定→`loadSubjectBundle` / `loadSubjectBundleFresh` 链验证共享加载：两次直接输入相同 ID 只发一组 bundle 请求，较新的调用接管完成/失败状态，结束后不残留 busy；新文本搜索不接管该数据请求，其结果和提示也不被旧加载覆盖。搜索与写入集成测试使用 Node test 的超时和 Promise 生命周期检查，未完成的等待不能被误报为通过。

## 验证层次与边界

| 层次 | 能证明什么 | 不能据此声称什么 |
| --- | --- | --- |
| CI / Node 回归 | 真实源码在受控时序、DOM/存储夹具下的行为，双端对应逻辑与 CSS 契约 | 真实 Bilibili DOM 始终不变、浏览器完整绘制、扩展实际安装成功 |
| 完整脚本 + 模拟页面/API 的浏览器验收 | 真实 DOM 重绘、点击、表单保留和 GM/Chrome 适配后的事件行为 | 真实账号写入成功、线上站点当前结构或真实 MV3 worker 生命周期已验收 |
| 已安装脚本 + 真实 Chrome 页面 | 当前页面的实际分区、位置、层叠、点击命中、控制台和安装版本 | 油猴验收同时证明已安装扩展；一次页面验证覆盖所有站点变体 |

2026-09-05 的完整脚本模拟浏览器验收覆盖 R5/R6/R7 两版；真实 Chrome 油猴验收覆盖官方分区与小窗层叠。它们是本次人工验收记录，不会因运行 Node 测试而自动重跑。Token 监听与编辑器回滚的核心回归已经纳入 CI，并非只有临时浏览器脚本。

## 发布前手工步骤

### M1：网页小窗、弹窗与布局

1. 载入待发布版本并刷新真实官方番剧页面，记录实际版本。使用已有绑定即可，不为布局验证修改收藏或进度；暂停播放器。
2. 滚动至 Bilibili 网页小窗出现，令小窗与插件面板重叠。在同一个重叠坐标用 DevTools 的 `document.elementsFromPoint(x, y)` 检查命中顺序：小窗/视频应在插件 notice、卡片内容之前。不能只比较视频自己的 z-index；同时检查它的祖先层叠上下文。
3. 小窗画面和控制按钮应完整可见、可点击；折叠和展开插件面板后重复。打开设置弹窗，弹窗应位于小窗之上且能正常关闭。
4. 滚回普通播放器，切换网页全屏，再退出；播放器不得被主面板遮挡。若页面出现 B 站音乐浮层，检查主面板仍处在浮层之下。
5. 确认官方面板在整个选集模块之后，折叠释放多余占位；设置中不再存在官方布局关闭选项。再检查普通视频仍用原插入位置。
6. 记录截图、命中元素、面板与播放器祖先层级及控制台异常。油猴与已安装扩展分别验收；只验证了一种时明确记录另一种未做真实运行验证。

### M2：官方历史续播与分区切换

1. 从 B 站搜索打开含附属短篇的官方季页面，保留历史续播行为。记录 ss/ep URL、document.title、当前播放 EP 的 href、active 类、最近 `SectionPanel` 的 h3。
2. 当父季标题不含短篇名、实际 active EP 位于短篇面板时，插件应进入该短篇分区。已保存分区绑定应恢复；未绑定时应要求选择，不得自动借用父季绑定。
3. 只切换浏览标签或滚动虚拟列表，使播放 EP 的 DOM 临时卸载；已确认分区和绑定不得变回父番。
4. 真正播放主番集数、再切回短篇；列表和数字网格均应按播放证据切换，浏览中的非播放面板不能接管。检查另一季、另一媒体、离开再返回时无旧缓存污染。

### M3：表单与账号的完整脚本集成验收

使用隔离浏览器和模拟 Bilibili 页面、GM/Chrome 存储、Bangumi API；不要用真实凭证或真实收藏写入制造失败。

1. 加载完整未修改油猴脚本；再用 Chrome API 适配夹具对完整 extension/content.js 重复以下步骤。
2. 初始进度 0/2，点击第 1 集已看：摘要和未编辑输入都更新到 1。手工输入其他进度后触发重绘，草稿应保留；保存成功后后续进度重新跟随数据。
3. 打开设置，从模拟的另一标签清空 Token，再只改角色栏开关，存储不能恢复旧凭证。另一标签换成新 Token 后重复；旧账号的收藏与编辑器状态不得留下，同值通知不能关闭当前编辑器。
4. 模拟首次收藏写请求失败，填写评分/评论并保存：按钮在请求中禁用，失败后草稿仍在且可重试。无收藏重试仍 POST，已有收藏重试 PATCH；成功后关闭编辑器并显示已保存值。
5. 让写请求成功、紧随其后的刷新失败：已提交评分/评论不得回滚。让等待中的旧请求经历换页或换 Token：迟到成功和失败均不得覆盖新页面状态。

发布记录应分别列出自动测试日志、模拟浏览器结果、真实页面结果及未验证范围，不把 CSS 契约测试写成视觉端到端测试。
