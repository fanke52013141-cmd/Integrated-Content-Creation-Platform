# @integrated-content/workspace

团队内容协作的内存领域服务：工作空间、固定所有者与角色权限、品牌工具包、文章评论、审核状态流、乐观锁冲突检测、不可变版本快照、追加式审计日志和素材授权元数据。

- Node.js `>=22.22.2`，原生 ESM。
- 零运行时依赖，不连接数据库、身份系统、存储服务或许可证验证服务。
- 所有写操作同步执行；传入与返回的结构均进行防御性复制。
- `actorId` 表示**已经由调用方完成身份认证的用户**。本包只检查工作空间成员关系与角色权限，不验证 token、密码或会话。

## 快速开始

```js
import {
  ArticleStatus,
  WorkspaceRole,
  WorkspaceService,
} from '@integrated-content/workspace'

const service = new WorkspaceService()
const workspace = service.createWorkspace({
  name: '品牌内容组',
  ownerId: 'owner-1',
})

service.addMember({
  workspaceId: workspace.id,
  actorId: 'owner-1',
  userId: 'editor-1',
  role: WorkspaceRole.EDITOR,
})
service.addMember({
  workspaceId: workspace.id,
  actorId: 'owner-1',
  userId: 'reviewer-1',
  role: WorkspaceRole.REVIEWER,
})

service.createBrandKit({
  workspaceId: workspace.id,
  actorId: 'owner-1',
  name: '默认品牌',
  colors: { primary: '#0F4C81' },
  typography: { heading: 'Inter', body: 'Noto Sans SC' },
  voice: '专业、清晰、克制',
})

const asset = service.registerAsset({
  workspaceId: workspace.id,
  actorId: 'owner-1',
  uri: 'asset://cover-1',
  sha256: 'content-sha256',
  mimeType: 'image/png',
  rights: {
    license: 'CC BY 4.0',
    source: 'https://example.test/cover-1',
    status: 'authorized',
    commercialUse: true,
    modificationAllowed: true,
    creator: 'Creator',
    attribution: 'Creator / Example',
    expiresAt: '2030-01-01T00:00:00Z',
    evidenceRef: 'internal-rights-record-1',
  },
})

let article = service.createArticle({
  workspaceId: workspace.id,
  actorId: 'editor-1',
  title: '文章标题',
  body: '初稿',
  metadata: { channel: 'wechat' },
  assetIds: [asset.id],
})

article = service.updateArticle({
  articleId: article.id,
  actorId: 'editor-1',
  expectedRevision: article.revision,
  body: '修订后的正文',
  changeSummary: '补充正文',
})
service.submitForReview({ articleId: article.id, actorId: 'editor-1' })
article = service.approveArticle({
  articleId: article.id,
  actorId: 'reviewer-1',
  assetUsage: { commercial: true, modified: false },
})

console.assert(article.status === ArticleStatus.APPROVED)
```

可用 `createWorkspaceService(options)` 代替 `new WorkspaceService(options)`。测试或需要确定性时间时，可注入：

```js
const service = new WorkspaceService({
  clock: () => new Date('2026-01-01T00:00:00Z'),
  idGenerator: () => crypto.randomUUID(),
})
```

自定义 `idGenerator` 必须返回唯一、非空的 ID 片段。

## 角色与权限

角色常量：`owner`、`admin`、`editor`、`reviewer`、`viewer`。工作空间创建者自动成为唯一的 `owner`；所有者不能在本 API 中被移除、降级或由其他成员替代。

| 能力 | owner | admin | editor | reviewer | viewer |
| --- | --- | --- | --- | --- | --- |
| 读取工作空间、成员、品牌、文章、版本和素材 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 修改工作空间、管理成员和品牌 | ✓ | ✓ | — | — | — |
| 注册素材、更新授权元数据 | ✓ | ✓ | ✓ | — | — |
| 创建、编辑、提交文章 | ✓ | ✓ | ✓ | — | — |
| 通过审核、退回修改 | ✓ | ✓ | — | ✓ | — |
| 创建和解决评论 | ✓ | ✓ | ✓ | ✓ | — |
| 读取审计日志 | ✓ | ✓ | — | — | — |

