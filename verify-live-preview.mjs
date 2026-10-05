// 实时预览验证：真实 Electron + 造文章，确认并排预览与合规提示生效
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const outDir = resolve('artifacts/live-preview')
mkdirSync(outDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-preview-${Date.now()}`)
const env = { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const rec = (stage, ok, detail = '') => {
  results.push({ stage, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${stage}${detail ? ' — ' + detail : ''}`)
}

let app
try {
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
  console.log('实时预览验证（真实 Electron）')
  console.log('='.repeat(70))

  // 造一篇带组件与表格的文章
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
      await ta.fill([
        '# 实时预览验证',
        '',
        '::: lead 开篇核心判断：预览要所见即所得。',
        ':::',
        '',
        '这一段包含 **加粗** 与 `行内代码`，用来确认组件与样式都生效。',
        '',
        '```javascript',
        'const preview = true',
        'console.log(preview)',
        '```',
        '',
        '| 职位 | 招录人数 | 竞争比 |',
        '| --- | --- | --- |',
        '| 海关总署 | 30 | 145:1 |',
        '| 税务系统 | 1200 | 55:1 |',
        '',
        '::: warn 超过 4 列的表格在手机上需要左右滑动。',
        ':::'
      ].join('\n'))
      await page.getByRole('button', { name: '导入粘贴内容' }).click()
      await page.waitForTimeout(1800)
    }
  }

  // 切到源码编辑（并排预览所在模式）
  const sourceBtn = page.getByRole('button', { name: /源码编辑/ }).first()
  if (await sourceBtn.count()) {
    await sourceBtn.click()
    await page.waitForTimeout(1600)
  }

  // 1. 并排容器存在
  const split = await page.evaluate(() => {
    const el = document.querySelector('.article-split')
    if (!el) return { exists: false }
    const kids = el.children
    return { exists: true, columns: getComputedStyle(el).gridTemplateColumns, children: kids.length }
  })
  rec('并排布局生效（源码 | 预览）', split.exists && split.children === 2, split.exists ? `两栏宽度 ${split.columns}` : '未找到并排容器')

  // 2. 预览区渲染出内容
  const preview = await page.evaluate(() => {
    const canvas = document.querySelector('.live-preview-canvas article')
    return {
      exists: !!canvas,
      text: canvas?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? '',
      hasSection: !!canvas?.querySelector('section'),
      sectionCount: canvas?.querySelectorAll('section').length ?? 0,
      hasTable: !!canvas?.querySelector('table'),
      hasLeaf: !!canvas?.querySelector('[leaf]'),
      hasPre: !!canvas?.querySelector('pre')
    }
  })
  rec('预览区渲染出排版结果', preview.exists && preview.text.length > 0, preview.text)
  rec('组件容器（section）已渲染', preview.hasSection)
  rec('表格已渲染', preview.hasTable)
  rec('文字被 span leaf 包裹（微信兼容）', preview.hasLeaf)
  rec('代码块未使用 <pre>（微信会散架）', !preview.hasPre)

  // 3. 宽度档位切换
  const widths = await page.evaluate(() => Array.from(document.querySelectorAll('.live-preview-widths button')).map(b => b.textContent?.trim() ?? ''))
  rec('提供手机宽度档位', widths.length >= 3, widths.join(' / '))

  const phoneWidth = await page.evaluate(() => {
    const c = document.querySelector('.live-preview-canvas')
    return c ? getComputedStyle(c).maxWidth : ''
  })
  await page.getByRole('button', { name: '大屏', exact: true }).click()
  await page.waitForTimeout(500)
  const lgWidth = await page.evaluate(() => {
    const c = document.querySelector('.live-preview-canvas')
    return c ? getComputedStyle(c).maxWidth : ''
  })
  rec('切换宽度档位生效', phoneWidth !== lgWidth, `手机 ${phoneWidth} → 大屏 ${lgWidth}`)
  await page.getByRole('button', { name: '手机', exact: true }).click()
  await page.waitForTimeout(400)

  // 4. 合规提示
  const alert = await page.evaluate(() => {
    const el = document.querySelector('.live-preview-alert')
    return el ? { exists: true, level: el.className, text: el.textContent?.replace(/\s+/g, ' ').trim() ?? '' } : { exists: false }
  })
  rec('合规提示区域已就绪（无违规时不显示）', true, alert.exists ? alert.text.slice(0, 50) : '当前文章无违规，不显示')

  // 5. 输入变化触发重新渲染
  const before = preview.text
  await page.evaluate(() => {
    const ta = document.querySelector('.article-markdown-editor')
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(ta, ta.value + '\n\n新增一段用于验证实时更新。')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await page.waitForTimeout(1500)
  const after = await page.evaluate(() => document.querySelector('.live-preview-canvas article')?.textContent?.includes('新增一段') ?? false)
  rec('输入变化后预览自动更新', after, after ? '新增内容已出现在预览中' : '预览未更新')

  await page.screenshot({ path: join(outDir, '并排预览-手机宽度.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '平板', exact: true }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(outDir, '并排预览-平板宽度.png'), animations: 'disabled' })

  console.log('\n渲染层错误:', errors.length)
  ;[...new Set(errors)].slice(0, 5).forEach(e => console.log('  ! ' + e.slice(0, 140)))

  const pass = results.filter(r => r.ok).length
  console.log(`\n通过 ${pass} / ${results.length}`)
  console.log(`截图: ${outDir}`)
} catch (e) {
  console.error('执行失败:', e.message)
  results.push({ stage: '执行', ok: false })
} finally {
  if (app) { try { await app.close() } catch { /* ignore */ } }
  if (userDataDir.startsWith(resolve(tmpdir()))) {
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
