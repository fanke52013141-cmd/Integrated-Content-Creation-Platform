/**
 * Browser preview bridge.
 *
 * In Electron the preload script exposes `window.moliu` via contextBridge.
 * When the renderer is opened directly in a browser (e.g. for UI preview),
 * the preload never runs and `window.moliu` is undefined, which crashes the
 * app on bootstrap. This module injects a lightweight mock so the UI can
 * render with demo data outside Electron.
 *
 * It is a no-op when the real bridge already exists.
 */
import type {
  AppBootstrap,
  HotspotBootstrap,
  HotSourceResult,
  MoliuApi,
  ProviderPreset
} from '../../shared/contracts'

const DEMO_BOOTSTRAP: AppBootstrap = {
  providers: [
    {
      id: 'demo-provider',
      displayName: '演示供应商',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'demo-model',
      enabled: true,
      isRelay: false,
      capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false },
      models: [
        {
          id: 'demo-model',
          providerId: 'demo-provider',
          modelId: 'demo-model',
          displayName: '演示模型',
          contextLimit: 128000,
          outputLimit: 4096,
          reasoningVariants: [],
          isDefault: true,
          enabled: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        }
      ],
      hasApiKey: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }
  ],
  searchService: {
    id: 'doubao-custom',
    displayName: '豆包搜索 Custom 版',
    enabled: true,
    hasApiKey: false,
    updatedAt: '2025-01-01T00:00:00.000Z'
  },
  accounts: [
    {
      id: 'demo-account',
      name: '心流示例',
      intro: '专注于科技与生活方式的内容创作者，分享实用见解与生活美学。',
      domain: '科技生活',
      status: 'locked',
      isCurrent: true,
      versionCount: 2,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-06-15T00:00:00.000Z'
    }
  ],
  currentAccountId: 'demo-account'
}

const DEMO_SOURCES = [
  ['weibo', '微博'],
  ['zhihu', '知乎'],
  ['baidu', '百度'],
  ['douyin', '抖音'],
  ['bilibili', '哔哩哔哩'],
  ['ithome', 'IT之家'],
  ['36kr', '36氪'],
  ['csdn', 'CSDN'],
  ['juejin', '稀土掘金'],
  ['toutiao', '今日头条'],
  ['netease-news', '网易新闻'],
  ['qq-news', '腾讯新闻'],
  ['sina', '新浪网'],
  ['thepaper', '澎湃新闻'],
  ['kuaishou', '快手'],
  ['hupu', '虎扑'],
  ['huxiu', '虎嗅'],
  ['ifanr', '爱范儿'],
  ['sspai', '少数派'],
  ['ngabbs', 'NGA'],
  ['v2ex', 'V2EX'],
  ['github', 'GitHub'],
  ['hellogithub', 'HelloGitHub'],
  ['tieba', '百度贴吧'],
  ['douban-group', '豆瓣小组'],
  ['douban-movie', '豆瓣电影'],
  ['jianshu', '简书'],
  ['coolapk', '酷安'],
  ['acfun', 'AcFun'],
  ['weread', '微信读书'],
  ['zhihu-daily', '知乎日报'],
  ['history', '历史上的今天'],
  ['earthquake', '中国地震台'],
  ['weatheralarm', '中央气象台'],
  ['51cto', '51CTO'],
  ['52pojie', '吾爱破解'],
  ['nodeseek', 'NodeSeek'],
  ['hostloc', '全球主机交流'],
  ['guokr', '果壳'],
  ['miyoushe', '米游社'],
  ['genshin', '原神'],
  ['honkai', '崩坏3'],
  ['starrail', '崩坏：星穹铁道'],
  ['lol', '英雄联盟'],
  ['ithome-xijiayi', 'IT之家喜加一']
] as const

const DEMO_HOTSPOT_BOOTSTRAP: HotspotBootstrap = {
  service: {
    mode: 'embedded',
    state: 'ready',
    version: 'demo-1.0',
    routeCount: DEMO_SOURCES.length
  },
  sources: DEMO_SOURCES.map(([id, displayName]) => ({ id, path: id, displayName })),
  preferences: DEMO_SOURCES.map(([id], index) => ({
    sourceId: id,
    hidden: false,
    sortOrder: index,
    updatedAt: '2025-01-01T00:00:00.000Z'
  }))
}

const DEMO_SOURCE_RESULTS: HotSourceResult[] = DEMO_HOTSPOT_BOOTSTRAP.sources.map((source) => ({
  source,
  status: 'ready' as const,
  subtitle: '实时榜单',
  updateTime: new Date().toISOString(),
  items: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ].map((rank) => ({
    id: `${source.id}-${rank}`,
    title: `${source.displayName}示例热点 #${rank} · 这是一条用于演示的热点数据`,
    desc: '演示数据：此条目用于展示热点洞察页面的布局与交互效果。',
    url: 'https://example.com',
    source: source.id,
    sourceTitle: source.displayName,
    subtitle: source.displayName,
    updateTime: new Date().toISOString(),
    hotValue: `${(10000 - rank * 850).toLocaleString()} 热`,
    rank,
    rawJson: '{}'
  }))
}))

const DEMO_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    capabilities: { chat: true, jsonMode: true, streaming: true, vision: true, image: false }
  },
  {
    id: 'doubao',
    displayName: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
    capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false }
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false }
  }
]

/**
 * Build a mock bridge. Returns arrays for list-like calls and proper
 * objects for bootstrap-shaped calls, so every page renders without
 * crashing.
 */
