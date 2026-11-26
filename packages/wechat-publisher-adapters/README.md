# WeChat Publisher Adapters

为现有 `DeliveryMachine` 提供真实/模拟适配器、生产文件持久化、跨进程互斥、素材哈希缓存和微信草稿 API 客户端。

**范围仅限草稿：正文图片、封面、draft add/update/get/count、健康检查和读回比较。没有发布、群发或 free-send 接口。**

## 安全边界

- 默认不发起网络请求；`WeChatHttpClient` 在**每次请求前**检查 live 配置。
- 真实网络必须同时满足：
  1. 调用方显式 `live: true`；
  2. 环境中显式 `WECHAT_LIVE=1`；
  3. 配置 access token 或 AppID/AppSecret；
  4. API Base 为 HTTPS。
- 所有测试只使用内存 mock、包内 `.runtime` 临时目录和注入的伪 fetch transport，**没有调用真实微信或任何未授权 live 网络**。
- Secret 只存在内存中；文件 store 拒绝包含 `appSecret/accessToken/password/privateKey/credentials` 等字段的记录。

## 组成

| 模块 | 能力 |
|---|---|
| `createRendererAdapter` | 注入真实 renderer；无实现且无 `document.renderedHtml` 时失败关闭 |
| `createInspectorAdapter` | 标题/作者/摘要/正文预算、封面与图片发现、可注入质量 linter |
| `createWechatAssets` | JPG/PNG 正文图、JPEG 封面、大小/路径限制、哈希缓存上传、HTML 图片替换 |
| `createWechatDrafts` | 带持久化幂等注册的 draft add/findByKey/reconcile，以及 update/get |
| `createVerifierAdapter` | 语义文本、关键元数据、图片和结构摘要比较 |
| `WeChatHttpClient` | token 缓存、uploadimg、add_material、draft add/update/get/count、健康检查 |
| `FileDeliveryStore` | 原子快照、损坏检测、敏感字段拒绝、同 key 跨进程互斥 |
| `FileAssetCache` / `MemoryAssetCache` | 账户隔离的内容哈希结果缓存，pending 状态阻断盲目重试 |
| `MockWechatClient` / `createMockAdapters` | 无网络全链路 mock、故障注入、update/get/count/health 契约 |
| `reconcileDraftAndResume` | 先远端读回对账，再复位记录并恢复状态机 |

## 与 DeliveryMachine 对接

以下是**只有获得明确 live 授权后**才可使用的装配示例；不要在未授权环境设置 `WECHAT_LIVE=1`：

```js
import { DeliveryMachine } from '../wechat-publisher/src/state-machine.mjs'
import {
  FileAssetCache,
  FileDeliveryStore,
  createInspectorAdapter,
  createRendererAdapter,
  createVerifierAdapter,
  createWechatAssets,
  createWechatClient,
  createWechatDrafts,
} from './index.mjs'

const account = { id: 'authorized-test-account', credentialRef: 'env' }
const env = process.env
const client = createWechatClient({ account, live: true, env })
const cache = new FileAssetCache({ directory: '.runtime/asset-cache' })

const machine = new DeliveryMachine({
  store: new FileDeliveryStore({ directory: '.runtime/deliveries' }),
  renderer: createRendererAdapter({
    render: context => rendererService.render(context),
  }),
  inspector: createInspectorAdapter({
    // 可选：直接注入 packages/wechat-quality 的 lintHtml
    lint: (html, options) => lintHtml(html, options),
  }),
  assets: createWechatAssets({
    client,
    cache,
    assetsRoot: '/authorized/assets',
  }),
  drafts: createWechatDrafts({ client, cache }),
  verifier: createVerifierAdapter(),
})
```

无网络装配：

```js
const adapters = createMockAdapters()
const machine = new DeliveryMachine({
  store: new FileDeliveryStore({ directory: '.runtime/test-deliveries' }),
  ...adapters,
})
```

`createMockAdapters()` 还暴露 `client`、`calls`、`failNext()`、`cache` 和 `health.check()`，便于验证调用次数、故障恢复和健康状态。

## 持久化与互斥语义

### Delivery store

- 每个 key 以 SHA-256 文件名保存完整 JSON 快照；临时文件 `fsync` 后原子 rename。
- `load()` 对不存在返回 `null`，对损坏 JSON 返回 `STORE_CORRUPT`，不会用空记录覆盖损坏现场。
- `runExclusive()` 使用同进程 Promise 队列和跨进程 `.lock` 文件：
  - 锁文件包含 PID、hostname、随机 token 和创建时间；
  - 同 host 的死亡进程锁可回收；
  - 无法确认 owner 或元数据损坏的锁需经过 `staleMs` 才回收；
  - 释放时校验 token，避免误删其他进程的锁；
  - 默认等待 5 秒，超时返回可重试的 `DELIVERY_LOCKED`。

### 素材哈希缓存

缓存键为 `accountId + kind + 内容 SHA-256`，因此同一素材在不同账号之间不会错误复用 URL/mediaId。

上传过程：

1. 锁内先写 `pending`；
2. 调用上传；
3. 校验结果后写 `completed`；
4. 后续相同内容直接复用结果，跨进程也只允许一个上传者。

