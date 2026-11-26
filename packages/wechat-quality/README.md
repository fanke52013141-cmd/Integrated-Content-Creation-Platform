# WeChat Quality：版本化兼容矩阵与独立 Linter

本包补充官方 `verify-article-structure@0.2.30` 未覆盖或策略不同的检查，不替代其真实浏览器布局检测。核心数据在 [`rules/compatibility-v1.json`](rules/compatibility-v1.json)，执行器只从该矩阵读取规则、目标严重级别和豁免配置。

## 快速开始

```bash
cd packages/wechat-quality
npm install
npm test

# 粘贴到公众号编辑器前的检查
node cli.mjs article.html --target=editor-paste

# 创建远程草稿前的严格检查
node cli.mjs article.html --target=draft

# 查看当前矩阵和规则元数据
node cli.mjs --list-rules
```

CLI 始终向 stdout 输出 JSON：

| 退出码 | 含义 |
|---:|---|
| 0 | 无阻断项；可能是 `pass`，也可能是需要复核的 `degrade` |
| 1 | 存在 `block` 项，`valid=false` |
| 2 | 参数、文件读取、矩阵或执行异常 |

## 目标与降级/阻断策略

| 目标 | 本地/相对图片 | 非白名单 HTTPS 图片 | HTTP 或 `//` 图片 | 其他危险项 |
|---|---|---|---|---|
| `preview` | `degrade` | `degrade` | `degrade` | 按规则阻断或降级 |
| `editor-paste` | `degrade`，提示转存 | `degrade`，提示转存 | `degrade` | 按规则阻断或降级 |
| `draft` | **block** | **block** | **block** | 按规则阻断或降级 |

草稿图片 Host 白名单在矩阵中版本化，目前为：

- `mmbiz.qpic.cn`
- `mmbiz.qlogo.cn`
- `res.wx.qq.com`

检查是**精确 Host 匹配**，且只接受显式 HTTPS。`src`、`data-src`、`data-original`、`srcset`、`imagesrcset`、其他图片属性及 CSS `url()` 都会检查，不能用备用地址绕过。`data:`、`file:`、`blob:`、`javascript:`、`vbscript:`、`filesystem:` 等一律阻断。

`status` 与 `valid` 的语义：

- `pass`：零发现，`valid=true`；
- `degrade`：只有降级项，`valid=true`，仍应复核后再交付；
- `block`：至少一个阻断项，`valid=false`，CLI 退出 1。

## 规则覆盖

当前 `matrixVersion=1.0.0`，共 **19 条规则**。

| 类别 | 规则 | 覆盖内容 |
|---|---|---|
| 危险标签 | `html.dangerous-tag` | `script/iframe/object/embed/style/link/meta/form/input/button` 等交互、嵌入或非文章标签；同时覆盖 SVG `foreignObject` |
| 危险属性 | `html.event-handler-attribute`、`html.dangerous-attribute` | 所有 `on*` 行内事件、`srcdoc`、`formaction` |
| URL | `url.unsafe-scheme`、`url.degraded-scheme` | 危险 scheme、控制字符/空白混淆、HTTP/协议相对链接、非 HTTP 链接 |
| CSS 禁用 | `css.position`、`css.layout`、`css.animation`、`css.variable`、`css.dangerous` | absolute/fixed/sticky、grid/float、动画/transition/smooth-scroll、CSS 变量/var()、expression/behavior/-moz-binding/@ 规则 |
| CSS 兼容 | `css.modern-function`、`css.font-family` | `color-mix/oklch/oklab/lab/lch` 降级；所有显式 `font-family` 按官方第 3 章降级 |
| 官方结构缺口 | `structure.leaf-block`、`structure.nodeleaf-content` | `span[leaf]` 的块级后代、`section[nodeleaf]` 的非许可组件或非空文本 |
| 图片 | `image.data-w`、`image.source-required`、`image.nonremote`、`image.insecure`、`image.external-host` | `data-w` 有限正数、图片地址必填、本地图、HTTP 图、非白名单外链图 |

### 官方 checker 未覆盖项如何补足

