import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireChecker = createRequire(path.join(ROOT, 'upstream/verify-article-structure-spec/cli/package.json'))
const puppeteer = requireChecker('puppeteer')
const markdown = await readFile(path.join(ROOT, 'poc/fixtures/theme-poc.md'), 'utf8')
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--disable-dev-shm-usage'],
})
const errors = []
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => { if (window === window.top) localStorage.clear() })
  await page.goto('http://127.0.0.1:8780', { waitUntil: 'networkidle0', timeout: 60_000 })
  await page.waitForSelector('.theme-option')
  const healthInPage = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/health')
      return { status: response.status, text: await response.text() }
    }
    catch (error) { return { error: error.message } }
  })
  console.log('Browser health:', healthInPage)
  const clientHealth = await page.evaluate(async () => {
    try {
      const { ApiClient } = await import('./lib/api.js')
      return { result: await new ApiClient().health() }
    }
    catch (error) { return { error: error.message, code: error.code, details: error.details } }
  })
  console.log('ApiClient health:', clientHealth)
  console.log('Notice:', await page.$eval('#notice', item => item.textContent))
  await page.waitForFunction(() => document.querySelector('#backend-badge').textContent.includes('/api 已连接'), { timeout: 20_000 })
  assert.equal(await page.$$eval('.theme-option', items => items.length), 3)
  await page.evaluate((source) => {
    const set = (selector, value) => {
      const element = document.querySelector(selector)
      element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('#title', '一体化编辑器真实渲染验收')
    set('#author', '平台 QA')
    set('#summary', '验证编辑、主题、质量检查与草稿提交。')
    set('#markdown', source)
  }, markdown)
  await page.waitForFunction(() => document.querySelector('#render-status').textContent.includes('/api/render'), { timeout: 60_000 })
  await page.waitForFunction(() => document.querySelector('#quality-output').textContent.includes('"ready": true'), { timeout: 60_000 })
  await page.click('#manual-sync')
  await page.waitForFunction(() => document.querySelector('#sync-badge').textContent.includes('后端记录：已完成'), { timeout: 60_000 })
  const syncDetail = await page.$eval('#sync-detail', item => item.textContent)
  assert.match(syncDetail, /"status": "completed"/)
  assert.match(syncDetail, /"mediaId": "[^"]+"/)
  assert.deepEqual(errors, [])
  await mkdir(path.join(ROOT, 'apps/platform-server/artifacts'), { recursive: true })
  await page.screenshot({ path: path.join(ROOT, 'apps/platform-server/artifacts/editor-e2e.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, themes: 3, backend: 'connected', realChromiumRender: true, qualityReady: true, delivery: 'completed', pageErrors: errors, screenshot: 'apps/platform-server/artifacts/editor-e2e.png' }, null, 2))
}
finally {
  await browser.close()
}
