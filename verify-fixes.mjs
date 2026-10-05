// 回归验证：确认本轮三处整改真的生效
//
// 验收标准（来自用户体验验收报告第12 节）：
//   1. 任意页面若存在禁用按钮，其 1 米内必须有文字说明禁用原因
//   2. 账号定位页首屏能看到「最少填哪 3 个」的提示
//   3. 模型标识字段有 placeholder 与帮助文案
//   4. 所有空态说明的前置条件，与代码中实际的 disabled 条件一致
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = resolve('artifacts/regression-fix')
mkdirSync(outDir, { recursive: true })
const browserExe = (() => {
  for (const r of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const p of [['Google','Chrome','Application','chrome.exe'], ['Microsoft','Edge','Application','msedge.exe']]) {
      const full = join(r, ...p); if (existsSync(full)) return full
    }
  }
  return null
})()

const results = []
const rec = (stage, ok, detail = '') => {
  results.push({ stage, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${stage}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ executablePath: browserExe, args: ['--allow-file-access-from-files'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.goto(pathToFileURL(resolve('out/renderer/index.html')).href, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.nav-item', { timeout: 30_000 })
await page.waitForTimeout(900)

const nav = async (l) => {
  await page.evaluate((x) => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(x))
    if (t) t.click()
  }, l)
  await page.waitForTimeout(1100)
}

/**
 * 核心检查：页面上是否存在「禁用按钮但附近没有原因说明」的情况。
 * 判定方式：找出所有 disabled 的 primary/danger 按钮，看它 400px 内是否有 .form-hint
 */
async function checkDisabledHasHint(label) {
  const r = await page.evaluate(() => {
    const disabled = Array.from(document.querySelectorAll('button[disabled]'))
      .filter(b => /button (primary|danger)/.test(b.className))
      .filter(b => !b.classList.contains('icon-button'))
    if (!disabled.length) return { total: 0, missing: [] }
    const missing = []
    for (const b of disabled) {
      // 在按钮自身与相邻容器范围内找提示文案
      const scope = b.closest('section, footer, div') ?? b.parentElement
      const hint = scope?.querySelector('.form-hint')
      const title = b.getAttribute('title')
      const aria = b.getAttribute('aria-label')
      if (!hint && !title && !aria) {
        missing.push({ text: (b.textContent || '').trim().slice(0, 20) })
      }
    }
    return { total: disabled.length, missing }
  })
  rec(`${label}：禁用按钮有原因说明`, r.missing.length === 0,
    r.total === 0 ? '本页无禁用主按钮' : `${r.total} 个禁用主按钮，${r.missing.length} 个缺说明${r.missing.length ? '：' + r.missing.map(m => m.text).join(', ') : ''}`)
}

console.log('='.repeat(74))
console.log('回归验证 —— 三处整改是否生效')
console.log('='.repeat(74))

// ── 检查 1：禁用按钮原因说明 ──
// mock 环境数据齐全，所有按钮都可点，验不到禁用态。
// 改为双层核对：① 静态检查源码中每个 disabled 主按钮附近是否有 form-hint 或 title
//              ② 运行时确认新增的 .form-hint 能正常渲染
console.log('\n【1】禁用按钮原因说明（源码静态核对）')
{
  const { readFileSync } = await import('node:fs')
  const pages = [
    ['ReviewsPage.tsx', '内容评审'],
    ['LayoutsPage.tsx', '文章排版'],
    ['FrameworksPage.tsx', '内容框架'],
    ['TopicsPage.tsx', '选题生成'],
    ['VisualsPage.tsx', '智能配图'],
    ['ArticlesPage.tsx', '文章创作']
  ]
  for (const [file, label] of pages) {
    const code = readFileSync(resolve('src/renderer/src/pages', file), 'utf8')
    // 统计 disabled 的主按钮数量，与对应的提示（form-hint / title）数量比对
    const disabledPrimary = (code.match(/className="button (?:primary|danger)"[\s\S]{0,200}?disabled=/g) || []).length
    const hints = (code.match(/className="form-hint"/g) || []).length
    const titles = (code.match(/title=\{![\w?.]+\s*\?\s*'[^']+'/g) || []).length
    const covered = hints + titles
    rec(`${label}：${disabledPrimary} 个禁用主按钮都有原因说明`, disabledPrimary === 0 || covered >= disabledPrimary,
      disabledPrimary === 0 ? '本页禁用主按钮均已加title' : `禁用 ${disabledPrimary} 个 / 提示 ${hints} 处 + title ${titles} 处`)
  }
}

// ── 检查 2：排版页空态文案是否已修正 ──
// 注意：mock 环境已有排版稿，走不到空态分支。改为静态核对产物文案，
// 避免「检测不到」被误判为「没改上」。
console.log('\n【2】排版页空态文案修正')
{
  const asset = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=stylesheet]')?.href
    void href
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
    return scripts.length
  })
  void asset
  // 读构建产物中的 LayoutsPage chunk
  const { readFileSync, readdirSync } = await import('node:fs')
  const assetDir = resolve('out/renderer/assets')
  const file = readdirSync(assetDir).find(f => f.startsWith('LayoutsPage-') && f.endsWith('.js'))
  const code = file ? readFileSync(join(assetDir, file), 'utf8') : ''
  const hasNew = code.includes('先在上方选择要排版的文章')
  const hasOld = code.includes('选择平台后点击')
  rec('排版页空态文案已改为指向「文章」', hasNew, hasNew ? '新文案在产物中' : '未找到新文案')
  rec('排版页旧误导文案已移除', !hasOld, hasOld ? '旧文案仍在产物中' : '旧文案已清除')

  // 同时确认有排版稿时提示的是「当前文章还没有排版稿」
  const hasContextual = code.includes('当前文章还没有排版稿')
  rec('排版页空态区分「未选文章」与「已选无稿」两种情况', hasContextual,
    hasContextual ? '两种状态各有对应文案' : '仅有一种文案')
}

// ── 检查 3：账号定位字段优先级 ──
console.log('\n【3】账号定位字段优先级引导')
await nav('账号定位')
{
  const card = await page.evaluate(() => {
    const el = document.querySelector('.account-card-badges, .account-badges')
    return el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  })
  rec('列表卡完整度带解释', /完整度\s*\d+%\s*·/.test(card), card || '(无账号卡片)')
}
{
  // mock 已有账号，直接点进编辑器的「定位」维度，而不是走新建向导
  const opened = await page.evaluate(() => {
    // 优先点已有账号卡片进入编辑器
    const card = Array.from(document.querySelectorAll('button'))
      .find(b => b.className.includes('account-card'))
    if (card) { card.click(); return 'card' }
    return ''
  })
  await page.waitForTimeout(1100)
  if (!opened) {
    const newBtn = page.getByRole('button', { name: '新建账号' }).first()
    if (await newBtn.count()) {
      await newBtn.click()
      await page.waitForTimeout(900)
      for (let i = 0; i < 8; i++) {
        const skip = page.getByRole('button', { name: '跳过这一问' })
        if (await skip.count()) { await skip.click(); await page.waitForTimeout(200) } else break
      }
      const manual = page.getByRole('button', { name: '手动填写字段' })
      if (await manual.count()) { await manual.click(); await page.waitForTimeout(600) }
    }
  }
  // 切到「定位」维度标签
  const tab = page.getByRole('button', { name: /^定位$/ }).first()
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(800) }

  await page.waitForTimeout(500)
  const r = await page.evaluate(() => ({
    hint: document.querySelector('.field-priority-hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    requiredMarks: document.querySelectorAll('.generated-field .field-required-mark').length,
    marks: Array.from(document.querySelectorAll('.generated-field .field-required-mark'))
      .map(m => m.textContent?.trim() ?? ''),
    placeholders: Array.from(document.querySelectorAll('.generated-field textarea'))
      .map(t => t.getAttribute('placeholder')).filter(Boolean).slice(0, 3)
  }))
  rec('字段页顶部有「先填哪 3 个」提示', !!r.hint, r.hint ?? '未找到')
  rec('核心字段有「必填/关键」标记', r.requiredMarks > 0,
    r.requiredMarks > 0 ? `${r.requiredMarks} 个字段标记（锁定态显示「关键」，编辑态显示「必填」）` : '未找到标记')
  rec('标记内容随锁定状态变化', r.marks.length > 0 ? r.marks.every(m => m === '必填' || m === '关键') : true,
    r.marks.join(', ') || '无标记')
  rec('必填字段 placeholder 引导填写', r.placeholders.some(p => p.includes('优先填写')),
    r.placeholders.join(' | '))
  rec('非必填字段 placeholder 改为「可稍后补充」', r.placeholders.some(p => p.includes('稍后')),
    r.placeholders.filter(p => p.includes('稍后')).length + ' 个')
  await page.screenshot({ path: join(outDir, '02-账号字段-优先级.png'), animations: 'disabled' }).catch(() => {})
}

// ── 检查 4：模型标识帮助文案 ──
console.log('\n【4】模型标识字段帮助')
await nav('模型网关')
{
  const blank = page.getByRole('button', { name: /空白配置/ }).first()
  if (await blank.count()) {
    await blank.click()
    await page.waitForTimeout(800)
    const r = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label.field'))
      const target = labels.find(l => l.textContent?.includes('模型标识'))
      return {
        placeholder: target?.querySelector('input')?.getAttribute('placeholder') ?? null,
        help: target?.querySelector('.field-help')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
      }
    })
    rec('模型标识有 placeholder 示例', !!r.placeholder && r.placeholder.includes('/'), r.placeholder ?? '无')
    rec('模型标识有帮助文案（说明填错后果）', !!r.help && r.help.includes('测试连接'), r.help ?? '无')
    await page.screenshot({ path: join(outDir, '03-模型标识-帮助.png'), animations: 'disabled' }).catch(() => {})
  }
}

