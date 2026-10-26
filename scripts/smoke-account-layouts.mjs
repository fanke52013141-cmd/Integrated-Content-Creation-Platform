import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-account-layout-smoke-'))
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const app = await electron.launch({ executablePath, args: process.env.MOLIU_EXECUTABLE ? [] : ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
let page
try {
  page = await app.firstWindow()
  page.setDefaultTimeout(12_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  const account = await page.evaluate(() => window.moliu.accounts.save({ fields: [{ id: crypto.randomUUID(), name: '账号名称', value: '统一版式测试号', isDefault: true }], wizardAnswers: [], status: 'locked', source: 'manual' }))
  await page.reload()
  const openDesigner = async () => {
    await page.getByRole('button', { name: '账号定位', exact: true }).first().click()
    await page.locator('.account-card').filter({ hasText: '统一版式测试号' }).click()
    await page.getByRole('tab', { name: '公众号版式' }).click()
    await page.getByLabel('固定开篇说明').waitFor()
  }
  await openDesigner()
  if ((await page.evaluate(() => window.moliu.articles.list())).length) throw new Error('Test must start with zero articles')
  await page.getByLabel('固定开篇说明').fill('每周与你分享可靠的知识')
  await page.getByLabel('二级标题样式').selectOption('underline')
  await page.getByLabel('正文字号', { exact: true }).fill('17')
  const frame = page.frameLocator('iframe[title="统一版式测试号公众号版式设计预览"]')
  await frame.getByText('每周与你分享可靠的知识', { exact: true }).waitFor()
  await frame.locator('img').waitFor()
  const image = await frame.locator('img').evaluate(async (img) => {
    try { await img.decode() } catch { /* assertion reports failure */ }
    return { src: img.getAttribute('src'), width: img.naturalWidth, alt: img.alt }
  })
  if (!image.src?.startsWith('data:image/png;') || !image.width || !image.alt) throw new Error(`Sample image or alt failed: ${JSON.stringify(image)}`)
  const headerStyle = await frame.locator('.mly-brand-header,section').filter({ hasText: '每周与你分享可靠的知识' }).first().getAttribute('style')
  if (!headerStyle?.includes('border-left')) throw new Error('Preview sanitizer removed brand header styling')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByText('版式草稿已保存，后续文章仍沿用当前启用版本').waitFor()
  if (await page.evaluate((id) => window.moliu.layouts.getAccountDefault(id, 'wechat'), account.id)) throw new Error('Saving draft activated layout')

  // 编辑器未依赖文章，保存草稿后重进仍可继续；侧栏离开前的未保存编辑在本窗口恢复。
  await page.getByRole('button', { name: '文章排版', exact: true }).first().click()
  await openDesigner()
  if (await page.getByLabel('固定开篇说明').inputValue() !== '每周与你分享可靠的知识') throw new Error('Saved draft not recovered')
  await page.getByLabel('固定文末署名').fill('独立作者 · 版权所有')
  await page.getByRole('button', { name: '文章排版', exact: true }).first().click()
  await openDesigner()
  if (await page.getByLabel('固定文末署名').inputValue() !== '独立作者 · 版权所有') throw new Error('Local working edits lost across navigation')
  await page.getByRole('button', { name: '启用为新版本', exact: true }).click()
  await page.locator('.account-layout-heading').getByText(/当前启用 V1/).waitFor()

  // 版式包经过实际保存/读取；导入仅改编辑区。
  const bundlePath = join(root, 'layout.json')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, bundlePath)
  await page.getByRole('button', { name: '导出当前参数', exact: true }).click()
  await page.getByText(`版式包已导出：${bundlePath}`, { exact: true }).waitFor()
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'))
  if (bundle.styleConfig.brandFooterText !== '独立作者 · 版权所有') throw new Error('Preset export lost brand copy')
  bundle.styleConfig.brandFooterText = '导入后的署名'
  await writeFile(bundlePath, JSON.stringify(bundle), 'utf8')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, bundlePath)
  await page.getByRole('button', { name: '导入版式包', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('textarea[placeholder="例如：关注提示、版权说明或品牌落款"]')?.value === '导入后的署名')
  const activeBefore = await page.evaluate((id) => window.moliu.layouts.getAccountDefault(id, 'wechat'), account.id)
  if (activeBefore?.versionNumber !== 1) throw new Error('Import unexpectedly changed active version')
  await page.getByRole('button', { name: '启用为新版本', exact: true }).click()
  await page.locator('.account-layout-heading').getByText(/当前启用 V2/).waitFor()

  const delivery = await page.evaluate(async (id) => {
    const article = await window.moliu.articles.save({ accountId: id, materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 正式交付文章\n\n## 一个小节\n\n正文内容。', source: 'manual' })
    const layout = await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat' })
    return { article, layout }
  }, account.id)
  if (!delivery.layout.layoutVersionId || !delivery.layout.html.includes('导入后的署名') || delivery.layout.html.includes('<h1')) throw new Error('Account default was not used for new article')
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.getByLabel('预览内容').selectOption(delivery.article.id)
  await frame.getByText('正文内容。', { exact: true }).waitFor()
  await page.getByLabel('预览内容').selectOption('sample')

  // 模拟另一个窗口启用新版本：当前窗口必须保留草稿并要求更新基准。
  await page.evaluate(async (id) => {
    const active = await window.moliu.layouts.getAccountDefault(id, 'wechat')
    await window.moliu.layouts.setAccountDefault({ accountId: id, platform: 'wechat', themeId: 'minimal', styleConfig: { brandFooterText: '另一窗口更新' }, expectedVersionId: active.id })
  }, account.id)
  await page.getByLabel('固定文末署名').fill('保留本窗口编辑')
  await page.getByRole('button', { name: '启用为新版本', exact: true }).click()
  await page.getByRole('button', { name: '更新启用基准', exact: true }).waitFor()
  if (await page.getByLabel('固定文末署名').inputValue() !== '保留本窗口编辑') throw new Error('Conflict lost user editing')
  await page.getByRole('button', { name: '更新启用基准', exact: true }).click()
  await page.getByRole('button', { name: '启用为新版本', exact: true }).click()
  await page.locator('.account-layout-heading').getByText(/当前启用 V4/).waitFor()
  const oldLayout = await page.evaluate((id) => window.moliu.layouts.list(id), delivery.article.id)
  if (oldLayout[0]?.html !== delivery.layout.html) throw new Error('Old article output changed after template activation')

  await frame.getByText('保留本窗口编辑', { exact: true }).waitFor()
  await page.getByText('预览不保存正式排版稿；实际微信效果仍需粘贴和实机验收。', { exact: true }).waitFor()
  while (await page.getByRole('button', { name: '关闭通知', exact: true }).count()) await page.getByRole('button', { name: '关闭通知', exact: true }).first().click()
  await mkdir(resolve('artifacts'), { recursive: true })
  await capture(page, { path: resolve('artifacts/account-layout-designer.png') })
  await page.setViewportSize({ width: 787, height: 850 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) throw new Error(`Account layout editor overflows by ${overflow}px`)
  await capture(page, { path: resolve('artifacts/account-layout-designer-narrow.png') })
  if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`)
  console.log('Account layout smoke passed: no-article configuration, draft recovery, inline preview, JSON roundtrip, account binding and conflict handling')
} catch (error) {
  if (page) await capture(page, { path: resolve('artifacts/account-layout-failure.png') }, 1).catch(() => {})
  throw error
} finally {
  await app.close()
  if (!root.startsWith(`${resolve(tmpdir())}${sep}moliu-account-layout-smoke-`)) throw new Error('Unexpected temporary path')
  await rm(root, { recursive: true, force: true })
}
