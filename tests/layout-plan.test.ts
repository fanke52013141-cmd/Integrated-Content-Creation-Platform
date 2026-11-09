// AI 排版方案（轻编排）解析与落位测试：
// - 解析器：正常输出、字段缺失/半角分隔、锚点越界收敛、未知图片丢弃、重复插入点去重、extractBlock 未命中兜底
// - 落位：插入点/导读/互动语改写渲染输入 Markdown，且不改标题与代码块内容
// - 服务链路：mock 网关全链路（资产池收集、方案生成、随排版稿落库快照）
import { afterEach, describe, expect, it } from 'vitest'
import { parseLayoutPlan } from '../src/main/services/layout-plan-parser.js'
import { applyLayoutPlan, ArticleLayoutService, renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'
import { LayoutPlanService } from '../src/main/services/layout-plan-service.js'
import { AppDatabase } from '../src/main/database.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { LayoutPlan } from '../src/shared/contracts.js'

const ASSETS = [
  { fileName: 'cover-a.png', kind: 'cover' as const, alt: '封面主视觉' },
  { fileName: 'inline-b.png', kind: 'inline' as const, alt: '注意力机制信息图' },
  { fileName: 'inline-c.png', kind: 'inline' as const, alt: '金句卡片' }
]
const THEMES = [{ id: 'wechat-green' }, { id: 'tech-blue' }]
const OPTIONS = { knownAssets: ASSETS, knownThemeIds: THEMES, paragraphCount: 5 }

const SAMPLE = [
  '配图插入点：',
  '  - 图片：inline-b.png ｜ 位置：第2段之后 ｜ 说明：信息图解释注意力机制',
  '  - 图片：inline-c.png ｜ 位置：结尾之前 ｜ 说明：金句卡片',
  '推荐模板：tech-blue ｜ 理由：账号偏科技理性',
  '封面位：cover-a.png ｜ 说明：21:9 首图',
  '导读：先别急——这篇文章给你三个视角的答案。',
  '结尾互动语：评论区聊聊你的看法。'
].join('\n')

describe('parseLayoutPlan', () => {
  it('解析标准输出：插入点、推荐模板、封面位、导读与互动语', () => {
    const { plan, warnings } = parseLayoutPlan(SAMPLE, OPTIONS)
    expect(warnings).toEqual([])
    expect(plan.insertions).toEqual([
      { assetFileName: 'inline-b.png', anchor: 'after-paragraph', paragraph: 2, note: '信息图解释注意力机制', alt: '注意力机制信息图' },
      { assetFileName: 'inline-c.png', anchor: 'before-ending', note: '金句卡片', alt: '金句卡片' }
    ])
    expect(plan.recommendedThemeId).toBe('tech-blue')
    expect(plan.recommendedReason).toBe('账号偏科技理性')
    expect(plan.coverAssetFileName).toBe('cover-a.png')
    expect(plan.leadIn).toContain('三个视角')
    expect(plan.closing).toContain('评论区')
  })

  it('兼容半角分隔符、路径前缀与「沿用」模板口径', () => {
    const raw = [
      '配图插入点：- 图片：assets/images/inline-b.png | 位置：文首 | 说明：开场图',
      '沿用：wechat-green ｜ 理由：用户已选',
      '封面位：无'
    ].join('\n')
    const { plan, warnings } = parseLayoutPlan(raw, OPTIONS)
    expect(warnings).toEqual([])
    expect(plan.insertions[0]).toMatchObject({ assetFileName: 'inline-b.png', anchor: 'leading' })
    expect(plan.recommendedThemeId).toBe('wechat-green')
    expect(plan.coverAssetFileName).toBeUndefined()
  })

  it('锚点越界收敛到最后一段并告警；无法识别的位置改为文末', () => {
    const { plan, warnings } = parseLayoutPlan([
      '配图插入点：',
      '- 图片：inline-b.png ｜ 位置：第9段之后 ｜ 说明：超界',
      '- 图片：inline-c.png ｜ 位置：段落中间 ｜ 说明：乱写'
    ].join('\n'), OPTIONS)
    expect(plan.insertions[0]).toMatchObject({ anchor: 'after-paragraph', paragraph: 5 })
    expect(plan.insertions[1]).toMatchObject({ anchor: 'before-ending' })
    expect(warnings).toHaveLength(2)
  })

  it('未知图片丢弃；重复引用同一张图只保留第一处；非封面资产不能占封面位', () => {
    const { plan, warnings } = parseLayoutPlan([
      '配图插入点：',
      '- 图片：ghost.png ｜ 位置：文首 ｜ 说明：不存在',
      '- 图片：inline-b.png ｜ 位置：第1段之后 ｜ 说明：首次',
      '- 图片：inline-b.png ｜ 位置：第3段之后 ｜ 说明：重复',
      '封面位：inline-b.png ｜ 说明：正文图冒充封面'
    ].join('\n'), OPTIONS)
    expect(plan.insertions.map((item) => item.assetFileName)).toEqual(['inline-b.png'])
    expect(plan.coverAssetFileName).toBeUndefined()
    expect(warnings.some((item) => item.includes('ghost.png'))).toBe(true)
    expect(warnings.some((item) => item.includes('封面'))).toBe(true)
  })

  it('推荐主题不在可用池时撤下推荐并保留理由', () => {
    const { plan } = parseLayoutPlan('推荐模板：不存在的主题 ｜ 理由：模型幻觉', OPTIONS)
    expect(plan.recommendedThemeId).toBeUndefined()
    expect(plan.recommendedReason).toContain('不在可用主题内')
  })

  it('空文本/纯噪音输出得到空方案且不抛错（人工模式兜底）', () => {
    const { plan, warnings } = parseLayoutPlan('模型自由发挥的前言\n没有键值行', OPTIONS)
    expect(plan.insertions).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('applyLayoutPlan', () => {
  const MARKDOWN = [
    '# 标题行保留原样',
    '',
    '第一段内容。',
    '',
    '第二段内容。',
    '',
    '第三段内容。'
  ].join('\n')

  it('无方案/空方案返回原文（零回归保证）', () => {
    expect(applyLayoutPlan(MARKDOWN, undefined)).toBe(MARKDOWN)
    expect(applyLayoutPlan(MARKDOWN, { insertions: [] })).toBe(MARKDOWN)
  })

  it('按锚点插入图片、文首导读与文末互动语，标题保持第一行', () => {
    const plan: LayoutPlan = {
      insertions: [
        { assetFileName: 'inline-b.png', anchor: 'after-paragraph', paragraph: 1, note: '信息图', alt: '注意力机制信息图' },
        { assetFileName: 'inline-c.png', anchor: 'before-ending', note: '金句', alt: '金句卡片' }
      ],
      leadIn: '导读钩子',
      closing: '互动语收尾'
    }
    const result = applyLayoutPlan(MARKDOWN, plan)
    const lines = result.split('\n')
    expect(lines[0]).toBe('# 标题行保留原样')
    expect(result).toContain('> 导读钩子')
    expect(result.indexOf('> 导读钩子')).toBeLessThan(result.indexOf('第一段内容。'))
    expect(result).toContain('![注意力机制信息图](moliu-asset://assets/inline-b.png)')
    expect(result.indexOf('第一段内容。')).toBeLessThan(result.indexOf('moliu-asset://assets/inline-b.png'))
    expect(result.indexOf('moliu-asset://assets/inline-b.png')).toBeLessThan(result.indexOf('第二段内容。'))
    expect(result).toContain('![金句卡片](moliu-asset://assets/inline-c.png)')
    expect(result).toContain('互动语收尾')
    expect(result.trimEnd().endsWith('互动语收尾')).toBe(true)
  })

  it('文首插入不会把首段吞进图片/引用段落（块间空行完整）', () => {
    const result = applyLayoutPlan(MARKDOWN, {
      insertions: [{ assetFileName: 'inline-b.png', anchor: 'leading', note: '', alt: '开场图' }],
      leadIn: '导读'
    })
    // 引用块必须独立成块：导读行之后紧跟图片行、图片行之后紧跟正文首段，各自以空行分隔
    const blocks = result.split(/\n\s*\n/).map((block) => block.trim())
    expect(blocks.some((block) => block.startsWith('> 导读'))).toBe(true)
    expect(blocks.some((block) => block.startsWith('![开场图]'))).toBe(true)
    expect(blocks.some((block) => block === '第一段内容。')).toBe(true)
  })

  it('代码块内的连续空行不被触碰，围栏内容逐字保留', () => {
    const withFence = ['# T', '', '```text', 'a', '', '', 'b', '```', '', '尾段'].join('\n')
    const result = applyLayoutPlan(withFence, { insertions: [], closing: '谢谢' })
    expect(result).toContain('a\n\n\nb')
  })

  it('带方案的渲染产物包含插入图与导读（渲染管线串联）', () => {
    const plan: LayoutPlan = {
      insertions: [{ assetFileName: 'inline-b.png', anchor: 'after-paragraph', paragraph: 2, note: '', alt: '信息图' }],
      leadIn: '导读钩子',
      closing: '互动语'
    }
    const rendered = renderLayoutMarkdown(applyLayoutPlan(MARKDOWN, plan), 'wechat')
    expect(rendered.html).toContain('moliu-asset://assets/inline-b.png')
    expect(rendered.html).toContain('导读钩子')
    expect(rendered.html).toContain('互动语')
    // 标题进入元数据而非正文（公众号口径）
    expect(rendered.title).toBe('标题行保留原样')
    expect(rendered.html).not.toContain('<h1')
  })
})

describe('LayoutPlanService 全链路（mock 网关）', () => {
  const dbs: AppDatabase[] = []
  afterEach(() => { while (dbs.length) dbs.pop()!.close() })

  function setup(markdown: string) {
    const db = new AppDatabase(':memory:')
    dbs.push(db)
    const provider = db.saveProvider({ displayName: '测试', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'mock', enabled: true, isRelay: false,
      capabilities: { chat: true, streaming: false, jsonMode: false, vision: false, image: false },
      models: [{ modelId: 'mock', displayName: 'mock', reasoningVariants: [], isDefault: true, enabled: true }] }, Buffer.from('KEY'), 'mock')
    const article = db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: markdown })
    const pack = db.saveVisualPack({ kind: 'manual', articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: 'draft',
      cover: { visual: '', prompt: '封面主视觉', overlayText: '' }, inlineImages: [{ location: '第2段', purpose: '信息图', ratio: '16:9', prompt: 'p', alt: '注意力机制信息图' }], releaseImages: [], rawXml: '' })
    db.saveVisualAsset({ packId: pack.id, kind: 'cover', slot: 0, prompt: '封面', fileName: 'cover-a.png', source: 'generated' })
    db.saveVisualAsset({ packId: pack.id, kind: 'inline', slot: 0, prompt: '信息图', fileName: 'inline-b.png', source: 'generated' })
    db.saveVisualAsset({ packId: pack.id, kind: 'release', slot: 0, prompt: '发布图', fileName: 'release-c.png', source: 'generated' })
    return { db, provider, article, pack }
  }

  const gatewayResponse = (extracted: string | undefined, extractionMatched: boolean) => ({
    chat: async () => ({ providerId: 'p', model: 'mock', content: '模型自由文本', extracted, extractionMatched, latencyMs: 1, jsonModeSimulated: false })
  })

  const ARTICLE = '# 全文标题\n\n第一段。\n\n第二段讲注意力机制。\n\n第三段收尾。'

  it('收集文章资产池（排除发布图），解析方案并按用户已选主题沿用', async () => {
    const { db, provider, article } = setup(ARTICLE)
    const service = new LayoutPlanService(db, gatewayResponse([
      '配图插入点：',
      '- 图片：inline-b.png ｜ 位置：第2段之后 ｜ 说明：解释注意力机制',
      '沿用：wechat-green ｜ 理由：用户已选',
      '封面位：cover-a.png ｜ 说明：首图',
      '导读：三段看懂注意力。',
      '结尾互动语：评论区聊聊。'
    ].join('\n'), true) as unknown as ModelGateway, makePromptRegistryStub())
    const result = await service.generate({ articleId: article.id, providerId: provider.id, model: 'mock', userThemeId: 'wechat-green' })
    expect(result.extractionMatched).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.assetOptions.map((asset) => asset.fileName).sort()).toEqual(['cover-a.png', 'inline-b.png'])
    expect(result.paragraphCount).toBe(3)
    expect(result.plan.insertions[0]).toMatchObject({ assetFileName: 'inline-b.png', anchor: 'after-paragraph', paragraph: 2 })
    expect(result.plan.recommendedThemeId).toBe('wechat-green')
    expect(result.plan.coverAssetFileName).toBe('cover-a.png')
    expect(result.plan.leadIn).toBe('三段看懂注意力。')
  })

  it('extractBlock 未命中返回空方案（人工模式），不抛错', async () => {
    const { db, provider, article } = setup(ARTICLE)
    const service = new LayoutPlanService(db, gatewayResponse(undefined, false) as unknown as ModelGateway, makePromptRegistryStub())
    const result = await service.generate({ articleId: provider.id === '' ? '' : article.id, providerId: provider.id, model: 'mock' })
    expect(result.extractionMatched).toBe(false)
    expect(result.plan.insertions).toEqual([])
    expect(result.warnings[0]).toContain('人工模式')
  })

  it('方案随排版稿落库：HTML 含插图与导读，快照可复现当时的编排', () => {
    const { db, article } = setup(ARTICLE)
    const layouts = new ArticleLayoutService(db)
    const saved = layouts.create({
      articleId: article.id,
      platform: 'wechat',
      themeId: 'wechat-green',
      plan: {
        insertions: [{ assetFileName: 'inline-b.png', anchor: 'after-paragraph', paragraph: 2, note: '', alt: '信息图' }],
        leadIn: '导读钩子',
        closing: '互动语'
      }
    })
    expect(saved.html).toContain('moliu-asset://assets/inline-b.png')
    expect(saved.html).toContain('导读钩子')
    expect(saved.html).toContain('互动语')
    expect(saved.layoutConfigSnapshot?.plan?.leadIn).toBe('导读钩子')
    expect(saved.layoutConfigSnapshot?.themeId).toBe('wechat-green')
    // 文章源稿不被轻编排改写
    expect(db.getArticle(article.id)!.rawMarkdown).toBe(ARTICLE)
  })

  it('无方案的排版稿行为与现状一致（快照不含 plan 键）', () => {
    const { db, article } = setup(ARTICLE)
    const saved = new ArticleLayoutService(db).create({ articleId: article.id, platform: 'wechat', themeId: 'wechat-green' })
    expect(saved.html).not.toContain('moliu-asset')
    expect(saved.layoutConfigSnapshot?.plan).toBeUndefined()
  })
})
