import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { AppDatabase } from './database.js'
import type { ModelGateway } from './gateway/model-gateway.js'
import { PROVIDER_PRESETS } from './gateway/presets.js'
import type { KeyStore } from './security/key-store.js'
import type { AccountGenerator } from './services/account-generator.js'
import type { HotspotFilter } from './services/hotspot-filter.js'
import type { HotspotService } from './services/hotspot-service.js'
import type { TopicGenerator } from './services/topic-generator.js'
import type { MaterialSearchService } from './services/material-search-service.js'
import type { FrameworkGenerator } from './services/framework-generator.js'
import type { ArticleGenerator } from './services/article-generator.js'
import type { ReviewService } from './services/review-service.js'
import type { VisualPackGenerator } from './services/visual-pack-generator.js'
import type { ArticleLayoutService } from './services/article-layout-service.js'
import type { WechatPublishService } from './services/wechat-publish-service.js'
import { validateAccountFields, validateTopicSchema } from '../shared/domain.js'
import type {
  AddHotFavoriteInput,
  FilterHotspotsInput,
  GenerateAccountInput,
  RestoreVersionInput,
  SaveAccountInput,
  SaveHotSourcePreferencesInput,
  SaveTopicInput,
  SaveProviderInput,
  GenerateTopicsInput,
  AddSearchMaterialInput,
  MaterialSearchInput,
  SaveManualMaterialInput,
  SaveSearchServiceInput,
  GenerateFrameworksInput,
  SaveFrameworkInput,
  SaveFrameworkTemplateInput,
  GenerateArticlesInput,
  ReviseArticleInput,
  SaveArticleInput,
  RestoreArticleVersionInput,
  SaveReviewRoleInput, StartReviewInput, UpdateReviewProblemInput, AddManualReviewProblemInput,
  TopicSchemaField,
  UpdateHotFavoriteTagsInput
} from '../shared/contracts.js'

const providerSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().trim().min(1).max(80),
  protocol: z.literal('openai-compatible'),
  baseUrl: z.string().trim().url(),
  defaultModel: z.string().trim().min(1).max(160),
  enabled: z.boolean(),
  isRelay: z.boolean(),
  capabilities: z.object({
    chat: z.boolean(),
    jsonMode: z.boolean(),
    streaming: z.boolean(),
    vision: z.boolean(),
    image: z.boolean()
  }),
  models: z.array(z.object({
    id: z.string().optional(),
    modelId: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(120),
    contextLimit: z.number().int().positive().optional(),
    outputLimit: z.number().int().positive().optional(),
    reasoningVariants: z.array(z.string().trim().min(1).max(40)),
    isDefault: z.boolean(),
    enabled: z.boolean()
  })).min(1),
  apiKey: z.string().trim().optional()
}).superRefine((input, context) => {
  const enabledModels = input.models.filter((model) => model.enabled)
  if (!enabledModels.length) {
    context.addIssue({ code: 'custom', message: '至少需要启用一个模型', path: ['models'] })
  }
  if (enabledModels.filter((model) => model.isDefault).length !== 1) {
    context.addIssue({ code: 'custom', message: '必须且只能设置一个默认模型', path: ['models'] })
  }
  const modelIds = input.models.map((model) => model.modelId)
  if (new Set(modelIds).size !== modelIds.length) {
    context.addIssue({ code: 'custom', message: '同一连接内的模型 ID 不能重复', path: ['models'] })
  }
})

const hotItemSchema = z.object({
  id: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(2_000),
  desc: z.string().max(20_000),
  pic: z.string().url().optional(),
  url: z.union([z.string().url(), z.literal('')]),
  source: z.string().trim().min(1).max(100),
  sourceTitle: z.string().trim().min(1).max(200),
  subtitle: z.string().max(200),
  updateTime: z.string().min(1).max(100),
  hotValue: z.string().max(100).optional(),
  rank: z.number().int().positive(),
  rawJson: z.string().max(200_000)
})

const favoriteTagsSchema = z.array(z.enum(['待选题', '已用'])).max(2)

