import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import { ReviewService } from '../src/main/services/review-service.js'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'
import { GatewayError } from '../src/main/gateway/types.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { disambiguateOptions, resolveAccountSelection, isReviewBaselineStale, resolveLayoutSelection } from '../src/shared/creation-state.js'
import { isDraftDirty, readWorkDraft, writeWorkDraft } from '../src/shared/creation-state.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'

const PROVIDER_ID = 'p1'
const MODEL_ID = 'mock-model'
const prompts = makePromptRegistryStub()

function ensureProvider(database: AppDatabase): void {
  database.saveProvider({
    id: PROVIDER_ID, displayName: '体验回归供应商', protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1', defaultModel: MODEL_ID, enabled: true, isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: MODEL_ID, displayName: MODEL_ID, reasoningVariants: [], isDefault: true, enabled: true }]
  })
}

function makeGateway(handler: (attempt: number, request: UnifiedRequest) => UnifiedResponse | Error): ModelGateway {
  let attempts = 0
  return {
    chat: vi.fn(async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      attempts += 1
      const result = handler(attempts, request)
      if (result instanceof Error) throw result
      return result
    })
  } as unknown as ModelGateway
}

function ok(request: UnifiedRequest, content: string): UnifiedResponse {
  return {
    providerId: request.providerId, model: request.model ?? MODEL_ID, content,
    extracted: undefined, extractionMatched: false, finishReason: 'stop',
    promptTokens: 5, completionTokens: 5, latencyMs: 1, jsonModeSimulated: false
  }
}

function newArticle(database: AppDatabase, markdown = '# 原标题\n\n原正文。'): string {
  return database.saveArticle({
    frameworkId: undefined, accountId: undefined, materialIds: [], manualOutline: '大纲',
    status: 'locked', rawMarkdown: markdown, source: 'manual'
  }).id
}

describe('F03 排版选中态限定在当前文章内', () => {
  const layouts = [
    { id: 'la1', articleId: 'A' }, { id: 'la2', articleId: 'A' },
    { id: 'lb1', articleId: 'B' }
  ]
  it('切到没有排版稿的文章时清空选中，不再指向另一篇', () => {
    expect(resolveLayoutSelection(layouts, 'A', 'la1')).toBe('la1')
    expect(resolveLayoutSelection(layouts, 'B', 'la1')).toBe('lb1')
    expect(resolveLayoutSelection(layouts, 'C', 'la1')).toBe('')
  })
  it('A→B→A 且当前稿被删除后回落到该文章最近稿', () => {
    const remaining = layouts.filter((item) => item.id !== 'la1')
    expect(resolveLayoutSelection(remaining, 'A', 'la1')).toBe('la2')
    expect(resolveLayoutSelection(remaining, 'B', 'lb1')).toBe('lb1')
  })
  it('同名文章的下拉项靠副标题分辨，不同名时不加噪声', () => {
    const options = disambiguateOptions([
      { value: 'a', label: '同名文章', hint: '草稿', distinct: '09-20 10:00' },
      { value: 'b', label: '同名文章', hint: '已锁定', distinct: '09-20 14:03' },
      { value: 'c', label: '另一篇', hint: '草稿', distinct: '09-19 09:00' }
    ])
    expect(options).toEqual([
      { value: 'a', label: '同名文章', hint: '草稿 · 09-20 10:00' },
      { value: 'b', label: '同名文章', hint: '已锁定 · 09-20 14:03' },
      { value: 'c', label: '另一篇', hint: '草稿' }
    ])
  })
})

describe('F05 账号定位的三种状态', () => {
  const accounts = [{ id: 'acc1' }, { id: 'acc2' }]
  it('未初始化时补默认账号', () => {
    expect(resolveAccountSelection({ current: '', accounts, currentAccountId: 'acc2', initialized: false }))
      .toEqual({ accountId: 'acc2', initialized: true })
  })
  it('用户主动选择「不使用账号定位」必须保持为空', () => {
    expect(resolveAccountSelection({ current: '', accounts, currentAccountId: 'acc2', initialized: true }))
      .toEqual({ accountId: '', initialized: true })
  })
  it('所选账号被删除时回落到当前账号，当前账号也没了则取第一个', () => {
    expect(resolveAccountSelection({ current: 'gone', accounts, currentAccountId: 'acc1', initialized: true }).accountId).toBe('acc1')
    expect(resolveAccountSelection({ current: 'gone', accounts, currentAccountId: 'gone', initialized: true }).accountId).toBe('acc1')
  })
  it('还没有账号时不锁定选择，等账号出现再补默认值', () => {
    expect(resolveAccountSelection({ current: '', accounts: [], initialized: false }))
      .toEqual({ accountId: '', initialized: false })
  })
})

