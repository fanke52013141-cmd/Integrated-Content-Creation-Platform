import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-layout-theme-smoke-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) => console.error('renderer:error:', error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
  if (await guide.isVisible().catch(() => false)) await guide.click()
  const article = await page.evaluate(async () => window.moliu.articles.save({
    materialIds: [], manualOutline: '', status: 'locked', source: 'manual',
    rawMarkdown: '# 新版排版验收\n\n这是一段用于验证**编辑部主题**的正文。\n\n## 章节标题\n\n- 要点一\n- 要点二\n\n> 引用内容。'
  }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '文章排版', exact: true }).click()
  await page.locator('.theme-gallery').waitFor()
  const editorial = page.getByRole('button', { name: /^编辑部/ })
  if (!(await editorial.getAttribute('aria-pressed'))?.includes('true')) throw new Error('默认主题不是编辑部')
  await page.getByRole('button', { name: /^现代极简/ }).click()
  await page.getByRole('button', { name: '生成排版稿' }).first().click()
  await page.getByText('微信公众号排版稿已生成').waitFor({ timeout: 60_000 })
  const layout = await page.evaluate(async (articleId) => (await window.moliu.layouts.list(articleId))[0], article.id)
  if (layout.themeId !== 'modern') throw new Error(`排版稿主题未应用现代极简：${layout.themeId}`)
  if (!layout.html.includes('#2563eb')) throw new Error('排版稿缺少现代极简主题强调色')
  await capture(page, { path: resolve('artifacts/journey-2026-11-26/layout-theme-gallery.png'), animations: 'disabled' })
  console.log('Layout theme smoke passed: gallery visible, editorial default, modern theme applied to rendered layout')
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-layout-theme-smoke-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
