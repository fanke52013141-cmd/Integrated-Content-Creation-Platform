# wechat-renderer

可复用的真实 Chromium 渲染服务。连接 doocs/md 的 Vite 应用，直接调用 `processClipboardContent()`，输出与微信复制按钮同级的 HTML，而不是 MCP 的“`<style>` + 未内联 HTML”。

## 特性

- Browser 和 Page 延迟初始化并跨请求复用；
- 所有渲染进入串行队列，单个失败不会阻塞后续任务；
- 同一页面中重置主题，避免文档间状态泄漏；
- 复用一个自定义 CSS tab，不随请求数增长；
- 等待 doocs 的 Vue 更新、公式、Mermaid、PlantUML / Infographic 异步内容；
- 请求拦截：屏蔽跟踪、阻断指定资源、返回本地 mock 图片；
- 页面超时或失败后隔离销毁，Browser 可继续复用；
- `close()` 排空已接受任务并清理页面/浏览器；
- 输出 HTML、纯文本、图片、标题、hash、耗时、请求和 console 元数据。

## 前提

必须连接 **doocs/md 的 Vite 源码应用**，因为浏览器运行时会导入：

```text
/md/src/stores/editor.ts
/md/src/stores/render.ts
/md/src/stores/theme.ts
/md/src/stores/cssEditor.ts
/md/src/services/export/clipboard.ts
```

普通生产构建不会暴露这些模块。默认地址为 `http://127.0.0.1:5173/md/`。

Node.js ≥ 22.22.2。Puppeteer 是可选 peer dependency；也可以注入已有 Browser 或 `browserFactory`。

## API

```js
import { ChromiumRenderer } from '@integrated-content/wechat-renderer'
import puppeteer from 'puppeteer'

const renderer = new ChromiumRenderer({
  puppeteer,
  appUrl: 'http://127.0.0.1:5173/md/',
  moduleBase: '/md/src',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  launchOptions: {
    headless: 'new',
    args: ['--disable-dev-shm-usage'],
  },
  navigationTimeoutMs: 20_000,
  renderTimeoutMs: 30_000,
  settleDelayMs: 800,
})

const result = await renderer.render({
  markdown: '# 标题\n\n正文和公式 $E=mc^2$。',
  themeId: 'default', // default / grace / simple；也可使用页面已安装的 marketplace key
  customCSS: 'p { color: #333; }',
  themeOptions: {
    primaryColor: '#0F4C81',
    fontSize: '16px',
    lineHeight: '1.75',
    isShowLineNumber: false,
    isCiteStatus: true,
  },
})

console.log(result.html, result.plainText)
await renderer.close()
```

### 输入

```ts
{
  markdown: string
  themeId?: string
  customCSS?: string
  themeOptions?: {
    primaryColor?, fontFamily?, fontSize?, lineHeight?, blockSpacing?,
    linkColor?, blockquoteBackground?, codeBlockTheme?, headingStyles?, legend?,
    isCiteStatus?, isShowLineNumber?, isMacCodeBlock?, isCountStatus?,
    isUseIndent?, isUseJustify?
  }
}
```

每次调用都会先重置主题，再应用本次覆盖项；`customCSS` 缺省为空，不会继承上一篇。

### 输出

```ts
{
  html: string
  plainText: string
  hasPendingAsyncContent: false
  images: Array<{ src, alt }>
  headings: Array<{ level, text }>
  metadata: {
    renderer: 'doocs/processClipboardContent'
    rendererRevision: string
    themeId: string
    source: { sha256, characters }
    output: { sha256, characters, plainTextCharacters }
    customCSS: { present, characters }
    timings: { queueWaitMs, durationMs }
    browser: {
      launchedForRender, pageCreatedForRender,
      totalLaunches, totalPageCreations
    }
    requests: { continued, blocked, responded, failed, blockedUrls }
    console: Array<{ type, text }>
  }
}
```

## 串行与生命周期

```text
render A ───────────────┐
render B ───── queue ───┼─ A 完成/失败并清理页面 → B → close
render C ───────────────┘
```

- 成功时保留 Browser + Page，下一篇无需重新启动或导航。
- `ASYNC_CONTENT_PENDING`、`RENDER_TIMEOUT`、源码不一致或页面异常时，关闭当前 Page，避免旧任务仍在执行。
- 如果 Browser 仍连接，下一任务只创建新 Page；如果已断开，可重新 launch。
- `close()` 不再接受新任务，等待已接受任务完成后清理。
- 外部传入 `browser` 时默认只关闭服务创建的 Page，不关闭外部 Browser；可用 `ownsBrowser: true` 改变所有权。

`getStats()` 返回 launch/page/render 数量、队列 pending 和当前资源状态。

## 请求拦截

默认屏蔽 Google Tag Manager、Google Analytics 和百度统计。

自定义示例：

```js
const renderer = new ChromiumRenderer({
  puppeteer,
  blockedResourceTypes: ['media'],
  blockedUrlPatterns: [/tracker\.example\.com/],
  requestInterceptor: async ({ url, resourceType, method }) => {
    if (url === 'https://assets.test/local.png') {
      return {
        action: 'respond',
        response: { contentType: 'image/png', body: pngBuffer },
      }
    }
    if (url.includes('untrusted.example')) return { action: 'block' }
    return { action: 'continue' }
  },
})
```

返回值支持：

- `{ action: 'block' }`；
- `{ action: 'respond', response }`，交给 Puppeteer `request.respond()`；
- `{ action: 'continue', overrides? }`，交给 `request.continue()`。

资源拦截不是 CSS/HTML sanitizer。处理不可信自定义 CSS 时，仍需独立 CSS 安全策略和允许的网络来源。

## 错误码

- `INVALID_RENDER_INPUT`
- `BROWSER_UNAVAILABLE`
- `APP_NOT_READY`
- `RENDER_TIMEOUT`
- `ASYNC_CONTENT_PENDING`
- `SOURCE_MISMATCH`
- `RENDER_INVALID_RESPONSE`
- `RENDERER_CLOSED`
- `CLEANUP_FAILED`

## 测试

```bash
# 假 Browser/Page + 队列：无需 Chrome
node --test test/queue.test.mjs test/service.test.mjs

# 真实 Chromium + 自动启动的 doocs Vite 应用
node --test test/chromium-integration.test.mjs

# 全部
node --test test/*.test.mjs
```

真实集成测试在包内创建临时 Vite cache，测试结束删除。本机需要：

- Chrome；可用 `PUPPETEER_EXECUTABLE_PATH` 指定；
- `upstream/verify-article-structure-spec/cli` 中的 Puppeteer；
- `upstream/doocs-md/apps/web` 中的 Vite 与 doocs 源码。

集成用例覆盖同一 Browser/Page 连续渲染两篇、MathJax + Mermaid SVG、异步 ready、自定义 CSS 内联、第二篇样式隔离、本地图片 mock 和完整清理。
