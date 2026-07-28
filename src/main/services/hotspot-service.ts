import { createHash } from 'node:crypto'
import type {
  HotItem,
  HotSource,
  HotSourceResult,
  HotspotBootstrap
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { EmbeddedHotService } from './embedded-hot-service.js'

interface UpstreamRoute {
  name?: unknown
  path?: unknown
}

interface UpstreamRegistry {
  code?: unknown
  routes?: unknown
}

interface UpstreamList {
  code?: unknown
  title?: unknown
  subtitle?: unknown
  updateTime?: unknown
  data?: unknown
}

type UpstreamItem = Record<string, unknown>

const PRIMARY_SOURCE_IDS = [
  'weibo',
  'zhihu',
  'baidu',
  'douyin',
  'toutiao',
  'bilibili',
  'qq-news',
  'ithome'
]

const SOURCE_NAMES: Record<string, string> = {
  '36kr': '36氪',
  '51cto': '51CTO',
  '52pojie': '吾爱破解',
  acfun: 'AcFun',
  baidu: '百度',
  bilibili: '哔哩哔哩',
  coolapk: '酷安',
  csdn: 'CSDN',
  'douban-group': '豆瓣小组',
  'douban-movie': '豆瓣电影',
  douyin: '抖音',
  earthquake: '中国地震台',
  genshin: '原神',
  github: 'GitHub',
  guokr: '果壳',
  hellogithub: 'HelloGitHub',
  history: '历史上的今天',
  honkai: '崩坏3',
  hostloc: '全球主机交流',
  hupu: '虎扑',
  huxiu: '虎嗅',
  ifanr: '爱范儿',
  ithome: 'IT之家',
  'ithome-xijiayi': 'IT之家喜加一',
  jianshu: '简书',
  juejin: '稀土掘金',
  kuaishou: '快手',
  lol: '英雄联盟',
  miyoushe: '米游社',
  'netease-news': '网易新闻',
  ngabbs: 'NGA',
  nodeseek: 'NodeSeek',
  'qq-news': '腾讯新闻',
  sina: '新浪网',
  'sina-news': '新浪新闻',
  sspai: '少数派',
  starrail: '崩坏：星穹铁道',
  thepaper: '澎湃新闻',
  tieba: '百度贴吧',
  toutiao: '今日头条',
  v2ex: 'V2EX',
  weatheralarm: '中央气象台',
  weibo: '微博',
  weread: '微信读书',
  zhihu: '知乎',
  'zhihu-daily': '知乎日报'
}

export class HotspotService {
  private sources: HotSource[] = []

  constructor(
    private readonly embedded: EmbeddedHotService,
    private readonly database?: AppDatabase
  ) {}

  async bootstrap(): Promise<HotspotBootstrap> {
    const baseUrl = await this.embedded.start()
    const response = await fetch(`${baseUrl}/all`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) throw new Error(`热点源发现失败（${response.status}）`)
    const payload = await response.json() as UpstreamRegistry
    if (payload.code !== 200 || !Array.isArray(payload.routes)) {
      throw new Error('热点源清单格式无效')
    }

    const sources = payload.routes
      .map((route): HotSource | undefined => this.normalizeSource(route as UpstreamRoute))
      .filter((source): source is HotSource => Boolean(source))
    const primaryOrder = new Map(PRIMARY_SOURCE_IDS.map((id, index) => [id, index]))
    sources.sort((left, right) => {
      const leftOrder = primaryOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = primaryOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.displayName.localeCompare(right.displayName, 'zh-CN')
    })
    this.sources = sources
    return {
      service: this.embedded.status(),
      sources,
      preferences: this.database?.listHotSourcePreferences() ?? []
    }
  }

  async refresh(sourceIds?: string[]): Promise<HotSourceResult[]> {
    if (!this.sources.length) await this.bootstrap()
    const requested = sourceIds?.length
      ? this.sources.filter((source) => sourceIds.includes(source.id))
      : this.sources
    return Promise.all(requested.map((source) => this.fetchSource(source)))
  }

  private normalizeSource(route: UpstreamRoute): HotSource | undefined {
    if (typeof route.name !== 'string' || typeof route.path !== 'string') return undefined
    if (!/^[a-z0-9][a-z0-9/-]*$/i.test(route.name)) return undefined
    return {
      id: route.name,
      path: route.path,
      displayName: SOURCE_NAMES[route.name] ?? route.name
    }
  }

  private async fetchSource(source: HotSource): Promise<HotSourceResult> {
    const fallback: HotSourceResult = {
      source,
      status: 'error',
      subtitle: '热榜',
      updateTime: new Date().toISOString(),
      items: []
    }

    try {
      const baseUrl = await this.embedded.start()
      const response = await fetch(`${baseUrl}${source.path}?limit=20`, {
        signal: AbortSignal.timeout(16_000)
      })
      if (!response.ok) throw new Error(`请求失败（${response.status}）`)
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) throw new Error('数据源返回了非 JSON 内容')
      const payload = await response.json() as UpstreamList
      if (payload.code !== 200 || !Array.isArray(payload.data)) {
        throw new Error('数据源返回格式无效')
      }

      const sourceTitle = text(payload.title) || source.displayName
      const subtitle = text(payload.subtitle) || '热榜'
      const updateTime = text(payload.updateTime) || new Date().toISOString()
      const items = payload.data
        .map((item, index) => this.normalizeItem(
          item as UpstreamItem,
          index,
          source,
          sourceTitle,
          subtitle,
          updateTime
        ))
        .filter((item): item is HotItem => Boolean(item))
      if (!items.length) throw new Error('该平台暂未返回有效热点')

      return {
        source: { ...source, displayName: sourceTitle },
        status: 'ready',
        subtitle,
        updateTime,
        items
      }
    } catch (error) {
      return {
        ...fallback,
        error: error instanceof Error ? error.message : '平台暂时无法获取'
      }
    }
  }

  private normalizeItem(
    raw: UpstreamItem,
    index: number,
    source: HotSource,
    sourceTitle: string,
    subtitle: string,
    updateTime: string
  ): HotItem | undefined {
    const title = text(raw.title)
    if (!title) return undefined
    const url = text(raw.url) || text(raw.mobileUrl)
    const rawId = text(raw.id)
    const id = rawId || createHash('sha1')
      .update(`${source.id}\n${title}\n${url}`)
      .digest('hex')
      .slice(0, 20)

    return {
      id,
      title,
      desc: text(raw.desc),
      pic: text(raw.pic) || text(raw.cover) || undefined,
      url,
      source: source.id,
      sourceTitle,
      subtitle,
      updateTime,
      hotValue: formatHotValue(raw.hot),
      rank: index + 1,
      rawJson: JSON.stringify(raw)
    }
  }
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function formatHotValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return new Intl.NumberFormat('zh-CN').format(value)
}
