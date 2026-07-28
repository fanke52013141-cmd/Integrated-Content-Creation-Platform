import type {
  MaterialSearchImageResult,
  MaterialSearchInput,
  MaterialSearchResult,
  MaterialSearchWebResult
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { KeyStore } from '../security/key-store.js'

export const DOUBAO_SEARCH_ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search'

interface DoubaoSearchResponse {
  ResponseMetadata?: {
    RequestId?: string
    Error?: { Code?: string; CodeN?: number; Message?: string }
  }
  Result?: {
    TimeCost?: number
    LogId?: string
    WebResults?: Array<{
      Id?: string
      Title?: string
      Url?: string
      SiteName?: string
      Snippet?: string
      Summary?: string
      PublishTime?: string
      RankScore?: number
      AuthInfoDes?: string
    }>
    ImageResults?: Array<{
      Id?: string
      Title?: string
      Url?: string
      SiteName?: string
      PublishTime?: string
      Image?: {
        Url?: string
        Width?: number
        Height?: number
        Shape?: string
        Watermark?: string
      }
    }>
  }
}

export class MaterialSearchService {
  private lastRequestAt = 0

  constructor(
    private readonly database: AppDatabase,
    private readonly keyStore: KeyStore,
    private readonly endpoint = DOUBAO_SEARCH_ENDPOINT
  ) {}

  async search(input: MaterialSearchInput): Promise<MaterialSearchResult> {
    const service = this.database.getSearchService()
    if (!service.enabled) throw new Error('豆包搜索服务已停用，请在模型网关中启用')
    const apiKey = this.keyStore.readSearchService()
    const count = input.type === 'web'
      ? Math.min(50, Math.max(1, input.count ?? 10))
      : Math.min(5, Math.max(1, input.count ?? 5))
    const payload = input.type === 'web'
      ? {
          Query: input.query.trim(),
          SearchType: 'web',
          Count: count,
          Filter: {
            NeedContent: true,
            NeedUrl: true,
            ...(input.sites?.trim() ? { Sites: input.sites.trim() } : {}),
            ...(input.authorityOnly ? { AuthInfoLevel: 1 } : {})
          },
          ...(input.timeRange ? { TimeRange: input.timeRange } : {})
        }
      : {
          Query: input.query.trim(),
          SearchType: 'image',
          Count: count
        }
    const startedAt = performance.now()
    const response = await this.request(apiKey, payload)
    const latencyMs = Math.round(performance.now() - startedAt)
    const metadata = response.ResponseMetadata
    if (metadata?.Error) throw searchError(metadata.Error.Code ?? String(metadata.Error.CodeN ?? ''), metadata.Error.Message)

    if (input.type === 'web') {
      const results: MaterialSearchWebResult[] = (response.Result?.WebResults ?? [])
        .flatMap((item) => {
          const id = item.Id?.trim()
          const title = item.Title?.trim()
          const sourceUrl = item.Url?.trim()
          if (!id || !title || !sourceUrl) return []
          return [{
            id,
            title,
            summary: item.Summary?.trim() ?? '',
            snippet: item.Snippet?.trim() ?? '',
            sourceUrl,
            sourceName: item.SiteName?.trim() || undefined,
            publishedAt: item.PublishTime?.trim() || undefined,
            authority: item.AuthInfoDes?.trim() || undefined,
            relevanceScore: typeof item.RankScore === 'number' ? item.RankScore : undefined
          }]
        })
      return {
        query: input.query.trim(), type: 'web', results, latencyMs,
        requestId: metadata?.RequestId, logId: response.Result?.LogId
      }
    }

    const results: MaterialSearchImageResult[] = (response.Result?.ImageResults ?? [])
      .flatMap((item) => {
        const id = item.Id?.trim()
        const imageUrl = item.Image?.Url?.trim()
        const sourceUrl = item.Url?.trim()
        if (!id || !imageUrl || !sourceUrl) return []
        return [{
          id,
          title: item.Title?.trim() || '未命名图片参考',
          sourceUrl,
          sourceName: item.SiteName?.trim() || undefined,
          publishedAt: item.PublishTime?.trim() || undefined,
          imageUrl,
          imageWidth: item.Image?.Width,
          imageHeight: item.Image?.Height,
          imageShape: item.Image?.Shape?.trim() || undefined,
          watermark: item.Image?.Watermark?.trim() || undefined
        }]
      })
    return {
      query: input.query.trim(), type: 'image', results, latencyMs,
      requestId: metadata?.RequestId, logId: response.Result?.LogId
    }
  }

  private async request(apiKey: string, payload: Record<string, unknown>): Promise<DoubaoSearchResponse> {
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < 250) await delay(250 - elapsed)
    this.lastRequestAt = Date.now()

    let lastError: Error | undefined
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30_000)
        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          })
          const text = await response.text()
          let body: DoubaoSearchResponse
          try {
            body = JSON.parse(text) as DoubaoSearchResponse
          } catch {
            throw new Error(response.ok ? '搜索服务返回格式异常' : `搜索服务请求失败（HTTP ${response.status}）`)
          }
          if (!response.ok && !body.ResponseMetadata?.Error) {
            throw new Error(`搜索服务请求失败（HTTP ${response.status}）`)
          }
          if (body.ResponseMetadata?.Error?.Code === '10500' && attempt < 2) {
            await delay(500)
            continue
          }
          return body
        } finally {
          clearTimeout(timeout)
        }
      } catch (error) {
        lastError = error instanceof DOMException && error.name === 'AbortError'
          ? new Error('豆包搜索请求超过 30 秒')
          : error instanceof Error ? error : new Error('豆包搜索请求失败')
        if (attempt < 2) await delay(500)
      }
    }
    throw lastError ?? new Error('豆包搜索请求失败')
  }
}

function searchError(code: string, message?: string): Error {
  const known: Record<string, string> = {
    '10400': '搜索参数无效，请检查搜索词和筛选条件',
    '10401': '豆包搜索 API Key 无效',
    '10402': '当前账号未开通该搜索类型',
    '10403': '当前账号没有豆包搜索权限',
    '10406': '豆包搜索免费额度已耗尽，请在控制台开通套餐或按量计费',
    '10409': '当前套餐不支持该搜索类型',
    '10410': '没有可用的豆包搜索套餐',
    '10412': '豆包搜索套餐额度不足',
    '700429': '豆包搜索请求过快，请稍后重试'
  }
  return new Error(known[code] ?? message?.slice(0, 300) ?? '豆包搜索服务暂不可用')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