权限字符串和完整矩阵由 `Permission`、`ROLE_PERMISSIONS` 导出；`hasPermission(role, permission)` 与 `getRolePermissions(role)` 可用于 UI 能力判断。服务端方法始终再次鉴权，不能只依赖 UI 隐藏按钮。

未加入工作空间的用户、角色权限不足以及成员被移除后的访问都会抛出 `PERMISSION_DENIED`。移除成员不会抹除文章、评论或审计记录中的历史作者 ID。

## API

所有方法使用命名参数对象，避免依赖位置参数。读取方法返回快照；修改快照不会影响服务内部状态。

### 工作空间与成员

| 方法 | 作用 |
| --- | --- |
| `createWorkspace({ name, ownerId, ownerDisplayName? })` | 创建工作空间并安装固定所有者 |
| `getWorkspace({ workspaceId, actorId })` | 获取工作空间 |
| `updateWorkspace({ workspaceId, actorId, name })` | 修改名称；相同名称不产生新审计记录 |
| `listMembers({ workspaceId, actorId })` | 按加入顺序列出成员 |
| `addMember({ workspaceId, actorId, userId, role, displayName? })` | 添加非 owner 成员 |
| `changeMemberRole({ workspaceId, actorId, userId, role })` | 修改非 owner 成员角色 |
| `removeMember({ workspaceId, actorId, userId })` | 移除非 owner 成员，立即撤销其权限 |

### 品牌工具包

| 方法 | 作用 |
| --- | --- |
| `createBrandKit({ workspaceId, actorId, name, colors?, typography?, logoAssetIds?, voice? })` | 每个工作空间创建一个品牌工具包 |
| `getBrandKit({ workspaceId, actorId })` | 读取品牌工具包 |
| `updateBrandKit({ workspaceId, actorId, expectedRevision, ...fields })` | 乐观锁更新品牌工具包 |

字段说明：

- `colors`：颜色名到 `#RRGGBB` / `#RRGGBBAA` 的映射，保存为大写十六进制。
- `typography`：排版用途到字体名称的扁平映射。
- `logoAssetIds`：当前工作空间已注册素材的唯一 ID 列表。
- `voice`：品牌语气说明。

更新中的 `colors`、`typography`、`logoAssetIds` 都是**完整替换**，不是深层合并；未传入的字段保持不变。品牌修订号从 1 开始。

### 文章、编辑冲突与审核

| 方法 | 作用 |
| --- | --- |
| `createArticle({ workspaceId, actorId, title, body?, metadata?, assetIds? })` | 创建 `draft`，初始 `revision = 1` |
| `getArticle({ articleId, actorId })` | 获取文章及内嵌审核事件历史 |
| `listArticles({ workspaceId, actorId, status? })` | 列出工作空间文章，可按状态过滤 |
| `updateArticle({ articleId, actorId, expectedRevision, title?, body?, metadata?, assetIds?, changeSummary? })` | 乐观锁编辑并生成新版本 |
| `submitForReview({ articleId, actorId, note? })` | 提交非空正文进入审核 |
| `approveArticle({ articleId, actorId, note?, assetUsage? })` | 授权检查通过后进入 `approved` |
| `requestChanges({ articleId, actorId, note })` | 带必填原因退回修改 |

状态流：

```text
draft ── submitForReview ──► in_review ── approveArticle ──► approved
                                │
                                └── requestChanges ──► changes_requested
                                                               │
                                ◄── submitForReview ───────────┘
```

退回路径是 `in_review → changes_requested → in_review → approved`；`changes_requested` 可以直接编辑和重新提交，不要求额外切换到 `draft`。

约束：

