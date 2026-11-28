# 心流 Desktop · 批次 E 与批次 F 开发交接文档（HANDOFF）

> **交接日期**：2026-11-28  
> **当前基线**：批次 A / B / C / D 全部完成并通过全量回归  
> **数据库版本**：`v6`（`v5` = `account_style_samples`，`v6` = `skill_profiles`）  
> **自动化验证基线**：`npm run typecheck` PASS · `vitest` 65 文件 / 574 单测全绿 · `npm run build` PASS · `node scripts/smoke-workflow.mjs` PASS  
> **下一阶段前提**：先按 [real-world-checklist.md](./real-world-checklist.md) 真机单号试跑若干篇文章，验证真实模型语感、多轮 Skill 效果、微信排版保真度与单篇成本后，再启动批次 E 与批次 F。

---

## 一、已完成基线速览（批次 A ~ D）

| 批次 | 核心交付 | 关键文件 |
|---|---|---|
| **批次 A** | 账号记忆/红线全链路注入 + 标杆样文库（`v5`） | `src/shared/domain.ts`, `src/main/repositories/account-repository.ts`, `src/renderer/src/pages/AccountPage.tsx` |
| **批次 B** | 选区 AI 改写（`Ctrl+K`）+ 标题/摘要工坊 + 编辑器即时体检与字数/时长 + 插图编号修复 | `src/shared/article-checker.ts`, `src/main/services/article-generator.ts`, `src/main/services/title-digest-service.ts`, `src/renderer/src/pages/ArticlesPage.tsx` |
| **批次 C** | 提示词业务层/输出协议层拆分 + 三大重环节受控多轮 Skill（框架对抗 / 成文自检含无依据数字扫描 / 排版自检自修，`v6`）+ 网页正文一键抓取（含 SSRF 防护）+ 冲突提示与多平台排版指引 | `src/main/gateway/prompt-registry.ts`, `src/main/services/skill-runner.ts`, `src/main/services/framework-generator.ts`, `src/main/services/article-polisher.ts`, `src/main/services/layout-plan-service.ts`, `src/main/services/url-material-service.ts` |
| **批次 D** | 模型用量与成本账本（近 7/30 天 + 自定义文本单价估算）+ 拆出 `AccountRepository` & `PublishingRepository` + `vitest` 15s 超时加固 + `.gitignore` 清理 + 真机验收清单 | `src/main/database.ts`, `src/main/repositories/account-repository.ts`, `src/main/repositories/publishing-repository.ts`, `src/renderer/src/pages/DataPage.tsx`, `docs/real-world-checklist.md` |
| **真机试跑顺手修复** | 3 篇「AI科普」（智谱 `glm-5.3` + `glm-5.3-flash` + 豆包搜索）全链路试跑中发现并已修复：① 非 UUID `providerId`（如 `wx-cloud-ai`、`doubao-search`）IPC 校验放行；② 像素制同步生图端点（`api.999555999.com/v1` / `gpt-image-2.6`，320s 超时 + 断连重试 2 次 + 禁 `2048` 保护）接入 `ModelGateway` 并复用 `scripts/gen_image.py`；③ 推理模型短 `maxTokens` 饿死正文修复（标题摘要/选区改写/排版方案/框架挑刺轮统一提至 `6000`）；④ 框架对抗 Skill 重构轮改流式且非流式超时提至 `120s`；⑤ `parseFrameworkXml` 容错增强与协议层标签名强约束 | `src/main/ipc.ts`, `src/main/ipc-visual-studio.ts`, `src/main/gateway/model-gateway.ts`, `src/main/gateway/prompt-registry.ts`, `src/main/services/framework-generator.ts`, `src/main/services/title-digest-service.ts`, `src/main/services/layout-plan-service.ts`, `src/main/services/article-generator.ts`, `scripts/gen_image.py` |

> **注**：框架对抗 Skill 保持全程使用主模型（不降级到 `flash`）；真实文生图出 PNG 仅待设置环境变量 `OPENAI_API_KEY`（或在桌面端「AI 服务」填入对应生图 Key）即可实测验收。

