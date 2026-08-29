# 心流平台全面审查报告（流程阻塞点 × UI/交互）

> 审查日期：2026-08-29 · 范围：全仓库（src/main 后端流水线、src/renderer 前端、架构与存储）
> 结论：8 段创作流水线（账号→热点→选题→素材→框架→文章→评审→配图→排版→发布）后端已全部实现且多数阶段已并行化；真正卡体验的是 **不可取消、超时策略、进度盲区、发布断点** 四类后端问题，以及 **三层 CSS 打架 + 无流程引导** 两类前端问题。

---

## 一、流水线现状

```
账号定位(lock) → 热点(内嵌dailyhot+微博hot_band) → AI筛选热点
    ↓ 收藏/采纳
选题生成(N=1~5 并行, 流式) → [素材库搜索/手录]
    ↓ 锁定
框架生成(N=1~3 并行, 流式, XML模板) ←─ 可选素材
    ↓ 锁定
文章生成/改稿(N=1~3 并行, 流式, 8000tok) ←─ 框架+素材
    ↓ 锁定
评审(N≤10角色并行, 流式) → 应用改稿(生成新文章版本)
    ↓
配图三件套(单次LLM, 仅提示词) → 排版(纯本地渲染, 毫秒级) → 微信推送草稿 → 手动回填链接
```

- 存储：单 SQLite（`node:sqlite` 同步、WAL），`artifact_references` 不可变引用（DB 触发器），版本表齐全。数据层质量高。
- 网关：OpenAI 兼容，非流式 3 次重试 + 60s 超时，全量 `model_calls` 日志；流式无重试。

## 二、流程阻塞点（按严重度）

### P0-1 全链路不可取消
任何生成一旦开始无法取消；无 AbortController 暴露给 UI（仅网关内部超时 `model-gateway.ts:299,341`、素材搜索 `material-search-service.ts:146`）。长文生成失败只能干等或杀进程。

### P0-2 流式超时策略错误
`model-gateway.ts:341-342`：流式 120s **总时长**上限（发起时一次性设定，不因收包重置）。文章 maxTokens=8000，慢模型/推理模型下必然中途被掐断 → 候选失败。且 `chatStream` **无任何重试**（`model-gateway.ts:219`），流中断即整条失败（仅"0 增量"时回退非流式）。错误文案写死"60 秒"（`model-gateway.ts:488`）。

### P0-3 进度盲区（无流式无事件的三个环节）
- 热点 AI 筛选：单次非流式调用，200 条可达 30-60s+，重试后最长 ~3 分钟 **零反馈**（`hotspot-filter.ts:41`）。
- 配图生成：非流式，10-40s 盲等（`visual-pack-generator.ts:17`）。
- 评审"应用改稿"：`ReviewService.apply` 复用 revise 但 **不传 onStream**（`review-service.ts:87-91`），秒级到分钟级盲等。

### P0-4 并发与竞态无守卫
- 主进程无任何按域互斥；跨页可同时跑选题+框架+文章+评审。
- `articles:revise` count===1 时覆写同一文章 id（`article-generator.ts:116`），连点/并发会双写同一行。
- 渲染层仅靠按钮 `disabled` 防双击，路由重挂载即失效。

### P0-5 错误被吞 / 状态失真
- `WechatPublishService.pushDraft` catch 后只写 `failed` 记录不上抛（`wechat-publish-service.ts:10`），UI 无重试入口，失败是终态。
- 批量生成的 `failed[]` 被压成一条 toast（如 TopicsPage），逐条失败不可见。
- `createReviewTask` 建行即写 `status:'completed'`（`database.ts:1441`），未开始就"已完成"。
- 加载失败与空状态在多数页面不可区分（只弹 toast，页面照常渲染空态）。
- 微信 access_token 无缓存，每次推送/测试都重新取。

### P0-6 发布环节断点（端到端手工清单）
配图阶段只产出提示词（`visual-pack-generator.ts`），**全仓库无图片生成**；发布需用户：
① 外部工具按提示词生图 ② 上传微信素材库 ③ 手抄 `thumbMediaId` 填进应用（`PublishingPage.tsx`）④ 推送 ⑤ 去_mp.weixin.qq.com 发布 ⑥ 手抄 URL 回填"标记已发布"。
且排版页提供 xiaohongshu/web 平台但发布只通微信；visual pack 对排版/发布是死端（HTML 渲染忽略图片，`article-layout-service.ts:17`）。

