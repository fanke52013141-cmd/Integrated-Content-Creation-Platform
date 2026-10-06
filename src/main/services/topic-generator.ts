import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type {
  GenerateTopicsInput,
  GenerateTopicsResult,
  HotFavorite,
  StreamEvent,
  Topic,
  TopicSchemaField
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { callModelWithFallback } from '../gateway/stream-helper.js'
import type { UnifiedRequest } from '../gateway/types.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { GatewayError } from '../gateway/types.js'

export class TopicGenerator {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(input: GenerateTopicsInput, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<GenerateTopicsResult> {
    const account = input.accountId ? this.database.getAccount(input.accountId) : null
    if (input.accountId && !account) throw new Error('账号定位不存在')
    if (account && account.status !== 'locked') throw new Error('选题生成只能使用已锁定的账号定位')

    const schema = this.database.getTopicSchema()
    if (!schema.length) throw new Error('请先配置至少一个选题字段')

    const seedKeyword = input.seedKeyword.trim()
    if (!seedKeyword) throw new Error('请填写热点关键词或主题')

    const favoriteIds = [...new Set(input.relatedHotFavoriteIds)]
    const favorites = this.database.listHotFavorites()
      .filter((favorite) => favoriteIds.includes(favorite.id))
    if (favorites.length !== favoriteIds.length) throw new Error('部分收藏热点不存在或已被删除')

    const work = Array.from({ length: input.count }, (_, index) =>
      this.generateOne({
        accountId: account?.id,
        accountVersionId: account?.currentVersionId,
        accountStatus: 'locked',
        accountXml: account ? serializeAccountXml(account.fields, account.redlines) : '<账号定位>通用创作，不使用账号定位</账号定位>',
        providerId: input.providerId,
        model: input.model,
        schema,
        seedKeyword,
        favorites,
        index,
        total: input.count,
        onStream,
        signal
      })
    )
    const settled = await Promise.allSettled(work)
    const topics: Topic[] = []
    const failed: Array<{ index: number; message: string }> = []
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') topics.push(result.value)
      else failed.push({ index: index + 1, message: readableError(result.reason) })
    })
    return { topics, failed }
  }

  private async generateOne(input: {
    accountId?: string
    accountVersionId?: string
    accountStatus: 'locked'
    accountXml: string
    providerId: string
    model: string
    schema: TopicSchemaField[]
    seedKeyword: string
    favorites: HotFavorite[]
    index: number
    total: number
    onStream?: (event: StreamEvent) => void
    signal?: AbortSignal
  }): Promise<Topic> {
    input.onStream?.({ phase: 'start', index: input.index, total: input.total })
    const request: UnifiedRequest = {
      providerId: input.providerId,
      model: input.model,
      temperature: 0.75,
      maxTokens: 2_000,
      jsonMode: true,
      messages: [
        {
          role: 'system',
          content: this.prompts.render('topic.generate', {
            '字段列表': input.schema.map((field) => field.name)
          })
        },
        {
          role: 'user',
          content: [
            input.accountXml,
            `<热搜关键词>${escapeXml(input.seedKeyword)}</热搜关键词>`,
            serializeFavoriteHotspotsXml(input.favorites),
            `<生成任务>第 ${input.index + 1} 个独立选题，请与其他可能的方向保持差异。</生成任务>`
          ].join('\n\n')
        }
      ]
    }
    const response = await callModelWithFallback(this.gateway, request, {
      signal: input.signal,
      onDelta: (delta) => input.onStream?.({ phase: 'delta', index: input.index, total: input.total, delta }),
      onRetry: () => input.onStream?.({ phase: 'start', index: input.index, total: input.total })
    })
    const fields = parseTopicJson(response.content, input.schema)
    const topic = this.database.saveTopic({
      seedKeyword: input.seedKeyword,
      accountIds: input.accountId ? [input.accountId] : [],
      relatedHotIds: input.favorites.map((favorite) => favorite.id),
      status: 'draft',
      source: 'ai',
      fields,
      providerId: response.providerId,
      model: response.model
    })
    if (input.accountId && input.accountVersionId) this.database.createArtifactReference({
      sourceType: 'account-profile',
      sourceId: input.accountId,
      sourceVersionId: input.accountVersionId,
      sourceStatusSnapshot: input.accountStatus,
      targetType: 'topic',
      targetId: topic.id
    })
    for (const favorite of input.favorites) {
      this.database.createArtifactReference({
        sourceType: 'hot-favorite',
        sourceId: favorite.id,
        sourceVersionId: favorite.id,
        sourceStatusSnapshot: 'locked',
        targetType: 'topic',
        targetId: topic.id
      })
    }
    input.onStream?.({ phase: 'complete', index: input.index, total: input.total })
    return topic
  }

}

export function parseTopicJson(content: string, schema: TopicSchemaField[]): Record<string, string> {
  const candidates = [
    content.trim(),
    content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    extractJsonObject(content)
  ].filter((value): value is string => Boolean(value))
  const expected = schema.map((field) => field.name)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const object = Array.isArray(parsed) ? parsed[0] : parsed
      if (!object || typeof object !== 'object' || Array.isArray(object)) continue
      const record = object as Record<string, unknown>
      const keys = Object.keys(record).sort()
      if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) continue
      const normalized: Record<string, string> = {}
      let valid = true
      for (const field of schema) {
        const value = record[field.name]
        if (typeof value !== 'string') {
          valid = false
          break
        }
        normalized[field.name] = value.trim()
        if (field.required && !normalized[field.name]) {
          valid = false
          break
        }
      }
      if (valid) return normalized
    } catch {
      // Try a more forgiving extraction strategy.
    }
  }

  throw new GatewayError('ParseError', '模型结果未能匹配当前选题字段，请换模型或重试')
}

export function serializeFavoriteHotspotsXml(favorites: HotFavorite[]): string {
  const body = favorites.length
    ? favorites.map((favorite, index) => (
      `${index + 1}. ID：${escapeXml(favorite.id)}\n来源：[${escapeXml(favorite.hotItem.sourceTitle)}] ${escapeXml(favorite.hotItem.title)}\n来源 URL：${escapeXml(favorite.hotItem.url)}\n获取时间：${escapeXml(favorite.hotItem.updateTime || favorite.createdAt)}\n摘要：${escapeXml(favorite.hotItem.desc)}\n核实状态：缓存快照，未实时核验`
    )).join('\n')
    : '无'
  return `<收藏热点>\n${body}\n</收藏热点>`
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  return start >= 0 && end > start ? content.slice(start, end + 1) : undefined
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : '生成失败，请重试'
}
