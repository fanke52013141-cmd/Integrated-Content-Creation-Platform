import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

const artifactDir = resolve('artifacts')
const root = await mkdtemp(join(tmpdir(), 'moliu-layout-smoke-'))
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
await mkdir(artifactDir, { recursive: true })
const app = await electron.launch({
  executablePath,
  args: process.env.MOLIU_EXECUTABLE ? [] : ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: root }
})
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await page.waitForLoadState('domcontentloaded')
  const data = await page.evaluate(async () => {
    const article = await window.moliu.articles.save({
      materialIds: [], manualOutline: '', status: 'locked',
      rawMarkdown: '# 排版测试\n\n## 小标题\n\n一段正文。\n\n- 要点一', source: 'manual'
    })
    const layout = await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat' })
    const rows = await window.moliu.layouts.list(article.id)
    const other = await window.moliu.articles.save({
      materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 另一篇文章\n\n第二篇的正文。', source: 'manual'
    })
    await window.moliu.layouts.create({ articleId: other.id, platform: 'wechat' })
    return {
      title: layout.title,
      html: layout.html,
      plain: layout.plainText,
      version: layout.articleVersionId === article.currentVersionId,
      status: layout.articleStatusSnapshot,
      saved: rows.length,
      richClipboard: await window.moliu.clipboard.writeRichText('<p><strong>带格式</strong></p>', '带格式')
    }
  })
  if (data.title !== '排版测试' || !data.html.includes('<h2') || !data.plain.includes('一段正文')
    || !data.version || data.status !== 'locked' || data.saved !== 1) throw new Error('Layout workflow failed')
  if (data.richClipboard !== true) throw new Error('Rich text clipboard bridge did not work')

  // F03：切换文章后，排版预览必须跟着换成那篇文章自己的稿子，不能继续显示上一篇
  await page.getByRole('button', { name: '文章排版' }).first().click()
  await page.getByText('排版测试').first().waitFor()
  await page.getByLabel('文章').click()
  await page.getByRole('option', { name: '排版测试' }).click()
  await page.getByText('来自《排版测试》').waitFor()
  await page.getByLabel('文章').click()
  await page.getByRole('option', { name: '另一篇文章' }).click()
  await page.getByText('来自《另一篇文章》').waitFor()
  if (await page.getByText('来自《排版测试》').count()) throw new Error('排版预览串到了另一篇文章')
  await capture(page, { path: resolve(artifactDir, 'layout-selection-scoped.png'), animations: 'disabled' })

  // F19：125%/150% 缩放等效于 944/787 CSS px 宽，排版工作台要换行而不是把操作挤出屏幕
  const originalViewport = page.viewportSize()
  for (const width of [944, 787]) {
    await page.setViewportSize({ width, height: 800 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 1) throw new Error(`${width}px 宽度下排版页出现 ${overflow}px 横向滚动`)
  }
  await capture(page, { path: resolve(artifactDir, 'layout-narrow-width.png'), animations: 'disabled' })
  if (originalViewport) await page.setViewportSize(originalViewport)

  // F12：一键复制带格式正文，供直接粘贴进公众号编辑器
  await page.getByRole('button', { name: '复制图文（带格式）' }).click()
  await page.getByText('已复制带格式正文').waitFor()

  // 验收任务 7：两篇同名文章要能分辨，切过去后预览不能还是另一篇
  await page.waitForTimeout(1_200)
  await page.evaluate(async () => {
    const twin = await window.moliu.articles.save({
      materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 排版测试\n\n同名稿子的乙段正文。', source: 'manual'
    })
    await window.moliu.layouts.create({ articleId: twin.id, platform: 'wechat' })
  })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: '文章排版' }).first().click()
  await page.getByLabel('文章').click()
  const twins = page.getByRole('option').filter({ hasText: '排版测试' })
  if (await twins.count() !== 2) throw new Error(`同名文章应出现两个选项，实际 ${await twins.count()} 个`)
  const labels = (await twins.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())
  if (new Set(labels).size !== 2) throw new Error(`同名文章的两个选项无法区分：${JSON.stringify(labels)}`)
  await twins.filter({ hasText: '草稿' }).click()
  await page.getByText('同名稿子的乙段正文').waitFor()
  if ((await page.locator('.layout-html').first().innerText()).includes('一段正文')) throw new Error('同名文章切换后预览仍是另一篇')
  await capture(page, { path: resolve(artifactDir, 'layout-same-title-distinguished.png'), animations: 'disabled' })
  console.log('Layout smoke passed: markdown rendering, version snapshot, per-article selection, rich text copy, same-title articles told apart')
} finally {
  await app.close()
  const requiredPrefix = `${resolve(tmpdir())}${sep}moliu-layout-smoke-`
  if (!root.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
  await rm(root, { recursive: true, force: true })
}
