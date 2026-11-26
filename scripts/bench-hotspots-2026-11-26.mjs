import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-hotspot-bench-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
  if (await guide.isVisible().catch(() => false)) await guide.click()
  const t0 = Date.now()
  await page.getByRole('button', { name: '热点洞察', exact: true }).click()
  await page.locator('.hot-item-list li').first().waitFor({ timeout: 60_000 })
  const initialMs = Date.now() - t0
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('刷新全部'))
    return button && !button.disabled
  }, undefined, { timeout: 60_000 })
  const t1 = Date.now()
  await page.getByRole('button', { name: '刷新全部' }).click()
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('刷新全部'))
    return button && !button.disabled
  }, undefined, { timeout: 90_000 })
  const refreshAllMs = Date.now() - t1
  const meta = await page.locator('.hotspot-hero-meta').innerText()
  console.log(JSON.stringify({ initialVisibleMs: initialMs, refreshAllMs, meta }, null, 2))
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-hotspot-bench-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
