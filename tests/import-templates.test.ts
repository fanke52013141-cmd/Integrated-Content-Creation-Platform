import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import { ContentImportService } from '../src/main/services/content-import-service.js'
import { VisualAssetService } from '../src/main/services/visual-asset-service.js'
import { ArticleLayoutService } from '../src/main/services/article-layout-service.js'
import { importTemplateDefinition } from '../src/main/services/import-templates.js'
import { parseCsv } from '../src/main/services/content-import-service.js'
import type { ContentImportKind } from '../src/shared/contracts.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() } }))

function setup(): { database: AppDatabase; service: ContentImportService; dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'moliu-import-template-'))
  const database = new AppDatabase(join(dir, 'moliu.db'))
  const service = new ContentImportService(database, new VisualAssetService(database, {} as never, join(dir, 'images')))
  return { database, service, dir, cleanup: () => { database.close(); rmSync(dir, { recursive: true, force: true }) } }
}

describe('标准导入模板', () => {
  it.each<ContentImportKind>(['account', 'hot-item', 'topic', 'framework', 'article', 'review', 'visual-plan', 'layout', 'publish-form', 'prompt'])('%s 提供可下载、带示例的标准模板', (kind) => {
    const template = importTemplateDefinition(kind)
    expect(template.fileName).toMatch(/标准导入/)
    expect(template.content.length).toBeGreaterThan(80)
    expect(template.note.length).toBeGreaterThan(10)
    if (template.fileName.endsWith('.csv')) expect(parseCsv(template.content).length).toBeGreaterThan(1)
  })

  it('下载按钮对应的服务会写出带表头和示例的标准表格', async () => {
    const { service, dir, cleanup } = setup()
    try {
      const { dialog } = await import('electron')
      const output = join(dir, '账号设定-标准导入表.csv')
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: output } as never)
      const result = await service.downloadTemplate('account')
      expect(result.path).toBe(output)
      const rows = parseCsv(readFileSync(output, 'utf8'))
      expect(rows[0]).toEqual(['字段名称', '字段内容'])
      expect(rows.some(row => row[0] === '账号名称')).toBe(true)
    } finally { cleanup() }
  })

  it('账号、框架、文章可使用 CSV 从外部进入，文章可直接生成排版', async () => {
    const { database, service, cleanup } = setup()
    try {
      const account = await service.preview({
        kind: 'account', format: 'csv',
        content: '字段名称,字段内容\n账号名称,表格账号\n目标受众,内容团队\n写作风格,简洁克制'
      })
      const accountResult = await service.commit({ token: account.token })
      expect(accountResult.failed).toEqual([])
      expect(database.listAccounts()[0].name).toBe('表格账号')

      const framework = await service.preview({
        kind: 'framework', format: 'csv',
        content: '框架主题,章节名称,章节内容\n外部框架,开头,先交代背景\n外部框架,论证,展开证据\n外部框架,结尾,给出行动'
      })
      const frameworkResult = await service.commit({ token: framework.token })
      expect(frameworkResult.failed).toEqual([])
      expect(database.listFrameworks()[0].sections.map(section => section.name)).toEqual(['开头', '论证', '结尾'])

      const article = await service.preview({
        kind: 'article', format: 'csv',
        content: '标题,正文\n外部文章,"# 外部文章\n\n## 小节\n\n- 第一条\n- 第二条\n\n带**加粗**的正文。"'
      })
      const articleResult = await service.commit({ token: article.token })
      expect(articleResult.failed).toEqual([])
      const saved = database.getArticle(articleResult.created[0].id)!
      expect(saved.rawMarkdown).toContain('## 小节')
      const layout = new ArticleLayoutService(database).create({ articleId: saved.id, platform: 'wechat' })
      expect(layout.html).toContain('第一条')
      expect(layout.html).toContain('<strong')
    } finally { cleanup() }
  })

  it('图片 CSV 将本地图片导入配图资产，随后可进入排版', async () => {
    const { database, service, dir, cleanup } = setup()
    try {
      const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 外部图片排版\n\n正文。' })
      mkdirSync(join(dir, 'images'), { recursive: true })
      writeFileSync(join(dir, 'images', 'cover.png'), PNG)
      const csvPath = join(dir, '图片.csv')
      writeFileSync(csvPath, '图片类型,图片路径或网址,位置,用途,比例,提示词,替代文本,封面文案\n封面,images/cover.png,,公众号封面,21:9,外部封面,封面图,测试封面\n文内图,images/cover.png,正文。,正文配图,16:9,外部插图,正文图,', 'utf8')
      // 文件选择由主进程负责；此处模拟已经通过系统文件框选中的 CSV。
      const picked = service as unknown as { pickedFiles: Set<string> }
      picked.pickedFiles.add(csvPath)
      const preview = await service.preview({ kind: 'visual-plan', filePath: csvPath })
      expect(preview.errors).toEqual([])
      expect(preview.items[0].visualAssetCount).toBe(2)
      const result = await service.commit({ token: preview.token, associations: { articleId: article.id } })
      expect(result.failed).toEqual([])
      const assets = database.listVisualAssets(result.created[0].id)
      expect(assets.map(asset => asset.kind).sort()).toEqual(['cover', 'inline'])
      expect(assets.every(asset => existsSync(join(dir, 'images', asset.fileName)))).toBe(true)

      const markdown = `${article.rawMarkdown}\n\n![正文图](moliu-asset://assets/${assets.find(asset => asset.kind === 'inline')!.fileName})`
      const updated = database.saveArticle({ id: article.id, materialIds: [], manualOutline: '', status: 'locked', source: 'manual', rawMarkdown: markdown })
      const layout = new ArticleLayoutService(database).create({ articleId: updated.id, platform: 'wechat' })
      expect(layout.html).toContain('<img')
      expect(layout.html).toContain(assets.find(asset => asset.kind === 'inline')!.fileName)
    } finally { cleanup() }
  })

  it('本地图片只允许读取 CSV 同目录及子目录，不允许绝对路径或目录逃逸', async () => {
    const { database, service, dir, cleanup } = setup()
    try {
      const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 路径安全\n\n正文' })
      const csvPath = join(dir, '图片.csv')
      writeFileSync(csvPath, '图片类型,图片路径或网址\n封面,../outside.png', 'utf8')
      const picked = service as unknown as { pickedFiles: Set<string> }
      picked.pickedFiles.add(csvPath)
      const preview = await service.preview({ kind: 'visual-plan', filePath: csvPath })
      expect(preview.errors.join('；')).toContain('同目录或子目录')
      expect(database.listVisualPacks(article.id)).toHaveLength(0)
    } finally { cleanup() }
  })
})
