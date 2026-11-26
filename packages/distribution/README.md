# distribution

草稿优先的多渠道分发基础包。统一适配器契约、渠道能力矩阵、幂等任务回执、显式发布确认和读回对账；Node.js ESM，零运行时依赖，网络请求通过可注入 `fetch` 发出。

> **知乎、掘金、CSDN、头条仅提供 mock 契约。** 包内没有这些平台的真实发布实现，也不会把 mock 成功表示为真实发布。微信只建草稿，不发布、不群发。

## 快速开始

```js
import {
  DistributionService,
  MemoryReceiptStore,
  createWordPressAdapter,
} from '@integrated-content/distribution'

const wordpress = createWordPressAdapter({
  baseUrl: 'https://blog.example',
  credentials: {
    username: 'editor',
    applicationPassword: process.env.WP_APPLICATION_PASSWORD,
  },
  // 生产也可用 credentialProvider(credentialRef)，避免长期驻留密钥
})

const service = new DistributionService({
  adapters: [wordpress],
  store: new MemoryReceiptStore(), // 仅 POC；生产替换持久化 store
})

const receipt = await service.submit({
  channel: 'wordpress',
  document: normalizedDocument, // content-tools 的输出，或兼容对象
  account: { id: 'blog-a', credentialRef: 'secret-manager:blog-a' },
})

console.log(receipt.status) // draft；默认绝不发布
```

`document` 至少需要非空标题和正文。兼容 `content-tools` 的 `metadata.title / markdown / html / plainText / assets / contentHash`，也兼容 `revision / renderedHtml / images / thumbnail / wechatDocument`。敏感字段（secret、password、token、authorization、cookie、API key、credential 等命名）不会进入任务键或回执；`credentialRef` 可以保留。

## 能力矩阵

运行时用 `service.getCapabilities(channel)` 或 `getChannelCapabilities(channel, { adapter })` 查询，不要把前端按钮状态当作最终安全检查；服务在每次提交时再次断言。

| 渠道 | 草稿 | 真实发布 | 读回 / 对账 | 实现边界 |
|---|---|---|---|---|
| `wechat` | 是 | **否** | 是 | 包装现有 `DraftDeliveryService`，复用图片、封面、建稿、读回和恢复状态机 |
| `wordpress` | 是 | 是，需显式确认 | 是 | WordPress REST `/wp-json/wp/v2/posts`，确定性 slug 对账 |
| `webhook` | 是，接收方契约 | 可配置 | 可配置 | 默认只能得到 `accepted`；只有明确远端状态才记为 `draft` 或 `published` |
| `zhihu` | mock | **否** | mock | 可替换契约，不真实发布 |
| `juejin` | mock | **否** | mock | 可替换契约，不真实发布 |
| `csdn` | mock | **否** | mock | 可替换契约，不真实发布 |
| `toutiao` | mock | **否** | mock | 可替换契约，不真实发布 |

未知渠道、缺少适配器、未声明能力和 mock 发布都会在任何远端副作用之前失败。真实接入新平台时，应实现同一适配器接口、补充可验证能力并经过审查，不能只把 `publish` 改成 `true`。

## 草稿优先与发布确认

默认 `requestedMode: 'draft'`。发布必须同时满足：

1. 请求包含 `requestedMode: 'publish'` 和 `allowPublish: true`；
2. 渠道与适配器都声明 `publish: true`，且存在 `publish()`；
3. 已有明确 `draft` 回执，webhook 的 `accepted` 不算草稿；
4. 支持读回的渠道先对账，标题/正文不一致会进入 `needs_reconciliation`，禁止发布；
5. 适配器响应明确确认 `published`，仅 HTTP 2xx 不算发布成功。

```js
const published = await service.submit({
  channel: 'wordpress',
  document,
  requestedMode: 'publish',
  allowPublish: true,
  account: { id: 'blog-a', credentialRef: 'secret-manager:blog-a' },
})
```

同一渠道、账号、目标和文档使用同一任务键。先提交草稿、之后提交发布会升级同一回执，而不是再建一篇草稿。

## 回执与恢复

回执包含：

- `key / jobId / channel / adapterMode / requestedMode`；
- 非敏感输入和能力快照；
- `status / stage / revision / createdAt / updatedAt / completedAt`；
- 各阶段累计 `attempts.draft / publish / reconcile`；
- `remote`：remoteId、receiptId、providerStatus、URL、渠道原始状态的非敏感投影；
- `verification`：`unverified / verified / status-verified / mismatch / not-supported / simulated`；
- 结构化 `error` 和完整阶段事件 `history`。

主要状态：

