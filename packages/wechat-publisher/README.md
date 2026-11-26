# wechat-publisher

可恢复、幂等的**微信公众号草稿交付状态机**。零运行时依赖，Node.js ESM，全部外部行为通过适配器注入。

**范围仅为草稿：正文图片上传、封面缩略图上传、draft add/get、读回比较和报告。包内没有发布、群发或 free-send 接口。**

## 架构

```text
一次绑定的主题 / 账号 / renderer
                 │
                 ▼ submit(document)
         DraftDeliveryService
                 │
                 ▼
          DeliveryMachine
  render → inspect → images → thumbnail
         → draft add → draft get → compare → report
                 │
      durable store + injected adapters
```

每一步完成后保存输出；图片还会逐张保存。任务记录包含：

- 稳定幂等键和原始非敏感输入；
- 当前步骤、状态、总尝试次数、每步输出和错误；
- 每个图片子步骤及上传 URL；
- 远端副作用台账；
- 状态迁移历史；
- 最终草稿报告。

### 幂等键

`buildIdempotencyKey()` 对以下数据做稳定 JSON 序列化和 SHA-256：

```text
文档（Markdown、metadata、素材引用）+ 主题 + 账号 ID + renderer ID/version/options
```

对象属性顺序不影响结果；内容、主题、账号或 renderer 改变会得到不同任务。

账号只保留 `id` 和可选 `credentialRef`。`appSecret`、access token 等不会进入任务键或持久化记录。文档和素材应使用可序列化引用及内容 hash，不要把凭证放入文档对象。

## 一次配置，后续只提交文档

```js
import {
  DeliveryMachine,
  DraftDeliveryService,
  MemoryDeliveryStore,
} from '@integrated-content/wechat-publisher'

const machine = new DeliveryMachine({
  store: new MemoryDeliveryStore(), // POC；生产替换为持久化 store
  renderer,
  inspector,
  assets,
  drafts,
  verifier,
  retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2000 },
})

const delivery = new DraftDeliveryService({
  machine,
  theme: { id: 'default', options: { primaryColor: '#0F4C81' } },
  account: { id: 'account-a', credentialRef: 'secret-manager:account-a' },
  renderer: {
    id: 'doocs-md',
    version: '80b43d495bf51ce5d70dcfb0d73443b306104e76',
    options: {},
  },
})

const record = await delivery.submit({
  id: 'article-42',
  markdown: '# 标题\n\n正文',
  metadata: { title: '标题', author: '', digest: '' },
  renderedHtml: '<h1>标题</h1><p>正文</p>',
  images: [],
  thumbnail: { id: 'cover', uri: 'asset://cover', sha256: '...' },
})

console.log(record.status, record.result?.mediaId)
```

相同任务再次 `submit()` 会直接返回已完成记录。进程恢复后也可以只保存 key：

```js
const record = await delivery.resume(key)
```

`MemoryDeliveryStore` 仅用于测试/POC。生产 store 必须提供：

```text
load(key) -> record | null
save(record) -> record                 # 持久化完整快照
runExclusive(key, work) -> work()      # 同一 key 的跨进程互斥执行
```

## 适配器契约

### renderer

```js
renderer.render({ document, theme, renderer, account, deliveryKey })
// -> { html, plainText? }
```

### inspector

```js
inspector.inspect({ document, theme, renderer, account, rendered })
// -> {
//   ready, blockers, warnings,
//   article: { title, author, digest, content, content_source_url?, ... },
//   images: [{ id, src? , token?, replacement?, ...assetReference }],
//   thumbnail: { ...assetReference }
// }
```

`ready: false` 会在任何远端副作用之前终止。图片 ID 必须稳定且唯一。

默认 HTML 替换支持：

- `token`：把唯一占位符替换成 URL 或 `replacement`；
- `src`：替换 `<img src="...">` / 单引号形式。

复杂 HTML 建议注入 `assets.replaceImage(content, image, url)`，或使用唯一注释占位符。

### assets

必须显式声明：

```js
assets.idempotentUploads = true
```

并实现：

```js
assets.uploadImage({ image, account, idempotencyKey, ... })
// -> { url }

assets.uploadThumbnail({ thumbnail, account, idempotencyKey, ... })
// -> { mediaId, url? }
```

**同一 `idempotencyKey` 必须返回同一远端结果。**适配器可以用持久化 key→结果映射、内容 hash 去重或支持幂等键的上传服务实现。状态机不接受无法声明此能力的上传适配器，因为网络响应丢失时盲目重试会制造重复素材。

### drafts

```js
drafts.idempotentAdd = true // 若适配器能保证同 key 不重复建稿
drafts.add({ article, account, idempotencyKey, ... }) // -> { mediaId }
drafts.get({ mediaId, account, ... }) // -> { news_item: [article] } 或 { article }
drafts.findByKey?.({ account, idempotencyKey, ... }) // -> { mediaId } | null
```

草稿创建有额外的恢复保护：

1. 调用前持久化 `draftAdd.remoteState = possible`；
2. 成功后保存 mediaId；
3. 如果上次在 `possible` 状态中断，先 `findByKey()` 对账；
4. 若适配器声明幂等 add，也可用同一 key 安全重试；
5. 如果既不能对账、也不能幂等 add，任务进入 `needs_reconciliation`，**不会盲目再次 add**。

这意味着：普通 HTTP 没有天然的 exactly-once 语义。真实微信适配器必须实现持久化幂等映射或可用的草稿对账机制；缺失时本包选择失败关闭，而不是承诺无法实现的“绝对不重”。

若已修复适配器/对账能力，可显式执行：

```js
await delivery.resume(key, { reconcile: true })
```

默认 `resume()` 对 `needs_reconciliation` 不做任何远端操作。

### verifier

```js
verifier.compare({ expected, actual, ... })
// -> { ok, semanticTextEqual?, differences?, ... }
```

微信可能规范化 HTML，因此生产比较器应做语义文本、标题、封面、图片和结构检查，而不是简单比较原始字符串。`ok: false` 会进入 `READBACK_MISMATCH`，不会创建第二个草稿。

## 失败分类与重试

错误可携带：

```js
{
  code: 'ETIMEDOUT',
  category: 'transient',
  retryable: true,
  sideEffect: 'possible' // none | possible | confirmed
}
```

HTTP 408/425/429/5xx 和常见网络错误默认识别为 transient。`retry.maxAttempts` 是**每次运行**的最大尝试次数；持久化的 `step.attempts` 是跨运行总次数。瞬时故障可按指数退避自动重试，后续 `resume()` 从最近完成步骤继续。

主要终态：

- `completed`：已建草稿、读回并比较通过；
- `failed`：当前运行结束，可用同 key 恢复；
- `needs_reconciliation`：远端结果不确定，默认禁止任何重试；
- `retry_wait`：一次运行内的瞬时错误等待状态。

## Mock 与测试

`src/mock.mjs` 提供：

- 全内存 renderer/inspector/assets/drafts/verifier；
- 幂等图片、封面、草稿映射；
- 调用记录；
- 调用前或“副作用完成后丢响应”的故障注入。

```js
mocks.failNext('drafts.add', transientError('response lost'), { after: true })
```

运行：

```bash
cd packages/wechat-publisher
node --test test/*.test.mjs
```

测试覆盖完整链路、逐阶段恢复、重复提交、并发提交、响应丢失、草稿对账、禁止盲目重建、读回差异、密钥不落库和一次配置连续提交多篇文档。
