// 流程顺畅度走查：模拟真实用户从入口到发布的完整链路，
// 验证每一跳是否可达、是否有断点、是否需要多余操作。
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = resolve('artifacts/flow-audit')
mkdirSync(outDir, { recursive: true })
const browserExe = (() => {
  for (const r of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const p of [['Google','Chrome','Application','chrome.exe'], ['Microsoft','Edge','Application','msedge.exe']]) {
      const full = join(r, ...p); if (existsSync(full)) return full
    }
  }
  return null
})()

const FLOW = [
  { route: 'accounts', label: '账号定位', short: '账号' },
  { route: 'hotspots', label: '热点洞察', short: '热点' },
  { route: 'topics', label: '选题生成', short: '选题' },
  { route: 'frameworks', label: '内容框架', short: '框架' },
  { route: 'articles', label: '文章创作', short: '文章' },
  { route: 'reviews', label: '内容评审', short: '评审' },
  { route: 'visuals', label: '智能配图', short: '配图' },
  { route: 'layouts', label: '文章排版', short: '排版' },
  { route: 'publishing', label: '发布管理', short: '发布' }
]

const browser = await chromium.launch({ executablePath: browserExe, args: ['--allow-file-access-from-files'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(pathToFileURL(resolve('out/renderer/index.html')).href, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.nav-item', { timeout: 30_000 })
await page.waitForTimeout(900)

console.log('='.repeat(80))
console.log('流程顺畅度走查 —— 模拟用户从入口走到发布')
console.log('='.repeat(80))

// 步骤 1：首页入口可达性
console.log('\n【步骤 1】首页四个入口是否都能正确跳转')
const entries = [
  ['从主题开始', '内容框架'],
  ['从热点开始', '热点洞察'],
  ['从资料开始', '素材库'],
  ['导入现成文章', '文章创作']
]
for (const [entryName, expectPage] of entries) {
  // 回到创作台
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('创作台'))
    if (t) t.click()
  })
  await page.waitForTimeout(600)
  const ok = await page.evaluate((name) => {
    const btn = Array.from(document.querySelectorAll('.home-entry')).find(b => b.textContent?.includes(name))
    if (!btn) return false
    btn.click()
    return true
  }, entryName)
  await page.waitForTimeout(800)
  const heading = await page.evaluate(() => document.querySelector('.page h2')?.textContent?.trim() ?? document.querySelector('h2')?.textContent?.trim() ?? '')
  const match = heading.includes(expectPage.replace('内容框架', '框架').replace('文章创作', '文章工作台').replace('素材库', '素材').replace('热点洞察', '热点'))
  console.log(`  ${match ? '✓' : '✗'} ${entryName.padEnd(8)} → ${heading} ${match ? '' : `(期望含「${expectPage}」)`}`)
}

// 步骤 2：逐页流转，检查「下一步」引导
console.log('\n【步骤 2】逐页检查下一步引导与空状态')
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('创作台'))
  if (t) t.click()
})
await page.waitForTimeout(600)

// 部分页面天然不需要空态/下一步：
// - hotspots 是常驻数据源（热榜本身就有内容），不产出可交接的中间物
// - articles 是链路终点，后面没有「下一步」
// - accountspage 自带FirstRunGuide 三步引导
const NO_EMPTY_REQUIRED = new Set(['hotspots', 'articles', 'accounts'])

for (const stage of FLOW) {
  await page.evaluate((l) => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(l))
    if (t) t.click()
  }, stage.label)
  await page.waitForTimeout(900)

  // 注意：空态/引导常在首屏之下（表单区较长），必须用整页高度判断，
  // 否则会误判为「无空态」——这是本次走查踩过的坑。
  const info = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel)?.textContent?.trim() ?? ''
    const content = document.querySelector('.content')
    return {
      heading: document.querySelector('.page h2')?.textContent?.trim()
        ?? document.querySelector('h2')?.textContent?.trim() ?? '',
      pipeline: document.querySelectorAll('.pipeline-step').length,
      pipelineCurrent: q('.pipeline-step.current'),
      breadcrumb: Array.from(document.querySelectorAll('.breadcrumb-item')).map(e => e.textContent?.trim()).join(' / '),
      nextStep: q('.next-step-bar .next-step-text'),
      nextAction: q('.next-step-bar .button'),
      emptyTitle: q('.large-empty h3, .empty-state-title, .account-empty-state strong, .article-empty h3, .center-empty strong'),
      emptyDesc: q('.large-empty .micro-copy, .empty-state-desc, .account-empty-state p, .article-empty p'),
      emptyAction: q('.large-empty .button, .empty-state .button, .account-empty-state .button, .article-empty .button'),
      emptyBtnCount: document.querySelectorAll('.large-empty .button, .article-empty .button').length,
      hasBlocking: q('.inline-alert').slice(0, 60),
      scrollHeight: content?.scrollHeight ?? 0,
      clientHeight: content?.clientHeight ?? 0
    }
  })

  const flags = []
  if (info.pipeline === 0) flags.push('无流水线')
  if (!NO_EMPTY_REQUIRED.has(stage.route) && !info.emptyTitle && !info.nextStep && !info.hasBlocking) {
    flags.push('无引导/无空态')
  }
  const mark = flags.length ? `⚠ ${flags.join(', ')}` : '✓'
  const overflow = info.scrollHeight > info.clientHeight + 20 ? ` (需滚动 ${info.scrollHeight - info.clientHeight}px 才见空态)` : ''
  console.log(`\n  ${mark} ${stage.label}${overflow}`)
  console.log(`     标题: ${info.heading}`)
  console.log(`     面包屑: ${info.breadcrumb}`)
  console.log(`     流水线: ${info.pipeline} 段, 当前="${info.pipelineCurrent}"`)
  if (info.nextStep) console.log(`     下一步: ${info.nextStep} → [${info.nextAction}]`)
  if (info.emptyTitle) console.log(`     空态标题: ${info.emptyTitle}`)
  if (info.emptyDesc) console.log(`     空态说明: ${info.emptyDesc}`)
  if (info.emptyAction) console.log(`     空态按钮: ${info.emptyAction}`)

  // 整页截图：空态常在首屏之下，必须 fullPage
  await page.screenshot({ path: join(outDir, `${stage.route}.png`), animations: 'disabled', fullPage: true })
}

// 步骤 3：页面间返回/前进是否保持状态
console.log('\n【步骤 3】流水线内跳转（应保持在链路内且高亮正确）')
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('内容框架'))
  if (t) t.click()
})
await page.waitForTimeout(800)
for (const short of ['评审', '发布', '文章']) {
  await page.evaluate((s) => {
    const b = Array.from(document.querySelectorAll('.pipeline-step')).find(x => x.textContent?.trim() === s)
    if (b) b.click()
  }, short)
  await page.waitForTimeout(700)
  const cur = await page.evaluate(() => document.querySelector('.pipeline-step.current')?.textContent?.trim() ?? '(无)')
  const crumb = await page.evaluate(() => Array.from(document.querySelectorAll('.breadcrumb-item')).map(e => e.textContent?.trim()).join(' / '))
  console.log(`  点「${short}」→ 高亮="${cur}" 面包屑="${crumb}" ${cur === short ? '✓' : '✗'}`)
}

console.log('\n【控制台错误】', errors.length)
;[...new Set(errors)].slice(0, 8).forEach(e => console.log('  ' + e.slice(0, 150)))

await browser.close()
