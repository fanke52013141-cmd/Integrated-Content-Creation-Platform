// P3 界面验证：确认「按类型选主题」在真实界面上生效
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = resolve('artifacts/p3-verify')
mkdirSync(outDir, { recursive: true })
const browserExe = (() => {
  for (const r of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const p of [['Google','Chrome','Application','chrome.exe'], ['Microsoft','Edge','Application','msedge.exe']]) {
      const full = join(r, ...p); if (existsSync(full)) return full
    }
  }
  return null
})()

let app
const results = []
const rec = (stage, ok, detail = '') => {
  results.push({ stage, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${stage}${detail ? ' — ' + detail : ''}`)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: [resolve('.'), '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
  cwd: process.cwd(), env, timeout: 90_000
})
const page = await app.firstWindow({ timeout: 60_000 })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
await page.waitForSelector('.nav-item', { timeout: 40_000 })
await page.waitForTimeout(1500)

console.log('='.repeat(70))
console.log('P3 界面验证 —— 按文章类型选主题（真实 Electron）')
console.log('='.repeat(70))

// 造一篇文章，否则排版页是空态、看不到主题选择器
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('文章创作'))
  if (t) t.click()
})
await page.waitForTimeout(1200)
const importBtn = page.getByRole('button', { name: /导入现成稿/ }).first()
if (await importBtn.count()) {
  await importBtn.click()
  await page.waitForTimeout(700)
  const ta = page.getByLabel('粘贴 Markdown')
  if (await ta.count()) {
    await ta.fill('# P3 验证文章\n\n## 第一节\n\n内容一。\n\n## 第二节\n\n内容二。\n\n## 第三节\n\n内容三。')
    await page.getByRole('button', { name: '导入粘贴内容' }).click()
    await page.waitForTimeout(1600)
  }
}

await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('文章排版'))
  if (t) t.click()
})
await page.waitForTimeout(1400)

const hasGenreField = await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('label.field'))
  return labels.some(l => l.textContent?.includes('文章类型'))
})
rec('排版页出现「文章类型」选择器', hasGenreField)

// 主题下拉选项应带适配说明
await page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('label.field')).find(l => l.textContent?.includes('主题'))
  label?.querySelector('button, [role="combobox"]')?.click()
})
await page.waitForTimeout(700)
const optionTexts = await page.evaluate(() => {
  const pop = document.querySelector('.select-popover, [role="listbox"]')
  return pop ? Array.from(pop.querySelectorAll('button, [role="option"]')).map(b => b.textContent?.replace(/\s+/g, ' ').trim() ?? '') : []
})
rec('主题选项带「适合类型 + 视觉性格」说明', optionTexts.length > 0 && optionTexts.some(t => t.includes('适合')),
  optionTexts[0]?.slice(0, 70) ?? `${optionTexts.length} 个选项`)
await page.screenshot({ path: join(outDir, '01-主题选项说明.png'), animations: 'disabled' })
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 选类型 → 主题自动切换
const before = await page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('label.field')).find(l => l.textContent?.includes('主题'))
  return label?.querySelector('button')?.textContent?.trim() ?? ''
})
await page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('label.field')).find(l => l.textContent?.includes('文章类型'))
  label?.querySelector('button, [role="combobox"]')?.click()
})
await page.waitForTimeout(600)
const picked = await page.evaluate(() => {
  const pop = document.querySelector('.select-popover, [role="listbox"]')
  const opt = pop ? Array.from(pop.querySelectorAll('button, [role="option"]'))[0] : null
  if (!opt) return ''
  const text = opt.textContent?.trim() ?? ''
  opt.click()
  return text
})
await page.waitForTimeout(800)
const after = await page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('label.field')).find(l => l.textContent?.includes('主题'))
  return label?.querySelector('button')?.textContent?.trim() ?? ''
})
const hint = await page.evaluate(() => document.querySelector('.form-hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
rec('选择文章类型后自动推荐主题', !!picked && hint.includes('已按'),
  `类型「${picked.slice(0, 12)}」 主题「${before}」→「${after}」 ${hint.slice(0, 50)}`)
await page.screenshot({ path: join(outDir, '02-按类型推荐.png'), animations: 'disabled' })

console.log('\n渲染层错误:', errors.length)
;[...new Set(errors)].slice(0, 5).forEach(e => console.log('  ! ' + e.slice(0, 120)))

const pass = results.filter(r => r.ok).length
console.log(`\n通过 ${pass} / ${results.length}`)
console.log(`截图: ${outDir}`)
await app.close()
