import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { PromptRegistry } from '../src/main/gateway/prompt-registry.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import { ArticleGenerator, normalizeSelectionOutput } from '../src/main/services/article-generator.js'
import { createAccountFields } from '../src/shared/domain.js'

describe('Batch B: selection AI rewrite', () => {
  it('normalizeSelectionOutput extracts tagged or fenced content and rejects empty text', () => {
    expect(normalizeSelectionOutput('<改写结果>\n这是更克制的表达。\n</改写结果>')).toBe('这是更克制的表达。')
    expect(normalizeSelectionOutput('```markdown\n短句收尾。\n```')).toBe('短句收尾。')
    expect(() => normalizeSelectionOutput('<改写结果>   </改写结果>')).toThrow('有效改写片段')
  })

  it('reviseSelection sends bounded before/after context & account samples without mutating saved article versions', async () => {
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
        fields: createAccountFields({ 账号名称: '深度主笔', 写作风格: '短句克制' }),
        wizardAnswers: [],
        status: 'locked',
        source: 'manual'
      })
      db.saveAccountStyleSample({
        profileId: account.id,
        title: '语感样本',
        excerpt: '好文章不靠形容词堆砌，靠具体动作撑起来。'
      })

      const markdown = '# 测试标题\n\n## 第一节\n\n这是上文铺垫段落。\n\n总而言之，赋能业务抓手非常重要。\n\n这是下文收尾段落。'
      const article = db.saveArticle({
        accountId: account.id,
        materialIds: [],
        manualOutline: '',
        status: 'draft',
        source: 'manual',
        rawMarkdown: markdown
      })
      const targetSnippet = '总而言之，赋能业务抓手非常重要。'
      const selectionStart = markdown.indexOf(targetSnippet)
      const selectionEnd = selectionStart + targetSnippet.length

      const captured: UnifiedRequest[] = []
      const gateway = {
        chat: async (request: UnifiedRequest): Promise<UnifiedResponse> => {
          captured.push(request)
          return {
            content: '<改写结果>直接把流程跑顺，比喊口号管用得多。</改写结果>',
            extracted: '直接把流程跑顺，比喊口号管用得多。',
            extractionMatched: true,
            providerId: request.providerId,
            model: request.model ?? 'm1',
            latencyMs: 25,
            finishReason: 'stop',
            jsonModeSimulated: false
          }
        }
      } as unknown as ModelGateway

      const generator = new ArticleGenerator(db, gateway, prompts)
      const result = await generator.reviseSelection({
        articleId: article.id,
        baseMarkdown: markdown,
        selectionStart,
        selectionEnd,
        instruction: '去掉套话，改得更像真人说话',
        providerId: 'p1',
        model: 'm1'
      })

      expect(result.originalText).toBe(targetSnippet)
      expect(result.revisedText).toBe('直接把流程跑顺，比喊口号管用得多。')
      // 局部改写不直接创建新版本，交由前端 Diff 确认后再替换草稿
      expect(db.getArticle(article.id)?.versionCount).toBe(1)

      const userPrompt = String(captured[0]?.messages[1]?.content ?? '')
      expect(userPrompt).toContain('<上文语境>')
      expect(userPrompt).toContain('这是上文铺垫段落。')
      expect(userPrompt).toContain(`<待改写片段>\n${targetSnippet}\n</待改写片段>`)
      expect(userPrompt).toContain('<下文语境>')
      expect(userPrompt).toContain('这是下文收尾段落。')
      expect(userPrompt).toContain('好文章不靠形容词堆砌')
    } finally {
      db.close()
    }
  })
})
