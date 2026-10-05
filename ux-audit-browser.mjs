// UX 走查取证（浏览器模式）：项目自带 mock-bridge，可在浏览器中渲染完整 UI。
// 用法：node ux-audit-browser.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = resolve('artifacts/ux-audit')
mkdirSync(outDir, { recursive: true })
const indexPath = resolve('out/renderer/index.html')
if (!existsSync(indexPath)) {
  console.error('renderer build not found:', indexPath)
  process.exit(1)
}

// 找可用的 Chrome/Edge
function findBrowser() {
  const roots = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA
  ].filter(Boolean)
  const rel = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe']
  ]
  for (const r of roots) {
    for (const parts of rel) {
      const p = join(r, ...parts)
      if (existsSync(p)) return p
    }
  }
  return null
}

const executablePath = findBrowser()
console.log('browser:', executablePath ?? '(playwright builtin)')
if (!executablePath) { console.error('no chromium-based browser found'); process.exit(1) }

const PAGES = [
  ['home', '创作台'],
  ['accounts', '账号定位'],
  ['hotspots', '热点洞察'],
  ['topics', '选题生成'],
  ['frameworks', '内容框架'],
  ['articles', '文章创作'],
  ['reviews', '内容评审'],
  ['visuals', '智能配图'],
  ['layouts', '文章排版'],
  ['publishing', '发布管理'],
  ['materials', '素材库'],
  ['providers', 'AI 服务'],
  ['data', '数据与备份'],
  ['prompts', '提示词']
]

const baseURL = pathToFileURL(indexPath).href
const browser = await chromium.launch({ executablePath, args: ['--allow-file-access-from-files'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.boot-screen', { state: 'detached', timeout: 20_000 }).catch(() => {})
await page.waitForTimeout(1200)

for (const [route, label] of PAGES) {
  const ok = await page.evaluate((l) => {
    const items = Array.from(document.querySelectorAll('.nav-item'))
    const t = items.find((b) => b.textContent?.trim().endsWith(l))
    if (t) { t.click(); return true }
    return false
  }, label)
  await page.waitForTimeout(1100)
  const file = join(outDir, `${route}.png`)
  try {
    await page.screenshot({ path: file, animations: 'disabled', timeout: 30_000 })
    console.log(`✓ ${route.padEnd(11)} ${label.padEnd(6)} nav=${ok} -> ${file}`)
  } catch (e) {
    console.log(`✗ ${route.padEnd(11)} ${label.padEnd(6)} nav=${ok} screenshot failed: ${e.message.slice(0, 80)}`)
  }
}

// 暗色模式
await page.evaluate(() => document.querySelector('.theme-toggle')?.click())
await page.waitForTimeout(800)
await page.screenshot({ path: join(outDir, 'dark-mode.png'), animations: 'disabled' })
console.log('✓ dark-mode')

console.log('\n--- console errors (%d) ---', errors.length)
;[...new Set(errors)].slice(0, 25).forEach((e) => console.log('  ' + e.slice(0, 180)))

await browser.close()
console.log('\nartifacts:', readdirSync(outDir).length, 'files ->', outDir)
