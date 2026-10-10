// 全量 UI 截图审查：14 路由 × 多视口，带 ui-fixtures 演示数据。
// 输出 artifacts/ui-review/*.png 与 overflow-audit.json（横向溢出审计）。
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173/?ui-fixtures=1#/'
const ROUTES = [
  'home', 'accounts', 'hotspots', 'topics', 'frameworks', 'articles', 'reviews',
  'visuals', 'layouts', 'publishing', 'materials', 'providers', 'prompts', 'data'
]
const VIEWPORTS = [
  { tag: '1440', width: 1440, height: 960 },
  { tag: '980', width: 980, height: 900 }
]

const outDir = resolve('artifacts/ui-review')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const audit = {}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err)))
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1_400)
    const file = resolve(outDir, `${route}-${vp.tag}.png`)
    await page.screenshot({ path: file })
    audit[`${route}@${vp.tag}`] = await page.evaluate(() => {
      const doc = document.documentElement
      const vw = window.innerWidth
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width <= 0) continue
        if (r.right > vw + 1 || r.left < -1) {
          const cs = getComputedStyle(el)
          if (cs.position === 'fixed' || cs.display === 'none') continue
          const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(/\s+/)[0]
          offenders.push(`${el.tagName.toLowerCase()}.${cls} L${Math.round(r.left)} R${Math.round(r.right)}`)
          if (offenders.length >= 10) break
        }
      }
      return { vw, docScrollW: doc.scrollWidth, overflow: doc.scrollWidth > vw, offenders }
    })
    console.log(`shot: ${route}@${vp.tag}`)
  }
  if (errors.length) audit[`pageerrors@${vp.tag}`] = errors
  await ctx.close()
}

await writeFile(resolve(outDir, 'overflow-audit.json'), JSON.stringify(audit, null, 2))
await browser.close()
console.log('done:', outDir)
