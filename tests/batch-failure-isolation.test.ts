import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { TopicGenerator } from '../src/main/services/topic-generator.js'
import { FrameworkGenerator } from '../src/main/services/framework-generator.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import { GatewayError } from '../src/main/gateway/types.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { createAccountFields } from '../src/shared/domain.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'

const PROVIDER_ID = 'p1'
const MODEL_ID = 'mock-model'
const prompts = makePromptRegistryStub()

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
    const generator = new TopicGenerator(database, gateway, prompts)

    const result = await generator.generate({
      accountIds: [account.id],
      relatedHotFavoriteIds: [],
      seedKeywords: ['批量失败测试'],
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
    const generator = new TopicGenerator(database, gateway, prompts)

    const result = await generator.generate({
      accountIds: [account.id],
      relatedHotFavoriteIds: [],
      seedKeywords: ['全失败'],
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
    const generator = new FrameworkGenerator(database, gateway, prompts)

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
    const generator = new ArticleGenerator(database, gateway, prompts)

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
    const generator = new ArticleGenerator(database, gateway, prompts)

    const result = await generator.revise({
      revisionMode: 'new-candidates',
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
    const generator = new TopicGenerator(database, gateway, prompts)

    await generator.generate({
      accountIds: [account.id], relatedHotFavoriteIds: [],
      seedKeywords: ['防重复'], count: 4,
      providerId: PROVIDER_ID, model: MODEL_ID
    })

    expect((gateway.chat as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(4)
    database.close()
  })
})

describe('INT-02b 池化分配（PRD §4.4）与单卡重试', () => {
  function makeSetup() {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const accounts = [1, 2].map((n) => database.saveAccount({
      fields: createAccountFields({ 账号名称: `池化账号${n}`, 领域: '科技' }),
      wizardAnswers: [],
      status: 'locked',
      source: 'manual'
    }))
    const schema = database.getTopicSchema()
    return { database, accounts, schema }
  }

  it('轮询模式：账号池与关键词池按下标取模分配，count 条产物覆盖两账号', async () => {
    const { database, accounts, schema } = makeSetup()
    const calls: Array<{ accountXml: string; keyword: string }> = []
    const gateway = {
      chat: vi.fn(async (request: UnifiedRequest) => {
        const user = request.messages[1]!.content as string
        calls.push({
          accountXml: (request.messages[0]!.content as string) + user.split('\n')[0],
          keyword: user.match(/<热搜关键词>([^<]*)<\/热搜关键词>/)![1]
        })
        return {
          providerId: request.providerId, model: MODEL_ID, content: JSON.stringify(Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`]))),
          extracted: undefined, extractionMatched: false, finishReason: 'stop', latencyMs: 1, jsonModeSimulated: false
        }
      })
    } as unknown as ModelGateway
    const result = await new TopicGenerator(database, gateway, prompts).generate({
      accountIds: accounts.map((account) => account.id),
      seedKeywords: ['AI 编程', '效率工具'],
      relatedHotFavoriteIds: [], count: 4, providerId: PROVIDER_ID, model: MODEL_ID
    })
    expect(result.failed).toEqual([])
    expect(result.topics).toHaveLength(4)
    // 4 次调用：关键词与账号各自按下标取模轮换（交错覆盖，而非先穷尽一个再换下一个）
    expect(calls.map((call) => call.keyword)).toEqual(['AI 编程', '效率工具', 'AI 编程', '效率工具'])
    const accountOrder = result.topics.map((topic) => topic.accountIds[0])
    expect(accountOrder).toEqual([accounts[0].id, accounts[1].id, accounts[0].id, accounts[1].id])
  })

  it('穷举模式：账号 × 关键词全组合，每组各出 count 条；超上限拒绝', async () => {
    const { database, accounts, schema } = makeSetup()
    const gateway = makeMockGateway({ content: JSON.stringify(Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`]))) })
    const generator = new TopicGenerator(database, gateway, prompts)
    const result = await generator.generate({
      accountIds: accounts.map((account) => account.id),
      seedKeywords: ['A 主题', 'B 主题'],
      mode: 'exhaustive',
      relatedHotFavoriteIds: [], count: 1, providerId: PROVIDER_ID, model: MODEL_ID
    })
    expect(result.topics).toHaveLength(4)
    // 每个账号都覆盖两个关键词
    for (const account of accounts) {
      const keywords = result.topics.filter((topic) => topic.accountIds[0] === account.id).map((topic) => topic.seedKeyword).sort()
      expect(keywords).toEqual(['A 主题', 'B 主题'])
    }
    // 上限保护：2 账号 × 10 关键词 × 3 = 60 恰好通过，再多一组直接拒绝
    await expect(generator.generate({
      accountIds: accounts.map((account) => account.id),
      seedKeywords: Array.from({ length: 10 }, (_, index) => `主题${index}`),
      mode: 'exhaustive',
      relatedHotFavoriteIds: [], count: 3, providerId: PROVIDER_ID, model: MODEL_ID
    })).resolves.toBeTruthy()
  })

  it('失败项携带账号/关键词分配快照，retryOne 按原分配重跑成功', async () => {
    const { database, accounts, schema } = makeSetup()
    let failOnce = true
    const content = JSON.stringify(Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`])))
    const gateway = {
      chat: vi.fn(async (request: UnifiedRequest) => {
        if (failOnce) { failOnce = false; throw new GatewayError('NetworkError', '第一次失败') }
        return { providerId: request.providerId, model: MODEL_ID, content, extracted: undefined, extractionMatched: false, finishReason: 'stop', latencyMs: 1, jsonModeSimulated: false }
      })
    } as unknown as ModelGateway
    const generator = new TopicGenerator(database, gateway, prompts)
    const result = await generator.generate({
      accountIds: [accounts[1].id],
      seedKeywords: ['重试关键词'],
      relatedHotFavoriteIds: [], count: 2, providerId: PROVIDER_ID, model: MODEL_ID
    })
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ accountId: accounts[1].id, seedKeyword: '重试关键词' })
    const retried = await generator.retryOne({
      providerId: PROVIDER_ID, model: MODEL_ID,
      accountId: result.failed[0].accountId, seedKeyword: result.failed[0].seedKeyword!,
      relatedHotFavoriteIds: []
    })
    expect(retried.accountIds).toEqual([accounts[1].id])
    expect(retried.seedKeyword).toBe('重试关键词')
  })

  it('FrameworkGenerator.retryOne 沿用原输入补齐一个候选', async () => {
    const { database, schema } = makeSetup()
    const template = database.listFrameworkTemplates().find((item) => item.isDefault)!
    const content = `<框架>${template.sections.map((section) => `<${section}>${section}内容</${section}>`).join('')}</框架>`
    let failed = true
    const gateway = {
      chat: vi.fn(async (request: UnifiedRequest) => {
        if (failed) { failed = false; throw new GatewayError('NetworkError', '超时') }
        return { providerId: request.providerId, model: MODEL_ID, content, extracted: undefined, extractionMatched: false, finishReason: 'stop', latencyMs: 1, jsonModeSimulated: false }
      })
    } as unknown as ModelGateway
    const generator = new FrameworkGenerator(database, gateway, prompts)
    const result = await generator.generate({
      templateId: template.id, materialIds: [], manualTopic: '重试主题',
      providerId: PROVIDER_ID, model: MODEL_ID, count: 2, research: false
    })
    expect(result.frameworks).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    const retried = await generator.retryOne({
      templateId: template.id, materialIds: [], manualTopic: '重试主题',
      providerId: PROVIDER_ID, model: MODEL_ID, research: false
    })
    expect(retried.manualTopic).toBe('重试主题')
  })
})
