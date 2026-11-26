import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-layout-bench-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate(async () => {
    const article = await window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'locked', source: 'manual', rawMarkdown: '# 性能测试\n\n这是正文。\n\n## 标题\n\n- 一\n- 二' })
    const t0 = performance.now()
    const preview = await window.moliu.layouts.renderPreview({ articleId: article.id, markdown: article.rawMarkdown, platform: 'wechat', themeId: 'editorial' })
    const t1 = performance.now()
    const layout = await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat', themeId: 'editorial' })
    const t2 = performance.now()
    return { previewMs: Math.round(t1 - t0), createMs: Math.round(t2 - t1), htmlLength: layout.html.length }
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-layout-bench-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