describe('F02 正文工作草稿与改稿基线', () => {
  function memoryStore(): Storage & Map<string, string> {
    const map = new Map<string, string>()
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) },
      map
    } as unknown as Storage & Map<string, string>
  }

  it('未保存正文按文章隔离存放，切页/重启后仍可取回', () => {
    const store = memoryStore()
    writeWorkDraft(store, 'A', '# A\n\n未保存的关键编辑')
    writeWorkDraft(store, 'B', '# B\n\n另一篇的草稿')
    expect(readWorkDraft(store, 'A')).toContain('未保存的关键编辑')
    expect(readWorkDraft(store, 'B')).toContain('另一篇的草稿')
    expect(isDraftDirty(readWorkDraft(store, 'A'), '# A\n\n原稿')).toBe(true)
    expect(isDraftDirty(readWorkDraft(store, 'A'), '# A\n\n未保存的关键编辑')).toBe(false)
  })
  it('保存成功后清除本地草稿，回到跟随库内容', () => {
    const store = memoryStore()
    writeWorkDraft(store, 'A', '临时修改')
    writeWorkDraft(store, 'A', '')
    expect(readWorkDraft(store, 'A')).toBeNull()
  })
  it('改稿使用屏幕上的未保存正文，而不是库内旧稿', async () => {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const articleId = newArticle(database)
    const captured: UnifiedRequest[] = []
    const gateway = makeGateway((attempt, request) => {
      captured.push(request)
      return ok(request, '# 改后\n\n新正文')
    })
    const generator = new ArticleGenerator(database, gateway, prompts)
    await generator.revise({
      articleId, instruction: '加强开头', alignFramework: false, count: 1,
      providerId: PROVIDER_ID, model: MODEL_ID, baseMarkdown: '# 原标题\n\n未保存的关键编辑'
    })
    expect(captured[0].messages[1]?.content).toContain('未保存的关键编辑')
    database.close()
  })
})

