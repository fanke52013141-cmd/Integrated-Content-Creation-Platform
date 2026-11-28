import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { PromptRegistry } from '../src/main/gateway/prompt-registry.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import { parseTitlesDigestJson, TitleDigestService } from '../src/main/services/title-digest-service.js'
import { countArticleWords, estimateReadMinutes } from '../src/shared/article-checker.js'
import { createAccountFields } from '../src/shared/domain.js'

describe('Batch B: title workshop, digest generator & shared reading stats', () => {
  it('parseTitlesDigestJson parses fenced JSON, cleans titles, deduplicates, and clamps digest to 120 chars', () => {
    const raw = `\`\`\`json
{
  "titles": [
    { "text": "# 《别再用形容词教 AI 写作》", "style": "反常识", "reason": "直击痛点" },
    { "text": "别再用形容词教 AI 写作", "style": "重复项", "reason": "应去重" },
    { "text": "一套更稳的公众号人机共创流程", "style": "克制专业", "reason": "适合职场受众" }
  ],
  "digest": "${'摘要'.repeat(80)}"
}
\`\`\``
    const parsed = parseTitlesDigestJson(raw)
    expect(parsed.titles).toHaveLength(2)
    expect(parsed.titles[0]).toEqual({ text: '别再用形容词教 AI 写作', style: '反常识', reason: '直击痛点' })
    expect(parsed.digest.length).toBe(120)
    expect(() => parseTitlesDigestJson('没有 JSON 的闲聊回复')).toThrow('标题与摘要 JSON')
  })

  it('TitleDigestService uses unsaved baseMarkdown and injects account memories', async () => {
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
        capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
        models: [{ modelId: 'm1', displayName: 'm1', reasoningVariants: [], isDefault: true, enabled: true }]
      })
      const prompts = new PromptRegistry(db)
      prompts.seed()

      const account = db.saveAccount({
        fields: createAccountFields({ 账号名称: '观察号' }),
        wizardAnswers: [],
        status: 'locked',
        source: 'manual'
      })
      db.addAccountMemory({ profileId: account.id, insight: '带具体数字的标题打开率高 40%', source: '发布复盘' })
      const article = db.saveArticle({
        accountId: account.id,
        materialIds: [],
        manualOutline: '',
        status: 'draft',
        source: 'manual',
        rawMarkdown: '# 旧标题\n\n旧正文。'
      })

      const captured: UnifiedRequest[] = []
      const gateway = {
        chat: async (request: UnifiedRequest): Promise<UnifiedResponse> => {
          captured.push(request)
          return {
            content: JSON.stringify({
              titles: [{ text: '日更 3 篇不降质：我是这样用 AI 共创的', style: '数字实操', reason: '有明确数量承诺' }],
              digest: '分享一套人机协同的公众号日更工作流。'
            }),
            providerId: request.providerId,
            model: request.model ?? 'm1',
            latencyMs: 18,
            finishReason: 'stop',
            extractionMatched: false,
            jsonModeSimulated: false
          }
        }
      } as unknown as ModelGateway

      const service = new TitleDigestService(db, gateway, prompts)
      const result = await service.generate({
        articleId: article.id,
        baseMarkdown: '# 草稿新标题\n\n这是尚未保存的最新草稿内容。',
        providerId: 'p1',
        model: 'm1'
      })

      expect(result.titles).toHaveLength(1)
      expect(result.digest).toBe('分享一套人机协同的公众号日更工作流。')
      const userPrompt = String(captured[0]?.messages[1]?.content ?? '')
      expect(userPrompt).toContain('这是尚未保存的最新草稿内容。')
      expect(userPrompt).toContain('带具体数字的标题打开率高 40%')
    } finally {
      db.close()
    }
  })

  it('countArticleWords and estimateReadMinutes exclude code fences and estimate reading time', () => {
    const md = '# 标题\n\n这是一段中文正文内容。\n\n```ts\nconst ignored = 12345\n```\n\nHello world.'
    expect(countArticleWords(md)).toBe(14)
    expect(estimateReadMinutes(0)).toBe(0)
    expect(estimateReadMinutes(14)).toBe(1)
    expect(estimateReadMinutes(1600)).toBe(4)
  })
})
