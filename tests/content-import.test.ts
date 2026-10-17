import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import {
  ContentImportService,
  detectPasteFormat,
  docxToMarkdown,
  htmlToMarkdown,
  markdownTopicItems,
  parseArticleMarkdown,
  parseCsv,
  parseFrameworkMarkdown,
  parseFrameworkJson,
  parseTopicCsv,
  parseTopicJson,
  sanitizeLayoutHtml
} from '../src/main/services/content-import-service.js'

describe('content import parsers', () => {
  it('parses topic JSON into fields without dropping unknown keys', () => {
    const items = parseTopicJson(JSON.stringify({
      topics: [
        { title: '选题 A', 核心观点: '观点 A', 自定义字段: '保留' },
        { fields: { 选题主题: '选题 B', 读者价值: '价值 B' } }
      ]
    }))
    expect(items).toHaveLength(2)
    expect(items[0].fields?.['选题主题']).toBe('选题 A')
    expect(items[0].fields?.['自定义字段']).toBe('保留')
    expect(items[1].fields?.['选题主题']).toBe('选题 B')
  })

  it('parses CSV with BOM, quoted comma and header mapping', () => {
    const rows = parseCsv('\uFEFF选题主题,核心观点\r\n"选题,带逗号",观点\r\n选题 B,"多行\n观点"')
    expect(rows[0][0]).toBe('选题主题')
    const items = parseTopicCsv('\uFEFF选题主题,核心观点\n"选题,带逗号",观点\n选题 B,"多行\n观点"')
    expect(items[0].title).toBe('选题,带逗号')
    expect(items[1].fields?.['核心观点']).toContain('多行')
  })

  it('parses markdown topic lists and strips bullets/numbers', () => {
    const items = markdownTopicItems('- 选题一\n2. 选题二\n\n* 选题三')
    expect(items.map((item) => item.title)).toEqual(['选题一', '选题二', '选题三'])
  })

  it('parses framework markdown headings into sections', () => {
    const items = parseFrameworkMarkdown('# 我的框架\n\n## 开头\n第一段\n\n## 论证\n第二段')
    expect(items[0].title).toBe('我的框架')
    expect(items[0].sections?.map((section) => section.name)).toEqual(['开头', '论证'])
    expect(items[0].sections?.[1].content).toContain('第二段')
  })

  it('parses framework JSON sections and rejects empty structures', () => {
    const items = parseFrameworkJson(JSON.stringify([{ title: '框架 A', sections: [{ name: '开头', content: '内容' }] }, { title: '空框架', sections: [] }]))
    expect(items).toHaveLength(1)
    expect(items[0].sections?.[0].name).toBe('开头')
  })

  it('parses article markdown and adds a warning when no h1 exists', () => {
    const items = parseArticleMarkdown('正文没有标题')
    expect(items[0].title).toBe('未命名文章')
    expect(items[0].warnings.length).toBe(1)
  })

  it('converts HTML to markdown while removing scripts and event handlers', () => {
    const markdown = htmlToMarkdown('<h1>标题</h1><script>alert(1)</script><p onclick="x()">正文 <strong>加粗</strong></p><a href="https://example.com">链接</a>')
    expect(markdown).toContain('# 标题')
    expect(markdown).toContain('**加粗**')
    expect(markdown).toContain('[链接](https://example.com)')
    expect(markdown).not.toContain('script')
    expect(markdown).not.toContain('onclick')
  })

  it('detects obvious pasted formats', () => {
    expect(detectPasteFormat('topic', '{"topics":[]}')).toBe('json')
    expect(detectPasteFormat('topic', '标题,观点\nA,B')).toBe('csv')
    expect(detectPasteFormat('framework', '# 标题\n## 章节')).toBe('markdown')
  })
})

