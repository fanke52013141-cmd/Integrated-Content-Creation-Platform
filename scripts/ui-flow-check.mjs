// 全流程模拟：创作台 → 热点(收藏→生成选题) → 选题(生成框架) → 框架(去文章创作)
// → 文章(新建草稿弹窗/智能改稿) → 评审 → 配图 → 排版 → 发布，逐步截图并记录错误。
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173/?ui-fixtures=1#/'
const outDir = resolve('artifacts/ui-review/flow')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160)) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + String(err).slice(0, 160)))

const report = {}
async function shot(name) {
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: resolve(outDir, `${name}.png`) })
  report[name] = { url: page.url().split('#')[1] || '/', title: await page.title() }
  console.log(`step ok: ${name} -> ${report[name].url}`)
}

await page.goto(`${BASE}home`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1_500)
await shot('01-home')

// 热点：收藏第一条 → 生成选题
await page.locator('.nav-item:has-text("热点洞察")').first().click()
await page.waitForTimeout(1_200)
const favBtn = page.locator('.hot-favorite-button').first()
await favBtn.click()
await page.waitForTimeout(800)
const genBtn = page.locator('.hotspot-insight-rail button:has-text("生成选题")')
if (await genBtn.isDisabled()) { report['02-hotspot-fav'] = '生成选题仍不可用（收藏失败？）'; console.log('WARN: 生成选题 disabled') }
else { await genBtn.click(); await page.waitForTimeout(1_200) }
await shot('02-topics-from-hotspot')

// 选题：展开演示选题卡（草稿态没有「生成框架→」，锁定后才有），随后经侧栏进框架页
const expandBtn = page.locator('.topic-expand').first()
if (await expandBtn.count()) { await expandBtn.click(); await page.waitForTimeout(700) }
await shot('03-topics-expanded')
await page.locator('.nav-item:has-text("内容框架")').first().click()
await page.waitForTimeout(1_400)
await shot('04-frameworks')

// 框架：去文章创作
const toArticles = page.locator('button:has-text("去文章创作")').first()
if (await toArticles.count()) { await toArticles.click() } else { await page.locator('.nav-item:has-text("文章创作")').first().click() }
await page.waitForTimeout(1_600)
await shot('05-articles')

// 文章：新建草稿弹窗开 → 关
await page.locator('button:has-text("新建草稿")').first().click()
await page.waitForTimeout(900)
await shot('06-new-draft-dialog')
await page.locator('.modal button:has-text("取消")').first().click().catch(() => page.keyboard.press('Escape'))
await page.waitForTimeout(500)

// 文章：展开智能改稿（本轮修复点）
await page.evaluate(() => { const d = document.querySelector('.article-revision'); if (d) d.open = true })
await page.waitForTimeout(400)
const revisionProbe = await page.evaluate(() => {
  const rail = document.querySelector('.article-rail')?.getBoundingClientRect()
  const btn = [...document.querySelectorAll('.article-revision footer button')].pop()?.getBoundingClientRect()
  return rail && btn ? { inside: btn.right <= rail.right + 1, btnRight: Math.round(btn.right), railRight: Math.round(rail.right) } : null
})
report['revision-probe'] = revisionProbe
console.log('revision probe:', JSON.stringify(revisionProbe))
await shot('07-article-revision-open')

// 沿作品条下一步走完创作链
const stages = ['08-reviews', '09-visuals', '10-layouts', '11-publishing']
for (const name of stages) {
  const next = page.locator('.work-bar-stage-next')
  if (await next.count()) { await next.first().click(); await page.waitForTimeout(1_400) }
  await shot(name)
}

// 发布页停留检查
await page.waitForTimeout(400)
report['consoleErrors'] = consoleErrors
console.log('console errors:', consoleErrors.length ? consoleErrors : '无')

await writeFile(resolve(outDir, 'flow-report.json'), JSON.stringify(report, null, 2))
await browser.close()
console.log('flow done')