- 只有 `draft` 和 `changes_requested` 可以编辑、恢复版本或提交审核。
- `in_review` 与 `approved` 内容锁定；本包没有发布接口，也没有“已通过文章重新开稿”的隐式捷径。
- 编辑要求 `expectedRevision` 与当前值一致。否则抛出 `EditConflictError`，`code = EDIT_CONFLICT`，`details.actualRevision` 给出最新修订号；旧内容不会覆盖新内容。
- `metadata` 和 `assetIds` 更新为完整替换。`metadata` 只接受 JSON 兼容的有限数字、字符串、布尔值、null、数组及普通对象。
- 内容相同的编辑属于 no-op，不增加修订号、不创建版本、不写审计。
- 提交、通过和退回只改变流程状态，不增加内容修订号。文章记录 `submittedRevision` 和 `approvedRevision`，并保留每次审核事件的正文修订号、操作者、时间和说明。

### 版本

| 方法 | 作用 |
| --- | --- |
| `listArticleVersions({ articleId, actorId })` | 按修订号升序返回完整快照 |
| `getArticleVersion({ articleId, actorId, revision })` | 读取指定快照 |
| `restoreArticleVersion({ articleId, actorId, revision, expectedRevision, changeSummary? })` | 将旧内容复制为新的头部修订 |

快照包含标题、正文、元数据、素材引用、原因、作者和时间。恢复不会删除或重写后续历史。例如从修订 3 恢复修订 1 会得到修订 4，且 `restoredFromRevision = 1`。恢复操作本身也受乐观锁和文章可编辑状态约束。

### 评论

| 方法 | 作用 |
| --- | --- |
| `addComment({ articleId, actorId, body, parentId?, anchor? })` | 添加文章评论或回复 |
| `listComments({ articleId, actorId, status? })` | 列出全部、`open` 或 `resolved` 评论 |
| `resolveComment({ commentId, actorId })` | 解决评论；重复解决为幂等 no-op |

`anchor` 使用 UTF-16 字符串偏移 `{ start, end }`，要求 `0 <= start <= end <= body.length`。评论记录创建时的 `articleRevision`；文章后续编辑不会自动迁移锚点。回复不能跨文章，解决父评论不会自动解决子评论。

### 素材与授权

| 方法 | 作用 |
| --- | --- |
| `registerAsset({ workspaceId, actorId, uri, kind?, sha256, mimeType, rights })` | 注册素材及授权元数据 |
| `getAsset({ assetId, actorId })` | 获取素材 |
| `listAssets({ workspaceId, actorId })` | 列出工作空间素材 |
| `updateAssetRights({ assetId, actorId, expectedRevision, rights })` | 完整替换授权元数据并递增素材修订号 |
| `checkAssetUsage({ assetId, actorId, usage?, at? })` | 检查单个素材的指定用途 |
| `validateArticleAssets({ articleId, actorId, usage?, at? })` | 一次检查文章当前修订引用的全部素材 |

`rights` 结构：

```js
{
  // 必填
  license: 'CC BY 4.0',          // 许可证或授权条款名称
  source: 'https://example.test/a.png',
  status: 'authorized',          // authorized | pending | revoked
  commercialUse: true,
  modificationAllowed: true,

  // 可选
  creator: '作者',
  copyrightHolder: '权利人',
  licenseUrl: 'https://example.test/license',
  attribution: '要求的署名文本',
  acquiredAt: '2026-01-01T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z', // null 表示未声明到期时间
  evidenceRef: '内部授权凭证引用',
  restrictions: ['不得转授权'],
  metadata: { territory: 'worldwide' },
}
```

`usage` 为 `{ commercial?: boolean, modified?: boolean }`，默认均为 `false`。`at` 默认取注入时钟当前时间。报告中的 `violations` 可能包含：

- `NOT_AUTHORIZED`：状态为 `pending` 或 `revoked`；
- `LICENSE_EXPIRED`：检查时间大于或等于 `expiresAt`；
- `COMMERCIAL_USE_FORBIDDEN`：请求商业使用但元数据不允许；
- `MODIFICATION_FORBIDDEN`：请求修改素材但元数据不允许。