如果响应丢失，保留 `pending` 并抛出 `ASSET_RECONCILIATION_REQUIRED`，**不会盲目再次上传**。只有人工确认远端状态后才能：

```js
await cache.clearPending(context, { confirm: true })
```

`draft` 使用同一 pending/complete 机制，但缓存键是 `accountId + 'draft' + idempotencyKey`，错误为 `DRAFT_RECONCILIATION_REQUIRED`。

### 草稿对账与恢复

```js
await drafts.reconcile({ account, idempotencyKey, mediaId })
```

先调用 `draft/get` 确认远端存在，再保存 key→mediaId 映射。若需要继续原任务：

```js
const record = await reconcileDraftAndResume({
  machine,
  drafts,
  key,
  account,
  idempotencyKey,
  mediaId,
})
```

该助手同时处理当前 `DeliveryMachine.executeExisting()` 对 `needs_reconciliation` 无条件早退的问题：只有完成远端对账后，才把记录从 `needs_reconciliation` 复位为 `pending` 并恢复。**不会用第二次 add 代替对账。**

## HTTP 合同

| 方法 | 微信端点/行为 |
|---|---|
| `getAccessToken()` | `GET /cgi-bin/token`；内存缓存并提前 5 分钟过期 |
| `uploadArticleImage()` | `POST /cgi-bin/media/uploadimg`，multipart `media`，要求返回 `url` |
| `uploadThumbnail()` | `POST /cgi-bin/material/add_material?type=thumb`，要求返回 `media_id` |
| `addDraft(article)` | `POST /cgi-bin/draft/add`，body 为 `{ articles: [article] }` |
| `updateDraft({ mediaId, index, article })` | `POST /cgi-bin/draft/update`，body 为 `{ media_id, index, articles: article }`，`articles` 是对象而非数组 |
| `getDraft(mediaId)` | `POST /cgi-bin/draft/get` |
| `getDraftCount()` | `POST /cgi-bin/draft/count`，用于只读健康检查 |

客户端没有 `publish`、`massSend` 或 `freeSend` 方法。

## 凭证环境加载

支持 `.env` 文本和账号级覆盖：

```dotenv
WECHAT_LIVE=1
WECHAT_APP_ID=replace-with-authorized-test-id
WECHAT_APP_SECRET=replace-with-authorized-test-secret
# 可选：WECHAT_ACCESS_TOKEN=...
# 可选且必须为 HTTPS：WECHAT_API_BASE=https://api.weixin.qq.com

# account.id = team-a 时优先读取：
WECHAT_ACCOUNT_TEAM_A_APP_ID=...
WECHAT_ACCOUNT_TEAM_A_APP_SECRET=...
WECHAT_ACCOUNT_TEAM_A_ACCESS_TOKEN=...
WECHAT_ACCOUNT_TEAM_A_API_BASE=...
```

- `parseEnvText()` / `loadEnvFile()` 支持注释、`export` 和引号；
- `resolveWechatCredentials()` 先取账号级配置，再回退通用配置；
- `publicCredentials()` 只返回布尔配置状态，不返回 secret/token；
- access token 仅缓存在客户端内存，不写入素材缓存或 delivery record。

## 素材约束

- 正文图：真实 JPG/PNG，非空且小于 `1,000,000` bytes；
- 封面：真实 JPEG，非空且不超过 `64 KiB`；
- 文件引用必须位于显式 `assetsRoot` 内，拒绝绝对路径和 `..` 越界；
- 也接受 `Uint8Array/Buffer`，以及 DeliveryMachine 已序列化的 `{ $bytes: hex }`；
- 已是白名单 HTTPS 微信图片可直接复用；
- 任意外链图片不会自动抓取，需先获得授权并转存；
- 封面不能复用普通图片 URL，必须上传获得 `thumb_media_id`。

## 错误分类

`AdapterError` 和 `classifyError()` 保留：

- `code`：HTTP/WeChat/适配器错误码；
- `category`：`transient/auth/validation/permanent/ambiguous`；
- `retryable`：408/425/429/5xx、常见网络错误及限流为 true；
- `sideEffect`：`none/possible/confirmed`，区分读操作与可能已发生的写操作；
- `status` 和不带 secret 的 `details`。

响应缺少 URL/mediaId、非 JSON、上传或建稿结果不确定时均失败关闭，不伪造成功。

## 测试

```bash
cd packages/wechat-publisher-adapters
npm install
npm test
# tests 20
# pass 20
# fail 0

# 默认测试发现也已验证，不会直接执行锁 worker
node --test
# tests 20
# pass 20
# fail 0
```

跨进程 worker 与共享测试工具位于包根 `helpers/`，不在 `test/` 或 `test-*` 发现范围内。

覆盖：

- 真实 HTTP 形状：token 缓存、multipart、draft add/update/get/count、健康检查；
- 未显式 live 时零网络调用；
- 文件快照、敏感字段、损坏 JSON、跨进程互斥和死亡锁回收；
- 内存/文件素材缓存、并发去重、账号隔离、pending 阻断和显式清理；
- 完整 DeliveryMachine 草稿链路、重复提交零新增副作用；
- draft add 响应丢失后的禁止盲建、远端对账和恢复；
- renderer/inspector/verifier/health、错误分类和无发布能力。
