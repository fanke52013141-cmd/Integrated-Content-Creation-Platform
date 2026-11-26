import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-platforms-smoke-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => console.error('renderer:error:', error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
  if (await guide.isVisible().catch(() => false)) await guide.click()

  await page.getByRole('button', { name: '平台授权', exact: true }).click()
  await page.getByRole('heading', { name: '平台授权' }).waitFor()
  await page.getByText('微博', { exact: true }).waitFor()
  await page.getByText('快手', { exact: true }).waitFor()
  await page.getByText('微信公众号', { exact: true }).waitFor()
  if (!(await page.getByText('未授权', { exact: true }).isVisible())) throw new Error('初始微博状态应为未授权')

  await page.evaluate(async () => { await window.moliu.hotspots.saveWeiboCookie('SUB=smoke-test') })
  await page.getByRole('button', { name: '刷新状态' }).click()
  await page.getByText('已授权', { exact: true }).waitFor()

  await page.getByRole('button', { name: '清除授权' }).click()
  await page.getByRole('button', { name: '清除授权', exact: true }).last().click()
  await page.getByText('未授权', { exact: true }).waitFor()

  await capture(page, { path: resolve('artifacts/journey-2026-11-26/platforms-page.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '去热点页验证' }).click()
  await page.getByRole('heading', { name: '热点洞察' }).waitFor()
  console.log('Platforms smoke passed: unified page, status refresh, clear authorization, hotspot navigation')
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-platforms-smoke-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
