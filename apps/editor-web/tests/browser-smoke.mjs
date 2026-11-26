import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireChecker = createRequire(path.resolve(root, '../../upstream/verify-article-structure-spec/cli/package.json'))
const puppeteer = requireChecker('puppeteer')
const server = createAppServer({ root, apiOrigin: '' })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--disable-dev-shm-usage']
})
const errors = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  await page.evaluateOnNewDocument(() => { if (window === window.top) localStorage.clear() })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.theme-option')
  assert.equal(await page.$$eval('.theme-option', items => items.length), 3)
  assert.match(await page.$eval('#backend-badge', item => item.textContent), /本地模式/)
  assert.equal(await page.$eval('#manual-sync', item => item.disabled), true)
  assert.equal(await page.$eval('#review-action', item => item.disabled), true)
  await page.evaluate(() => [...document.querySelectorAll('.theme-option')].find(item => item.textContent.includes('编辑红')).click())
  await page.waitForFunction(() => document.querySelector('#preview').srcdoc.includes('编辑红'))
  await page.evaluate(() => {
    const input = document.querySelector('#title')
    input.value = 'Chromium 一体化编辑器验收'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  try {
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('已保存到此浏览器'), { timeout: 5000 })
  }
  catch (error) {
    console.error(await page.evaluate(() => ({
      saveStatus: document.querySelector('#save-status').textContent,
      notice: document.querySelector('#notice').textContent,
      storage: localStorage.getItem('integrated-editor.session.v1'),
      title: document.querySelector('#title').value
    })))
    console.error('page errors:', errors)
    throw error
  }
  assert.ok(await page.$$eval('.version-item', items => items.length) >= 1)
  assert.match(await page.$eval('#device', item => item.className), /mobile/)
  await page.click('[data-view="desktop"]')
  assert.match(await page.$eval('#device', item => item.className), /desktop/)
  assert.match(await page.$eval('#preview', item => item.srcdoc), /id="output"/)
  assert.deepEqual(errors, [])
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'artifacts/editor-desktop.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, themes: 3, autosave: true, localVersion: true, preview: true, backend: 'explicit-offline', pageErrors: errors, screenshot: 'artifacts/editor-desktop.png' }, null, 2))
}
finally {
  await browser.close()
  server.close()
}