function createMockBridge(): MoliuApi {
  const emptyArray = <T>(): Promise<T[]> => Promise.resolve([])
  const void_ = (): Promise<void> => Promise.resolve()

  const root: Record<string, unknown> = {
    app: {
      bootstrap: (): Promise<AppBootstrap> => Promise.resolve(DEMO_BOOTSTRAP),
      getDataPath: (): Promise<string> => Promise.resolve('/demo/workspace')
    },
    providers: {
      presets: (): Promise<ProviderPreset[]> => Promise.resolve(DEMO_PROVIDER_PRESETS),
      list: () => emptyArray(),
      save: (input: unknown) => Promise.resolve(input),
      remove: (id: string) => void_(),
      test: () => Promise.resolve({ ok: true, latencyMs: 42, model: 'demo-model', message: '演示连接成功' })
    },
    searchService: {
      get: () => Promise.resolve(DEMO_BOOTSTRAP.searchService),
      save: (input: unknown) => Promise.resolve(input),
      test: () => Promise.resolve({ ok: true, latencyMs: 38, message: '演示连接成功' })
    },
    accounts: {
      list: () => Promise.resolve(DEMO_BOOTSTRAP.accounts),
      get: (id: string) => Promise.resolve(DEMO_BOOTSTRAP.accounts.find((a) => a.id === id)),
      generate: () => Promise.resolve(DEMO_BOOTSTRAP.accounts[0]),
      save: (input: unknown) => Promise.resolve(input),
      setCurrent: () => void_(),
      setLocked: () => void_(),
      restore: () => void_(),
      remove: () => void_()
    },
    hotspots: {
      bootstrap: (): Promise<HotspotBootstrap> => Promise.resolve(DEMO_HOTSPOT_BOOTSTRAP),
      saveSourcePreferences: () => Promise.resolve(DEMO_HOTSPOT_BOOTSTRAP.preferences),
      refresh: (sourceIds?: string[]): Promise<HotSourceResult[]> => {
        if (!sourceIds || !sourceIds.length) return Promise.resolve(DEMO_SOURCE_RESULTS)
        return Promise.resolve(DEMO_SOURCE_RESULTS.filter((r) => sourceIds.includes(r.source.id)))
      },
      openSource: () => void_(),
      listFavorites: () => emptyArray(),
      addFavorite: (input: { hotItem: { id: string; title: string; source: string; sourceTitle: string } }) =>
        Promise.resolve({
          favorite: {
            id: `fav-${Date.now()}`,
            hotItem: input.hotItem,
            tags: ['待选题' as const],
            status: 'active' as const,
            createdAt: new Date().toISOString()
          },
          created: true
        }),
      updateFavoriteTags: (input: { id: string }) =>
        Promise.resolve({ id: input.id, hotItem: {}, tags: [], status: 'active', createdAt: new Date().toISOString() }),
      removeFavorite: () => void_(),
      filter: () => Promise.resolve({ assessments: [], latencyMs: 0, model: 'demo-model' })
    },
    topics: {
      getSchema: () => Promise.resolve([]),
      saveSchema: (fields: unknown) => Promise.resolve(fields),
      resetSchema: () => Promise.resolve([]),
      list: () => emptyArray(),
      generate: () => Promise.resolve({ topics: [], latencyMs: 0 }),
      save: (input: unknown) => Promise.resolve(input),
      setLocked: () => void_(),
      setInLibrary: () => void_(),
      remove: () => void_()
    },
    materials: {
      list: () => emptyArray(),
      search: () => Promise.resolve({ items: [], total: 0 }),
      addSearchResult: () => void_(),
      addManual: () => void_(),
      remove: () => void_()
    },
    frameworks: {
      listTemplates: () => emptyArray(),
      saveTemplate: (input: unknown) => Promise.resolve(input),
      list: () => emptyArray(),
      generate: () => Promise.resolve({ frameworks: [], latencyMs: 0 }),
      save: (input: unknown) => Promise.resolve(input),
      setLocked: () => void_(),
      remove: () => void_()
    },
    articles: {
      list: () => emptyArray(),
      get: () => void_(),
      generate: () => Promise.resolve({ article: null, latencyMs: 0 }),
      revise: () => Promise.resolve({ article: null, latencyMs: 0 }),
      save: (input: unknown) => Promise.resolve(input),
      restore: () => void_(),
      setLocked: () => void_(),
      remove: () => void_()
    },
    reviews: {
      listRoles: () => emptyArray(),
      saveRole: (input: unknown) => Promise.resolve(input),
      removeRole: () => void_(),
      listTasks: () => emptyArray(),
      start: () => void_(),
      updateProblem: () => void_(),
      addManualProblem: () => void_(),
      apply: () => void_()
    },
    visuals: {
      list: () => emptyArray(),
      generate: () => void_(),
      remove: () => void_()
    },
    layouts: {
      list: () => emptyArray(),
      create: (input: unknown) => Promise.resolve(input),
      remove: () => void_()
    },
    publishing: {
      getWechatChannel: () => Promise.resolve({ appId: '', appSecret: '', enabled: false }),
      saveWechatChannel: (input: unknown) => Promise.resolve(input),
      testWechatChannel: () => Promise.resolve({ ok: false, message: '演示环境未配置' }),
      list: () => emptyArray(),
      pushWechatDraft: () => void_(),
      update: () => void_()
    }
  }

  return root as unknown as MoliuApi
}

export function ensureMockBridge(): void {
  const w = window as unknown as { moliu?: MoliuApi }
  if (!w.moliu) {
    w.moliu = createMockBridge()
    console.info('[mock-bridge] window.moliu not detected — injected demo data for UI preview.')
  }
}
