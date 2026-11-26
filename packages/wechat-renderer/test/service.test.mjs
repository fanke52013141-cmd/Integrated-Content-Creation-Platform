import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChromiumRenderer } from '../src/index.mjs'

class FakePage {
  constructor(browser) {
    this.browser = browser
    this.closed = false
    this.handlers = new Map()
  }

  async setViewport() {}
  setDefaultNavigationTimeout() {}
  setDefaultTimeout() {}
  async setRequestInterception() {}
  on(name, handler) { this.handlers.set(name, handler) }
  async goto() {}
  async waitForSelector() {}
  async waitForFunction() {}
  isClosed() { return this.closed }

  async evaluate(_fn, payload) {
    if (this.browser.evaluateHandler) return this.browser.evaluateHandler(payload)
    return {
      html: `<h1 style="color:red">${payload.themeId}</h1><p>${payload.markdown}</p>`,
      plainText: payload.markdown,
      hasPendingAsyncContent: false,
      sourceFromEditor: payload.markdown,
      images: [],
      headings: [],
    }
  }

  async close() {
    this.closed = true
    this.browser.closeCount += 1
  }
}

class FakeBrowser {
  constructor() {
    this.pages = []
    this.closeCount = 0
    this.closed = false
    this.evaluateHandler = null
  }

  isConnected() { return !this.closed }
  async newPage() {
    const page = new FakePage(this)
    this.pages.push(page)
    return page
  }
  async close() { this.closed = true }
}

test('browser and page are reused across successful renders and closed once', async () => {
  const browser = new FakeBrowser()
  let launches = 0
  const renderer = new ChromiumRenderer({
    browserFactory: async () => { launches += 1; return browser },
    settleDelayMs: 0,
  })

  const first = await renderer.render({ markdown: 'first' })
  const second = await renderer.render({ markdown: 'second', themeId: 'grace' })

  assert.equal(launches, 1)
  assert.equal(browser.pages.length, 1)
  assert.equal(first.metadata.browser.launchedForRender, true)
  assert.equal(second.metadata.browser.launchedForRender, false)
  assert.equal(second.metadata.browser.pageCreatedForRender, false)
  assert.equal(renderer.getStats().renders, 2)
  assert.match(second.html, /grace/)
  assert.equal(second.hasPendingAsyncContent, false)

  await renderer.close()
  assert.equal(browser.pages[0].closed, true)
  assert.equal(browser.closed, true)
  await assert.rejects(renderer.render({ markdown: 'late' }), error => error.code === 'RENDERER_CLOSED')
})

test('pending async content fails and disposes only the contaminated page', async () => {
  const browser = new FakeBrowser()
  browser.evaluateHandler = async payload => ({
    html: '<p>pending</p>',
    plainText: 'pending',
    hasPendingAsyncContent: true,
    sourceFromEditor: payload.markdown,
  })
  const renderer = new ChromiumRenderer({ browserFactory: async () => browser, settleDelayMs: 0 })

  await assert.rejects(
    renderer.render({ markdown: 'diagram' }),
    error => error.code === 'ASYNC_CONTENT_PENDING',
  )
  assert.equal(browser.pages[0].closed, true)

  browser.evaluateHandler = null
  const next = await renderer.render({ markdown: 'next' })
  assert.equal(next.metadata.renderer, 'doocs/processClipboardContent')
  assert.equal(browser.pages.length, 2)
  assert.equal(renderer.getStats().hasBrowser, true)
  await renderer.close()
})

test('a timed-out page cannot overlap the next queued render', async () => {
  const browser = new FakeBrowser()
  browser.evaluateHandler = () => new Promise(() => {})
  const renderer = new ChromiumRenderer({
    browserFactory: async () => browser,
    renderTimeoutMs: 20,
    settleDelayMs: 0,
  })

  await assert.rejects(renderer.render({ markdown: 'slow' }), error => error.code === 'RENDER_TIMEOUT')
  assert.equal(browser.pages[0].closed, true)

  browser.evaluateHandler = null
  const result = await renderer.render({ markdown: 'after timeout' })
  assert.equal(result.hasPendingAsyncContent, false)
  assert.equal(browser.pages.length, 2)
  await renderer.close()
})

test('request interception supports block, local response and continue', async () => {
  const renderer = new ChromiumRenderer({
    browserFactory: async () => new FakeBrowser(),
    requestInterceptor: async ({ url }) => {
      if (url === 'https://assets.test/local.png') {
        return { action: 'respond', response: { contentType: 'image/png', body: 'mock' } }
      }
      return { action: 'continue' }
    },
  })
  const makeRequest = url => ({
    calls: [],
    url: () => url,
    method: () => 'GET',
    resourceType: () => 'image',
    async abort(code) { this.calls.push(['abort', code]) },
    async respond(response) { this.calls.push(['respond', response]) },
    async continue(overrides) { this.calls.push(['continue', overrides]) },
  })

  const tracked = makeRequest('https://www.googletagmanager.com/gtag/js?id=x')
  const local = makeRequest('https://assets.test/local.png')
  const ordinary = makeRequest('https://cdn.example.com/a.css')
  await renderer.routeRequest(tracked)
  await renderer.routeRequest(local)
  await renderer.routeRequest(ordinary)

  assert.deepEqual(tracked.calls, [['abort', 'blockedbyclient']])
  assert.equal(local.calls[0][0], 'respond')
  assert.deepEqual(ordinary.calls, [['continue', undefined]])
  assert.equal(renderer.requestStats.blocked, 1)
  assert.equal(renderer.requestStats.responded, 1)
  assert.equal(renderer.requestStats.continued, 1)
  await renderer.close()
})

test('an externally supplied browser is detached, not closed by default', async () => {
  const browser = new FakeBrowser()
  const renderer = new ChromiumRenderer({ browser, settleDelayMs: 0 })
  await renderer.render({ markdown: 'external' })
  await renderer.close()
  assert.equal(browser.pages[0].closed, true)
  assert.equal(browser.closed, false)
})