---

## 二、必须坚守的架构约束

1. **不引入重型 Agent 框架**（严禁引入 LangChain / LangGraph / Deep Agents）；继续基于现有轻依赖与 `ModelGateway` 演进。
2. **分层原则不变**：
   - 轻环节（账号、热点、选题、标题摘要、配图规划）：单轮 `system content`（业务层可编辑，协议层受保护自动拼接）。
   - 重环节（框架、写作/精修、排版）：可控多轮 Skill（2~4 轮上限、本地确定性反馈、退化回滚、失败优雅降级）。
   - 批量一键生成（批次 E）：**确定性 SQLite 状态机**，而非自由发散的 Autonomous Agent。
3. **零回归与向后兼容**：老库平滑迁移、老版用户自定义提示词不失效、所有既有单测保持全绿。
4. **Windows PowerShell 5.1 命令规范**：不支持 `&&`，串联命令统一使用 `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };`。

---

## 三、批次 E：任务级并发 + 账号级配方 + 确定性「一键生成」编排器

> **目标**：从“单篇逐环手动点击”升级为“后台并发批量生产 + 关键审批闸门（HITL）集中人工拍板”，实现单人日产 1~3 篇乃至矩阵放量的提效。  
> **预估工期**：3~4 天 · **数据库迁移**：`v7`

### 1. 数据库迁移 `v7`（`src/main/db/migrations.ts`）

新增三张表：

```sql
-- 1) 账号级创作配方：为每个账号固化默认环节配置、Skill 开关与人工审批闸门
CREATE TABLE IF NOT EXISTS account_workflow_recipes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  -- JSON: { stages: ['framework','article','titles','visuals','layout'], useFrameworkSkill: boolean, useLayoutSkill: boolean, pauseAfterStages: string[], frameworkTemplateId?: string, reviewRoleIds?: string[], visualStyleId?: string, layoutThemeId?: string, platform?: 'wechat' | 'xiaohongshu' | 'web', modelOverrides?: Record<string, { providerId: string; model: string }> }
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_workflow_recipes_account ON account_workflow_recipes(account_id, is_default DESC);

-- 2) 确定性一键生成流水线实例（SQLite 持久化状态机，支持重启续跑）
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES account_profiles(id) ON DELETE SET NULL,
  recipe_id TEXT REFERENCES account_workflow_recipes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('topic', 'framework', 'manual')),
  source_id TEXT,
  -- queued | running | waiting_approval | completed | failed | cancelled
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  current_stage TEXT,
  -- JSON: 贯穿整条流水线的产物引用 { topicId?, materialIds?, frameworkId?, articleId?, articleVersionId?, visualPackId?, layoutId? }
  context_json TEXT NOT NULL DEFAULT '{}',
  recipe_snapshot_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status, updated_at DESC);

-- 3) 流水线单步执行台账（可定位失败步骤、单步重试与跳过）
CREATE TABLE IF NOT EXISTS pipeline_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, -- framework | article | titles | review | visuals | layout
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped')),
  artifact_id TEXT,
  artifact_version_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run ON pipeline_run_steps(run_id, step_order ASC);
```

### 2. 解除模块级大锁 → 任务级并发池（`src/main/services/generation-registry.ts`）

- **现状**：`generation-registry.ts` 目前按 `GenerationDomain`（如 `'articles'`）做全局互斥，导致无法同时跑第 2 篇文章或在精修第 1 篇时后台生成第 2 篇。
- **改造要点**：
  - 保留既有 `beginGeneration(domain, ...)` 兼容签名（避免影响现有所有单测与页面），新增按**任务锁键（`lockKey`）**互斥与**可配置并发槽位池**（默认文本类并发上限 `2~3`，生图类 `2`）：
    - 例：同一篇文章的改稿锁键为 `article:${articleId}`，不同文章可并行运行；
    - 无具体作品 ID 的独立生成（如批量新建）按 `taskId` 分配并发槽位；
  - 取消接口支持按 `taskId` 或 `domain` 取消，事件流 `GenerationEvent` 携带 `taskId` 与 `runId?`。

