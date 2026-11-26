import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { ChromiumRenderer } from '../src/index.mjs'

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(PACKAGE_ROOT, '../..')
const WEB_ROOT = path.join(ROOT, 'upstream/doocs-md/apps/web')
const CHECKER_ROOT = path.join(ROOT, 'upstream/verify-article-structure-spec/cli')
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const canRun = existsSync(CHROME)
  && existsSync(path.join(CHECKER_ROOT, 'node_modules/puppeteer'))
  && existsSync(path.join(WEB_ROOT, 'node_modules/vite'))
  && existsSync(path.join(WEB_ROOT, 'src/main.ts'))

async function availablePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

test('real Chromium reuses doocs app, waits for async content and isolates themes', {
  skip: canRun ? false : 'Local Chrome, doocs Vite or Puppeteer is unavailable',
  timeout: 180_000,
}, async t => {
  const requireChecker = createRequire(path.join(CHECKER_ROOT, 'package.json'))
  const requireWeb = createRequire(path.join(WEB_ROOT, 'package.json'))
  const puppeteer = requireChecker('puppeteer')
  const viteEntry = requireWeb.resolve('vite')
  const { createServer } = await import(pathToFileURL(viteEntry).href)
  const runtime = await mkdtemp(path.join(PACKAGE_ROOT, 'test/.runtime-'))
  const port = await availablePort()
  let server
  let renderer

  try {
    server = await createServer({
      configFile: path.join(WEB_ROOT, 'vite.config.ts'),
      configLoader: 'runner',
      root: WEB_ROOT,
      cacheDir: path.join(runtime, 'vite-cache'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port, strictPort: true },
    })
    await server.listen()

    renderer = new ChromiumRenderer({
      puppeteer,
      appUrl: `http://127.0.0.1:${port}/md/`,
      moduleBase: '/md/src',
      executablePath: CHROME,
      launchOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
      navigationTimeoutMs: 30_000,
      renderTimeoutMs: 90_000,
      settleDelayMs: 800,
      requestInterceptor: async ({ url }) => {
        if (url === 'https://assets.test/local.png') {
          return {
            action: 'respond',
            response: {
              contentType: 'image/png',
              body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
            },
          }
        }
        return { action: 'continue' }
      },
    })

    const first = await renderer.render({
      markdown: [
        '# Chromium 集成',
        '',
        '第一篇 **正文**，包含行内公式 $E=mc^2$。',
        '',
        '```mermaid',
        'graph TD',
        '  A[开始] --> B[完成]',
        '```',
        '',
        '![拦截图片](https://assets.test/local.png)',
      ].join('\n'),
      themeId: 'default',
      customCSS: 'p { color: rgb(1, 2, 3) !important; }',
      themeOptions: { primaryColor: '#0F4C81', isShowLineNumber: false },
    })

    assert.equal(first.hasPendingAsyncContent, false)
    assert.match(first.html, /Chromium 集成/)
    assert.match(first.html, /rgb\(1,\s*2,\s*3\)/)
    assert.ok((first.html.match(/<svg/g) ?? []).length >= 2, 'MathJax and Mermaid should both produce SVG')
    assert.ok(first.images.some(image => image.src === 'https://assets.test/local.png'))
    assert.ok(first.metadata.requests.responded >= 1)
    assert.equal(first.metadata.output.sha256.length, 64)
    assert.equal(first.metadata.browser.launchedForRender, true)

    const second = await renderer.render({
      markdown: '# 第二篇\n\n第二篇正文。',
      themeId: 'grace',
      customCSS: '',
    })

    assert.equal(second.hasPendingAsyncContent, false)
    assert.match(second.plainText, /第二篇正文/)
    assert.doesNotMatch(second.html, /Chromium 集成/)
    assert.doesNotMatch(second.html, /rgb\(1,\s*2,\s*3\)/)
    assert.equal(second.metadata.browser.launchedForRender, false)
    assert.equal(second.metadata.browser.pageCreatedForRender, false)
    assert.equal(renderer.getStats().browserLaunches, 1)
    assert.equal(renderer.getStats().pageCreations, 1)
    assert.equal(renderer.getStats().renders, 2)

    t.diagnostic(JSON.stringify({
      firstHtmlCharacters: first.metadata.output.characters,
      secondHtmlCharacters: second.metadata.output.characters,
      firstSvgCount: (first.html.match(/<svg/g) ?? []).length,
      browserLaunches: renderer.getStats().browserLaunches,
      pageCreations: renderer.getStats().pageCreations,
      localResponses: first.metadata.requests.responded,
    }))
  }
  finally {
    if (renderer) await renderer.close()
    if (server) await server.close()
    await rm(runtime, { recursive: true, force: true })
  }
})
