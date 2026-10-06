import { expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'

function setup(finishReason = 'stop', failSecond = false) {
  const db = new AppDatabase(':memory:')
  db.saveProvider({ id: 'audit-provider', displayName: 'Audit mock', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:9999/v1', defaultModel: 'mock', enabled: true, isRelay: false, capabilities: { chat: true, jsonMode: false, streaming: false, vision: false, image: false }, models: [{ modelId: 'mock', displayName: 'mock', enabled: true, isDefault: true, reasoningVariants: [] }] })
  const gateway = { chat: async (request: { messages: Array<{ content: string }> }) => ({ providerId: 'audit-provider', model: 'mock', content: failSecond && request.messages.some(item => item.content.includes('第 2 个独立改稿候选')) ? '缺少标题的失败候选' : '# 候选\n\n尚未写完的正文', finishReason, latencyMs: 1 }) } as unknown as ModelGateway
  const generator = new ArticleGenerator(db, gateway, makePromptRegistryStub())
  const article = db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 原文章\n\n只有正文包含特定检索词' })
  return { db, generator, article }
}

it('retrying one failed candidate preserves the original article', async () => {
  const { db, generator, article } = setup('stop', true)
  try {
    const input = { articleId: article.id, revisionMode: 'new-candidates' as const, instruction: '润色', alignFramework: false, providerId: 'audit-provider', model: 'mock', count: 3, expectedVersionId: article.currentVersionId, draftRevision: 0 }
    const batch = await generator.revise(input)
    expect(batch.articles).toHaveLength(2)
    expect(batch.failed).toHaveLength(1)
    expect(batch.articles.every(item => item.id !== article.id)).toBe(true)
    // Same request transformation used by retryFailed when one candidate failed.
    const retry = await generator.retry(batch.requestId!)
    expect(retry.failed).toEqual([{ index: 2, message: expect.any(String) }])
    expect(generator.listRequests()[0].results[1].status).toBe('failed')
    expect(db.getArticle(article.id)?.versionCount).toBe(1)
  } finally { db.close() }
})

it('searches the body with matching summary totals', () => {
  const { db } = setup()
  try {
    const result = db.workflow.listSummaries({ search: '特定检索词' })
    expect(result.total).toBe(1)
    expect(result.items.filter(item => item.title.includes('特定检索词'))).toHaveLength(0)
  } finally { db.close() }
})

it('preserves a token-truncated response without promoting it to an article', async () => {
  const { db, generator } = setup('length')
  try {
    const result = await generator.generate({ manualOutline: '测试主题', materialIds: [], providerId: 'audit-provider', model: 'mock', count: 1 })
    expect(result.failed).toHaveLength(1)
    expect(result.articles).toHaveLength(0)
    expect(generator.listRequests()[0].results[0]).toMatchObject({ completion: 'truncated', content: '# 候选\n\n尚未写完的正文' })
  } finally { db.close() }
})
