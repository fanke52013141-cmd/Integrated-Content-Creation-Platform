import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = await mkdtemp(join(tmpdir(), 'moliu-workflow-smoke-'))
const screenshots = resolve('artifacts/workflow-smoke')
await mkdir(screenshots, { recursive: true })
let app
const errors = []
async function launch() {
  app = await electron.launch({ executablePath: process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe'), args: process.env.MOLIU_EXECUTABLE ? [] : ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '创作台', exact: true }).waitFor()
  return page
}
try {
  let page = await launch()
  const ids = await page.evaluate(async () => {
    const save = title => window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: `# ${title}\n\n原始正文` })
    const a = await save('作品 A'), b = await save('作品 B')
    return { a: a.id, b: b.id }
  })
  await page.getByRole('button', { name: '文章创作', exact: true }).click()
  await page.locator('.article-list-item').filter({ hasText: '作品 A' }).click()
  await page.locator('.article-editor-head h2').getByText('作品 A', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('textarea[name="articleMarkdown"]')?.disabled === false)
  const editor = page.locator('textarea[name="articleMarkdown"]')
  await editor.waitFor(); await editor.fill('# 作品 A\n\n重启后必须保留的修改')
  for (let tries = 0; tries < 50; tries++) { const draft = await page.evaluate(id => window.moliu.articles.getDraft(id), ids.a); if (draft?.content.includes('重启后必须保留')) break; if (tries === 49) throw new Error('Draft not persisted for selected article'); await new Promise(resolve => setTimeout(resolve, 100)) }
  await page.getByRole('button', { name: '文章排版', exact: true }).click()
  await page.locator('.saved-version-gate').waitFor()
  assert.match(await page.locator('.work-bar').innerText(), /待保存版本/)
  await page.screenshot({ path: join(screenshots, 'unsaved-gate.png') })
  await app.close()
  page = await launch()
  await page.getByRole('button', { name: '文章创作', exact: true }).click()
  await page.locator('.article-list-item').filter({ hasText: '作品 A' }).click()
  await page.screenshot({ path: join(screenshots, 'restart-debug.png') })
  await page.waitForFunction(() => document.querySelector('textarea[name="articleMarkdown"]')?.value.includes('重启后必须保留'))
  await page.locator('.article-save-state').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('手动编辑已保存为新版本').waitFor()
  const state = await page.evaluate(async id => ({ article: await window.moliu.articles.get(id), draft: await window.moliu.articles.getDraft(id) }), ids.a)
  assert.equal(state.article.versionCount, 2); assert.equal(state.draft, null)
  await page.getByRole('button', { name: '文章排版', exact: true }).click()
  assert.equal(await page.locator('.saved-version-gate').count(), 0)
  const layouts = await page.evaluate(async ({ a, b }) => {
    const first = await window.moliu.layouts.create({ articleId: a, platform: 'wechat' })
    const second = await window.moliu.layouts.create({ articleId: b, platform: 'wechat' })
    await window.moliu.publishing.saveForm({ articleId: a, appId: '', layoutId: first.id, author: '作者 A', digest: '摘要 A', coverAssetId: '', thumbMediaId: '封面 A', contentSourceUrl: '' })
    return { first: first.id, second: second.id }
  }, ids)
  await page.getByRole('button', { name: '发布管理', exact: true }).click()
  // Select layout through the actual UI, so cross-work state is exercised.
  const select = page.getByRole('button', { name: '排版稿', exact: true })
  await select.click()
  await page.getByRole('option').filter({ hasText: '作品 A' }).first().click()
  await page.waitForFunction(() => document.querySelector('input[name="author"]')?.value === '作者 A')
  await select.click()
  await page.getByRole('option').filter({ hasText: '作品 B' }).first().click()
  await page.waitForFunction(() => document.querySelector('input[name="author"]')?.value === '')
  assert.equal(await page.locator('input[name="thumbMediaId"]').inputValue(), '')
  assert.notEqual(await page.locator('input[name="digest"]').inputValue(), '摘要 A')
  await page.screenshot({ path: join(screenshots, 'publish-work-B.png') })
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '立即备份', exact: true }).click()
  await page.getByText('恢复', { exact: true }).waitFor()
  await page.screenshot({ path: join(screenshots, 'backup.png') })
  assert.deepEqual(errors, [])
  console.log('Workflow smoke passed: persistent draft restart, saved-version gate, commit, cross-work publishing form, backup; no renderer errors', layouts)
} finally {
  if (app) await app.close().catch(() => {})
  // The absolute target is the isolated directory created above, never real userData.
  assert.ok(root.startsWith(join(tmpdir(), 'moliu-workflow-smoke-')))
  await rm(root, { recursive: true, force: true })
}