### 3. 确定性编排器（新增 `src/main/services/pipeline-runner-service.ts`）

- **核心流程**：
  1. `createRunsFromTopics(input)` / `createRunFromFramework(input)`：支持从选题池多选批量创建 `pipeline_runs`，落库配方快照 `recipe_snapshot_json` 与 `pipeline_run_steps`。
  2. **调度循环**：按并发上限领取 `queued` Run，依次调用既有成熟服务（`FrameworkGenerator` → `ArticleGenerator` → `TitleDigestService` → 可选 `ReviewService` / `VisualStudio` → `LayoutPlanService` + `ArticleLayoutService`）。
  3. **人工审批闸门（HITL Gate）**：
     - 当某一步 `stage` 命中 `recipe.pauseAfterStages`（例如默认 `['framework', 'article']`）时，步骤与 Run 置为 `waiting_approval` 并停止推进；
     - 用户可在对应页面自由编辑/选区改写/保存新版本，随后点击「通过并继续（`approveAndResume(runId)`）」；
     - **关键细节**：`approveAndResume` 必须读取目标作品当前的 `currentVersionId`（延续用户刚修改的最新版本，而不是旧快照！）。
  4. **异常与重启恢复**：
     - 应用重启时，将残留 `running` 的 Run 与 Step 自动标为 `failed`（附提示“应用重启中断，可点击重试当前步骤”），绝不卡死在 `running`；
     - 支持 `retryStep(runId, stage)`、`skipStep(runId, stage)`、`cancelRun(runId)`。

### 4. IPC 与前端「生产队列」工作台

- **IPC**：`recipes:list / save / remove`、`pipeline:create / list / get / approve / retry-step / skip-step / cancel`。
- **前端**：
  - 账号页增加「创作配方」子 Tab（配置默认阶段、框架/排版 Skill 开关、审批闸门、默认主题与模型路由）；
  - 选题页 / 框架页支持勾选多条 → 「一键入队生产」；
  - 侧边栏或创作台新增「生产队列」视图，按「待我审批 / 后台运行中 / 失败待重试 / 已完成待推送」分栏展示，支持一键跳转到对应文章/框架审批并点击「通过并继续」。

### 5. 批次 E 验收标准
- 新增 `tests/pipeline-runner.test.ts`，覆盖：
  1. 无闸门全自动串跑（选题 → 框架 → 成稿 → 标题摘要 → 排版）；
  2. 审批闸门暂停 + 人工修改文章产生新版本 + `approveAndResume` 延续新版本排版；
  3. 单步失败隔离 + `retryStep` 恢复完成 + `skipStep` 跳过；
  4. 模拟重启后残留 `running` 自动回收为可重试状态；
  5. 多篇并发隔离互不阻塞。

---

## 四、批次 F：矩阵号多公众号通道 + 跨号防撞车

> **目标**：解除当前 `publish_channels` 单例限制（`CHECK(id='wechat-official')`），让每个矩阵号绑定自己的公众号凭证并防推错号，同时在选题阶段自动规避矩阵号间同质化撞车。  
> **预估工期**：2~3 天 · **数据库迁移**：`v8`

### 1. 数据库迁移 `v8`（`src/main/db/migrations.ts`）

- **重建 `publish_channels` 表**（SQLite 改 `CHECK` 约束需建新表 → 迁数据 → 删旧表 → 改名，务必在事务内执行并关闭/恢复外键检查）：
  - 移除 `CHECK(id='wechat-official')`，允许任意 UUID 或 `'wechat-official'`；
  - 新增列：
    - `account_profile_id TEXT REFERENCES account_profiles(id) ON DELETE SET NULL`（绑定所属矩阵号）；
    - `is_default INTEGER NOT NULL DEFAULT 0`（未绑定账号文章的默认回退通道）；
  - 存量 `'wechat-official'` 记录无损迁入并标记 `is_default = 1`，关联的 `publish_channel_secrets` 与 `publications.channel_id` 外键保持 100% 完整；