| 官方缺口 | 本包状态 | 说明 |
|---|---|---|
| 第 3 章字体 | `implemented-as-degrade` | 检测任意 `font-family`，建议移除并继承默认字体栈；即使写成官方默认栈也提示，因为规范原则是“不建议设置任何字体族” |
| 2.2 `span[leaf]` | `implemented` | 递归检查所有后代，只允许文本和行内元素；`section/div/p/table` 等块级元素阻断 |
| 2.3 `section[nodeleaf]` | `implemented-with-explicit-allowlist` | 官方文档没有列出完整“特定组件”清单，因此 v1 默认只无条件接受 `img`；其他组件须验证后通过 API 显式加入 |
| `redundant-node` | `deferred` | 上游只预留文案和跳过用例，尚未纳入规范或实现；本包不擅自创造判定标准 |

### `section[nodeleaf]` 自定义豁免

```js
import { lintHtml } from './index.mjs';

const report = lintHtml(html, {
  target: 'draft',
  nodeleafAllowedTags: ['mp-verified-component'],
});
```

该选项只表示项目已核验的豁免，**不代表本包声称该组件获得官方普遍支持**。

## API

```js
import { lintHtml } from './index.mjs';

const report = lintHtml(html, {
  target: 'draft',             // preview | editor-paste | draft
  source: 'article.html',
  // matrixPath: '/path/to/versioned-matrix.json',
  // nodeleafAllowedTags: ['mp-verified-component'],
});

console.log(report.status, report.valid, report.summary);
for (const finding of report.findings) {
  console.log(finding.ruleId, finding.severity, finding.location, finding.recommendation);
}
```

报告包含：

- `matrixVersion`、`target`、`status`、`valid`、`recommendedAction`；
- 元素/图片/发现/阻断/降级数量及 `ruleHits`；
- 官方缺口覆盖状态；
- 每条发现的规则、严重级别、动作、证据、节点路径、行列/offset 和修复建议。

矩阵和解析器也公开：`loadMatrix`、`validateMatrix`、`resolveRule`、`classifyUrl`、`parseInlineStyle` 等，见 [`index.mjs`](index.mjs)。

## 测试

```bash
npm test
# tests 33
# pass 33
# fail 0
```

测试覆盖：

- 草稿完全合规、预览降级不阻断、综合危险样本阻断；
- 危险标签/属性、混淆 URL、CSS 禁用项及安全 CSS；
- `span[leaf]` 行内正例与多种块级反例；
- `section[nodeleaf]` 默认图片正例、自定义组件正反例；
- `data-w` 的 `1/1080/0.5/.5` 正例，以及 `0/-1/NaN/Infinity/12px/0x10/空值/缺失` 反例；
- 本地图、任意外链、HTTP、协议相对地址、缺失地址、`data-src` 回退；
- CSS `url()`、`srcset` 绕过尝试；
- 矩阵重复 ID/错误引用/未知目标、结果确定性、CLI 退出码和 JSON 可解析性。

### 真实文章补充验证

对 `poc/artifacts/article-fragment.html` 以 `--target=draft` 检查，结果保存在 [`test-results/main-article-draft.json`](test-results/main-article-draft.json)：

- 官方 checker：`isValid=true`；
- 本包：`status=block`，共 44 项发现；
- **4 个阻断项**：3 个 `<input>` 和 1 个本地图片；
- **40 个降级项**：2 个显式字体族、38 个 `color-mix()`。

这体现了本包与官方 checker 的互补关系：官方通过不表示草稿输入已经满足本项目的静态内容与图片交付策略。`<input>` 阻断属于本包的保守策略，应把任务列表改成静态符号；它不是对官方标签白名单的断言。

## 版本化与边界

- 规则、严重级别、标签集合和 Host 白名单变更必须提升 `matrixVersion` 并补正反测试；报告始终携带版本，便于比较。
- 本包是**保守项目兼容策略**，不是微信官方完整白名单，也不对 HTML 做自动清理或安全消毒。
- 不发起网络请求，因此只验证 URL 形式、协议和 Host，不验证可访问性、Content-Type、实际图片尺寸或 `data-w` 是否等于真实像素宽度。
- 不执行 Chromium 布局测量；`width/height/line-height`、Dark Mode 等仍应交给官方 checker 和真机回归。
- `data:` 图片也按不可交付地址阻断，避免 SVG/脚本内容和草稿外链不确定性。
