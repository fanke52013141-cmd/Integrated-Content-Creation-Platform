# content-tools

零运行时依赖的 Node.js ESM 内容导入包：Markdown、DOCX 和**经授权的 HTML**统一转换为确定性文档模型，并提供结构化内容检查。

## 快速开始

```js
import { importContent, assertContentReady } from '@integrated-content/content-tools'

const { document, report } = importContent({
  name: 'article.md',
  data: `---\ntitle: 示例\ntags: [内容, 分发]\n---\n\n# 示例\n\n正文。`,
})

assertContentReady(document)
console.log(document.markdown, document.html, document.contentHash)
```

也可直接使用 `importMarkdown()`、`importDocx()` 和 `importHtml()`；它们返回 `{ document, media }`，统一入口额外返回 `report`。

## 统一文档模型

`schemaVersion: 1` 文档包含：

- `source`：格式、可选文件名、原始字节 SHA-256；HTML 还记录非敏感授权依据；
- `metadata`：规范化的 `title / author / summary / tags` 及可选链接、封面；
- `blocks`：标题、段落、代码、引用、列表、表格和分隔线；
- `markdown`：从 blocks 再生成的规范 Markdown，而非保留原始输入；
- `html`：白名单标签组成的安全 HTML；
- `plainText`：用于长度检查和渠道语义对账；
- `assets / links`：图片引用和超链接；DOCX 内嵌媒体以 `asset://docx/<sha256>` 引用；
- `contentHash`：规范化内容的 SHA-256，同一内容跨进程稳定；
- `importWarnings`：清洗或降级警告。

DOCX 返回的 `media` 单独包含 `{ id, name, mimeType, sha256, data: Uint8Array }`，便于上传或持久化；二进制不混入规范化文档或内容哈希。

## 各格式边界

### Markdown

支持 YAML front matter 的确定性子集（标量、行内数组、缩进无关的 `- item` 数组）、ATX/Setext 标题、 fenced code、引用、列表、表格、链接和图片。嵌套 YAML、短代码和完整 CommonMark 并非目标。原始 HTML 一律按文本转义，绝不执行；不安全的 URL 被丢弃并产生警告。

### 授权 HTML

必须显式提供授权事实，不会因“能读取 HTML”就假定有权处理：

```js
const result = importContent({
  format: 'html',
  data: '<h1>标题</h1><p>已授权正文</p>',
  authorization: {
    confirmed: true,
    basis: 'author-owned',       // 必填：自有、授权合同、开放许可等依据
    reference: 'license-or-contract-id',
  },
})
```

解析器移除脚本、样式、iframe、表单、SVG/MathML、事件处理器和非白名单属性。链接仅允许 HTTP(S)、mailto、tel、相对路径和锚点；图片仅允许 HTTP(S)、相对路径和内部 asset URI。`javascript:`、`data:`、协议相对 URL 会被拒绝。授权记录不是版权法律意见，调用方仍须验证凭证和素材权利。

### DOCX

直接读取 ZIP central directory 和 WordprocessingML，无外部命令、无宏执行、无远程转换。支持段落、Heading 1–6/标题 1–6、基础编号/项目列表、表格、超链接、内嵌或外链图片和核心属性。

安全限制：默认最多 2048 个条目、单条目 32 MiB、总解压 64 MiB；校验 CRC、路径、加密标志和压缩方法；拒绝 ZIP64、多磁盘和 DOCTYPE。可通过 `limits` 调低限制。复杂域、修订显示规则、文本框、公式及完整 Word 排版不在规范化范围内；不声称像素级还原文档。

## 内容检查

```js
const report = inspectContent(document, {
  requireTitle: true,
  minTextLength: 1,
  maxTitleLength: 200,
  maxTextLength: 200_000,
  requireImageAlt: false,
})
```

`report.ready === false` 时 `blockers` 包含机器可读代码；`warnings` 包含缺图片替代文本、标题层级跳跃、导入降级等。`assertContentReady()` 抛出携带完整 report 的 `ContentInspectionError`。检查是通用基线，渠道字数、封面和声明要求应由分发适配器追加。

## 测试

```bash
cd packages/content-tools
node --test test/*.test.mjs
```
