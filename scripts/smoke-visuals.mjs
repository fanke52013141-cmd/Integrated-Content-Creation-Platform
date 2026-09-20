import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// 1x1 有效 PNG，作为「用户本地图片」的替身
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const content = body.includes('中文内容视觉总监')
    // 两份文内图提示词，模拟真实配图方案
    ? '<配图方案><封面><主视觉>一盏台灯照亮书桌</主视觉><封面文案>把复杂事讲明白</封面文案><提示词>editorial illustration, warm desk lamp, clean composition, soft light, ample negative space, no text, no watermark</提示词></封面><文内配图><图><位置>开头后</位置><用途>建立阅读情绪</用途><比例>16:9</比例><提示词>minimal editorial illustration, notebook and lamp, warm light, no text</提示词><替代文本>台灯与笔记本</替代文本></图><图><位置>小标题后</位置><用途>支撑论点</用途><比例>16:9</比例><提示词>flat illustration, desk with coffee and laptop, soft daylight, no text</提示词><替代文本>桌面与电脑</替代文本></图></文内配图><发布配图><图><位置>公众号头图</位置><用途>公众号发布</用途><比例>2.35:1</比例><提示词>editorial cover, warm desk scene, no text</提示词><替代文本>温暖书桌封面</替代文本></图></发布配图></配图方案>'
    : '# ok'
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ model: 'visual-smoke', choices: [{ message: { content } }] }))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const root = await mkdtemp(join(tmpdir(), 'moliu-visual-smoke-'))
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
await writeFile(join(root, 'inline-a.png'), PNG)
await writeFile(join(root, 'inline-b.png'), PNG)
const app = await electron.launch({
  executablePath,
  args: process.env.MOLIU_EXECUTABLE ? [] : ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: root }
})

/** 点击「导入本地」并通过系统文件选择器把图片交给应用 */
async function importImage(page, slotIndex, filePath) {
  const slot = page.locator('.visual-slot').nth(slotIndex)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    slot.getByRole('button', { name: '导入本地' }).click()
  ])
  await chooser.setFiles(filePath)
  await slot.locator('.visual-asset').first().waitFor()
}

async function insertImage(page, index) {
  await page.getByRole('button', { name: '插入配图' }).click()
  await page.getByRole('option').filter({ hasText: new RegExp(`^文内图 ${index}`) }).click()
}

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))

  // 提示词三件套：无生图模型时也要能拿到封面 / 文内 / 发布提示词
  const data = await page.evaluate(async ({ port }) => {
    const provider = await window.moliu.providers.save({ displayName: 'Visual', protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'visual-smoke', enabled: true, isRelay: false, capabilities: { chat: true, jsonMode: false, streaming: false, vision: false, image: false }, models: [{ modelId: 'visual-smoke', displayName: 'Visual', reasoningVariants: [], isDefault: true, enabled: true }], apiKey: 'x' })
    const article = await window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 测试文章\n\n正文', source: 'manual' })
    const pack = await window.moliu.visuals.generate({ articleId: article.id, providerId: provider.id, model: 'visual-smoke', inlineCount: 2 })
    const saved = await window.moliu.visuals.list(article.id)
    return { articleId: article.id, cover: pack.cover.prompt, inline: pack.inlineImages.length, release: pack.releaseImages.length, saved: saved.length, version: pack.articleVersionId === article.currentVersionId }
  }, { port })
  if (!data.cover || data.inline !== 2 || data.release !== 1 || data.saved !== 1 || !data.version) throw new Error('Visual workflow failed')

  // F11 + F16：没有生图模型，也能逐张把本地图片导入到每个提示词位
  await page.getByRole('button', { name: '智能配图' }).click()
  await page.locator('.visual-slot').first().waitFor()
  if (await page.locator('.visual-slot').count() !== 4) throw new Error('配图方案位数量不正确')
  await page.getByText('尚未配置生图模型').waitFor()
  await importImage(page, 0, join(root, 'inline-a.png'))
  await importImage(page, 1, join(root, 'inline-a.png'))
  await importImage(page, 2, join(root, 'inline-b.png'))

  // F11：图片从配图页直接进正文，用户不需要手写 moliu-asset 地址
  await page.getByRole('button', { name: '文章创作' }).click()
  await page.locator('.article-list-item').filter({ hasText: '测试文章' }).click()
  await page.getByRole('button', { name: '源码编辑' }).click()
  const insertButton = page.getByRole('button', { name: '插入配图' })
  await insertButton.waitFor()
  if (!(await insertButton.isEnabled()) || !(await insertButton.innerText()).includes('2 张')) throw new Error('插入配图入口未就绪')
  await insertImage(page, 1)
  await insertImage(page, 2)
  const markdown = await page.locator('textarea[name="articleMarkdown"]').inputValue()
  const inserted = markdown.match(/moliu-asset:\/\/assets\/[^)\s]+/g) ?? []
  if (inserted.length !== 2) throw new Error(`正文中只找到 ${inserted.length} 个图片地址，期望 2 个`)
  if (!/\n\n!\[[^\]]*\]\(moliu-asset/.test(markdown)) throw new Error('配图没有另起一段，会和正文粘连')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('手动编辑已保存为新版本').waitFor()

  // 图片要能走到排版稿，并在导出时内嵌成 data URI（离线单文件可打开）
  const exported = await page.evaluate(async ({ articleId, targetDir }) => {
    const layout = await window.moliu.layouts.create({ articleId, platform: 'wechat' })
    const result = await window.moliu.app.exportArticle({ articleId, format: 'html', targetDir })
    return { images: (layout.html.match(/<img/g) ?? []).length, path: result.path }
  }, { articleId: data.articleId, targetDir: join(root, 'exports') })
  if (exported.images !== 2) throw new Error(`排版稿中只有 ${exported.images} 张图片，期望 2 张`)
  if (!exported.path) throw new Error('HTML 导出未落到目标目录')
  const html = await readFile(exported.path, 'utf8')
  const inlined = html.match(/data:image\/png;base64,/g) ?? []
  if (inlined.length !== 2) throw new Error(`导出 HTML 内嵌了 ${inlined.length} 张图片，期望 2 张`)
  console.log('Visual smoke passed: prompt pack, local import without an image model, images inserted into the body, rendered in layout, inlined as data URIs on export')
} finally {
  await app.close()
  await new Promise((done) => server.close(done))
  await rm(root, { recursive: true, force: true })
}
