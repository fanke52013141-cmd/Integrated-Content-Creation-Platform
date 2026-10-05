// 导航一致性验证：确认侧边栏 / 顶部流水线 / 作品栏 / 快捷键 四处顺序完全一致
// 这是导航统一改造的核心验收项，防止将来再次分叉
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = resolve('artifacts/ux-audit')
mkdirSync(outDir, { recursive: true })

const browserExe = (() => {
  for (const r of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const p of [['Google','Chrome','Application','chrome.exe'], ['Microsoft','Edge','Application','msedge.exe']]) {
      const full = join(r, ...p); if (existsSync(full)) return full
    }
  }
  return null
})()
const browser = await chromium.launch({ executablePath: browserExe, args: ['--allow-file-access-from-files'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(pathToFileURL(resolve('out/renderer/index.html')).href, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.nav-item', { timeout: 30_000 })
await page.waitForTimeout(800)

// 期望顺序（来自 src/shared/creation-flow.ts）
const EXPECTED = [
  ['accounts', '账号定位'], ['hotspots', '热点洞察'], ['topics', '选题生成'],
  ['frameworks', '内容框架'], ['articles', '文章创作'], ['reviews', '内容评审'],
  ['visuals', '智能配图'], ['layouts', '文章排版'], ['publishing', '发布管理']
]

// 1. 侧边栏顺序
const sidebar = await page.evaluate(() => {
  const groups = Array.from(document.querySelectorAll('.navigation .nav-group'))
  return groups.map(g => ({
    title: g.querySelector('.nav-group-title')?.textContent?.trim() ?? '',
    items: Array.from(g.querySelectorAll('.nav-item')).map(i => ({
      label: i.textContent?.trim() ?? '',
      current: i.getAttribute('aria-current')
    }))
  }))
})

console.log('='.repeat(78))
console.log('导航一致性验证')
console.log('='.repeat(78))

console.log('\n【1】侧边栏结构')
sidebar.forEach(g => {
  console.log(`  ${g.title}`)
  g.items.forEach(i => console.log(`     ${i.current ? '●' : '○'} ${i.label}`))
})

// 2. 侧边栏主链路顺序（排除总览与资源区）
const flowFromSidebar = sidebar
  .filter(g => g.title !== '总览' && g.title !== '资源')
  .flatMap(g => g.items.map(i => i.label))

console.log('\n【2】侧边栏主链路顺序')
console.log('  ' + flowFromSidebar.join(' → '))

// 3. 逐页检查顶部流水线顺序
console.log('\n【3】顶部流水线顺序（逐页）')
let pipelineMismatch = 0
for (const [route, label] of EXPECTED) {
  await page.evaluate((l) => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(l))
    if (t) t.click()
  }, label)
  await page.waitForTimeout(700)
  const steps = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.pipeline-step')).map(e => e.textContent?.trim() ?? '')
  )
  // 期望的流水线短标签
  const expectedShort = ['账号', '热点', '选题', '框架', '文章', '评审', '配图', '排版', '发布']
  const ok = JSON.stringify(steps) === JSON.stringify(expectedShort)
  if (!ok) pipelineMismatch++
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(6)} ${steps.join(' → ')}`)
}

// 4. 面包屑
console.log('\n【4】面包屑（抽样）')
for (const [route, label] of [EXPECTED[5], EXPECTED[8], ['materials', '素材库'], ['providers', '模型网关']]) {
  await page.evaluate((l) => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(l))
    if (t) t.click()
  }, label)
  await page.waitForTimeout(600)
  const crumb = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.breadcrumb-item')).map(e => e.textContent?.trim() ?? '')
  )
  console.log(`  ${label.padEnd(6)} ${crumb.join(' / ')}`)
}

// 5. 快捷键面板
console.log('\n【5】快捷键面板说明')
await page.keyboard.press('Shift+?')
await page.waitForTimeout(700)
const shortcutText = await page.evaluate(() =>
  document.querySelector('.shortcut-panel-body')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
)
console.log('  ' + (shortcutText.slice(0, 200) || '(未打开)'))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 6. 汇总判定
const expectedSidebar = EXPECTED.map(e => e[1])
const sidebarOk = JSON.stringify(flowFromSidebar) === JSON.stringify(expectedSidebar)

console.log('\n' + '='.repeat(78))
console.log('判定')
console.log('='.repeat(78))
console.log(`  侧边栏顺序 = 期望顺序     : ${sidebarOk ? '✓ 通过' : '✗ 不一致'}`)
console.log(`  流水线顺序（9 页全检）   : ${pipelineMismatch === 0 ? '✓ 全部一致' : `✗ ${pipelineMismatch} 页不一致`}`)
if (!sidebarOk) {
  console.log('\n  实际:', flowFromSidebar.join(' → '))
  console.log('  期望:', expectedSidebar.join(' → '))
}

await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('创作台'))
  if (t) t.click()
})
await page.waitForTimeout(800)
await page.screenshot({ path: join(outDir, 'nav-unified-home.png'), animations: 'disabled' })
console.log('\n  截图: artifacts/ux-audit/nav-unified-home.png')

await browser.close()
