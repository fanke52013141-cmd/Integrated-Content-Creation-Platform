import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-optimization-smoke-'))
const external = await mkdtemp(join(tmpdir(), 'moliu-portable-smoke-'))
const artifacts = resolve('artifacts/optimization-smoke')
await mkdir(artifacts, { recursive: true })
const image = join(root, 'user-picture.png')
await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'))
const app = await electron.launch({ executablePath: process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe'), args: process.env.MOLIU_EXECUTABLE ? [] : ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  const old = await page.evaluate(async () => {
    const original = await window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 很久以前的文章\n\n正文只包含尾部检索词。' })
    for (let i = 0; i < 505; i++) await window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: `# 新文章 ${i}\n\n新的正文` })
    return original
  })
  await page.evaluate(id => { location.hash = `/articles?articleId=${id}` }, old.id)
  await page.locator('.article-editor-head h2').filter({ hasText: '很久以前的文章' }).waitFor()
  await page.waitForFunction(() => document.querySelector('textarea[name="articleMarkdown"]')?.disabled === false)
  await page.locator('.local-image-import input[type=file]').setInputFiles(image)
  await page.waitForFunction(() => document.querySelector('textarea[name="articleMarkdown"]')?.value.includes('moliu-asset://'))
  await page.locator('.article-save-state').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('手动编辑已保存为新版本').waitFor()
  await page.getByRole('button', { name: '编辑与预览', exact: true }).click()
  await page.locator('.live-preview img').waitFor()
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  assert.equal(await page.locator('.sidebar').isVisible(), false)
  await page.setViewportSize({ width: 940, height: 820 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '专注模式窄屏出现横向溢出')
  await capture(page, { path: join(artifacts, 'focused-writing.png') })
  await page.getByRole('button', { name: '退出专注写作', exact: true }).click()
  assert.equal(await page.locator('.sidebar').isVisible(), true)
  const layout = await page.evaluate(async id => window.moliu.layouts.create({ articleId: id, platform: 'wechat' }), old.id)
  await page.evaluate(id => { location.hash = `/layouts?articleId=${id}` }, old.id)
  await page.getByLabel('文章', { exact: true }).filter({ hasText: '很久以前的文章' }).waitFor()
  await page.getByRole('button', { name: '复制正文，手动插图' }).click()
  await page.getByText('已复制正文与 1 个图片占位').waitFor()
  const html = await app.evaluate(({ clipboard }) => clipboard.readHTML())
  assert.ok(html.includes('【图片 1')); assert.ok(!html.includes('moliu-asset:'))

  await page.evaluate(id => { location.hash = `/publishing?articleId=${id}` }, old.id)
  await page.getByRole('button', { name: '导入自己的封面' }).waitFor()
  await page.locator('.local-image-import input[type=file]').setInputFiles(image)
  await page.locator('.delivery-cover').waitFor()
  assert.equal(await page.evaluate(async () => (await window.moliu.providers.list()).length), 0)
  await capture(page, { path: join(artifacts, 'manual-cover-no-ai.png') })
  const publicationId = randomUUID(), stamp = new Date().toISOString()
  const sqlite = new DatabaseSync(join(root, 'moliu.db'))
  sqlite.prepare('INSERT INTO publications(id,article_id,article_version_id,layout_id,channel_id,status,title,thumb_media_id,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(publicationId, old.id, layout.articleVersionId, layout.id, 'wechat-official', 'unknown', '很久以前的文章', '', '模拟网络中断，结果待确认', stamp, stamp)
  sqlite.close()
  await page.reload()
  await page.getByLabel('核对结果').selectOption('not-received')
  await page.getByLabel('核对说明').fill('测试：已按目标公众号、标题及提交时间确认未收到')
  await page.getByRole('button', { name: '保存核对结果' }).click()
  await page.locator('.publication-row').getByText('推送失败', { exact: true }).waitFor()
  assert.equal((await page.evaluate(async id => (await window.moliu.publishing.list()).find(item => item.id === id), publicationId)).resolution.decision, 'not-received')

  const document = await page.evaluate(async () => {
    const text = '背景资料。\n'.repeat(5000) + '尾部独有证据：公众号创作者希望先写文章。'
    const material = await window.moliu.materials.addFile({ fileName: '完整访谈.txt', data: new TextEncoder().encode(text).buffer })
    const full = await window.moliu.materials.document(material.id)
    const context = await window.moliu.materials.previewContext({ ids: [material.id], query: '尾部独有证据 公众号创作者' })
    return { id: material.id, full: full.content, input: context.text, omitted: context.omittedChars }
  })
  assert.ok(document.full.endsWith('尾部独有证据：公众号创作者希望先写文章。'))
  assert.ok(document.input.includes('尾部独有证据')); assert.ok(document.omitted > 0)
  // Worker 内的 Word 解析也经过真实 Electron 主进程调用。
  const docx = await readFile(resolve('tests/fixtures/optimization.docx'))
  const parsedWord = await page.evaluate(async bytes => {
    const material = await window.moliu.materials.addFile({ fileName: '访谈.docx', data: new Uint8Array(bytes).buffer })
    return (await window.moliu.materials.document(material.id)).content
  }, [...docx])
  assert.ok(parsedWord.includes('Word worker preserves this evidence'))
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, external)
  const exported = await page.evaluate(() => window.moliu.app.exportPortableBackup())
  assert.ok(exported.path.startsWith(external + sep))
  const manifest = JSON.parse(await readFile(join(exported.path, 'manifest.json'), 'utf8'))
  assert.equal(manifest.credentialsIncluded, false)
  assert.ok(manifest.images >= 2)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Optimization smoke passed: old article beyond 500, no-AI inline and cover import, focus/split/940px, image placeholders, unknown resolution, full text tail evidence, Word worker, external portable backup; no renderer errors')
} finally {
  await app.close()
  for (const directory of [root, external]) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
}
