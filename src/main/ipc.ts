import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AppDatabase } from './database.js'
import type { ModelGateway } from './gateway/model-gateway.js'
import { PROVIDER_PRESETS } from './gateway/presets.js'
import type { PromptRegistry } from './gateway/prompt-registry.js'
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
import type { WeiboLoginService } from './services/weibo-login-service.js'
import type { VisualAssetService } from './services/visual-asset-service.js'
import type { FileMaterialService } from './services/file-material-service.js'
import type { WorkspaceService } from './services/workspace-service.js'
import { listLayoutThemes } from './services/layout-themes.js'
import {
  activeGenerationDomains,
  beginGeneration,
  cancelGeneration,
  endGeneration,
  type GenerationDomain
} from './services/generation-registry.js'
import { GENERATION_DOMAIN_LABELS } from '../shared/contracts.js'
import { resolveExternalUrl, validateAccountFields, validateTopicSchema } from '../shared/domain.js'
import type {
  AddAccountMemoryInput,
  AddAccountPlatformInput,
  AddAccountRedlineInput,
  AddHotFavoriteInput,
  FilterHotspotsInput,
  GenerateAccountInput,
  RestoreVersionInput,
  SaveAccountInput,
  SaveHotSourcePreferencesInput,
  SaveTopicInput,
  SaveProviderInput,
  ProviderDraftTestInput,
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
  RenameArticleVersionInput,
  SaveReviewRoleInput, StartReviewInput, UpdateReviewProblemInput, AddManualReviewProblemInput,
  TopicSchemaField,
  UpdateHotFavoriteTagsInput
} from '../shared/contracts.js'

/** 流事件统一出口：渲染进程销毁后不再发送，避免 "Object has been destroyed" */
function sendToStream(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
}

