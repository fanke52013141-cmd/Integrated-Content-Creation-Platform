// 用户视角全路由 UI 巡检：遍历 12 个页面、收集控制台错误、验证关键交互与 hash 路由
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts', 'ui-audit')
await mkdir(artifactDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-ui-audit-${Date.now()}`)
const executablePath = resolve('node_modules/electron/dist/electron.exe')

const application = await electron.launch({
  executablePath,
  args: ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})

const issues = []
const routeResults = []
let window

function record(severity, route, message) {
  issues.push({ severity, route, message })
}

function check(condition, severity, route, message) {
  if (!condition) record(severity, route, message)
  return condition
}

try {
  window = await application.firstWindow()
  const consoleErrors = []
  window.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  window.on('pageerror', (error) => record('P0', 'global', `pageerror: ${error.message}`))

  await window.waitForLoadState('domcontentloaded')
  await window.getByText('本地创作流水线', { exact: false }).first().waitFor({ timeout: 15_000 })

  // --- P1 全局: 主题切换 ---
  const themeBefore = await window.evaluate(() => document.documentElement.dataset.theme)
  await window.getByRole('button', { name: '切换主题' }).click()
  await window.waitForTimeout(300)
  const themeAfter = await window.evaluate(() => document.documentElement.dataset.theme)
  check(themeBefore !== themeAfter, 'P1', 'global', `主题切换无效: ${themeBefore} -> ${themeAfter}`)
  await window.getByRole('button', { name: '切换主题' }).click()
  await window.waitForTimeout(300)

  // --- P1 hash 路由: 刷新保留路由 ---
  await window.getByRole('button', { name: '账号定位' }).first().click()
  await window.waitForTimeout(300)
  const hashAfterNav = await window.evaluate(() => window.location.hash)
  check(hashAfterNav.includes('accounts'), 'P1', 'routing', `点击导航后 hash 未更新: ${hashAfterNav}`)
  await window.reload()
  await window.waitForTimeout(1500)
  const hashAfterReload = await window.evaluate(() => window.location.hash)
  const titleAfterReload = await window.locator('.topbar h1').innerText()
  check(hashAfterReload.includes('accounts'), 'P0', 'routing', `刷新后 hash 丢失: ${hashAfterReload}`)
  check(titleAfterReload.includes('账号定位'), 'P0', 'routing', `刷新后未恢复到账号页, topbar: ${titleAfterReload}`)

  // --- 全局网关未配置横幅(新装状态) ---
  const bannerVisible = await window.locator('.gateway-banner').count()
  check(bannerVisible === 1, 'P2', 'global', '全新安装时网关未配置横幅未出现')

  // --- 遍历全部 12 个路由 ---
  const routes = [
    { id: 'dashboard', label: '流水线总览', expect: '创作工作台' },
    { id: 'accounts', label: '账号定位', expect: '账号定位' },
    { id: 'providers', label: '模型网关', expect: '模型网关' },
    { id: 'hotspots', label: '热点洞察', expect: '热点洞察' },
    { id: 'topics', label: '选题生成', expect: '选题生成' },
    { id: 'frameworks', label: '内容框架', expect: '内容框架' },
    { id: 'articles', label: '文章创作', expect: '文章创作' },
    { id: 'visuals', label: '智能配图', expect: '智能配图' },
    { id: 'reviews', label: '内容评审', expect: '内容评审' },
    { id: 'layouts', label: '文章排版', expect: '文章排版' },
    { id: 'publishing', label: '发布管理', expect: '发布管理' },
    { id: 'materials', label: '素材库', expect: '素材库' }
  ]

  for (const route of routes) {
    consoleErrors.length = 0
    try {
      await window.evaluate((id) => { window.location.hash = `#/${id}` }, route.id)
      await window.waitForTimeout(400)
      const topbarTitle = await window.locator('.topbar h1').innerText()
      const ok = topbarTitle.includes(route.expect)
      if (!ok) record('P1', route.id, `topbar 标题"${topbarTitle}"与预期"${route.expect}"不符`)
      const pageContent = await window.locator('.content').innerText()
      check(pageContent.trim().length > 5, 'P1', route.id, '页面内容为空')
      if (consoleErrors.length > 0) {
        record('P1', route.id, `控制台错误: ${consoleErrors.slice(0, 3).join(' | ')}`)
      }
      routeResults.push({ route: route.id, ok, title: topbarTitle, errors: consoleErrors.length })
      await window.screenshot({ path: resolve(artifactDir, `route-${route.id}.png`) })
    } catch (error) {
      record('P0', route.id, `路由加载异常: ${error.message}`)
      routeResults.push({ route: route.id, ok: false, title: 'ERROR', errors: -1 })
    }
  }

  // --- 关键交互: 供应商页添加模型, 校验表单空提交 ---
  await window.evaluate(() => { window.location.hash = '#/providers' })
  await window.waitForTimeout(400)
  await window.getByRole('button', { name: 'DeepSeek' }).first().click()
  await window.waitForTimeout(300)
  const saveButton = window.locator('.provider-editor').getByRole('button', { name: '加密保存' })
  await saveButton.click()
  await window.waitForTimeout(300)
  const nameFieldError = await window.locator('.provider-editor .field-error').count()
  record('P2', 'providers', `provider 表单空提交后的内联错误数量: ${nameFieldError}（P2-5 若为 0 说明该表单尚未接入 useFormErrors）`)

  // --- 关键交互: 素材页手动添加空提交, 验证 P2-5 表单内联错误 + 首错误聚焦 ---
  await window.evaluate(() => { window.location.hash = '#/materials' })
  await window.waitForTimeout(400)
  await window.getByRole('button', { name: '添加文字素材' }).first().click()
  await window.waitForTimeout(300)
  const dialogVisible = await window.locator('.manual-material-dialog').count()
  check(dialogVisible === 1, 'P1', 'materials', '手动素材对话框未打开')
  await window.locator('.manual-material-dialog').getByRole('button', { name: '加入素材库' }).click()
  await window.waitForTimeout(300)
  const inlineErrors = await window.locator('.manual-material-dialog .field-error').allInnerTexts()
  check(inlineErrors.length >= 2, 'P1', 'materials', `空提交后内联错误数量 ${inlineErrors.length} < 2: ${JSON.stringify(inlineErrors)}`)
  const focusedTag = await window.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName)
  check(focusedTag === 'title', 'P2', 'materials', `空提交后首错误聚焦位置: ${focusedTag}（预期 title）`)
  // Escape 关闭对话框 (P0-5 focus trap)
  await window.keyboard.press('Escape')
  await window.waitForTimeout(300)
  const dialogAfterEsc = await window.locator('.manual-material-dialog').count()
  check(dialogAfterEsc === 0, 'P1', 'materials', 'Escape 未能关闭手动素材对话框')

  // --- 关键交互: skip link ---
  const skipLink = window.locator('.skip-link')
  check(await skipLink.count() === 1, 'P1', 'global', 'skip link 不存在')
  await window.keyboard.press('Tab')
  await window.waitForTimeout(200)
  const skipFocused = await window.evaluate(() => document.activeElement?.classList.contains('skip-link'))
  // skip link 是否焦点首个元素取决于 DOM 顺序, 记录即可
  record('P2', 'global', `首个 Tab 焦点落在 skip-link: ${skipFocused === true}`)

  // --- 关键交互: 大列表(素材库空状态) ---
  const emptyState = await window.getByText('素材集合还是空的', { exact: false }).count()
  check(emptyState === 1, 'P2', 'materials', '素材库空状态未显示')

  // --- 截图总览 ---
  await window.evaluate(() => { window.location.hash = '#/dashboard' })
  await window.waitForTimeout(500)
  await window.screenshot({ path: resolve(artifactDir, 'final-dashboard.png') })
} finally {
  if (window) await window.screenshot({ path: resolve(artifactDir, 'final-state.png') }).catch(() => {})
  await application.close()
}

// --- 输出报告 ---
const p0 = issues.filter((i) => i.severity === 'P0')
const p1 = issues.filter((i) => i.severity === 'P1')
const p2 = issues.filter((i) => i.severity === 'P2')
const report = {
  timestamp: new Date().toISOString(),
  summary: { totalIssues: issues.length, p0: p0.length, p1: p1.length, p2: p2.length },
  routes: routeResults,
  issues
}
await writeFile(resolve(artifactDir, 'ui-audit-report.json'), JSON.stringify(report, null, 2))

console.log('=== UI 巡检完成 ===')
console.log(`路由遍历: ${routeResults.filter((r) => r.ok).length}/${routeResults.length} 正常`)
for (const r of routeResults) console.log(`  ${r.ok ? '✓' : '✗'} ${r.route} -> ${r.title} (console errors: ${r.errors})`)
console.log(`\n问题统计: P0=${p0.length} P1=${p1.length} P2=${p2.length}`)
for (const issue of p0) console.log(`  [P0] [${issue.route}] ${issue.message}`)
for (const issue of p1) console.log(`  [P1] [${issue.route}] ${issue.message}`)
for (const issue of p2) console.log(`  [P2] [${issue.route}] ${issue.message}`)
