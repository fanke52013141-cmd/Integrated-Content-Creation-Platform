import { z } from 'zod'
import type {
  FilterHotspotsInput,
  FilterHotspotsResult,
  HotItem,
  HotspotFit,
  StreamEvent
} from '../../shared/contracts.js'
import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { callModelWithFallback } from '../gateway/stream-helper.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { GatewayError } from '../gateway/types.js'

const assessmentSchema = z.object({
  index: z.number().int().positive(),
  fit: z.string(),
  reason: z.string().trim().min(1),
  angle: z.string().trim()
})

const resultSchema = z.object({
  results: z.array(assessmentSchema).min(1)
})

export class HotspotFilter {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async filter(
    input: FilterHotspotsInput,
    onStream?: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<FilterHotspotsResult> {
    const account = this.database.getAccount(input.accountId)
    if (!account) throw new Error('账号定位不存在')
    if (account.status !== 'locked') throw new Error('热点筛选只能使用已锁定账号定位')

    const items = deduplicateItems(input.items)
    if (!items.length) throw new Error('至少选择一条热点')
    if (items.length > 200) throw new Error('单次最多筛选 200 条热点，请减少平台或前 N 名数量')

    onStream?.({ phase: 'start', index: 0, total: 1 })
    const response = await callModelWithFallback(this.gateway, {
      providerId: input.providerId,
      model: input.model,
      temperature: 0.3,
      maxTokens: Math.min(16_000, Math.max(2_000, items.length * 180)),
      jsonMode: true,
      signal,
      messages: [
        {
          role: 'system',
          content: this.prompts.render('hotspot.filter')
        },
        {
          role: 'user',
          content: `${serializeAccountXml(account.fields)}\n\n${serializeHotListXml(items)}`
        }
      ]
    }, {
      signal,
      onDelta: (delta) => onStream?.({ phase: 'delta', index: 0, total: 1, delta }),
      onRetry: () => onStream?.({ phase: 'start', index: 0, total: 1 })
    })

    try {
      const parsed = parseHotspotFilterJson(response.content, items.length)
      return {
        accountId: account.id,
        accountVersionId: account.currentVersionId,
        providerId: response.providerId,
        model: response.model,
        latencyMs: response.latencyMs,
        assessments: parsed.map((assessment) => ({
          hotItem: items[assessment.index - 1],
          fit: assessment.fit,
          reason: assessment.reason,
          angle: assessment.angle
        }))
      }
    } finally {
      onStream?.({ phase: 'complete', index: 0, total: 1 })
    }
  }
}

export function serializeHotListXml(items: HotItem[]): string {
  const body = items
    .map((item, index) =>
      `${index + 1}. [${escapeXml(item.sourceTitle)}] ${escapeXml(item.title)}`
    )
    .join('\n')
  return `<热搜列表>\n${body}\n</热搜列表>`
}

export function parseHotspotFilterJson(
  content: string,
  expectedCount: number
): Array<{ index: number; fit: HotspotFit; reason: string; angle: string }> {
  const candidates = [
    content.trim(),
    content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    extractJsonObject(content)
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    try {
      const parsed = resultSchema.parse(JSON.parse(candidate))
      const normalized = parsed.results.map((item) => ({
        index: item.index,
        fit: normalizeFit(item.fit),
        reason: item.reason,
        angle: item.angle || (normalizeFit(item.fit) === 'low' ? '无' : '待人工补充')
      }))
      const indexes = normalized.map((item) => item.index)
      const expected = Array.from({ length: expectedCount }, (_, index) => index + 1)
      if (
        normalized.length === expectedCount &&
        new Set(indexes).size === expectedCount &&
        [...indexes].sort((left, right) => left - right).every((value, index) => value === expected[index])
      ) {
        return normalized.sort((left, right) => left.index - right.index)
      }
    } catch {
      // Try the next extraction strategy.
    }
  }

  throw new GatewayError(
    'ParseError',
    '模型结果未覆盖全部热点或格式无效，请换模型或重试'
  )
}

function normalizeFit(value: string): HotspotFit {
  const normalized = value.trim().toLocaleLowerCase()
  if (normalized === '高' || normalized === 'high') return 'high'
  if (normalized === '中' || normalized === 'medium') return 'medium'
  if (normalized === '低' || normalized === 'low') return 'low'
  throw new Error(`未知契合度：${value}`)
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  return start >= 0 && end > start ? content.slice(start, end + 1) : undefined
}

function deduplicateItems(items: HotItem[]): HotItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.source}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
