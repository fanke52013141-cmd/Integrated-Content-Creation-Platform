import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type {
  GenerateTopicsInput,
  GenerateTopicsResult,
  HotFavorite,
  StreamEvent,
  Topic,
  TopicAssessment,
  TopicSchemaField
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { callModelWithFallback } from '../gateway/stream-helper.js'
import type { UnifiedRequest } from '../gateway/types.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { GatewayError } from '../gateway/types.js'
import { modelOutputTokens } from './material-context.js'

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

    // 历史去重（借鉴 wewrite）：把同账号近期选题喂给模型避开，选题撞车是最直接的浪费；
    // 只注入标题做轻量提示，不阻断生成
    const historyTitles = this.database.listTopics()
      .filter((topic) => !input.accountId || topic.accountIds.includes(input.accountId))
      .slice(0, 30)
      .map((topic) => topic.fields['选题主题'] || Object.values(topic.fields)[0] || '')
      .filter(Boolean)

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
        historyTitles,
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
    historyTitles: string[]
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
      maxTokens: modelOutputTokens(this.database, input.providerId, input.model, 8_000),
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
            serializeHistoryTitlesXml(input.historyTitles),
            `<生成任务>第 ${input.index + 1} 个独立选题，请与其他可能的方向保持差异。</生成任务>`
          ].filter(Boolean).join('\n\n')
        }
      ]
    }
    const response = await callModelWithFallback(this.gateway, request, {
      signal: input.signal,
      onDelta: (delta) => input.onStream?.({ phase: 'delta', index: input.index, total: input.total, delta }),
      onRetry: () => input.onStream?.({ phase: 'start', index: input.index, total: input.total })
    })
    const fields = parseTopicJson(response.content, input.schema)
    // 三维评估随新提示词输出；旧提示词/旧模型缺该项时不阻断选题生成
    const assessment = extractTopicAssessment(response.content)
    const topic = this.database.saveTopic({
      seedKeyword: input.seedKeyword,
      accountIds: input.accountId ? [input.accountId] : [],
      relatedHotIds: input.favorites.map((favorite) => favorite.id),
      status: 'draft',
      source: 'ai',
      fields,
      assessment,
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

/** 把近期已用选题注入 prompt 做历史去重；无历史时返回空串，由调用方过滤 */
export function serializeHistoryTitlesXml(titles: string[]): string {
  if (!titles.length) return ''
  const body = titles.map((title, index) => `${index + 1}. ${escapeXml(title)}`).join('\n')
  return `<近期已用选题>\n${body}\n</近期已用选题>`
}

/** 从模型原始输出提取"评估"对象；旧提示词/旧模型缺该项、输出不规范时返回 undefined */
export function extractTopicAssessment(content: string): TopicAssessment | undefined {
  for (const candidate of collectJsonCandidates(content)) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const object = Array.isArray(parsed) ? parsed[0] : parsed
      if (!object || typeof object !== 'object' || Array.isArray(object)) continue
      const assessment = normalizeAssessment((object as Record<string, unknown>)['评估'])
      if (assessment) return assessment
    } catch {
      // 与 parseTopicJson 同样的宽松提取策略
    }
  }
  return undefined
}

function normalizeAssessment(raw: unknown): TopicAssessment | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const score = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : undefined
    }
    // 字符串形态："9"；缺项、空串、非数值一律视为缺失，绝不把 Number('')=0 当成 1 分
    if (typeof value !== 'string' || !value.trim()) return undefined
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? Math.min(10, Math.max(1, Math.round(parsed))) : undefined
  }
  const appeal = score(record['吸引力'])
  const differentiation = score(record['差异化'])
  const feasibility = score(record['可行性'])
  if (appeal === undefined || differentiation === undefined || feasibility === undefined) return undefined
  const reason = typeof record['理由'] === 'string' ? record['理由'].trim().slice(0, 120) : ''
  return { appeal, differentiation, feasibility, reason }
}

function collectJsonCandidates(content: string): string[] {
  return [
    content.trim(),
    content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    extractJsonObject(content)
  ].filter((value): value is string => Boolean(value))
}

export function parseTopicJson(content: string, schema: TopicSchemaField[]): Record<string, string> {
  const candidates = collectJsonCandidates(content)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const object = Array.isArray(parsed) ? parsed[0] : parsed
      if (!object || typeof object !== 'object' || Array.isArray(object)) continue
      const record = object as Record<string, unknown>
      const normalized: Record<string, string> = {}
      let valid = true
      for (const field of schema) {
        const value = record[field.name]
        // 真实模型可能省略可选字段、把短语输出成数字：必填字段严格校验，
        // 可选项缺失补空串，模型多出的未知键按 additionalProperties 语义忽略
        if (value === undefined || value === null || typeof value === 'object') {
          if (field.required) { valid = false; break }
          normalized[field.name] = ''
          continue
        }
        normalized[field.name] = String(value).trim()
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