| 状态 | 含义 |
|---|---|
| `queued / running` | 已持久化，等待或正在执行 |
| `draft` | 适配器明确确认草稿；不代表已发布 |
| `accepted` | 接收方已响应，但不能确认草稿或发布状态 |
| `published` | 适配器明确返回发布状态；mock 永远不会进入此状态 |
| `simulated` | 仅 mock 草稿结果，必须带 `simulated: true` |
| `failed` | 无不确定远端副作用的失败，可检查后恢复 |
| `needs_reconciliation` | 请求可能已产生副作用或读回不一致，默认禁止再次远端写入 |

```js
const same = await service.resume(key) // needs_reconciliation 时只返回，不盲试
const checked = await service.reconcile(key) // 主动读回
const recovered = await service.resume(key, { reconcile: true }) // 先对账，再按原请求继续
```

生产 store 契约：

```text
load(key) -> receipt | null
save(receipt) -> receipt
runExclusive(key, work) -> work()  # 同一 key 跨进程互斥
list(filter) -> receipt[]          # get/list 场景需要
```

`MemoryReceiptStore` 只用于测试和 POC。要实现崩溃恢复，store 必须在每次远端调用前持久化尝试事件，并提供真正的跨进程互斥。

## 适配器

### 微信：复用现有状态机

```js
import { createWeChatAdapter } from '@integrated-content/distribution'

const adapter = createWeChatAdapter({ service: draftDeliveryService })
```

`draftDeliveryService` 是 `@integrated-content/wechat-publisher` 已配置好的 `DraftDeliveryService`。适配器调用 `submit/get/resume`，映射 `mediaId`、provider key 和读回比较结果；不复制状态机，也不增加 `publish()`。缩略图、图片和微信特有字段可通过 `document.wechatDocument` 原样提供，否则从统一文档投影。

### WordPress REST

- 建稿前按 `icp-<任务键前缀>` 确定性 slug 查询；已存在则读回，不重复创建。
- 响应丢失后进入 `needs_reconciliation`；`resume(key, { reconcile: true })` 通过 slug 或 remoteId 找回。
- 普通 HTTP 并不天然 exactly-once：slug 是应用层去重约定，调用方应保证该命名空间不被其他系统占用。
- `credentials` 支持 `username + applicationPassword` 或 `token`；更推荐 `credentialProvider(credentialRef)` 按需取密钥。
- 读回比较标题和语义纯文本，避免仅因 HTML 格式变化误判；`mismatch` 会阻止发布。

### 通用 webhook

```js
const adapter = createWebhookAdapter({
  endpoint: 'https://hooks.example/draft',
  secret: process.env.WEBHOOK_SIGNING_SECRET,
  idempotent: true, // 只有接收方确实实现 Idempotency-Key 才开启
  statusEndpoint: 'https://hooks.example/receipts/:id',
  // 可选发布；默认不支持：
  supportsPublish: true,
  publishEndpoint: 'https://hooks.example/publish',
})
```

请求包含 `schemaVersion / event / idempotencyKey / occurredAt / content`，以及 `Idempotency-Key` 头。配置 `secret` 后增加 `X-Content-Signature: sha256=<HMAC-SHA256(raw-body)>`。接收方可从 `receipt_id / request_id / X-Receipt-Id` 返回回执标识。

默认事件为 `content.draft.upsert`；显式发布为 `content.publish`。无 `statusEndpoint` 且响应丢失时，服务选择人工对账而不是重复 POST。2xx + `accepted` 只表示已接收；只有响应 `status=draft|created` 才记为草稿，只有 `status=published` 才记为发布。

### 四个 mock-only 渠道

```js
import { createChannelContractMocks } from '@integrated-content/distribution'

const mocks = createChannelContractMocks()
const service = new DistributionService({ adapters: Object.values(mocks) })
const result = await service.submit({ channel: 'zhihu', document })
// result.status === 'simulated'
// result.remote.remoteId.startsWith('MOCK_ZHIHU_')
```

`ContractMockAdapter` 实现 `capabilities/createDraft/findByKey/getStatus/reconcile`，支持幂等内存草稿、调用记录和 `failNext(method, { after })` 故障注入，**故意没有 `publish()`**。替换适配器时沿用上下文：

```text
{ idempotencyKey, receipt, document, account, target, remoteId?, providerKey? }
```

返回至少 `{ status, remoteId?, providerStatus? }`；读回可增加 `matches / differences / title / content`。不要从 mock 返回构造“已发布”展示数据。

## 测试

```bash
cd packages/distribution
node --test test/*.test.mjs
```

测试覆盖能力矩阵、四个 mock 禁发布、默认草稿、发布确认、同键并发去重、敏感字段脱敏、WordPress 建稿/读回/发布及丢响应恢复、读回差异阻断、webhook 签名与回执边界，以及微信现有状态机复用。测试中的 HTTP 与微信远端均为本地替身，不代表对真实第三方服务进行了集成验证。
