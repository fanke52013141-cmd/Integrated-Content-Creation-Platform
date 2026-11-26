import { createHash } from 'node:crypto'
import { renderInDoocsPage } from './browser-render.mjs'
import { asRendererError, RendererError } from './errors.mjs'
import { SerialTaskQueue } from './queue.mjs'
import { withTimeout } from './timeout.mjs'

const DEFAULT_BLOCKED_URLS = [
  /(?:^|\/\/)(?:www\.)?googletagmanager\.com\//i,
  /(?:^|\/\/)(?:www\.)?google-analytics\.com\//i,
  /(?:^|\/\/)hm\.baidu\.com\//i,
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validateInput(input) {
  if (typeof input?.markdown !== 'string') {
    throw new RendererError('markdown must be a string', { code: 'INVALID_RENDER_INPUT' })
  }
  if (input.themeId !== undefined && (typeof input.themeId !== 'string' || !input.themeId.trim())) {
    throw new RendererError('themeId must be a non-empty string', { code: 'INVALID_RENDER_INPUT' })
  }
  if (input.customCSS !== undefined && typeof input.customCSS !== 'string') {
    throw new RendererError('customCSS must be a string', { code: 'INVALID_RENDER_INPUT' })
  }
  if (input.themeOptions !== undefined && (typeof input.themeOptions !== 'object' || input.themeOptions === null || Array.isArray(input.themeOptions))) {
    throw new RendererError('themeOptions must be an object', { code: 'INVALID_RENDER_INPUT' })
  }
}

export class ChromiumRenderer {
  constructor(options = {}) {
    this.appUrl = options.appUrl ?? 'http://127.0.0.1:5173/md/'
    this.moduleBase = (options.moduleBase ?? '/md/src').replace(/\/$/, '')
    this.rendererRevision = options.rendererRevision ?? '80b43d495bf51ce5d70dcfb0d73443b306104e76'
    this.puppeteer = options.puppeteer
    this.browserFactory = options.browserFactory
    this.browser = options.browser ?? null
    this.ownsBrowser = options.browser ? (options.ownsBrowser ?? false) : true
    this.launchOptions = {
      headless: 'new',
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      ...options.launchOptions,
    }
    this.viewport = options.viewport ?? { width: 1280, height: 900, deviceScaleFactor: 1 }
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 20_000
    this.renderTimeoutMs = options.renderTimeoutMs ?? 30_000
    this.settleDelayMs = options.settleDelayMs ?? 800
    this.requestInterceptor = options.requestInterceptor
    this.blockedUrlPatterns = options.blockedUrlPatterns ?? DEFAULT_BLOCKED_URLS
    this.blockedResourceTypes = new Set(options.blockedResourceTypes ?? [])
    this.consoleLimit = options.consoleLimit ?? 100
    this.logger = options.logger

    this.page = null
    this.queue = new SerialTaskQueue()
    this.consoleMessages = []
    this.requestStats = this.newRequestStats()
    this.stats = { browserLaunches: 0, pageCreations: 0, renders: 0 }
  }

  newRequestStats() {
    return { continued: 0, blocked: 0, responded: 0, failed: 0, blockedUrls: [] }
  }

  async ensureBrowser() {
    if (this.browser && this.browser.isConnected?.() === false) {
      this.browser = null
      this.page = null
      this.ownsBrowser = true
    }
    if (this.browser) return this.browser

    let factory = this.browserFactory
    if (!factory && this.puppeteer) factory = () => this.puppeteer.launch(this.launchOptions)
    if (!factory) {
      throw new RendererError('Provide puppeteer, browserFactory or an existing browser', {
        code: 'BROWSER_UNAVAILABLE',
      })
    }
    this.browser = await factory(this.launchOptions)
    this.ownsBrowser = true
    this.stats.browserLaunches += 1
    return this.browser
  }

  async routeRequest(request) {
    const url = request.url()
    const resourceType = request.resourceType()
    try {
      if (this.blockedResourceTypes.has(resourceType) || this.blockedUrlPatterns.some(pattern => pattern.test(url))) {
        this.requestStats.blocked += 1
        if (this.requestStats.blockedUrls.length < 50) this.requestStats.blockedUrls.push(url)
        await request.abort('blockedbyclient')
        return
      }

      const action = await this.requestInterceptor?.({ url, resourceType, method: request.method() }, request)
      const normalized = typeof action === 'string' ? { action } : action
      if (normalized?.action === 'block') {
        this.requestStats.blocked += 1
        if (this.requestStats.blockedUrls.length < 50) this.requestStats.blockedUrls.push(url)
        await request.abort('blockedbyclient')
        return
      }
      if (normalized?.action === 'respond') {
        this.requestStats.responded += 1
        await request.respond(normalized.response ?? normalized)
        return
      }
      await request.continue(normalized?.overrides)
      this.requestStats.continued += 1
    }
    catch (error) {
      this.requestStats.failed += 1
      this.logger?.warn?.('Request interception failed', { url, error })
      await request.abort('failed').catch(() => {})
    }
  }

  async setupPage(page) {
    await page.setViewport(this.viewport)
    page.setDefaultNavigationTimeout(this.navigationTimeoutMs)
    page.setDefaultTimeout(this.navigationTimeoutMs)
    await page.setRequestInterception(true)
    page.on('request', request => { void this.routeRequest(request) })
    page.on('console', message => {
      if (this.consoleMessages.length >= this.consoleLimit) return
      this.consoleMessages.push({ type: message.type(), text: message.text() })
    })
    page.on('pageerror', error => {
      if (this.consoleMessages.length >= this.consoleLimit) return
      this.consoleMessages.push({ type: 'pageerror', text: error.stack ?? error.message })
    })
    await page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs })
    await page.waitForSelector('#output .container', { timeout: this.navigationTimeoutMs })
    await page.waitForSelector('.cm-content', { timeout: this.navigationTimeoutMs })
    await page.waitForFunction(
      () => (document.querySelector('#output')?.textContent?.trim().length ?? 0) > 0,
      { timeout: this.navigationTimeoutMs },
    )
  }

  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page
    this.page = null
    const browser = await this.ensureBrowser()
    const page = await browser.newPage()
    this.page = page
    this.stats.pageCreations += 1
    try {
      await this.setupPage(page)
      return page
    }
    catch (error) {
      await this.discardPage()
      throw asRendererError(error, 'APP_NOT_READY')
    }
  }

  async discardPage() {
    const page = this.page
    this.page = null
    if (page && !page.isClosed()) await page.close().catch(() => {})
  }

  async renderNow(input, queuedAt) {
    const launchesBefore = this.stats.browserLaunches
    const pagesBefore = this.stats.pageCreations
    this.consoleMessages = []
    this.requestStats = this.newRequestStats()
    const startedAt = Date.now()

    try {
      const page = await this.ensurePage()
      const result = await withTimeout(
        page.evaluate(renderInDoocsPage, {
          markdown: input.markdown,
          themeId: input.themeId ?? 'default',
          customCSS: input.customCSS ?? '',
          themeOptions: input.themeOptions ?? {},
          moduleBase: this.moduleBase,
          settleDelayMs: this.settleDelayMs,
        }),
        this.renderTimeoutMs,
      )

      if (result.sourceFromEditor !== input.markdown) {
        throw new RendererError('CodeMirror source differs from input Markdown', { code: 'SOURCE_MISMATCH' })
      }
      if (result.hasPendingAsyncContent) {
        throw new RendererError('Async formula or diagram content is still pending', {
          code: 'ASYNC_CONTENT_PENDING',
        })
      }
      if (typeof result.html !== 'string' || typeof result.plainText !== 'string') {
        throw new RendererError('doocs returned no HTML/plainText', { code: 'RENDER_INVALID_RESPONSE' })
      }

      const completedAt = Date.now()
      this.stats.renders += 1
      return {
        html: result.html,
        plainText: result.plainText,
        hasPendingAsyncContent: false,
        images: result.images ?? [],
        headings: result.headings ?? [],
        metadata: {
          schemaVersion: 1,
          renderer: 'doocs/processClipboardContent',
          rendererRevision: this.rendererRevision,
          appUrl: this.appUrl,
          themeId: input.themeId ?? 'default',
          customCSS: {
            present: Boolean(input.customCSS),
            characters: input.customCSS?.length ?? 0,
          },
          source: {
            sha256: sha256(input.markdown),
            characters: input.markdown.length,
          },
          output: {
            sha256: sha256(result.html),
            characters: result.html.length,
            plainTextCharacters: result.plainText.length,
          },
          timings: {
            queueWaitMs: startedAt - queuedAt,
            durationMs: completedAt - startedAt,
          },
          browser: {
            launchedForRender: this.stats.browserLaunches > launchesBefore,
            pageCreatedForRender: this.stats.pageCreations > pagesBefore,
            totalLaunches: this.stats.browserLaunches,
            totalPageCreations: this.stats.pageCreations,
          },
          requests: this.requestStats,
          console: this.consoleMessages,
        },
      }
    }
    catch (error) {
      // A timed-out evaluate can still be running in the page. Dispose the page
      // before releasing the queue so no subsequent render can overlap it.
      await this.discardPage()
      throw asRendererError(error)
    }
  }

  render(input) {
    validateInput(input)
    const queuedAt = Date.now()
    const normalized = {
      markdown: input.markdown,
      themeId: input.themeId,
      customCSS: input.customCSS,
      themeOptions: structuredClone(input.themeOptions ?? {}),
    }
    return this.queue.run(() => this.renderNow(normalized, queuedAt))
  }

  getStats() {
    return {
      ...this.stats,
      pending: this.queue.pending,
      accepting: this.queue.accepting,
      hasBrowser: Boolean(this.browser),
      hasPage: Boolean(this.page && !this.page.isClosed()),
    }
  }

  async close() {
    return this.queue.close(async () => {
      const page = this.page
      const browser = this.browser
      this.page = null
      this.browser = null
      let failure
      if (page && !page.isClosed()) {
        try { await page.close() }
        catch (error) { failure = error }
      }
      if (browser && this.ownsBrowser) {
        try { await browser.close() }
        catch (error) { failure ??= error }
      }
      if (failure) throw asRendererError(failure, 'CLEANUP_FAILED')
    })
  }
}