### P1-7 跨阶段衔接弱
无自动串联、无流程位置指示；"去xx→"按钮仅导航不预创建；热点→选题、选题→素材走隐藏 localStorage（`moliu:topic-favorite-ids` 等），直进目标页即失效。"锁定"语义各页文案不一。

### P1-8 其它
- 预置供应商 `capabilities.streaming` 默认 false 但网关从不检查（声明未用）。
- macOS 关窗后 `event.sender.send` 抛 "Object has been destroyed"（Windows 主场景不受影响）。
- 素材搜索是全仓库唯一带客户端限速的调用（250ms），其余无退避调度（热点刷新纯手动，可接受）。

## 三、UI/交互问题（按影响排序）

### U0-1 三层 CSS 叠加，互相打架且有真实渲染 bug
`styles.css`(3341行) → `refresh.css`(2717行) → `ui-optimization.css`(1322行) 顺序覆盖；token 只在最后一层定义、前两层消费；**破坏性查找替换留下 ~30 处悬空选择器**，规则体被删后并入下一条规则串味（如 `refresh.css:845-848` 发布面板继承评审空态背景；`styles.css:78-83` focus-visible 规则被毁；`styles.css:89` 品牌字标错位）。同块内重复定义 token（`ui-optimization.css:43,87` 的 --background、:11,84 的 --purple-50）；`--purple-*` 名不副实映射为苹果蓝；字距三处互相矛盾；17 处 `!important`；Fraunces 字体 4 个 @font-face 全部死代码。

### U0-2 无流程引导
10 步流水线无步骤条、无"下一步"统一引导、锁定语义各页不同；用户不知道自己走到哪一步。

### U0-3 生成体验差
生成时整面墙被 `<pre>` 流式预览替换（Topics/Frameworks/Articles），布局跳动；多候选只播第 1 条增量；无取消；ArticlesPage 私自克隆了一份 `StreamingPreview`。

### U0-4 四个页面是压缩单行代码
Reviews/Visuals/Layouts/Publishing 页面源码为单行 JSX（千字符级），无法维护；三个页面一种代码风格。

### U0-5 空态/错误态混乱
现成的 `EmptyState`/`Skeleton` 组件 0 引用；各页手写 9 种空态多数无 CTA；Toast 单槽 4s 自动消失，错误会被后到的成功提示覆盖。

### U0-6 技术值裸露
手填 `thumbMediaId`、`articleVersionId.slice(0,8)` 当卡片标题（VisualsPage）、账户编辑器裸 JSON "DOWNSTREAM PAYLOAD" 面板、"复制网页源码"按钮。

### U0-7 评审结果无上下文
所有任务同一标题"评审结果"、不按所选文章过滤、无文章名/时间/状态，问题行是纯文本复选框墙。

### U1-8 其它
热点页同屏三份重复数据（1354 行、~30 个 useState，`legacy-source-grid` 类名自证废弃设计仍在线）；文章视觉模式 contentEditable markdown↔HTML 往返丢格式（表格/嵌套列表/粗斜体）；素材选择器 `slice(0,10/12)` 静默截断；快捷键数字序与导航序不一致、Ctrl+S 空操作；全大写英文眉题（"TOPIC LAB"等）出现在纯中文产品里。

## 四、修复映射（本轮）

| 问题 | 修复 |
|---|---|
| P0-1/2/3 | 网关 AbortSignal 全链路 + 各域 cancel IPC + 流式空闲超时(60s idle/10min 总) + 流中断重试1次 + apply 走流式 + 筛选/配图 phase 事件 |
| P0-4/5 | 按域 in-flight 守卫 + revise 竞态修复 + failed[] 逐条透出 + pushDraft 上抛可重试 + 评审状态修正 + access_token 缓存 |
| P0-6 | `provider_models.kind=image` + 网关 `/images/generations` + `visual_assets` 表 + 微信 `add_material` 自动上传回填 thumbMediaId（手动输入降级为兜底） |
| U0-1 | CSS 单层化重建（tokens/base/components/pages），类名不变，删除旧三层 |
| U0-2/3 | PipelineStepper + NextStepButton + query 传参统一 + useGenerationStream + 内嵌流式卡片 + 取消按钮 |
| U0-4~7 | 四页正常格式化重构、EmptyState/Skeleton/ErrorState 全面启用、可堆叠 Toast、评审按文章过滤、卡片真实标题、JSON 折叠 |
| U1-8 | 热点页去重复展示、素材选择器去截断、眉题中文化、快捷键对齐 |

## 五、本轮不做（后续建议）
小红书/网页端发布、富文本编辑器重写、SQLite 移出主线程（同步量级尚可）、热点定时自动刷新、图片编辑器。