describe('F07/F14 评审任务真实状态与版本基线', () => {
  function setup(): { database: AppDatabase; articleId: string; roleIds: string[]; roleNames: string[] } {
    const database = new AppDatabase(':memory:')
    ensureProvider(database)
    const roles = database.listReviewRoles().slice(0, 2)
    return { database, articleId: newArticle(database), roleIds: roles.map((role) => role.id), roleNames: roles.map((role) => role.name) }
  }
  const opinion = '<评审意见>位置：开头｜严重程度：高｜问题：太空｜建议：加钩子\n总体建议：更具体</评审意见>'

  it('全部角色失败时任务记为 failed，不伪装成评审完成', async () => {
    const { database, articleId, roleIds, roleNames } = setup()
    const gateway = makeGateway(() => new GatewayError('AuthError', 'HTTP 401'))
    const service = new ReviewService(database, gateway, new ArticleGenerator(database, gateway, prompts))
    const result = await service.start({ articleId, roleIds, fallbackProviderId: PROVIDER_ID, fallbackModel: MODEL_ID })
    expect(result.failed).toHaveLength(2)
    expect(result.task.status).toBe('failed')
    expect(result.task.opinions).toHaveLength(0)
    expect(result.task.failures.map((item) => item.roleName)).toEqual(roleNames)
    database.close()
  })

  it('部分角色失败时任务记为 partial，并保留成功意见', async () => {
    const { database, articleId, roleIds } = setup()
    const gateway = makeGateway((attempt, request) => (attempt === 2 ? new GatewayError('AuthError', 'HTTP 401') : ok(request, opinion)))
    const service = new ReviewService(database, gateway, new ArticleGenerator(database, gateway, prompts))
    const result = await service.start({ articleId, roleIds, fallbackProviderId: PROVIDER_ID, fallbackModel: MODEL_ID })
    expect(result.task.status).toBe('partial')
    expect(result.task.opinions).toHaveLength(1)
    expect(result.task.opinions[0]?.problems[0]?.issue).toBe('太空')
    database.close()
  })

  it('模型返回无法识别的内容时按失败处理，不能显示为评审完成', async () => {
    const { database, articleId, roleIds } = setup()
    const gateway = makeGateway((_attempt, request) => ok(request, '我觉得这篇文章整体还可以。'))
    const service = new ReviewService(database, gateway, new ArticleGenerator(database, gateway, prompts))
    const result = await service.start({ articleId, roleIds, fallbackProviderId: PROVIDER_ID, fallbackModel: MODEL_ID })

    expect(result.task.status).toBe('failed')
    expect(result.task.opinions).toHaveLength(0)
    expect(result.failed).toHaveLength(roleIds.length)
    expect(result.failed.every((item) => item.message.includes('未返回可识别的评审意见'))).toBe(true)
    database.close()
  })

  it('重复提交同一角色只执行一次，失败数量不被重复勾选放大', async () => {
    const { database, articleId, roleIds } = setup()
    const gateway = makeGateway((_attempt, request) => ok(request, opinion))
    const service = new ReviewService(database, gateway, new ArticleGenerator(database, gateway, prompts))
    const result = await service.start({
      articleId,
      roleIds: [roleIds[0], roleIds[0]],
      fallbackProviderId: PROVIDER_ID,
      fallbackModel: MODEL_ID
    })

    expect(result.task.status).toBe('completed')
    expect(result.task.roleIds).toEqual([roleIds[0]])
    expect(result.task.opinions).toHaveLength(1)
    expect(gateway.chat).toHaveBeenCalledTimes(1)
    database.close()
  })

  it('全部成功记为 completed 并绑定评审所依据的文章版本', async () => {
    const { database, articleId, roleIds } = setup()
    const gateway = makeGateway((_attempt, request) => ok(request, opinion))
    const service = new ReviewService(database, gateway, new ArticleGenerator(database, gateway, prompts))
    const result = await service.start({ articleId, roleIds, fallbackProviderId: PROVIDER_ID, fallbackModel: MODEL_ID })
    const article = database.getArticle(articleId)!
    expect(result.task.status).toBe('completed')
    expect(result.task.articleVersionId).toBe(article.currentVersionId)
    expect(result.task.articleVersionNumber).toBe(article.versionCount)
    database.close()
  })

  it('评审 V1 后文章改版，应用旧意见必须被拦下，显式确认才继续', async () => {
    const { database, articleId, roleIds } = setup()
    const gateway = makeGateway((_attempt, request) => ok(request,
      String(request.messages.at(-1)?.content ?? '').includes('<成稿>') ? opinion : '# 应用评审后的标题\n\n已按采纳意见修改。'))
    const service = new ReviewService(database, gateway, new ArticleGenerator(database, gateway, prompts))
    const { task } = await service.start({ articleId, roleIds, fallbackProviderId: PROVIDER_ID, fallbackModel: MODEL_ID })
    database.saveArticle({
      id: articleId, materialIds: [], manualOutline: '大纲', status: 'locked',
      rawMarkdown: '# 原标题\n\n手工改成的 V2。', source: 'manual'
    })
    const staleArticle = database.getArticle(articleId)!
    expect(isReviewBaselineStale(task, staleArticle)).toBe(true)
    await expect(service.apply(task.id, PROVIDER_ID, MODEL_ID)).rejects.toThrow(/第 1 版|第 2 版/)
    const applied = await service.apply(task.id, PROVIDER_ID, MODEL_ID, { force: true })
    expect(applied.currentVersionId).not.toBe(task.articleVersionId)
    database.close()
  })
})

describe('F04 排版与预览共用完整 Markdown 语法', () => {
  const sample = [
    '# 标题层级',
    '',
    '这里有 **重点** 和 [来源链接](https://example.com/a)。',
    '',
    '![封面图](https://example.com/cover.png)',
    '',
    '- 列表一',
    '  - 嵌套二',
    '',
    '> 引用一句',
    '',
    '| 平台 | 字数 |',
    '| --- | --- |',
    '| 公众号 | 64 |',
    '',
    '```js',
    'const a = 1',
    '```'
  ].join('\n')

  it('排版输出保留强调、链接、图片、表格、列表与代码', () => {
    const { html } = renderLayoutMarkdown(sample, 'wechat', 'wechat-green')
    expect(html).toMatch(/<strong[^>]*>重点<\/strong>/)
    expect(html).toContain('example.com/cover.png')
    expect(html).toMatch(/<table/)
    expect(html).toMatch(/嵌套二/)
    expect(html).toContain('参考链接')
    expect(html).not.toContain('**重点**')
  })
  it('纯文本降级保留图片占位与链接文字', () => {
    const { plainText } = renderLayoutMarkdown(sample, 'wechat', 'wechat-green')
    expect(plainText).toContain('[图：封面图]')
    expect(plainText).toContain('来源链接')
  })
})