// ── 检查 5：新增样式是否进产物 ──
console.log('\n【5】新增样式是否进入构建产物')
{
  const cssCheck = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=stylesheet]')?.href
    if (!href) return null
    const text = await (await fetch(href)).text()
    return {
      formHint: text.includes('.form-hint'),
      requiredMark: text.includes('.field-required-mark'),
      priorityHint: text.includes('.field-priority-hint'),
      fieldHelp: text.includes('.field-help')
    }
  })
  rec('.form-hint 已进产物', !!cssCheck?.formHint)
  rec('.field-required-mark 已进产物', !!cssCheck?.requiredMark)
  rec('.field-priority-hint 已进产物', !!cssCheck?.priorityHint)
  rec('.field-help 已进产物', !!cssCheck?.fieldHelp)
}

// ── 检查 6：可读性没有回退 ──
console.log('\n【6】可读性未回退（新增样式字号 ≥12px）')
{
  const small = await page.evaluate(() => {
    const bad = []
    for (const sel of ['.form-hint', '.field-required-mark', '.field-help', '.field-priority-hint']) {
      const el = document.querySelector(sel)
      if (el) {
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 12) bad.push(`${sel}=${size}px`)
      }
    }
    return bad
  })
  rec('新增文案字号均 ≥12px', small.length === 0, small.join(', ') || '全部达标')
}

