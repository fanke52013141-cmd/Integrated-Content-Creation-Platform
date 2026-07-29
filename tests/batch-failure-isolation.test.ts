import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { TopicGenerator } from '../src/main/services/topic-generator.js'
import { FrameworkGenerator } from '../src/main/services/framework-generator.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import { GatewayError } from '../src/main/gateway/types.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { createAccountFields } from '../src/shared/domain.js'

const PROVIDER_ID = 'p1'
const MODEL_ID = 'mock-model'

// 在 DB 中创建一个真实 provider，避免 topic_versions/framework_versions/article_versions 的 provider_id FK 失败。
function ensureProvider(database: AppDatabase): void {
  database.saveProvider({
    id: PROVIDER_ID,
    displayName: '批量测试供应商',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    defaultModel: MODEL_ID,
    enabled: true,
    isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: MODEL_ID, displayName: MODEL_ID, reasoningVariants: [], isDefault: true, enabled: true }]
  })
}

// 构造一个 mock gateway：第 failOnAttempt 次调用抛错，其余返回成功响应。
function makeMockGateway(options: {
  content: string
  failOnAttempt?: number
  failWith?: Error
}): ModelGateway {
  let attempts = 0
  return {
    chat: vi.fn(async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      attempts += 1
      if (options.failOnAttempt !== undefined && attempts === options.failOnAttempt) {
        throw options.failWith ?? new GatewayError('NetworkError', '模拟第 ' + attempts + ' 次失败')
      }
      return {
        providerId: request.providerId,
        model: request.model ?? MODEL_ID,
        content: options.content,
        extracted: undefined,
        extractionMatched: false,
        finishReason: 'stop',
        promptTokens: 10,
        completionTokens: 20,
        latencyMs: 5,
        jsonModeSimulated: false
      }
    })
  } as unknown as ModelGateway
}

describe('INT-02 批量失败隔离 - 单个失败不阻塞其余', () => {
  it('TopicGenerator: count=3 时第 2 次失败，返回 2 个选题 + 1 个 failed 项', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '批量测试号', 领域: '科技' }),
      wizardAnswers: [],
      status: 'locked',
      source: 'manual'
    })
    const schema = database.getTopicSchema()
    const gateway = makeMockGateway({
      content: JSON.stringify(Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`]))),
      failOnAttempt: 2
    })
    const generator = new TopicGenerator(database, gateway)

    const result = await generator.generate({
      accountId: account.id,
      relatedHotFavoriteIds: [],
      seedKeyword: '批量失败测试',
      count: 3,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })

    expect(result.topics).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].index).toBeGreaterThanOrEqual(1)
    expect(result.failed[0].message).toMatch(/失败|模拟/)
    // 成功的选题都落库了
    for (const topic of result.topics) {
      expect(database.getTopic(topic.id)).not.toBeNull()
    }
    database.close()
  })

  it('TopicGenerator: 全部失败时返回空 topics + 3 个 failed', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '全失败号' }),
      wizardAnswers: [],
      status: 'locked',
      source: 'manual'
    })
    const gateway = makeMockGateway({ content: '{}', failWith: new GatewayError('TimeoutError', '全部超时') })
    // 让所有调用都失败
    ;(gateway as unknown as { chat: { mockImplementation: (fn: (...args: unknown[]) => unknown) => void } })
      .chat.mockImplementation(async () => { throw new GatewayError('TimeoutError', '全部超时') })
    const generator = new TopicGenerator(database, gateway)

    const result = await generator.generate({
      accountId: account.id,
      relatedHotFavoriteIds: [],
      seedKeyword: '全失败',
      count: 3,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })

    expect(result.topics).toHaveLength(0)
    expect(result.failed).toHaveLength(3)
    expect(result.failed.every((f) => f.message.includes('超时'))).toBe(true)
    database.close()
  })

  it('FrameworkGenerator: count=3 时第 2 次失败，返回 2 个框架 + 1 个 failed', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const template = database.listFrameworkTemplates()[0]
    const gateway = makeMockGateway({
      content: '<框架><标题>标题</标题><开头>开头</开头><论点一>论点一</论点一><论点二>论点二</论点二><论点三>论点三</论点三><结尾>结尾</结尾></框架>',
      failOnAttempt: 2
    })
    const generator = new FrameworkGenerator(database, gateway)

    const result = await generator.generate({
      templateId: template.id,
      topicId: undefined,
      accountId: undefined,
      materialIds: [],
      manualTopic: '批量失败框架',
      count: 3,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })

    expect(result.frameworks).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
    for (const framework of result.frameworks) {
      expect(database.getFramework(framework.id)).not.toBeNull()
    }
    database.close()
  })

  it('ArticleGenerator: count=3 时第 2 次失败，返回 2 个成稿 + 1 个 failed', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const gateway = makeMockGateway({
      content: '# 独立成稿\n\n正文内容，符合 Markdown 规范。',
      failOnAttempt: 2
    })
    const generator = new ArticleGenerator(database, gateway)

    const result = await generator.generate({
      frameworkId: undefined,
      accountId: undefined,
      materialIds: [],
      manualOutline: '标题：批量失败成稿\n开头：切入\n结尾：收束',
      count: 3,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })

    expect(result.articles).toHaveLength(2)
    expect(result.failed).toHaveLength(1)
    for (const article of result.articles) {
      expect(database.getArticle(article.id)).not.toBeNull()
    }
    database.close()
  })

  it('ArticleGenerator.revise: count=2 时第 1 次失败，返回 1 个成稿 + 1 个 failed', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    // 先创建一个成稿用于改稿
    const article = database.saveArticle({
      frameworkId: undefined, accountId: undefined, materialIds: [],
      manualOutline: '原稿大纲', status: 'locked',
      rawMarkdown: '# 原稿标题\n\n原稿内容。',
      source: 'manual'
    })
    const gateway = makeMockGateway({
      content: '# 改稿后标题\n\n改稿后内容。',
      failOnAttempt: 1
    })
    const generator = new ArticleGenerator(database, gateway)

    const result = await generator.revise({
      articleId: article.id,
      instruction: '把开头改得更犀利',
      alignFramework: false,
      count: 2,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })

    expect(result.articles).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    // count>1 时每个成功项是新成稿（非覆盖原稿）
    expect(result.articles[0].id).not.toBe(article.id)
    database.close()
  })
})

describe('INT-02 防重复 - 生成中重复调用不产生副作用', () => {
  it('TopicGenerator: 并发调用 gateway.chat 的次数等于 count（无重试无重复）', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '防重复号' }),
      wizardAnswers: [], status: 'locked', source: 'manual'
    })
    const schema = database.getTopicSchema()
    const gateway = makeMockGateway({
      content: JSON.stringify(Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`])))
    })
    const generator = new TopicGenerator(database, gateway)

    await generator.generate({
      accountId: account.id, relatedHotFavoriteIds: [],
      seedKeyword: '防重复', count: 4,
      providerId: PROVIDER_ID, model: MODEL_ID
    })

    expect((gateway.chat as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(4)
    database.close()
  })
})