- **通道验证状态隔离**：`workflow_kv` 中原先全局单例的微信验证键改为按 `channel_id` 隔离（如 `wechat_verify:${channelId}`），避免通道 A 验证通过误显示到通道 B。

### 2. 多通道仓储与发布服务改造

- [publishing-repository.ts](file:///d:/software/Integrated-Content-Creation-Platform/src/main/repositories/publishing-repository.ts)（批次 D 已拆出，天然隔离）：
  - 新增 `listWechatChannels()`、`getWechatChannel(channelId?)`、`getWechatChannelForAccount(accountId?)`、`saveWechatChannel(input, encryptedSecret?)`、`removeWechatChannel(channelId)`；
  - 保留无参 `getWechatChannel()` 指向默认通道，兼容老测试与单号用户。
- [wechat-publish-service.ts](file:///d:/software/Integrated-Content-Creation-Platform/src/main/services/wechat-publish-service.ts)：
  - `tokenCache` 从单一对象改为 `Map<string, { token: string; expiresAt: number }>`（按 `channelId` 隔离）；
  - `pushing` 并发锁改为 `Set<string>`（按 `channelId` 或 `articleId` 隔离，允许不同公众号同时推送草稿箱）；
  - 推送草稿 / 预检 / 正式发表 / 拉取阅读数据时，优先根据 `article.accountId` 路由其绑定通道，否则回退默认通道（也允许前端显式指定 `channelId`）；
  - 新增 `batchPushDrafts(items)`：支持矩阵号多篇已完成排版稿一键批量推入各自草稿箱（逐篇独立返回成败结果）。

### 3. 前端防推错号与多通道管理

- **发布中心 / 平台配置页**：
  - 公众号通道从单卡表单升级为「通道列表 + 绑定账号选择器 + 默认通道标记」，每个通道独立测试连接与展示白名单 IP 提示；
  - 推送按钮与确认弹窗**强提示目标公众号名称与 AppID 尾号**（如 `推送至「科技主号 · wx...8a2f」草稿箱`），文章所属账号与通道不匹配时高亮警示，杜绝矩阵号推错号。

### 4. 跨矩阵号选题防撞车（`src/main/services/topic-generator.ts`）

- **现状**：`topic-generator.ts` 目前仅按当前 `accountId` 查询本号历史选题去重。
- **改造**：
  - 当系统存在多个账号时，按当前关键词/热点额外查询**其他账号近 14 天内已生成的选题标题与切入角度**（最多 12 条）；
  - 注入 `<其他矩阵号已写角度>` 到用户上下文，明确指令：“以下角度已被我方其他矩阵号在近 14 天内使用，请避开同质化切入点，从本账号独特定位切入差异化角度”。

### 5. 批次 F 验收标准
- 新增 `tests/multi-wechat-channels.test.ts`：
  1. 存量单通道旧库执行 `v8` 迁移后，原有 `wechat-official` 配置、加密密钥与历史 `publications` 零丢失；
  2. 多通道独立 `appId` / `encryptedSecret` / `tokenCache` / 验证状态互不串扰；
  3. 不同账号的文章自动路由到各自绑定的公众号通道；
  4. 跨矩阵号选题去重：A 号已写过的角度自动注入到 B 号选题上下文的 `<其他矩阵号已写角度>` 中。

---

## 五、每批次统一验收命令（Windows PowerShell）

```powershell
npm.cmd run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node scripts/smoke-workflow.mjs
```

---

## 六、真机试跑后启动下一轮的快捷指令

当你用真实账号与模型试跑完几篇文章后，直接开新对话或在本对话回复：
- 若发现真机体验问题：贴出具体环节与体感反馈，先做小步精调再进批次 E；
- 若单号体验满意、准备放量：直接回复 **「按 `docs/HANDOFF-2026-11-28-批次E与批次F.md` 推进 批次 E」** 即可无缝接续。