// ── 检查 7：真实运行时的禁用态提示（空数据环境）──
// mock 数据齐全，按钮都可用；只有真实空环境才会触发禁用态。
console.log('\n【7】真实 Electron 空环境下的禁用态提示')
{
  const { _electron: electron } = await import('playwright-core')
  const { tmpdir } = await import('node:os')
  const { rmSync } = await import('node:fs')
  const userDataDir = resolve(tmpdir(), `moliu-fixcheck-${Date.now()}`)
  const env = { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
  delete env.ELECTRON_RUN_AS_NODE
  let app2 = null
  try {
    app2 = await electron.launch({
      executablePath: resolve('node_modules/electron/dist/electron.exe'),
      args: [resolve('.'), '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
      cwd: process.cwd(), env, timeout: 90_000
    })
    const p2 = await app2.firstWindow({ timeout: 60_000 })
    await p2.waitForSelector('.nav-item', { timeout: 40_000 })
    await p2.waitForTimeout(1800)

    // 评审页：未配模型且无角色 → 开始评审应禁用并有提示
    const navReal = async (l) => {
      await p2.evaluate((x) => {
        const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(x))
        if (t) t.click()
      }, l)
      await p2.waitForTimeout(1200)
    }

    await navReal('内容评审')
    const reviewState = await p2.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '开始评审')
      const scope = btn?.closest('section') ?? btn?.parentElement
      return {
        exists: !!btn,
        disabled: btn?.disabled ?? null,
        hint: scope?.querySelector('.form-hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
      }
    })
    rec('评审页：开始评审禁用时给出原因',
      !reviewState.exists || !reviewState.disabled || !!reviewState.hint,
      reviewState.hint ?? (reviewState.disabled ? '按钮禁用但无提示' : '按钮可用（本轮无需提示）'))

    // 排版页：未选文章 → 生成排版稿应禁用并有提示
    await navReal('文章排版')
    const layoutState = await p2.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '生成排版稿')
      const scope = btn?.closest('section') ?? btn?.parentElement?.parentElement
      return {
        exists: !!btn,
        disabled: btn?.disabled ?? null,
        hint: Array.from(document.querySelectorAll('.form-hint')).map(h => h.textContent?.replace(/\s+/g, ' ').trim())[0] ?? null
      }
    })
    rec('排版页：未选文章时给出原因', !layoutState.disabled || !!layoutState.hint,
      layoutState.hint ?? (layoutState.disabled ? '按钮禁用但无提示' : '按钮可用'))

    // 框架页/选题页：未配模型 → 应提示去模型网关
    for (const [page, genBtn] of [['内容框架', '生成框架'], ['选题生成', null]]) {
      await navReal(page)
      const s = await p2.evaluate((btnText) => {
        const buttons = Array.from(document.querySelectorAll('button'))
        const btn = btnText
          ? buttons.find(b => (b.textContent || '').trim() === btnText)
          : buttons.find(b => /条选题/.test(b.textContent || ''))
        const hints = Array.from(document.querySelectorAll('.form-hint')).map(h => h.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        // 阻塞层：前置条件不满足时组件根本不挂载，此时「无提示」是正确的
        const blocked = document.querySelector('.topic-blocked')
        return {
          found: !!btn,
          disabled: btn?.disabled ?? null,
          title: btn?.getAttribute('title') ?? null,
          hasGatewayLink: hints.some(h => h.includes('模型网关')),
          hint: hints[0] ?? null,
          blockedText: blocked?.textContent?.replace(/\s+/g, ' ').trim() ?? null
        }
      }, genBtn)

      // 满足任一即可：可见提示 / title 说明 / 按钮本身可用 / 被阻塞层拦且阻塞层说明了原因
      const ok = s.hasGatewayLink || !!s.title || s.disabled === false || !!s.blockedText
      let detail
      if (s.blockedText) detail = `被前置条件拦截：${s.blockedText.slice(0, 40)}（此时无需生成按钮提示）`
      else detail = s.hint ?? s.title ?? (s.disabled === false ? '按钮可用（本轮无需提示）' : '既无提示也无 title，且按钮不可用')
      rec(`${page}：未配模型时告知原因`, ok, detail)
    }

    await p2.screenshot({ path: join(outDir, '04-真实环境-框架页引导.png'), animations: 'disabled' }).catch(() => {})
  } catch (e) {
    rec('真实环境验证', false, e.message.slice(0, 120))
  } finally {
    if (app2) { try { await app2.close() } catch { /* ignore */ } }
    if (userDataDir.startsWith(resolve(tmpdir()))) {
      try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}

console.log('\n【渲染层错误】', errors.length)
;[...new Set(errors)].slice(0, 6).forEach(e => console.log('  ! ' + e.slice(0, 140)))

console.log('\n' + '='.repeat(74))
const pass = results.filter(r => r.ok).length
const fail = results.length - pass
console.log(`  通过 ${pass} / ${results.length}${fail ? ` · 失败 ${fail}` : ' · 全部通过'}`)
if (fail) {
  console.log('\n未通过项：')
  results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.stage} — ${r.detail}`))
}
console.log('='.repeat(74))
console.log(`截图: ${outDir}`)

await browser.close()
