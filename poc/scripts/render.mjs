import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { assertArticleImage, resolveInside } from '../server/images.mjs'
import { compileModernColors, replaceTaskInputsWithStaticSymbols } from '../server/article-transforms.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '../..')
const FIXTURES = path.join(ROOT, 'poc/fixtures')
const OUTPUT = path.join(ROOT, 'poc/artifacts', process.env.POC_OUTPUT_DIR ?? '')
const OUTPUT_PUBLIC = path.posix.join('poc/artifacts', process.env.POC_OUTPUT_DIR ?? '')
const THEME_CSS_PATH = process.env.POC_THEME_CSS ? path.resolve(ROOT, process.env.POC_THEME_CSS) : null
const requireCore = createRequire(path.join(ROOT, 'upstream/doocs-md/packages/core/package.json'))
const requireChecker = createRequire(path.join(ROOT, 'upstream/verify-article-structure-spec/cli/package.json'))
const { JSDOM } = requireCore('jsdom')
const puppeteer = requireChecker('puppeteer')
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.POC_DOOCS_URL ?? 'http://127.0.0.1:5173/md/'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

async function main() {
  const markdownPath = process.env.POC_MARKDOWN ? path.resolve(ROOT, process.env.POC_MARKDOWN) : path.join(FIXTURES, 'wechat-poc.md')
  const markdown = await readFile(markdownPath, 'utf8')
  const customCss = THEME_CSS_PATH ? await readFile(THEME_CSS_PATH, 'utf8') : ''
  const diagram = await readFile(path.join(FIXTURES, 'assets/poc-diagram.png'))
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? DEFAULT_CHROME,
    headless: 'new',
    args: ['--disable-dev-shm-usage'],
  })

  let result
  let page
  const consoleMessages = []
  try {
    page = await browser.newPage()
    page.on('console', (message) => {
      consoleMessages.push(`${message.type()}: ${message.text()}`)
      if (message.type() === 'error') {
        void Promise.all(message.args().map(async (argument) => {
          try {
            return await argument.evaluate(value => value instanceof Error ? value.stack : String(value))
          }
          catch {
            return '<unserializable console argument>'
          }
        })).then(values => consoleMessages.push(...values)).catch(() => {})
      }
    })
    page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.stack ?? error.message}`))
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (pathname.endsWith('/assets/poc-diagram.png')) {
        return request.respond({ contentType: 'image/png', body: diagram })
      }
      return request.continue()
    })

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForSelector('#output .container', { timeout: 20_000 })
    await page.waitForSelector('.cm-content', { timeout: 20_000 })
    await page.waitForFunction(() => document.querySelector('#output')?.textContent?.trim().length > 0, { timeout: 20_000 })

    result = await page.evaluate(async ({ source, customCss }) => {
      const base = '/md/src'
      const [
        { useEditorStore },
        { useRenderStore },
        { useThemeStore },
        { useCssEditorStore },
        { processClipboardContent },
      ] = await Promise.all([
        import(`${base}/stores/editor.ts`),
        import(`${base}/stores/render.ts`),
        import(`${base}/stores/theme.ts`),
        import(`${base}/stores/cssEditor.ts`),
        import(`${base}/services/export/clipboard.ts`),
      ])

      const editorStore = useEditorStore()
      const renderStore = useRenderStore()
      const themeStore = useThemeStore()
      const cssEditorStore = useCssEditorStore()
      await renderStore.initRendererInstance()
      themeStore.theme = 'default'
      themeStore.primaryColor = '#0F4C81'
      themeStore.fontSize = '16px'
      themeStore.isCiteStatus = true
      themeStore.isShowLineNumber = false
      themeStore.isMacCodeBlock = false
      themeStore.isCountStatus = false
      themeStore.legend = 'alt'
      if (customCss) cssEditorStore.addCssContentTab('POC_CUSTOM_THEME', customCss)
      await themeStore.applyCurrentTheme()
      themeStore.updateCodeTheme()
      editorStore.importContent(source)
      renderStore.render(source, { force: true, themeMode: 'light' })
      await new Promise(resolve => setTimeout(resolve, 800))
      const rendered = await processClipboardContent(themeStore.primaryColor)
      return {
        ...rendered,
        sourceFromEditor: editorStore.getContent(),
      }
    }, { source: markdown, customCss })
  }
  catch (error) {
    await mkdir(OUTPUT, { recursive: true })
    if (page) {
      await writeFile(path.join(OUTPUT, 'app-dom.html'), await page.content(), 'utf8').catch(() => {})
      await page.screenshot({ path: path.join(OUTPUT, 'app-error.png'), fullPage: true }).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    await writeFile(path.join(OUTPUT, 'browser-console.log'), `${consoleMessages.join('\n')}\n${error.stack}\n`, 'utf8')
    throw error
  }
  finally {
    await browser.close()
  }

  if (result.sourceFromEditor !== markdown) throw new Error('CodeMirror 中的源文章与输入文件不一致')
  if (result.hasPendingAsyncContent) throw new Error('存在未完成的异步公式或图表，拒绝导出')

  const dom = new JSDOM(`<body>${result.html}</body>`, { url: 'http://localhost/' })
  const root = dom.window.document.body
  const staticTaskInputs = replaceTaskInputsWithStaticSymbols(root)
  const compiledColorStyles = compileModernColors(root)
  const assets = []
  const images = [...root.querySelectorAll('img')]
  for (const [index, image] of images.entries()) {
    const src = image.getAttribute('src') ?? ''
    if (!src || /^(?:https?:)?\/\//i.test(src)) {
      assets.push({ id: `img-${index + 1}`, src, status: 'external-requires-upload' })
      continue
    }
    if (!src.startsWith('assets/')) {
      assets.push({ id: `img-${index + 1}`, src, status: 'unsupported-local-path' })
      continue
    }
    const sourcePath = resolveInside(FIXTURES, src)
    const metadata = await assertArticleImage(sourcePath)
    image.setAttribute('data-local-src', src)
    image.setAttribute('data-asset-id', `img-${index + 1}`)
    if (metadata.width) image.setAttribute('data-w', String(metadata.width))
    image.setAttribute('data-ratio', metadata.width && metadata.height ? String(metadata.height / metadata.width) : '')
    image.style.maxWidth = '100%'
    image.style.height = 'auto'
    const outputAssetPath = resolveInside(OUTPUT, src)
    await mkdir(path.dirname(outputAssetPath), { recursive: true })
    await copyFile(sourcePath, outputAssetPath)
    assets.push({ id: `img-${index + 1}`, src, ...metadata, status: 'ready-for-upload' })
  }

  const fragment = root.innerHTML
  const outputText = normalizeText(dom.window.document.body.textContent ?? '')
  const sourceText = normalizeText(markdown
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```(\w+)?/g, '')
    .replace(/[#>*_`\[\]()!|]/g, ' '))

  await mkdir(OUTPUT, { recursive: true })
  const preview = `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>WeChat POC Preview</title>\n<style>body{margin:0;background:#f2f3f5}main{box-sizing:border-box;max-width:677px;margin:24px auto;padding:24px 16px;background:#fff}@media(max-width:720px){main{margin:0}}</style>\n</head>\n<body><main>${fragment}</main></body>\n</html>\n`
  await Promise.all([
    writeFile(path.join(OUTPUT, 'article-fragment.html'), fragment, 'utf8'),
    writeFile(path.join(OUTPUT, 'article-preview.html'), preview, 'utf8'),
    writeFile(path.join(OUTPUT, 'source-normalized.txt'), sourceText, 'utf8'),
    writeFile(path.join(OUTPUT, 'rendered-normalized.txt'), outputText, 'utf8'),
    writeFile(path.join(OUTPUT, 'browser-console.log'), `${consoleMessages.join('\n')}\n`, 'utf8'),
  ])

  const manifest = {
    schemaVersion: 1,
    renderer: {
      project: 'doocs/md',
      revision: '80b43d495bf51ce5d70dcfb0d73443b306104e76',
      path: 'Chromium -> doocs processClipboardContent()',
      appUrl: APP_URL,
      pendingAsyncContent: result.hasPendingAsyncContent,
      customThemeCss: THEME_CSS_PATH ? path.relative(ROOT, THEME_CSS_PATH) : null,
      transforms: { staticTaskInputs, compiledColorStyles },
    },
    input: {
      file: path.relative(ROOT, markdownPath),
      sha256: sha256(markdown),
      characters: markdown.length,
    },
    output: {
      fragment: `${OUTPUT_PUBLIC}/article-fragment.html`,
      preview: `${OUTPUT_PUBLIC}/article-preview.html`,
      sha256: sha256(fragment),
      characters: fragment.length,
      utf8Bytes: Buffer.byteLength(fragment),
      normalizedTextCharacters: outputText.length,
    },
    plainText: result.plainText,
    images: assets,
    notes: [
      'No publish endpoint is called by this renderer.',
      'External images must be uploaded before creating a WeChat draft.',
      'Official structure validation and MP readback are separate steps.',
    ],
  }
  await writeFile(path.join(OUTPUT, 'render-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    fragment: `${OUTPUT_PUBLIC}/article-fragment.html`,
    preview: `${OUTPUT_PUBLIC}/article-preview.html`,
    images: assets.length,
    characters: fragment.length,
    pendingAsyncContent: result.hasPendingAsyncContent,
    sha256: manifest.output.sha256,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
