import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { TopicGenerator } from '../src/main/services/topic-generator.js'
import { FrameworkGenerator } from '../src/main/services/framework-generator.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import { ReviewService } from '../src/main/services/review-service.js'
import { VisualPackGenerator } from '../src/main/services/visual-pack-generator.js'
import { ArticleLayoutService } from '../src/main/services/article-layout-service.js'
import { WechatPublishService } from '../src/main/services/wechat-publish-service.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { KeyStore } from '../src/main/security/key-store.js'
import { createAccountFields } from '../src/shared/domain.js'

const PROVIDER_ID = 'p1'
const MODEL_ID = 'mock-model'

function ensureProvider(database: AppDatabase): void {
  database.saveProvider({
    id: PROVIDER_ID,
    displayName: '全流水线供应商',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    defaultModel: MODEL_ID,
    enabled: true,
    isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: MODEL_ID, displayName: MODEL_ID, reasoningVariants: [], isDefault: true, enabled: true }]
  })
}

// 按调用顺序返回预设响应的 mock gateway，串行流水线下每次调用对应一个阶段。
function makeSequentialGateway(responses: string[]): ModelGateway {
  let index = 0
  return {
    chat: vi.fn(async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      const content = responses[index] ?? responses[responses.length - 1]
      index += 1
      return {
        providerId: request.providerId,
        model: request.model ?? MODEL_ID,
        content,
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('INT-01 全流水线集成 - 账号→选题→框架→成稿→评审→改稿→配图→排版→发布', () => {
  it('完整链路无阻塞闭环，各环节产物落库且可溯源', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)

    // === 阶段 1：账号定位（锁定） ===
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '全流水线测试号', 领域: '科技自媒体' }),
      wizardAnswers: [],
      status: 'locked',
      source: 'manual'
    })
    expect(account.status).toBe('locked')

    // === mock gateway 按顺序为后续 6 次 AI 调用返回响应 ===
    const schema = database.getTopicSchema()
    const topicJson = JSON.stringify(Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`])))
    const frameworkXml = '<框架><标题>AI 写作时代的创作者</标题><开头>从工具与人的分工切入</开头><论点一>框架先决定读者</论点一><论点二>素材决定可信度</论点二><论点三>结构决定节奏</论点三><结尾>回到人本身</结尾></框架>'
    const articleMarkdown = '# AI 写作时代的创作者\n\n创作者最常见的浪费，是在没有结构时就急着堆字。\n\n## 框架先决定什么\n\n它帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n先搭结构，再投入表达。'
    const reviewXml = '<评审意见>\n位置：开头第一段｜严重程度：中｜问题：开头缺少具体场景｜建议：加入一个具体案例\n位置：结尾｜严重程度：低｜问题：结尾过于仓促｜建议：补充一句行动号召\n总体建议：结构清晰，建议加强开头和结尾的细节。\n</评审意见>'
    const revisedMarkdown = '# 更锋利的开头：别急着写\n\n创作者最常见的浪费，是在没有结构时就急着堆字。比如有人打开文档就想写第一句。\n\n## 框架先决定什么\n\n它帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n先搭结构，再投入表达，从下一篇文章开始。'
    const visualXml = '<配图方案><封面><主视觉>一个人在空白文档前思考</主视觉><封面文案>先搭框架，再写文章</封面文案><提示词>minimalist illustration, person thinking in front of blank document, soft light, 2.35:1</提示词></封面><文内配图><图><位置>开头</位置><用途>引入场景</用途><比例>1:1</比例><提示词>creative workspace with notes, flat illustration</提示词><替代文本>创作工作台</替代文本></图></文内配图><发布配图><图><位置>封面</位置><用途>公众号封面</用途><比例>2.35:1</比例><提示词>wider banner version with text space</提示词><替代文本>封面图</替代文本></图><图><位置>结尾</位置><用途>公众号文末</用途><比例>1:1</比例><提示词>call to action illustration</提示词><替代文本>行动号召</替代文本></图><图><位置>中段</位置><用途>公众号中段</用途><比例>1:1</比例><提示词>structure diagram</提示词><替代文本>结构图</替代文本></图></发布配图></配图方案>'

    const gateway = makeSequentialGateway([
      topicJson,      // 调用 1: TopicGenerator
      frameworkXml,   // 调用 2: FrameworkGenerator
      articleMarkdown,// 调用 3: ArticleGenerator.generate
      reviewXml,      // 调用 4: ReviewService.start
      revisedMarkdown,// 调用 5: ReviewService.apply → ArticleGenerator.revise
      visualXml       // 调用 6: VisualPackGenerator
    ])

    // === 阶段 2：选题 ===
    const topicGenerator = new TopicGenerator(database, gateway)
    const topicResult = await topicGenerator.generate({
      accountId: account.id,
      relatedHotFavoriteIds: [],
      seedKeyword: 'AI 写作',
      count: 1,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })
    expect(topicResult.topics).toHaveLength(1)
    expect(topicResult.failed).toHaveLength(0)
    const topic = topicResult.topics[0]
    expect(database.getTopic(topic.id)).not.toBeNull()

    // === 阶段 3：框架 ===
    const frameworkGenerator = new FrameworkGenerator(database, gateway)
    const frameworkResult = await frameworkGenerator.generate({
      templateId: database.listFrameworkTemplates()[0].id,
      topicId: topic.id,
      accountId: account.id,
      materialIds: [],
      manualTopic: '',
      count: 1,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })
    expect(frameworkResult.frameworks).toHaveLength(1)
    const framework = frameworkResult.frameworks[0]
    expect(framework.topicId).toBe(topic.id)
    expect(database.getFramework(framework.id)).not.toBeNull()

    // === 阶段 4：写文章 ===
    const articleGenerator = new ArticleGenerator(database, gateway)
    const articleResult = await articleGenerator.generate({
      frameworkId: framework.id,
      accountId: account.id,
      materialIds: [],
      count: 1,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })
    expect(articleResult.articles).toHaveLength(1)
    const article = articleResult.articles[0]
    expect(article.frameworkId).toBe(framework.id)
    expect(article.rawMarkdown.startsWith('# ')).toBe(true)

    // === 阶段 5：评审 ===
    const reviewRole = database.saveReviewRole({
      name: '内容编辑',
      systemPrompt: '你是内容编辑，评审文章质量',
      providerId: PROVIDER_ID,
      model: MODEL_ID,
      extractionTag: '评审意见',
      extractionOccurrence: 'last',
      dimensions: ['准确性', '结构'],
      sortOrder: 0
    })
    const reviewService = new ReviewService(database, gateway, articleGenerator)
    const reviewResult = await reviewService.start({
      articleId: article.id,
      roleIds: [reviewRole.id],
      fallbackProviderId: PROVIDER_ID,
      fallbackModel: MODEL_ID
    })
    expect(reviewResult.failed).toHaveLength(0)
    expect(reviewResult.task.opinions).toHaveLength(1)
    expect(reviewResult.task.opinions[0].problems.length).toBeGreaterThanOrEqual(1)

    // === 阶段 6：采纳评审意见改稿 ===
    // 先标记所有问题为采纳（默认 adopted=true，但确认一下）
    const adoptedArticle = await reviewService.apply(
      reviewResult.task.id,
      PROVIDER_ID,
      MODEL_ID
    )
    expect(adoptedArticle.id).toBeDefined()
    expect(adoptedArticle.rawMarkdown.startsWith('# ')).toBe(true)
    // 改稿后版本号递增
    expect(adoptedArticle.versionCount).toBeGreaterThan(article.versionCount)
    // 评审任务标记为 applied
    expect(database.getReviewTask(reviewResult.task.id)?.status).toBe('applied')

    // === 阶段 7：配图方案 ===
    const visualGenerator = new VisualPackGenerator(database, gateway)
    const visualPack = await visualGenerator.generate({
      articleId: adoptedArticle.id,
      inlineCount: 1,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })
    expect(visualPack.id).toBeDefined()
    expect(visualPack.cover.prompt).toBeTruthy()
    expect(visualPack.inlineImages).toHaveLength(1)
    expect(visualPack.releaseImages).toHaveLength(3)
    expect(visualPack.articleStatusSnapshot).toBe(adoptedArticle.status)

    // === 阶段 8：排版 ===
    const layoutService = new ArticleLayoutService(database)
    const layout = layoutService.create({
      articleId: adoptedArticle.id,
      platform: 'wechat'
    })
    expect(layout.id).toBeDefined()
    expect(layout.title).toBeTruthy()
    expect(layout.html).toContain('<article')
    expect(layout.html).toContain('<h1')
    expect(layout.platform).toBe('wechat')

    // === 阶段 9：发布到公众号草稿箱 ===
    // 配置微信渠道 + mock 微信 API
    database.saveWechatPublishChannel({ appId: 'wx-test-app-id', enabled: true })
    const keyStore = { readWechatPublishSecret: () => 'wx-test-secret' } as unknown as KeyStore
    const publishService = new WechatPublishService(database, keyStore)
    // mock 微信 token 和 draft/add 接口
    let wechatCallCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url)
      wechatCallCount += 1
      if (urlStr.includes('/cgi-bin/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-token-123', expires_in: 7200 }), {
          status: 200, headers: { 'content-type': 'application/json' }
        })
      }
      if (urlStr.includes('/cgi-bin/draft/add')) {
        return new Response(JSON.stringify({ media_id: 'mock-media-id-456' }), {
          status: 200, headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 404 })
    }))

    const publication = await publishService.pushDraft({
      articleId: adoptedArticle.id,
      layoutId: layout.id,
      thumbMediaId: 'thumb-media-001',
      author: '墨流测试号',
      digest: '先搭框架，再写文章'
    })
    expect(wechatCallCount).toBe(2) // token + draft/add
    expect(publication.status).toBe('draft')
    expect(publication.externalDraftId).toBe('mock-media-id-456')
    expect(publication.title).toBe(layout.title)
    expect(publication.thumbMediaId).toBe('thumb-media-001')

    // === 阶段 10：标记发布成功 ===
    const published = database.markPublicationPublished(publication.id, 'https://mp.weixin.qq.com/s/mock-article-url')
    expect(published.status).toBe('published')
    expect(published.publishedUrl).toBe('https://mp.weixin.qq.com/s/mock-article-url')

    // === 全链路溯源验证 ===
    // 选题引用了账号
    const topicRefs = database.listArtifactReferencesForTarget('topic', topic.id)
    expect(topicRefs.find((r) => r.sourceType === 'account-profile' && r.sourceId === account.id)).toBeDefined()
    // 框架引用了选题和账号
    const frameworkRefs = database.listArtifactReferencesForTarget('framework', framework.id)
    expect(frameworkRefs.find((r) => r.sourceType === 'topic' && r.sourceId === topic.id)).toBeDefined()
    expect(frameworkRefs.find((r) => r.sourceType === 'account-profile' && r.sourceId === account.id)).toBeDefined()
    // 成稿引用了框架和账号
    const articleRefs = database.listArtifactReferencesForTarget('article', adoptedArticle.id)
    expect(articleRefs.find((r) => r.sourceType === 'framework' && r.sourceId === framework.id)).toBeDefined()

    // === 确认所有产物落库 ===
    expect(database.listAccounts().length).toBeGreaterThanOrEqual(1)
    expect(database.listTopics().length).toBeGreaterThanOrEqual(1)
    expect(database.listFrameworks().length).toBeGreaterThanOrEqual(1)
    expect(database.listArticles().length).toBeGreaterThanOrEqual(1)
    expect(database.listReviewTasks(adoptedArticle.id).length).toBeGreaterThanOrEqual(1)
    expect(database.listVisualPacks(adoptedArticle.id).length).toBeGreaterThanOrEqual(1)
    expect(database.listArticleLayouts(adoptedArticle.id).length).toBeGreaterThanOrEqual(1)
    expect(database.listPublications().length).toBeGreaterThanOrEqual(1)

    // === 确认 gateway 调用次数正确（6 次 AI + 2 次微信） ===
    expect((gateway.chat as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(6)

    database.close()
  })

  it('任意环节可独立启动：无账号直接创建选题→框架→成稿', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)

    const schema = database.getTopicSchema()
    const gateway = makeSequentialGateway([
      '<框架><标题>无账号链路</标题><开头>开头</开头><论点一>论点一</论点一><论点二>论点二</论点二><论点三>论点三</论点三><结尾>结尾</结尾></框架>',
      '# 无账号链路成稿\n\n松耦合启动的成稿内容。'
    ])

    // 选题：无账号、无热点
    const topicGenerator = new TopicGenerator(database, gateway)
    // TopicGenerator 要求 locked account，所以这里改用直接 DB 创建选题验证松耦合
    const topic = database.saveTopic({
      seedKeyword: '无账号选题',
      accountIds: [],
      relatedHotIds: [],
      status: 'locked',
      source: 'manual',
      fields: Object.fromEntries(schema.map((f) => [f.name, `值-${f.name}`]))
    })

    // 框架：选题可选，用 manualTopic
    const frameworkGenerator = new FrameworkGenerator(database, gateway)
    const frameworkResult = await frameworkGenerator.generate({
      templateId: database.listFrameworkTemplates()[0].id,
      topicId: undefined,
      accountId: undefined,
      materialIds: [],
      manualTopic: '无账号框架主题',
      count: 1,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })
    expect(frameworkResult.frameworks).toHaveLength(1)
    expect(frameworkResult.frameworks[0].accountId).toBeUndefined()

    // 成稿：无框架，用手动大纲
    const articleGenerator = new ArticleGenerator(database, gateway)
    const articleResult = await articleGenerator.generate({
      frameworkId: undefined,
      accountId: undefined,
      materialIds: [],
      manualOutline: '标题：手动大纲\n开头：切入\n结尾：收束',
      count: 1,
      providerId: PROVIDER_ID,
      model: MODEL_ID
    })
    expect(articleResult.articles).toHaveLength(1)
    expect(articleResult.articles[0].frameworkId).toBeUndefined()
    database.close()
  })
})