export function registerIpc(options: {
  database: AppDatabase
  keyStore: KeyStore
  gateway: ModelGateway
  accountGenerator: AccountGenerator
  hotspotFilter: HotspotFilter
  hotspotService: HotspotService
  topicGenerator: TopicGenerator
  materialSearchService: MaterialSearchService
  frameworkGenerator: FrameworkGenerator
  articleGenerator: ArticleGenerator
  reviewService: ReviewService
  visualPackGenerator: VisualPackGenerator
  articleLayoutService: ArticleLayoutService
  wechatPublishService: WechatPublishService
  dataPath: string
}): void {
  const {
    database,
    keyStore,
    gateway,
    accountGenerator,
    hotspotFilter,
    hotspotService,
    topicGenerator,
    materialSearchService,
    frameworkGenerator,
    articleGenerator,
    reviewService,
    visualPackGenerator,
    articleLayoutService,
    wechatPublishService,
    dataPath
  } = options

  handle('app:bootstrap', () => {
    const accounts = database.listAccounts()
    return {
      providers: database.listProviders(),
      searchService: database.getSearchService(),
      accounts,
      currentAccountId: accounts.find((account) => account.isCurrent)?.id
    }
  })
  handle('app:data-path', () => dataPath)

  handle('providers:presets', () => PROVIDER_PRESETS)
  handle('providers:list', () => database.listProviders())
  handle('providers:save', (_event, raw: SaveProviderInput) => {
    const input = providerSchema.parse(raw)
    const encryptedKey = input.apiKey ? keyStore.encrypt(input.apiKey) : undefined
    return database.saveProvider(input, encryptedKey)
  })
  handle('providers:remove', (_event, id: string) => {
    database.removeProvider(requireId(id))
  })
  handle('providers:test', async (_event, id: string) => {
    const providerId = requireId(id)
    const provider = database.getProvider(providerId)
    if (!provider) throw new Error('供应商不存在')
    const startedAt = performance.now()
    const result = await gateway.chat({
      providerId,
      temperature: 0,
      maxTokens: 16,
      messages: [
        {
          role: 'user',
          content: '只回复 OK'
        }
      ]
    })
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
      model: result.model,
      message: '连接成功'
    }
  })

  handle('search-service:get', () => database.getSearchService())
  handle('search-service:save', (_event, raw: SaveSearchServiceInput) => {
    const input = z.object({
      apiKey: z.string().trim().min(1).max(1_000).optional(),
      enabled: z.boolean()
    }).parse(raw)
    const encryptedKey = input.apiKey ? keyStore.encrypt(input.apiKey) : undefined
    return database.saveSearchService({ enabled: input.enabled }, encryptedKey)
  })
  handle('search-service:test', async () => {
    const startedAt = performance.now()
    await materialSearchService.search({ query: '测试', type: 'web', count: 1 })
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), message: '搜索服务连接成功（已消耗 1 次搜索额度）' }
  })

  handle('accounts:list', () => database.listAccounts())
  handle('accounts:get', (_event, id: string) => database.getAccount(requireId(id)))
  handle('accounts:generate', (_event, input: GenerateAccountInput) => {
    requireId(input.providerId)
    return accountGenerator.generate(input)
  })
  handle('accounts:save', (_event, input: SaveAccountInput) => {
    const errors = validateAccountFields(input.fields)
    if (errors.length) throw new Error(errors.join('；'))
    return database.saveAccount(input)
  })
  handle('accounts:set-current', (_event, id: string) => {
    database.setCurrentAccount(requireId(id))
  })
  handle('accounts:set-locked', (_event, id: string, locked: boolean) =>
    database.setAccountLocked(requireId(id), Boolean(locked))
  )
  handle('accounts:restore', (_event, input: RestoreVersionInput) =>
    database.restoreAccountVersion(requireId(input.profileId), requireId(input.versionId))
  )
  handle('accounts:remove', (_event, id: string) => {
    database.removeAccount(requireId(id))
  })

  handle('hotspots:bootstrap', () => hotspotService.bootstrap())
  handle('hotspots:preferences:save', (_event, raw: SaveHotSourcePreferencesInput) => {
    const input = z.object({
      preferences: z.array(z.object({
        sourceId: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/i).max(100),
        hidden: z.boolean(),
        sortOrder: z.number().int().nonnegative()
      })).max(200)
    }).superRefine((value, context) => {
      const ids = value.preferences.map((preference) => preference.sourceId)
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: '平台偏好不能重复', path: ['preferences'] })
      }
    }).parse(raw)
    return database.saveHotSourcePreferences(input.preferences)
  })
  handle('hotspots:refresh', (_event, sourceIds?: string[]) => {
    if (sourceIds && (!Array.isArray(sourceIds) || sourceIds.some((id) => typeof id !== 'string'))) {
      throw new Error('热点源参数无效')
    }
    return hotspotService.refresh(sourceIds)
  })
  handle('hotspots:open-source', async (_event, rawUrl: string) => {
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许打开网页链接')
    await shell.openExternal(url.toString())
  })
  handle('hotspots:favorites:list', () => database.listHotFavorites())
  handle('hotspots:favorites:add', (_event, raw: AddHotFavoriteInput) => {
    const input = z.object({
      hotItem: hotItemSchema,
      accountId: z.string().uuid().optional(),
      tags: favoriteTagsSchema.optional()
    }).parse(raw)
    return database.addHotFavorite(input)
  })
  handle('hotspots:favorites:update-tags', (_event, raw: UpdateHotFavoriteTagsInput) => {
    const input = z.object({
      id: z.string().uuid(),
      tags: favoriteTagsSchema
    }).parse(raw)
    return database.updateHotFavoriteTags(input.id, input.tags)
  })
  handle('hotspots:favorites:remove', (_event, id: string) => {
    database.removeHotFavorite(requireId(id))
  })
  handle('hotspots:filter', (_event, raw: FilterHotspotsInput) => {
    const input = z.object({
      accountId: z.string().uuid(),
      providerId: z.string().uuid(),
      model: z.string().trim().min(1).max(160),
      items: z.array(hotItemSchema).min(1).max(200)
    }).parse(raw)
    return hotspotFilter.filter(input)
  })

  handle('topics:schema:get', () => database.getTopicSchema())
  handle('topics:schema:save', (_event, raw: TopicSchemaField[]) => {
    const fields = z.array(z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(50),
      required: z.boolean(),
      sortOrder: z.number().int().nonnegative()
    })).min(1).max(20).parse(raw).map((field, index) => ({
      id: field.id ?? crypto.randomUUID(),
      name: field.name.trim(),
      required: field.required,
      sortOrder: index
    }))
    const errors = validateTopicSchema(fields)
    if (errors.length) throw new Error(errors.join('；'))
    return database.saveTopicSchema(fields)
  })
  handle('topics:schema:reset', () => database.resetTopicSchema())
  handle('topics:list', (_event, libraryOnly?: boolean) => database.listTopics(Boolean(libraryOnly)))
  handle('topics:generate', (_event, raw: GenerateTopicsInput) => {
    const input = z.object({
      accountId: z.string().uuid(),
      providerId: z.string().uuid(),
      model: z.string().trim().min(1).max(160),
      seedKeyword: z.string().trim().min(1).max(4_000),
      relatedHotFavoriteIds: z.array(z.string().uuid()).max(30),
      count: z.number().int().min(1).max(5)
    }).parse(raw)
    return topicGenerator.generate(input)
  })
  handle('topics:save', (_event, raw: SaveTopicInput) => {
    const input = z.object({
      id: z.string().uuid().optional(),
      seedKeyword: z.string().trim().min(1).max(4_000),
      accountIds: z.array(z.string().uuid()).max(10),
      relatedHotIds: z.array(z.string().uuid()).max(30),
      status: z.enum(['draft', 'locked']),
      source: z.enum(['ai', 'manual', 'restore']),
      fields: z.record(z.string().trim().min(1).max(50), z.string().max(20_000)).refine(
        (fields) => Object.keys(fields).length > 0 && Object.keys(fields).length <= 30,
        '请至少填写一个选题字段'
      ),
      providerId: z.string().uuid().optional(),
      model: z.string().trim().min(1).max(160).optional()
    }).parse(raw)
    return database.saveTopic(input)
  })
  handle('topics:set-locked', (_event, id: string, locked: boolean) =>
    database.setTopicLocked(requireId(id), Boolean(locked))
  )
  handle('topics:set-in-library', (_event, id: string, inLibrary: boolean) =>
    database.setTopicInLibrary(requireId(id), Boolean(inLibrary))
  )
  handle('topics:remove', (_event, id: string) => database.removeTopic(requireId(id)))

  handle('materials:list', () => database.listMaterials())
  handle('materials:search', (_event, raw: MaterialSearchInput) => {
    const input = z.object({
      query: z.string().trim().min(1).max(100),
      type: z.enum(['web', 'image']),
      count: z.number().int().positive().optional(),
      timeRange: z.string().trim().max(30).optional(),
      sites: z.string().trim().max(2_000).optional(),
      authorityOnly: z.boolean().optional()
    }).superRefine((value, context) => {
      if (value.type === 'web' && value.count && value.count > 50) context.addIssue({ code: 'custom', message: '网页搜索最多返回 50 条', path: ['count'] })
      if (value.type === 'image' && value.count && value.count > 5) context.addIssue({ code: 'custom', message: '图片搜索最多返回 5 条', path: ['count'] })
    }).parse(raw)
    return materialSearchService.search(input)
  })
  handle('materials:add-search-result', (_event, raw: AddSearchMaterialInput) => {
    const webResult = z.object({
      id: z.string().trim().min(1).max(300), title: z.string().trim().min(1).max(2_000),
      summary: z.string().max(20_000), snippet: z.string().max(5_000), sourceUrl: z.string().url(),
      sourceName: z.string().max(300).optional(), publishedAt: z.string().max(100).optional(),
      authority: z.string().max(100).optional(), relevanceScore: z.number().min(0).max(1).optional()
    })
    const imageResult = z.object({
      id: z.string().trim().min(1).max(300), title: z.string().trim().min(1).max(2_000), sourceUrl: z.string().url(),
      sourceName: z.string().max(300).optional(), publishedAt: z.string().max(100).optional(), imageUrl: z.string().url(),
      imageWidth: z.number().int().positive().optional(), imageHeight: z.number().int().positive().optional(),
      imageShape: z.string().max(100).optional(), watermark: z.string().max(20).optional()
    })
    const input = z.object({
      result: z.union([webResult, imageResult]),
      query: z.string().trim().min(1).max(100),
      relatedTopicId: z.string().uuid().optional()
    }).parse(raw)
    const result = input.result
    const isImage = 'imageUrl' in result
    return database.addSearchMaterial(isImage ? {
      kind: 'image', origin: 'doubao_image', externalId: result.id, title: result.title, summary: '',
      sourceUrl: result.sourceUrl, sourceName: result.sourceName, query: input.query,
      relatedTopicId: input.relatedTopicId, publishedAt: result.publishedAt, imageUrl: result.imageUrl,
      imageWidth: result.imageWidth, imageHeight: result.imageHeight, imageShape: result.imageShape,
      watermark: result.watermark
    } : {
      kind: 'web', origin: 'doubao_web', externalId: result.id, title: result.title, summary: result.summary,
      sourceUrl: result.sourceUrl, sourceName: result.sourceName, query: input.query,
      relatedTopicId: input.relatedTopicId, publishedAt: result.publishedAt, authority: result.authority,
      relevanceScore: result.relevanceScore
    })
  })
  handle('materials:add-manual', (_event, raw: SaveManualMaterialInput) => {
    const input = z.object({
      title: z.string().trim().min(1).max(500), summary: z.string().trim().min(1).max(3_000),
      sourceUrl: z.string().url().optional(), sourceNote: z.string().trim().max(500).optional(),
      relatedTopicId: z.string().uuid().optional()
    }).parse(raw)
    return database.addManualMaterial(input)
  })
  handle('materials:remove', (_event, id: string) => database.removeMaterial(requireId(id)))

  const frameworkSectionsSchema = z.array(z.object({
    name: z.string().trim().min(1).max(50),
    content: z.string().trim().min(1).max(20_000)
  })).min(1).max(20).superRefine((sections, context) => {
    const names = sections.map((section) => section.name)
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', message: '框架章节名称不能重复' })
    }
  })
  const templateSchema = z.object({
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(80),
    sections: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
    isDefault: z.boolean()
  }).superRefine((value, context) => {
    if (new Set(value.sections).size !== value.sections.length) {
      context.addIssue({ code: 'custom', message: '模板章节名称不能重复', path: ['sections'] })
    }
  })
  handle('frameworks:templates:list', () => database.listFrameworkTemplates())
  handle('frameworks:templates:save', (_event, raw: SaveFrameworkTemplateInput) =>
    database.saveFrameworkTemplate(templateSchema.parse(raw))
  )
  handle('frameworks:list', () => database.listFrameworks())
  handle('frameworks:generate', (_event, raw: GenerateFrameworksInput) => {
    const input = z.object({
      topicId: z.string().uuid().optional(), accountId: z.string().uuid().optional(),
      materialIds: z.array(z.string().uuid()).max(30), templateId: z.string().min(1).max(100),
      manualTopic: z.string().trim().max(2_000).optional(), providerId: z.string().uuid(),
      model: z.string().trim().min(1).max(160), count: z.number().int().min(1).max(3)
    }).parse(raw)
    return frameworkGenerator.generate(input)
  })
  handle('frameworks:save', (_event, raw: SaveFrameworkInput) => {
    const input = z.object({
      id: z.string().uuid().optional(), topicId: z.string().uuid().optional(), accountId: z.string().uuid().optional(),
      materialIds: z.array(z.string().uuid()).max(30), templateId: z.string().min(1).max(100).optional(),
      manualTopic: z.string().trim().max(2_000), status: z.enum(['draft', 'locked']),
      sections: frameworkSectionsSchema, providerId: z.string().uuid().optional(),
      model: z.string().trim().min(1).max(160).optional()
    }).parse(raw)
    return database.saveFramework(input)
  })
  handle('frameworks:set-locked', (_event, id: string, locked: boolean) =>
    database.setFrameworkLocked(requireId(id), Boolean(locked))
  )
  handle('frameworks:remove', (_event, id: string) => database.removeFramework(requireId(id)))

  const articleIdSchema = z.string().uuid()
  handle('articles:list', () => database.listArticles())
  handle('articles:get', (_event, id: string) => database.getArticle(requireId(id)))
  handle('articles:generate', (_event, raw: GenerateArticlesInput) => {
    const input = z.object({
      frameworkId: articleIdSchema.optional(), accountId: articleIdSchema.optional(),
      materialIds: z.array(articleIdSchema).max(30), manualOutline: z.string().trim().min(1).max(30_000).optional(),
      providerId: articleIdSchema, model: z.string().trim().min(1).max(160), count: z.number().int().min(1).max(3)
    }).refine((value) => Boolean(value.frameworkId || value.manualOutline), { message: '请选择框架或填写手动框架' }).parse(raw)
    return articleGenerator.generate(input)
  })
  handle('articles:revise', (_event, raw: ReviseArticleInput) => {
    const input = z.object({
      articleId: articleIdSchema, instruction: z.string().trim().min(1).max(8_000), alignFramework: z.boolean(),
      providerId: articleIdSchema, model: z.string().trim().min(1).max(160), count: z.number().int().min(1).max(3)
    }).parse(raw)
    return articleGenerator.revise(input)
  })
  handle('articles:save', (_event, raw: SaveArticleInput) => {
    const input = z.object({
      id: articleIdSchema.optional(), frameworkId: articleIdSchema.optional(), accountId: articleIdSchema.optional(),
      materialIds: z.array(articleIdSchema).max(30), manualOutline: z.string().max(30_000), status: z.enum(['draft', 'locked']),
      rawMarkdown: z.string().trim().min(1).max(200_000), source: z.enum(['generate', 'revise', 'manual', 'restore']),
      instruction: z.string().max(8_000).optional(), providerId: articleIdSchema.optional(),
      model: z.string().trim().min(1).max(160).optional()
    }).parse(raw)
    return database.saveArticle(input)
  })
  handle('articles:restore', (_event, raw: RestoreArticleVersionInput) => {
    const input = z.object({ articleId: articleIdSchema, versionId: articleIdSchema }).parse(raw)
    return database.restoreArticleVersion(input.articleId, input.versionId)
  })
  handle('articles:set-locked', (_event, id: string, locked: boolean) => database.setArticleLocked(requireId(id), Boolean(locked)))
  handle('articles:remove', (_event, id: string) => database.removeArticle(requireId(id)))
  handle('reviews:roles:list',()=>database.listReviewRoles())
  handle('reviews:roles:save',(_e,raw:SaveReviewRoleInput)=>database.saveReviewRole(z.object({id:z.string().optional(),name:z.string().trim().min(1).max(80),systemPrompt:z.string().trim().min(1).max(12000),providerId:z.string().uuid().optional(),model:z.string().trim().max(160).optional(),extractionTag:z.string().trim().min(1).max(50),extractionOccurrence:z.enum(['first','last']),dimensions:z.array(z.string().trim().min(1).max(50)).max(10),sortOrder:z.number().int().min(0)}).parse(raw)))
  handle('reviews:roles:remove',(_e,id:string)=>database.removeReviewRole(requireId(id)))
  handle('reviews:tasks:list',(_e,articleId?:string)=>database.listReviewTasks(articleId))
  handle('reviews:start',(_e,raw:StartReviewInput)=>reviewService.start(z.object({articleId:z.string().uuid(),roleIds:z.array(z.string().uuid()).min(1).max(10),fallbackProviderId:z.string().uuid(),fallbackModel:z.string().min(1).max(160)}).parse(raw)))
  handle('reviews:problems:update',(_e,raw:UpdateReviewProblemInput)=>database.updateReviewProblem(z.object({id:z.string().uuid(),position:z.string().min(1),severity:z.enum(['high','medium','low']),issue:z.string().min(1),suggestion:z.string().min(1),adopted:z.boolean()}).parse(raw)))
  handle('reviews:problems:add',(_e,raw:AddManualReviewProblemInput)=>{const x=z.object({taskId:z.string().uuid(),position:z.string().min(1),severity:z.enum(['high','medium','low']),issue:z.string().min(1),suggestion:z.string().min(1)}).parse(raw);return database.addReviewOpinion({taskId:x.taskId,dimensions:[],overallSuggestion:'',rawXml:'',extractionMatched:true,problems:[{...x,adopted:true,isManual:true}] }).problems[0]})
  handle('reviews:apply',(_e,taskId:string,providerId:string,model:string)=>reviewService.apply(requireId(taskId),requireId(providerId),model))
  handle('visuals:list',(_e,articleId?:string)=>database.listVisualPacks(articleId?requireId(articleId):undefined))
  handle('visuals:generate',(_e,raw:unknown)=>visualPackGenerator.generate(z.object({articleId:z.string().uuid(),providerId:z.string().uuid(),model:z.string().trim().min(1).max(160),inlineCount:z.number().int().min(1).max(6)}).parse(raw)))
  handle('visuals:remove',(_e,id:string)=>database.removeVisualPack(requireId(id)))
  handle('layouts:list',(_e,articleId?:string)=>database.listArticleLayouts(articleId?requireId(articleId):undefined))
  handle('layouts:create',(_e,raw:unknown)=>articleLayoutService.create(z.object({articleId:z.string().uuid(),platform:z.enum(['wechat','xiaohongshu','web'])}).parse(raw)))
  handle('layouts:remove',(_e,id:string)=>database.removeArticleLayout(requireId(id)))
  handle('publishing:wechat:get',()=>database.getWechatPublishChannel())
  handle('publishing:wechat:save',(_e,raw:unknown)=>{const input=z.object({appId:z.string().trim().max(100),appSecret:z.string().trim().min(1).max(1000).optional(),enabled:z.boolean()}).parse(raw);return database.saveWechatPublishChannel({appId:input.appId,enabled:input.enabled},input.appSecret?keyStore.encrypt(input.appSecret):undefined)})
  handle('publishing:wechat:test',()=>wechatPublishService.test())
  handle('publishing:list',()=>database.listPublications())
  handle('publishing:wechat:push-draft',(_e,raw:unknown)=>wechatPublishService.pushDraft(z.object({articleId:z.string().uuid(),layoutId:z.string().uuid(),thumbMediaId:z.string().trim().min(1).max(200),author:z.string().trim().max(100).optional(),digest:z.string().trim().max(120).optional(),contentSourceUrl:z.string().trim().url().optional()}).parse(raw)))
  handle('publishing:update',(_e,raw:unknown)=>{const input=z.object({id:z.string().uuid(),status:z.literal('published'),publishedUrl:z.string().url()}).parse(raw);return database.markPublicationPublished(input.id,input.publishedUrl)})
}

function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, listener)
}

function requireId(value: string): string {
  if (!value || typeof value !== 'string') throw new Error('缺少有效 ID')
  return value
}
