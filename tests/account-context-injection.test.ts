import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { PromptRegistry } from '../src/main/gateway/prompt-registry.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import { HotspotFilter } from '../src/main/services/hotspot-filter.js'
import { TopicGenerator } from '../src/main/services/topic-generator.js'
import { FrameworkGenerator } from '../src/main/services/framework-generator.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import { createAccountFields, serializeAccountXml } from '../src/shared/domain.js'

function createFakeGateway(responder: (request: UnifiedRequest) => string): {
  gateway: ModelGateway
  requests: UnifiedRequest[]
} {
  const requests: UnifiedRequest[] = []
  const gateway = {
    chat: async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      requests.push(request)
      return {
        content: responder(request),
        providerId: request.providerId,
        model: request.model ?? 'm1',
        latencyMs: 12,
        finishReason: 'stop',
        extractionMatched: false,
        jsonModeSimulated: false
      }
    },
    chatStream: async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      requests.push(request)
      return {
        content: responder(request),
        providerId: request.providerId,
        model: request.model ?? 'm1',
        latencyMs: 12,
        finishReason: 'stop',
        extractionMatched: false,
        jsonModeSimulated: false
      }
    }
  } as unknown as ModelGateway
  return { gateway, requests }
}

describe('Batch A: account memories, redlines, and style samples context injection', () => {
  it('serializeAccountXml injects memories with limit and style samples within char budget while escaping XML', () => {
    const fields = createAccountFields({ 账号名称: '深度观察', 写作风格: '理性克制' })
    const redlines = [{
      id: 'r1', profileId: 'p1', kind: 'dont' as const,
      content: '禁止使用震惊体', createdAt: '2026-11-28T00:00:00Z'
    }]
    const memories = Array.from({ length: 12 }, (_, index) => ({
      id: `m-${index}`, profileId: 'p1', memoryDate: '2026-11-20',
      source: '发布复盘', insight: `经验 ${index + 1}`, action: index === 0 ? '保持短句开头' : '',
      createdAt: '2026-11-20T00:00:00Z'
    }))
    const samples = [
      {
        id: 's1', profileId: 'p1', title: '代表作一', tag: '开头范本',
        note: '注意短句节奏', excerpt: 'A'.repeat(200) + '</账号定位>',
        enabled: true, sortOrder: 0, createdAt: '2026-11-28T00:00:00Z', updatedAt: '2026-11-28T00:00:00Z'
      },
      {
        id: 's2', profileId: 'p1', title: '已停用样文', tag: '全文语感',
        note: '', excerpt: '不应被注入的内容',
        enabled: false, sortOrder: 1, createdAt: '2026-11-28T00:00:00Z', updatedAt: '2026-11-28T00:00:00Z'
      },
      {
        id: 's3', profileId: 'p1', title: '代表作二', tag: '论证风格',
        note: '', excerpt: 'B'.repeat(400),
        enabled: true, sortOrder: 2, createdAt: '2026-11-28T00:00:00Z', updatedAt: '2026-11-28T00:00:00Z'
      }
    ]

    const xml = serializeAccountXml(fields, redlines, {
      memories,
      samples,
      memoryLimit: 3,
      sampleCharBudget: 400
    })

    expect(xml).toContain('禁止使用震惊体')
    expect(xml).toContain('历史复盘经验')
    expect(xml).toContain('经验 1；行动建议：保持短句开头')
    expect(xml).toContain('经验 3')
    expect(xml).not.toContain('经验 4')
    expect(xml).toContain('标杆样文风格参考')
    expect(xml).toContain('仅用于学习语感、句式、段落节奏与表达习惯，严禁复用或编造样文中的事实、数据与案例')
    expect(xml).toContain('&lt;/账号定位&gt;')
    expect(xml).not.toContain('不应被注入的内容')
    expect(xml).toContain('[样文 2 · 论证风格] 代表作二')
    expect(xml).toContain('…')
  })

  it('persists account_style_samples via v5 migration, enforces 10-sample cap, and cascades on account delete', () => {
    const db = new AppDatabase(':memory:')
    try {
      const account = db.saveAccount({
        fields: createAccountFields({ 账号名称: '测试账号' }),
        wizardAnswers: [],
        status: 'locked',
        source: 'manual'
      })

      const created = db.saveAccountStyleSample({
        profileId: account.id,
        title: '爆款开头示范',
        tag: '开头范本',
        note: '先抛具体细节',
        excerpt: '去年冬天，我在杭州一家只有六个工位的工作室里，第一次见到这套流程。'
      })
      expect(created.enabled).toBe(true)
      expect(db.getAccount(account.id)?.styleSamples).toHaveLength(1)

      const updated = db.saveAccountStyleSample({
        id: created.id,
        profileId: account.id,
        title: '爆款开头示范（精修）',
        excerpt: created.excerpt,
        enabled: false
      })
      expect(updated.title).toBe('爆款开头示范（精修）')
      expect(updated.enabled).toBe(false)

      for (let index = 1; index < 10; index += 1) {
        db.saveAccountStyleSample({
          profileId: account.id,
          title: `样文 ${index + 1}`,
          excerpt: `样文内容 ${index + 1}`
        })
      }
      expect(() => db.saveAccountStyleSample({
        profileId: account.id,
        title: '超出上限',
        excerpt: '第 11 篇'
      })).toThrow('最多保存 10 篇')

      db.removeAccountStyleSample(created.id)
      expect(db.listAccountStyleSamples(account.id)).toHaveLength(9)

      db.removeAccount(account.id)
      expect(db.listAccountStyleSamples(account.id)).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('injects redlines/memories into hotspot & topic, and additionally injects enabled style samples into framework & article', async () => {
    const db = new AppDatabase(':memory:')
    try {
      db.saveProvider({
        id: 'p1',
        displayName: '测试供应商',
        protocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:9999/v1',
        defaultModel: 'm1',
        enabled: true,
        isRelay: false,
        capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false },
        models: [{ modelId: 'm1', displayName: 'm1', reasoningVariants: [], isDefault: true, enabled: true }]
      })
      const prompts = new PromptRegistry(db)
      prompts.seed()

      const account = db.saveAccount({
        fields: createAccountFields({ 账号名称: '独立观察者', 目标受众: '创作者', 写作风格: '犀利克制' }),
        wizardAnswers: [],
        status: 'locked',
        source: 'manual'
      })
      db.addAccountRedline({ profileId: account.id, kind: 'dont', content: '禁止使用营销号口吻' })
      db.addAccountMemory({ profileId: account.id, insight: '复盘发现真实数据对比完读率翻倍', action: '开篇放关键数字', source: '发布复盘' })
      db.saveAccountStyleSample({
        profileId: account.id,
        title: '我的代表作',
        tag: '全文语感',
        excerpt: '工具本身不会替你思考，它只放大你原本就有的判断力。'
      })

      const topicSchema = db.getTopicSchema()
      const validTopicPayload = Object.fromEntries(topicSchema.map((field) => [
        field.name,
        field.required ? `${field.name}测试内容` : ''
      ]))

      const { gateway, requests } = createFakeGateway((request) => {
        const system = String(request.messages[0]?.content ?? '')
        if (system.includes('热点筛选')) {
          return JSON.stringify({ results: [{ index: 1, fit: '高', reason: '契合', angle: '实操切入' }] })
        }
        if (system.includes('选题策划')) {
          return JSON.stringify(validTopicPayload)
        }
        if (system.includes('文章内容框架')) {
          return '<框架><标题>别再用形容词教 AI 写作</标题><开头>抛现象</开头><论点一>样文作用</论点一><论点二>复盘闭环</论点二><论点三>落地方法</论点三><结尾>行动建议</结尾></框架>'
        }
        return '# 别再用形容词教 AI 写作\n\n正文第一段内容，展示完整成稿结构。'
      })

      // 1. 热点筛选：含红线 + 记忆，不含样文
      const hotspotFilter = new HotspotFilter(db, gateway, prompts)
      await hotspotFilter.filter({
        accountId: account.id,
        providerId: 'p1',
        model: 'm1',
        items: [{
          id: 'h1', title: 'AI 写作工具爆发', desc: '', url: 'https://example.com',
          source: 'zhihu', sourceTitle: '知乎', subtitle: '', updateTime: '2026-11-28', rank: 1, rawJson: '{}'
        }]
      })
      const hotspotUser = String(requests.at(-1)?.messages[1]?.content ?? '')
      expect(hotspotUser).toContain('禁止使用营销号口吻')
      expect(hotspotUser).toContain('复盘发现真实数据对比完读率翻倍')
      expect(hotspotUser).not.toContain('工具本身不会替你思考')

      // 2. 选题生成：含红线 + 记忆，不含样文
      const topicGenerator = new TopicGenerator(db, gateway, prompts)
      const topicRes = await topicGenerator.generate({
        accountIds: [account.id],
        providerId: 'p1',
        model: 'm1',
        seedKeywords: ['AI 写作'],
        relatedHotFavoriteIds: [],
        count: 1
      })
      const topicUser = String(requests.at(-1)?.messages[1]?.content ?? '')
      expect(topicUser).toContain('禁止使用营销号口吻')
      expect(topicUser).toContain('复盘发现真实数据对比完读率翻倍')
      expect(topicUser).not.toContain('工具本身不会替你思考')

      // 3. 框架生成：含红线 + 记忆 + 标杆样文
      const template = db.listFrameworkTemplates()[0]!
      const frameworkGenerator = new FrameworkGenerator(db, gateway, prompts)
      const frameworkRes = await frameworkGenerator.generate({
        templateId: template.id,
        topicId: topicRes.topics[0]!.id,
        accountId: account.id,
        materialIds: [],
        providerId: 'p1',
        model: 'm1',
        count: 1,
        research: false
      })
      const frameworkUser = String(requests.at(-1)?.messages[1]?.content ?? '')
      expect(frameworkUser).toContain('禁止使用营销号口吻')
      expect(frameworkUser).toContain('复盘发现真实数据对比完读率翻倍')
      expect(frameworkUser).toContain('工具本身不会替你思考')

      // 4. 文章写作：含红线 + 记忆 + 标杆样文
      const articleGenerator = new ArticleGenerator(db, gateway, prompts)
      await articleGenerator.generate({
        frameworkId: frameworkRes.frameworks[0]!.id,
        accountId: account.id,
        materialIds: [],
        providerId: 'p1',
        model: 'm1',
        count: 1,
        polish: false
      })
      const articleUser = String(requests.at(-1)?.messages[1]?.content ?? '')
      expect(articleUser).toContain('禁止使用营销号口吻')
      expect(articleUser).toContain('复盘发现真实数据对比完读率翻倍')
      expect(articleUser).toContain('工具本身不会替你思考')
    } finally {
      db.close()
    }
  })
})