`approveArticle()` 默认检查全部引用素材的授权状态与到期时间；传入 `assetUsage` 后同时检查商业使用和修改权限。失败时抛出 `ASSET_LICENSE_BLOCKED`，文章保持 `in_review`，不会写“审核通过”审计。无素材引用的文章通过该检查。

**这些字段是调用方声明的元数据，不是法律意见，也不代表本包已联网验证许可证、权属或凭证。**

### 审计日志

```js
const page = service.listAuditLogs({
  workspaceId: workspace.id,
  actorId: 'owner-1',
  filters: {
    action: 'article.updated',       // 可选
    entityType: 'article',           // 可选
    entityId: article.id,            // 可选
    subjectActorId: 'editor-1',      // 可选，按操作者过滤
  },
  limit: 100,                         // 1..500，默认 100
  offset: 0,
})
// -> { items, total, offset, limit }
```

每条记录包含 `id`、`workspaceId`、`actorId`、`action`、`entityType`、`entityId`、`occurredAt` 和 `details`。日志按成功写入顺序返回，覆盖工作空间、成员、品牌、素材授权、文章、审核、版本恢复和评论变更。

本实现记录**成功的变更**；读取、鉴权拒绝、校验失败、冲突失败和 no-op 不写审计。生产系统若需安全取证，应在外围另行记录认证与拒绝事件。

## 错误模型

所有领域错误继承 `WorkspaceError`，均有稳定的 `code` 和结构化 `details`：

| 错误类 | code | 典型场景 |
| --- | --- | --- |
| `ValidationError` | `VALIDATION_ERROR` | 字段、JSON、日期、状态参数不合法 |
| `NotFoundError` | `NOT_FOUND` | 工作空间、文章、素材、版本等不存在 |
| `PermissionDeniedError` | `PERMISSION_DENIED` | 非成员或角色权限不足 |
| `StateTransitionError` | `INVALID_STATE_TRANSITION` | 审核中编辑、重复通过等 |
| `EditConflictError` | `EDIT_CONFLICT` | 文章、品牌或素材授权修订号过期 |
| `AssetLicenseError` | `ASSET_LICENSE_BLOCKED` | 审核时素材授权不满足用途 |

其他固定业务码包括 `MEMBER_EXISTS`、`BRAND_KIT_EXISTS`、`OWNER_IMMUTABLE` 和 `OWNER_ROLE_RESERVED`。

## 测试

```bash
cd packages/workspace
node --test test/*.test.mjs
# 或在仓库根目录
pnpm --dir packages/workspace test
```

测试覆盖：成员与角色隔离、所有者不变量、品牌校验与冲突、文章完整审核/退回/重交流程、过期编辑不覆盖、版本不可变与恢复、评论回复和锚点、跨工作空间引用、授权到期/撤销/用途限制、审核授权阻断、审计过滤/分页/防御性复制，以及失败和 no-op 不产生误导审计。

## 限制与生产接入边界

1. **仅内存、单进程**：重启即丢失数据；不同服务实例不共享状态。没有持久化 store、迁移、备份或跨进程事务接口。
2. **同步乐观锁而非分布式锁**：单进程内写操作不会交错；多进程部署必须由外层持久化方案提供条件更新/唯一约束，不能直接用本类充当并发协调器。
3. **不是认证系统**：调用方必须可信地映射 `actorId`，并保护用户 ID 不被客户端伪造。本包不提供登录、邀请、token、SSO 或 owner 转移。
4. **不是实时协同编辑器**：仅检测整篇修订冲突，不提供 OT/CRDT、字段级合并、实时光标、通知或自动锚点迁移。
5. **授权检查基于声明**：不下载素材、不计算/校验实际文件 hash、不验证 URL、许可证文本或授权凭证，也不替代法务审核。
6. **审计不是防篡改 WORM 存储**：服务边界能防止通过返回对象修改日志，但内存本身没有持久化、签名、哈希链或管理员取证能力。
7. **审核范围有限**：未实现多人会签、逐级审批、审核 SLA、发布/群发和已通过文章重新开稿；这些应由明确的后续状态机扩展完成。
