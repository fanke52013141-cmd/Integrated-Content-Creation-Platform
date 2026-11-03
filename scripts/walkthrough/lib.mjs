// 走查驱动：真实 Electron 启动 + 截图 + 控制台错误采集 + 步骤化 findings 记录
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '../..')
const ART = resolve(ROOT, 'artifacts/walkthrough')

export function shotDirFor(round) {
  const dir = join(ART, round)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 每轮独立 userData；round1 结束后可快照为 base 供后续轮次复制 */
export function userDataPath(name) {
  const dir = join(tmpdir(), `moliu-walk-${name}`)
  return dir
}

export function copyUserData(from, to) {
  rmSync(to, { recursive: true, force: true })
  if (existsSync(from)) cpSync(from, to, { recursive: true })
}

let shotSeq = 0
export async function startApp({ round, userDataDir }) {
  const shotDir = shotDirFor(round)
  const env = { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: resolve(ROOT, 'node_modules/electron/dist/electron.exe'),
    args: [ROOT, '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
    cwd: ROOT,
    env,
    timeout: 90_000
  })
  const page = await app.firstWindow({ timeout: 60_000 })
  const consoleErrors = []
  const pageErrors = []
  const toastLog = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400))
  })
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 400)))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.nav-item', { timeout: 40_000 })
  await page.waitForTimeout(1200)

  // 全程捕获 toast（错误往往 8 秒即消失，事后无法追查）
  await page.evaluate(() => {
    const seen = []
    const obs = new MutationObserver(() => {
      document.querySelectorAll('.toast, [class*="toast"]').forEach((el) => {
        const t = el.textContent?.replace(/[✕×]\s*$/, '').trim()
        if (t && t.length < 300 && !seen.includes(t)) seen.push(t)
      })
    })
    obs.observe(document.body, { subtree: true, childList: true, attributes: true })
    window.__seenToasts = seen
  })

  async function shot(name, opts = {}) {
    shotSeq += 1
    const file = join(shotDir, `${String(shotSeq).padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path: file, animations: 'disabled', ...opts })
    return file
  }

  async function nav(label) {
    await page.locator('.nav-item', { hasText: label }).first().click()
    await page.waitForTimeout(700)
  }

  const findings = []
  const runner = {
    async step(name, fn) {
      try {
        await fn()
        findings.push({ name, ok: true })
        console.log(`  ok  ${name}`)
        return true
      } catch (error) {
        const msg = String(error?.message ?? error).split('\n')[0].slice(0, 400)
        findings.push({ name, ok: false, error: msg })
        console.log(`  FAIL ${name}: ${msg}`)
        try {
          await page.screenshot({ path: join(shotDir, `FAIL-${slug(name)}.png`), animations: 'disabled' })
        } catch {}
        return false
      }
    }
  }

  async function finish() {
    let toasts = []
    try { toasts = await page.evaluate(() => window.__seenToasts ?? []) } catch {}
    await app.close().catch(() => {})
    writeFileSync(
      join(shotDir, 'findings.json'),
      JSON.stringify({ round, findings, toasts, consoleErrors: [...new Set(consoleErrors)], pageErrors: [...new Set(pageErrors)] }, null, 2)
    )
    console.log(`round ${round} done: ${findings.filter(f => !f.ok).length} failed / ${findings.length} steps; consoleErr=${consoleErrors.length} pageErr=${pageErrors.length}`)
    if (toasts.length) console.log('toasts:', JSON.stringify(toasts))
  }

  return { app, page, shot, nav, step: runner.step, finish, shotDir }
}

function slug(s) {
  return s.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)
}

/** 等待 toast / 状态文本出现；支持用 | 分隔多个候选词 */
export async function waitText(page, text, timeout = 15000) {
  const pattern = text.includes('|') ? new RegExp(text.split('|').join('|')) : text
  await page.getByText(pattern, { exact: false }).first().waitFor({ state: 'visible', timeout })
}

/** mock 主进程原生「打开文件」对话框，指向固定路径（用于自动化真实文件导入） */
export async function mockOpenDialog(app, filePath) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
}

/** mock 主进程原生「保存文件」对话框 */
export async function mockSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  }, filePath)
}