describe('ContentImportService commit', () => {
  function withDatabase(run: (database: AppDatabase) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-import-'))
    const database = new AppDatabase(join(dir, 'moliu.db'))
    return run(database).finally(() => { database.close(); rmSync(dir, { recursive: true, force: true }) })
  }

  it('imports topics as drafts and records the source', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      const preview = await service.preview({ kind: 'topic', content: '- 导入选题 A\n- 导入选题 B' })
      expect(preview.errors).toEqual([])
      expect(preview.items).toHaveLength(2)
      const result = await service.commit({ token: preview.token })
      expect(result.created).toHaveLength(2)
      expect(result.failed).toEqual([])
      const topics = database.listTopics()
      expect(topics).toHaveLength(2)
      expect(topics[0].status).toBe('draft')
      expect(topics[0].importSource?.tool).toBe('手动粘贴')
      expect(topics[0].versions[0].source).toBe('manual')
    })
  })

  it('imports a framework and an article without requiring account/topic/framework links', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      const frameworkPreview = await service.preview({ kind: 'framework', content: '# 导入框架\n\n## 开头\n\n正文' })
      const frameworkResult = await service.commit({ token: frameworkPreview.token })
      expect(frameworkResult.created).toHaveLength(1)
      const frameworks = database.listFrameworks()
      expect(frameworks[0].manualTopic).toBe('导入框架')
      expect(frameworks[0].sections.map((section) => section.name)).toEqual(['开头'])
      expect(frameworks[0].importSource?.format).toBe('markdown')

      const articlePreview = await service.preview({ kind: 'article', content: '# 导入文章\n\n正文内容' })
      const articleResult = await service.commit({ token: articlePreview.token })
      expect(articleResult.created).toHaveLength(1)
      const articles = database.listArticles()
      expect(articles[0].rawMarkdown).toContain('正文内容')
      expect(articles[0].frameworkId).toBeUndefined()
      expect(articles[0].importSource?.tool).toBe('手动粘贴')
    })
  })

  it('converts a real DOCX file through mammoth', async () => {
    const buffer = readFileSync(resolve('tests/fixtures/optimization.docx'))
    const result = await docxToMarkdown(buffer)
    expect(result.markdown.length).toBeGreaterThan(0)
    expect(result.markdown).toContain('Word')
  })

  it('imports an account profile and preserves unknown fields', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      const preview = await service.preview({
        kind: 'account',
        format: 'json',
        content: JSON.stringify({ 账号名称: '导入账号', 领域: '科技', 自定义字段: '保留我' })
      })
      expect(preview.errors).toEqual([])
      const result = await service.commit({ token: preview.token })
      expect(result.created).toHaveLength(1)
      const account = database.listAccounts()[0]
      expect(account.name).toBe('导入账号')
      expect(account.importSource?.tool).toBe('手动粘贴')
      const detail = database.getAccount(account.id)
      expect(detail?.fields.find((field) => field.name === '自定义字段')?.value).toBe('保留我')
    })
  })

  it('imports hot items into favorites', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      const preview = await service.preview({ kind: 'hot-item', format: 'csv', content: '标题,链接,来源,热度\n热点 A,https://example.com/a,微博,900' })
      expect(preview.items).toHaveLength(1)
      const result = await service.commit({ token: preview.token })
      expect(result.created).toHaveLength(1)
      const favorites = database.listHotFavorites()
      expect(favorites).toHaveLength(1)
      expect(favorites[0].hotItem.title).toBe('热点 A')
    })
  })

  it('imports a review report as a manual opinion', async () => {
    await withDatabase(async (database) => {
      const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 待评审\n\n正文', source: 'manual' })
      const service = new ContentImportService(database)
      const preview = await service.preview({ kind: 'review', format: 'csv', content: '位置,严重度,问题,建议\n第二段,高,事实没有出处,补充来源' })
      const result = await service.commit({ token: preview.token, associations: { articleId: article.id } })
      expect(result.created).toHaveLength(1)
      const tasks = database.listReviewTasks(article.id)
      expect(tasks).toHaveLength(1)
      expect(tasks[0].opinions[0].roleName).toBe('外部评审')
      expect(tasks[0].opinions[0].problems[0].issue).toBe('事实没有出处')
      expect(tasks[0].status).toBe('completed')
    })
  })

  it('imports a visual plan into a manual pack', async () => {
    await withDatabase(async (database) => {
      const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 配图文章\n\n正文', source: 'manual' })
      const service = new ContentImportService(database)
      const preview = await service.preview({
        kind: 'visual-plan',
        content: JSON.stringify({ cover: { visual: '封面', prompt: 'calm desk', overlayText: '' }, inlineImages: [{ location: '开头', purpose: '说明', ratio: '4:3', prompt: 'notes', alt: '' }], releaseImages: [] })
      })
      const result = await service.commit({ token: preview.token, associations: { articleId: article.id } })
      expect(result.created).toHaveLength(1)
      const packs = database.listVisualPacks(article.id)
      expect(packs).toHaveLength(1)
      expect(packs[0].inlineImages).toHaveLength(1)
    })
  })

  it('imports publish metadata into the article publish form', async () => {
    await withDatabase(async (database) => {
      const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 发布文章\n\n正文', source: 'manual' })
      const layout = database.saveArticleLayout({
        articleId: article.id,
        articleVersionId: article.currentVersionId,
        articleStatusSnapshot: 'draft',
        platform: 'wechat',
        title: '发布文章',
        html: '<p>正文</p>',
        plainText: '正文',
        themeId: 'wechat-green'
      })
      const service = new ContentImportService(database)
      const preview = await service.preview({ kind: 'publish-form', content: JSON.stringify({ author: '张三', digest: '摘要', contentSourceUrl: 'https://example.com/a' }) })
      const result = await service.commit({ token: preview.token, associations: { articleId: article.id, layoutId: layout.id } })
      expect(result.created).toHaveLength(1)
      const form = database.workflow.getForm(article.id)
      expect(form?.author).toBe('张三')
      expect(form?.digest).toBe('摘要')
    })
  })

  it('sanitizes and imports an external layout HTML', async () => {
    await withDatabase(async (database) => {
      const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 排版文章\n\n正文', source: 'manual' })
      const service = new ContentImportService(database)
      const preview = await service.preview({
        kind: 'layout',
        format: 'html',
        content: '<title>外部排版</title><h1>标题</h1><p onclick="alert(1)" style="color:red">正文</p><script>alert(1)</script><style>body{display:none}</style>'
      })
      expect(preview.items[0].layout?.title).toBe('外部排版')
      expect(preview.items[0].layout?.html).not.toContain('<script')
      expect(preview.items[0].layout?.html).not.toContain('onclick')
      expect(preview.items[0].layout?.html).not.toContain('<style')
      expect(preview.items[0].layout?.html).toContain('style="color:red"')
      const result = await service.commit({ token: preview.token, associations: { articleId: article.id } })
      expect(result.created).toHaveLength(1)
      const layouts = database.listArticleLayouts(article.id)
      expect(layouts[0].title).toBe('外部排版')
      expect(layouts[0].importSource?.format).toBe('html')
    })
  })

  it('removes dangerous attributes from layout HTML', () => {
    const html = sanitizeLayoutHtml('<a href="javascript:alert(1)" onmouseover="x">ok</a><iframe src="x"></iframe>')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('ok')
  })

  it('imports prompt JSON and refuses an unknown prompt key', async () => {
    await withDatabase(async (database) => {
      database.seedPrompts([{ key: 'test.prompt', title: '测试提示词', description: '测试', template: '旧内容' }])
      const def = database.listPromptDefs()[0]
      const service = new ContentImportService(database)
      const preview = await service.preview({ kind: 'prompt', content: JSON.stringify({ prompts: [{ key: def.key, content: '新的提示词内容', note: '测试导入' }] }) })
      await service.commit({ token: preview.token })
      expect(database.getPromptActiveContent(def.key)).toBe('新的提示词内容')
      const unknown = await service.preview({ kind: 'prompt', content: JSON.stringify({ prompts: [{ key: 'not.exists', content: 'x' }] }) })
      const unknownResult = await service.commit({ token: unknown.token })
      expect(unknownResult.created).toHaveLength(0)
      expect(unknownResult.failed[0]?.message).toContain('不存在')
    })
  })

  it('detects the same external source and can update it as a new version', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      const content = JSON.stringify({ topics: [{ title: '冲突选题' }] })
      const first = await service.preview({ kind: 'topic', content })
      const firstResult = await service.commit({ token: first.token })
      const firstId = firstResult.created[0].id
      const second = await service.preview({ kind: 'topic', content })
      expect(second.items[0].existing?.artifactId).toBe(firstId)
      const secondResult = await service.commit({ token: second.token, mode: 'new-version' })
      expect(secondResult.created[0].id).toBe(firstId)
      expect(database.getTopic(firstId)?.versionCount).toBe(2)
      expect(database.listTopics()).toHaveLength(1)
    })
  })

  it('applies a source-to-target field mapping before saving', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      const preview = await service.preview({ kind: 'topic', content: JSON.stringify({ topics: [{ 主题: '映射选题', 观点: '映射观点', 丢弃: '不要' }] }) })
      const result = await service.commit({
        token: preview.token,
        mapping: { 主题: '选题主题', 观点: '核心观点', 丢弃: '不导入' }
      })
      const topic = database.getTopic(result.created[0].id)
      expect(topic?.fields['选题主题']).toBe('映射选题')
      expect(topic?.fields['核心观点']).toBe('映射观点')
      expect(topic?.fields['丢弃']).toBeUndefined()
    })
  })

  it('rejects a file path that was not picked through the main-process dialog', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      await expect(service.preview({ kind: 'article', filePath: resolve('tests/fixtures/optimization.docx') }))
        .rejects.toThrow('请先通过「选择文件」按钮选择文件')
    })
  })

  it('rejects an expired/unknown preview token', async () => {
    await withDatabase(async (database) => {
      const service = new ContentImportService(database)
      await expect(service.commit({ token: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow('预览已过期')
    })
  })
})