/** 生成任务统一执行壳在 registerIpc 内定义，便于把结果写入任务台账 */

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
  prompts: PromptRegistry
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
  weiboLoginService: WeiboLoginService
  visualAssets: VisualAssetService
  fileMaterials: FileMaterialService
  workspace: WorkspaceService
  dataPath: string
}): void {
  const {
    database,
    keyStore,
    gateway,
    prompts,
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
    weiboLoginService,
    visualAssets,
    fileMaterials,
    workspace,
    dataPath
  } = options

  /**
   * 生成任务统一执行壳：模块内互斥 + 生命周期广播 + 任务台账落库。
   * 台账让任务中心能看到跨页面的历史结果；批量的部分失败如实记 partial，不伪装成全部成功。
   */
  async function runGeneration<T>(
    event: IpcMainInvokeEvent,
    domain: GenerationDomain,
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const run = beginGeneration(domain)
    const taskId = randomUUID()
    database.beginGenerationTask({ id: taskId, domain, label: GENERATION_DOMAIN_LABELS[domain] })
    sendToStream(event, 'generation:events', { id: taskId, domain, status: 'started', at: new Date().toISOString() })
    try {
      const result = await task(run.signal)
      const failed = (result as { failed?: unknown[] } | null)?.failed
      const partial = Array.isArray(failed) && failed.length > 0
      database.finishGenerationTask(taskId, partial ? 'partial' : 'succeeded', partial ? `${failed?.length} 项未完成` : '')
      sendToStream(event, 'generation:events', { id: taskId, domain, status: 'done', at: new Date().toISOString() })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败'
      database.finishGenerationTask(taskId, run.signal.aborted ? 'cancelled' : 'failed', message)
      sendToStream(event, 'generation:events', { id: taskId, domain, status: 'failed', message, at: new Date().toISOString() })
      throw error
    } finally {
      endGeneration(domain)
    }
  }

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
  handle('app:open-external', async (_event, rawUrl: string) => {
    // 危险协议直接返回 false，由页面给出统一提示；不抛错，避免渲染层出现未处理的 rejection
    const url = resolveExternalUrl(rawUrl)
    if (!url) return false
    await shell.openExternal(url.toString())
    return true
  })
  handle('app:export-article', (_event, raw: { articleId: string; format: 'markdown' | 'html'; targetDir?: string }) => {
    const input = z.object({
      articleId: z.string().uuid(),
      format: z.enum(['markdown', 'html']),
      targetDir: z.string().min(1).max(1_000).optional()
    }).parse(raw)
    return workspace.exportArticle(input)
  })
  handle('app:export-layout', (_event, raw: { layoutId: string; targetDir?: string }) => {
    const input = z.object({ layoutId: z.string().uuid(), targetDir: z.string().min(1).max(1_000).optional() }).parse(raw)
    return workspace.exportLayout(input)
  })
  handle('app:backup-create', (_event, raw?: { targetDir?: string }) => {
    const input = z.object({ targetDir: z.string().min(1).max(1_000).optional() }).optional().parse(raw)
    return workspace.createBackup(input)
  })
  handle('app:backup-restore', (_event, raw: { bundleDir: string }) => {
    const input = z.object({ bundleDir: z.string().min(1).max(1_000) }).parse(raw)
    return workspace.restoreBackup(input)
  })
  handle('app:backup-list', () => workspace.listBackupBundles())

  // ===== 生成任务：互斥、取消与历史台账 =====
  handle('generation:cancel', (_event, domain: string) => ({ cancelled: cancelGeneration(domain as GenerationDomain) }))
  handle('generation:active', () => activeGenerationDomains())
  handle('generation:list', (_event, limit?: number) => database.listGenerationTasks(
    typeof limit === 'number' && limit > 0 && limit <= 100 ? limit : 30
  ))

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

  /** 保存前测试：直接用表单里的接口地址 / 密钥 / 模型做一次最小请求，结果不加密不落库 */
  handle('providers:test-draft', async (_event, raw: ProviderDraftTestInput) => {
    const input = z.object({
      id: z.string().optional(),
      baseUrl: z.string().trim().url(),
      apiKey: z.string().trim().max(10_000).optional(),
      model: z.string().trim().max(160).optional()
    }).parse(raw)
    const result = await gateway.testDraft({
      providerId: input.id,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      onLog: (entry) => database.recordModelCall({
        providerId: input.id ?? null,
        model: entry.model,
        latencyMs: entry.latencyMs,
        success: entry.success,
        errorKind: entry.errorKind,
        errorMessage: entry.errorMessage
      })
    })
    return { ok: true, ...result }
  })

  /** 模型调用日志（含生成、测试、保存前测试） */
  handle('providers:logs', (_event, providerId?: string) =>
    database.listModelCalls(typeof providerId === 'string' && providerId ? providerId : undefined, 100)
  )

  // ===== 提示词管理 =====
  handle('prompts:list', () => database.listPromptDefs())
  handle('prompts:list-versions', (_event, key: string) => {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed) throw new Error('缺少提示词 key')
    return database.listPromptVersions(trimmed)
  })
  handle('prompts:update', (_event, raw: { key: string; content: string; note?: string }) => {
    const input = z.object({
      key: z.string().trim().min(1),
      content: z.string(),
      note: z.string().max(200).optional()
    }).parse(raw)
    return database.updatePrompt(input.key, input.content, input.note ?? '')
  })
  handle('prompts:restore', (_event, raw: { key: string; version: number }) => {
    const input = z.object({ key: z.string().trim().min(1), version: z.number().int().positive() }).parse(raw)
    return database.restorePrompt(input.key, input.version)
  })
  handle('prompts:reset', (_event, key: string) => {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed) throw new Error('缺少提示词 key')
    return database.resetPrompt(trimmed)
  })

  handle('providers:test', async (_event, id: string) => {
    const providerId = requireId(id)
    const provider = database.getProvider(providerId)
    if (!provider) throw new Error('供应商不存在')
    const startedAt = performance.now()
    try {
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
      const latencyMs = Math.round(performance.now() - startedAt)
      database.recordProviderTest(providerId, 'success')
      return {
        ok: true,
        latencyMs,
        model: result.model,
        message: `连接成功 · 模型 ${result.model} 正常响应`
      }
    } catch (error) {
      // 失败同样落库：让"已保存"与"验证失败"在界面上可区分，而不是静默回到未验证
      const reason = error instanceof Error ? error.message : String(error)
      database.recordProviderTest(providerId, 'failure', reason)
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        model: provider.defaultModel,
        message: `验证失败：${reason}`
      }
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
  handle('accounts:generate', (event, input: GenerateAccountInput) => {
    requireId(input.providerId)
    return runGeneration(event, 'account', async () => accountGenerator.generate(input))
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

  /* ── 账号六维扩展：红线 / 平台绑定 / 长期记忆 ── */
  handle('accounts:redlines:list', (_event, profileId: string) =>
    database.listAccountRedlines(requireId(profileId))
  )
  handle('accounts:redlines:add', (_event, raw: AddAccountRedlineInput) => {
    const input = z.object({
      profileId: z.string().min(1),
      kind: z.enum(['do', 'dont', 'compliance']),
      content: z.string().trim().min(1).max(500)
    }).parse(raw)
    return database.addAccountRedline({ ...input, profileId: requireId(input.profileId) })
  })
  handle('accounts:redlines:remove', (_event, id: string) => {
    database.removeAccountRedline(requireId(id))
  })
  handle('accounts:platforms:list', (_event, profileId: string) =>
    database.listAccountPlatformAccounts(requireId(profileId))
  )
  handle('accounts:platforms:add', (_event, raw: AddAccountPlatformInput) => {
    const input = z.object({
      profileId: z.string().min(1),
      platform: z.string().trim().min(1).max(30),
      handle: z.string().trim().min(1).max(100),
      note: z.string().trim().max(200).optional()
    }).parse(raw)
    return database.addAccountPlatformAccount({ ...input, profileId: requireId(input.profileId) })
  })
  handle('accounts:platforms:remove', (_event, id: string) => {
    database.removeAccountPlatformAccount(requireId(id))
  })
  handle('accounts:memories:list', (_event, profileId: string) =>
    database.listAccountMemories(requireId(profileId))
  )
  handle('accounts:memories:add', (_event, raw: AddAccountMemoryInput) => {
    const input = z.object({
      profileId: z.string().min(1),
      insight: z.string().trim().min(1).max(500),
      action: z.string().trim().max(500).optional(),
      source: z.string().trim().max(50).optional(),
      memoryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }).parse(raw)
    return database.addAccountMemory({ ...input, profileId: requireId(input.profileId) })
  })
  handle('accounts:memories:remove', (_event, id: string) => {
    database.removeAccountMemory(requireId(id))
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
  handle('hotspots:weibo:status', () => {
    const meta = database.getWeiboSessionMeta()
    return { configured: keyStore.hasWeiboCookie(), updatedAt: meta?.updatedAt }
  })
  handle('hotspots:weibo:save', (_event, raw: unknown) => {
    const { cookie } = z.object({
      cookie: z.string().trim().min(1).max(8_000)
    }).parse(raw)
    keyStore.saveWeiboCookie(cookie)
    const meta = database.getWeiboSessionMeta()
    return { configured: true, updatedAt: meta?.updatedAt }
  })
  handle('hotspots:weibo:login', () => weiboLoginService.login())
  handle('hotspots:weibo:clear', () => {
    keyStore.clearWeiboCookie()
  })
  handle('hotspots:filter', (event, raw: FilterHotspotsInput) => {
    const input = z.object({
      accountId: z.string().uuid(),
      providerId: z.string().uuid(),
      model: z.string().trim().min(1).max(160),
      items: z.array(hotItemSchema).min(1).max(200)
    }).parse(raw)
    return runGeneration(event, 'hotspot-filter', (signal) =>
      hotspotFilter.filter(input, (streamEvent) => sendToStream(event, 'hotspots:stream', streamEvent), signal))
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
  handle('topics:generate', (event, raw: GenerateTopicsInput) => {
    const input = z.object({
      accountId: z.string().uuid(),
      providerId: z.string().uuid(),
      model: z.string().trim().min(1).max(160),
      seedKeyword: z.string().trim().min(1).max(4_000),
      relatedHotFavoriteIds: z.array(z.string().uuid()).max(30),
      count: z.number().int().min(1).max(5)
    }).parse(raw)
    return runGeneration(event, 'topics', (signal) =>
      topicGenerator.generate(input, (streamEvent) => sendToStream(event, 'topics:stream', streamEvent), signal))
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
  handle('materials:usage', () => database.materialUsage())
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
  handle('materials:add-file',(_e,raw:unknown)=>{const input=z.object({fileName:z.string().trim().min(1).max(300),data:z.instanceof(ArrayBuffer),relatedTopicId:z.string().uuid().optional()}).parse(raw);return fileMaterials.importFromUpload(input)})

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
  handle('frameworks:generate', (event, raw: GenerateFrameworksInput) => {
    const input = z.object({
      topicId: z.string().uuid().optional(), accountId: z.string().uuid().optional(),
      materialIds: z.array(z.string().uuid()).max(30), templateId: z.string().min(1).max(100),
      manualTopic: z.string().trim().max(2_000).optional(), providerId: z.string().uuid(),
      model: z.string().trim().min(1).max(160), count: z.number().int().min(1).max(3)
    }).parse(raw)
    return runGeneration(event, 'frameworks', (signal) =>
      frameworkGenerator.generate(input, (streamEvent) => sendToStream(event, 'frameworks:stream', streamEvent), signal))
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
  handle('articles:generate', (event, raw: GenerateArticlesInput) => {
    const input = z.object({
      frameworkId: articleIdSchema.optional(), accountId: articleIdSchema.optional(),
      materialIds: z.array(articleIdSchema).max(30), manualOutline: z.string().trim().min(1).max(30_000).optional(),
      providerId: articleIdSchema, model: z.string().trim().min(1).max(160), count: z.number().int().min(1).max(3)
    }).refine((value) => Boolean(value.frameworkId || value.manualOutline), { message: '请选择框架或填写手动框架' }).parse(raw)
    return runGeneration(event, 'articles', (signal) =>
      articleGenerator.generate(input, (streamEvent) => sendToStream(event, 'articles:stream', streamEvent), signal))
  })
  handle('clipboard:writeRichText', (_event, raw: { html: string; text: string }) => {
    const input = z.object({ html: z.string().min(1).max(3_000_000), text: z.string().max(1_000_000) }).parse(raw)
    // 公众号等富文本编辑器读取的是剪贴板中的 HTML 格式，只写纯文本会丢掉全部样式
    clipboard.write({ html: input.html, text: input.text })
    return true
  })
  handle('articles:revise', (event, raw: ReviseArticleInput) => {
    const input = z.object({
      articleId: articleIdSchema, instruction: z.string().trim().min(1).max(8_000), alignFramework: z.boolean(),
      providerId: articleIdSchema, model: z.string().trim().min(1).max(160), count: z.number().int().min(1).max(3),
      baseMarkdown: z.string().max(200_000).optional()
    }).parse(raw)
    return runGeneration(event, 'articles', (signal) =>
      articleGenerator.revise(input, (streamEvent) => sendToStream(event, 'articles:stream', streamEvent), signal))
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
  handle('articles:rename-version', (_event, raw: RenameArticleVersionInput) => {
    const input = z.object({ articleId: articleIdSchema, versionId: articleIdSchema, label: z.string().max(60) }).parse(raw)
    return database.renameArticleVersion(input.articleId, input.versionId, input.label)
  })
  handle('articles:set-locked', (_event, id: string, locked: boolean) => database.setArticleLocked(requireId(id), Boolean(locked)))
  handle('articles:remove', (_event, id: string) => database.removeArticle(requireId(id)))
  handle('reviews:roles:list',()=>database.listReviewRoles())
  handle('reviews:roles:save',(_e,raw:SaveReviewRoleInput)=>database.saveReviewRole(z.object({id:z.string().optional(),name:z.string().trim().min(1).max(80),systemPrompt:z.string().trim().min(1).max(12000),providerId:z.string().uuid().optional(),model:z.string().trim().max(160).optional(),extractionTag:z.string().trim().min(1).max(50),extractionOccurrence:z.enum(['first','last']),dimensions:z.array(z.string().trim().min(1).max(50)).max(10),sortOrder:z.number().int().min(0)}).parse(raw)))
  handle('reviews:roles:remove',(_e,id:string)=>database.removeReviewRole(requireId(id)))
  handle('reviews:tasks:list',(_e,articleId?:string)=>database.listReviewTasks(articleId))
  handle('reviews:start',(event,raw:StartReviewInput)=>{const input=z.object({articleId:z.string().uuid(),roleIds:z.array(z.string().uuid()).min(1).max(10),fallbackProviderId:z.string().uuid(),fallbackModel:z.string().min(1).max(160)}).parse(raw);return runGeneration(event,'reviews',(signal)=>reviewService.start(input,(streamEvent)=>sendToStream(event,'reviews:stream',streamEvent),signal))})
  handle('reviews:problems:update',(_e,raw:UpdateReviewProblemInput)=>database.updateReviewProblem(z.object({id:z.string().uuid(),position:z.string().min(1),severity:z.enum(['high','medium','low']),issue:z.string().min(1),suggestion:z.string().min(1),adopted:z.boolean()}).parse(raw)))
  handle('reviews:problems:add',(_e,raw:AddManualReviewProblemInput)=>{const x=z.object({taskId:z.string().uuid(),position:z.string().min(1),severity:z.enum(['high','medium','low']),issue:z.string().min(1),suggestion:z.string().min(1)}).parse(raw);return database.addReviewOpinion({taskId:x.taskId,dimensions:[],overallSuggestion:'',rawXml:'',extractionMatched:true,problems:[{...x,adopted:true,isManual:true}] }).problems[0]})
  handle('reviews:apply',(event,taskId:string,providerId:string,model:string,force?:boolean)=>runGeneration(event,'reviews',(signal)=>reviewService.apply(requireId(taskId),requireId(providerId),model,{force:Boolean(force)},(streamEvent)=>sendToStream(event,'reviews:stream',streamEvent),signal)))
  handle('visuals:list',(_e,articleId?:string)=>database.listVisualPacks(articleId?requireId(articleId):undefined))
  handle('visuals:generate',(event,raw:unknown)=>{const input=z.object({articleId:z.string().uuid(),providerId:z.string().uuid(),model:z.string().trim().min(1).max(160),inlineCount:z.number().int().min(1).max(6)}).parse(raw);return runGeneration(event,'visuals',(signal)=>visualPackGenerator.generate(input,(streamEvent)=>sendToStream(event,'visuals:stream',streamEvent),signal))})
  handle('visuals:remove',(_e,id:string)=>{const packId=requireId(id);void visualAssets.removePackAssets(packId);database.removeVisualPack(packId)})
  handle('visuals:list-assets',(_e,packId:string)=>database.listVisualAssets(requireId(packId)))
  handle('visuals:generate-image',(event,raw:unknown)=>{const input=z.object({packId:z.string().uuid(),kind:z.enum(['cover','inline','release']),slot:z.number().int().min(0).max(30).optional(),prompt:z.string().trim().min(1).max(8_000),providerId:z.string().uuid(),model:z.string().trim().min(1).max(160),size:z.string().trim().max(40).optional()}).parse(raw);return runGeneration(event,'visuals',(signal)=>visualAssets.generate(input,signal))})
  handle('visuals:import-image',(_e,raw:unknown)=>{const input=z.object({packId:z.string().uuid(),kind:z.enum(['cover','inline','release']),slot:z.number().int().min(0).max(30).optional(),prompt:z.string().trim().max(8_000),filePath:z.string().trim().min(1).max(1_000)}).parse(raw);return visualAssets.importFromFile(input)})
  handle('visuals:import-image-data',(_e,raw:unknown)=>{const input=z.object({packId:z.string().uuid(),kind:z.enum(['cover','inline','release']),slot:z.number().int().min(0).max(30).optional(),prompt:z.string().trim().max(8_000),fileName:z.string().trim().min(1).max(300),data:z.instanceof(ArrayBuffer)}).parse(raw);return visualAssets.importFromData(input)})
  handle('visuals:remove-asset',(_e,id:string)=>visualAssets.removeAsset(requireId(id)))
  handle('layouts:list',(_e,articleId?:string)=>database.listArticleLayouts(articleId?requireId(articleId):undefined))
  handle('layouts:themes',()=>listLayoutThemes())
  handle('layouts:create',(_e,raw:unknown)=>articleLayoutService.create(z.object({articleId:z.string().uuid(),platform:z.enum(['wechat','xiaohongshu','web']),themeId:z.string().trim().min(1).max(60).optional(),customCss:z.string().max(20_000).optional()}).parse(raw)))
  handle('layouts:remove',(_e,id:string)=>database.removeArticleLayout(requireId(id)))
  handle('publishing:wechat:get',()=>database.getWechatPublishChannel())
  handle('publishing:wechat:save',(_e,raw:unknown)=>{const input=z.object({appId:z.string().trim().max(100),appSecret:z.string().trim().min(1).max(1000).optional(),enabled:z.boolean()}).parse(raw);return database.saveWechatPublishChannel({appId:input.appId,enabled:input.enabled},input.appSecret?keyStore.encrypt(input.appSecret):undefined)})
  handle('publishing:wechat:test',()=>wechatPublishService.test())
  handle('publishing:list',()=>database.listPublications())
  handle('publishing:wechat:push-draft',(_e,raw:unknown)=>{const input=z.object({articleId:z.string().uuid(),layoutId:z.string().uuid(),thumbMediaId:z.string().trim().max(200).optional(),coverAssetId:z.string().uuid().optional(),author:z.string().trim().max(100).optional(),digest:z.string().trim().max(120).optional(),contentSourceUrl:z.string().trim().url().optional()}).refine((value)=>Boolean(value.thumbMediaId||value.coverAssetId),{message:'请先生成或导入封面图片，或手动填写封面素材标识'}).parse(raw);return wechatPublishService.pushDraft(input)})
  handle('publishing:wechat:upload-cover',(_e,raw:unknown)=>{const input=z.object({assetId:z.string().uuid()}).parse(raw);return wechatPublishService.uploadAsset(input.assetId)})
  handle('publishing:update',(_e,raw:unknown)=>{const input=z.object({id:z.string().uuid(),status:z.literal('published'),publishedUrl:z.string().url()}).parse(raw);return database.markPublicationPublished(input.id,input.publishedUrl)})
  handle('publishing:retro',(_e,raw:unknown)=>{const input=z.object({id:z.string().uuid(),goal:z.string().trim().max(2_000),result:z.string().trim().max(2_000),lesson:z.string().trim().max(2_000)}).parse(raw);return database.savePublicationRetro(input.id,{goal:input.goal,result:input.result,lesson:input.lesson})})
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
