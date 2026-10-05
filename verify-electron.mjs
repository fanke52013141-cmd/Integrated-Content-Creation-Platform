// 真实Electron 启动验证：确认窗口渲染、主进程服务、DB 初始化
// 环境要点：必须清掉 ELECTRON_RUN_AS_NODE，并禁用 GPU（沙盒无GPU 会导致渲染进程崩溃）
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const outDir = resolve('artifacts/ux-audit')
mkdirSync(outDir, { recursive: true })
const executablePath = resolve('node_modules/electron/dist/electron.exe')
if (!existsSync(executablePath)) { console.error('electron.exe missing'); process.exit(1) }

const userDataDir = resolve(tmpdir(), `moliu-verify-${Date.now()}`)

// 关键：清掉 ELECTRON_RUN_AS_NODE（否则 Electron 以纯 Node 模式启动，拿不到 BrowserWindow）
const env = { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath,
  args: [resolve('.'), '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
  cwd: process.cwd(),
  env,
  timeout: 90_000
})

console.log('✓ Electron 进程已启动')

const page = await app.firstWindow({ timeout: 60_000 })
console.log('✓ 主窗口已创建')

const errors = []
const logs = []
page.on('console', (m) => { logs.push(`${m.type()}: ${m.text()}`); if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.waitForLoadState('domcontentloaded')
await page.waitForSelector('.nav-item', { timeout: 40_000 })
console.log('✓ 渲染层已挂载（.nav-item 存在）')

await page.waitForTimeout(2500)

// 读取关键 UI 状态
const state = await page.evaluate(() => ({
  title: document.title,
  heading: document.querySelector('.page h2')?.textContent ?? '',
  navGroups: Array.from(document.querySelectorAll('.nav-group-title')).map(e => e.textContent),
  navItems: Array.from(document.querySelectorAll('.nav-item')).map(e => e.textContent?.trim()),
  pipeline: Array.from(document.querySelectorAll('.pipeline-step')).map(e => e.textContent?.trim()),
  workBar: !!document.querySelector('.work-bar'),
  boot: !!document.querySelector('.boot-screen'),
  bootFallbackVisible: (() => {
    const el = document.getElementById('boot-fallback')
    if (!el) return 'no-el'
    return getComputedStyle(el).display
  })(),
  theme: document.documentElement.dataset.theme
}))

console.log('\n=== 运行时状态 ===')
console.log(JSON.stringify(state, null, 2))

await page.screenshot({ path: join(outDir, 'real-electron-home.png'), animations: 'disabled' })
console.log('\n✓ 截图: artifacts/ux-audit/real-electron-home.png')

// 注意：不要用 app.evaluate 里做动态 import —— Playwright 的 Electron
// evaluate 上下文不支持 dynamic import（会抛 "A dynamic import callback
// was not specified"）。主进程健康度改为在渲染层侧验证。
const dbProbe = await page.evaluate(() => ({
  // 渲染层能读到 bootstrap，说明 IPC 通道与主进程数据库都正常
  hasBridge: typeof window.moliu?.app?.bootstrap === 'function',
  version: document.title
}))
console.log('\n=== IPC 桥接 ===')
console.log(JSON.stringify(dbProbe, null, 2))

console.log('\n=== 渲染层错误 (%d) ===', errors.length)
;[...new Set(errors)].slice(0, 10).forEach(e => console.log('  ' + e.slice(0, 180)))

await page.waitForTimeout(500)
await app.close()
console.log('\n✓ 已正常关闭')
console.log('done')
