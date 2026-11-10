import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'
import { parseRolesImportPayload } from '../src/main/services/review-service.js'

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

describe('评审角色集导出导入（PRD §5.1）', () => {
  it('导入包解析：同名加后缀并排保留，模型绑定只留本机存在的供应商', () => {
    const payload = {
      format: 'moliu-review-roles',
      roles: [
        { name: '事实核查员', systemPrompt: '核查事实', providerId: 'exists-1', model: 'm1', extractionTag: '评审意见', extractionOccurrence: 'first', dimensions: ['事实'], sortOrder: 0 },
        { name: '事实核查员', systemPrompt: '同名角色' },
        { name: '标题党猎人', systemPrompt: '抓标题党', providerId: 'missing-9', model: 'ghost-model' },
        { name: '', systemPrompt: '缺名称应跳过' },
        { junk: true }
      ]
    }
    const result = parseRolesImportPayload(payload, ['exists-1'], ['事实核查员'])
    expect(result.imported).toBe(3)
    expect(result.renamed).toBe(2)
    expect(result.saves[0]).toMatchObject({ name: '事实核查员（导入）', providerId: 'exists-1', model: 'm1', extractionOccurrence: 'first' })
    // 包内第二个同名导入追加序号，绝不产出两个一模一样的名字
    expect(result.saves[1]).toMatchObject({ name: '事实核查员（导入2）', providerId: undefined, model: undefined })
    expect(result.saves[2]).toMatchObject({ name: '标题党猎人', providerId: undefined, model: undefined, extractionTag: '评审意见', extractionOccurrence: 'last' })
  })

  it('非角色集文件与空角色列表都拒绝', () => {
    expect(() => parseRolesImportPayload({ format: 'other' }, [], [])).toThrow('格式标记')
    expect(() => parseRolesImportPayload({ format: 'moliu-review-roles', roles: [] }, [], [])).toThrow('没有可导入')
  })

  it('导出再导入闭环：字段完整往返，同名全部加「（导入）」后缀并排保留', async () => {
    const { db } = setup()
    db.saveReviewRole({ name: '逻辑审', systemPrompt: '查逻辑漏洞', extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: ['逻辑'], sortOrder: 100 })
    db.saveReviewRole({ name: '共情审', systemPrompt: '查读者共鸣', extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: [], sortOrder: 101 })
    // 模拟导出内容（exportRoles 的 payload 结构）；库里另有 3 个冷启动默认角色
    const exported = {
      format: 'moliu-review-roles', schemaVersion: 1, exportedAt: new Date().toISOString(),
      roles: db.listReviewRoles().map((role) => ({ name: role.name, systemPrompt: role.systemPrompt, providerId: role.providerId, model: role.model, extractionTag: role.extractionTag, extractionOccurrence: role.extractionOccurrence, dimensions: role.dimensions, sortOrder: role.sortOrder }))
    }
    const result = parseRolesImportPayload(exported, [], db.listReviewRoles().map((role) => role.name))
    expect(result.imported).toBe(5)
    expect(result.renamed).toBe(5)
    expect(result.saves.map((save) => save.name)).toContain('逻辑审（导入）')
    expect(result.saves.map((save) => save.name)).toContain('共情审（导入）')
    // 模型绑定指向不存在供应商时被剥离
    expect(result.saves.every((save) => save.providerId === undefined)).toBe(true)
  })
})
