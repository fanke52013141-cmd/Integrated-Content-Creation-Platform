import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  EyeOff,
  Flame,
  FolderHeart,
  GripVertical,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  X
} from 'lucide-react'
import type {
  AccountProfileSummary,
  FilterHotspotsResult,
  HotFavorite,
  HotFavoriteTag,
  HotItem,
  HotServiceStatus,
  HotSource,
  HotSourcePreference,
  HotSourceResult,
  HotspotFit,
  ProviderSummary
} from '../../../shared/contracts'
import { errorMessage } from '../lib'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'

const BATCH_SIZE = 8

export function HotspotsPage({
  accounts,
  providers,
  currentAccountId,
  onNavigate,
  showToast
}: {
  accounts: AccountProfileSummary[]
  providers: ProviderSummary[]
  currentAccountId?: string
  onNavigate(route: RouteId): void
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const [view, setView] = useState<'wall' | 'favorites' | 'filter'>('wall')
  const [service, setService] = useState<HotServiceStatus>()
  const [sources, setSources] = useState<HotSource[]>([])
  const [hiddenSourceIds, setHiddenSourceIds] = useState<Set<string>>(new Set())
  const [sourceManagerOpen, setSourceManagerOpen] = useState(false)
  const [sourceManagerOrder, setSourceManagerOrder] = useState<HotSource[]>([])
  const [sourceManagerHidden, setSourceManagerHidden] = useState<Set<string>>(new Set())
  const [draggedSourceId, setDraggedSourceId] = useState<string>()
  const [results, setResults] = useState<Record<string, HotSourceResult>>({})
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [bootError, setBootError] = useState<string>()
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [favorites, setFavorites] = useState<HotFavorite[]>([])
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | HotFavoriteTag>('all')
  const [favoriteSourceFilter, setFavoriteSourceFilter] = useState('all')
  const [favoriteSearch, setFavoriteSearch] = useState('')
  const [savingFavoriteKeys, setSavingFavoriteKeys] = useState<Set<string>>(new Set())
  const lockedAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'locked'),
    [accounts]
  )
  const availableModels = useMemo(
    () => providers
      .filter((provider) => provider.enabled && provider.hasApiKey)
      .flatMap((provider) => provider.models
        .filter((model) => model.enabled)
        .map((model) => ({ provider, model }))),
    [providers]
  )
  const initialModel = availableModels.find(({ model }) => model.isDefault) ?? availableModels[0]
  const initialAccount = lockedAccounts.find((account) => account.id === currentAccountId)
    ?? lockedAccounts[0]
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [filterScope, setFilterScope] = useState<'wall' | 'favorites'>('wall')
  const [filterAccountId, setFilterAccountId] = useState(initialAccount?.id ?? '')
  const [filterModelTarget, setFilterModelTarget] = useState(
    initialModel ? encodeModelTarget(initialModel.provider.id, initialModel.model.modelId) : ''
  )
  const [filterSourceIds, setFilterSourceIds] = useState<Set<string>>(new Set())
  const [filterTopN, setFilterTopN] = useState(20)
  const [filtering, setFiltering] = useState(false)
  const [filterResult, setFilterResult] = useState<FilterHotspotsResult>()
  const [fitFilter, setFitFilter] = useState<'all' | 'high' | 'high-medium'>('all')
  const [ignoredAssessmentKeys, setIgnoredAssessmentKeys] = useState<Set<string>>(new Set())

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((favorite) => hotItemKey(favorite.hotItem))),
    [favorites]
  )
  const visibleSources = useMemo(
    () => sources.filter((source) => !hiddenSourceIds.has(source.id)),
    [hiddenSourceIds, sources]
  )
  const favoritePlatforms = useMemo(() => {
    const platforms = new Map<string, string>()
    for (const favorite of favorites) {
      platforms.set(favorite.hotItem.source, favorite.hotItem.sourceTitle)
    }
    return [...platforms.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [favorites])
  const filteredFavorites = useMemo(() => {
    const query = favoriteSearch.trim().toLocaleLowerCase('zh-CN')
    return favorites.filter((favorite) => {
      if (favoriteFilter !== 'all' && !favorite.tags.includes(favoriteFilter)) return false
      if (favoriteSourceFilter !== 'all' && favorite.hotItem.source !== favoriteSourceFilter) {
        return false
      }
      if (!query) return true
      return [
        favorite.hotItem.title,
        favorite.hotItem.sourceTitle,
        favorite.hotItem.desc
      ].some((value) => value.toLocaleLowerCase('zh-CN').includes(query))
    })
  }, [favoriteFilter, favoriteSearch, favoriteSourceFilter, favorites])
  const filterCandidates = useMemo(
    () => [...filterSourceIds].flatMap((sourceId) => {
      if (filterScope === 'favorites') {
        return favorites
          .filter((favorite) => favorite.hotItem.source === sourceId)
          .slice(0, filterTopN)
          .map((favorite) => favorite.hotItem)
      }
      const result = results[sourceId]
      return result?.status === 'ready' ? result.items.slice(0, filterTopN) : []
    }),
    [favorites, filterScope, filterSourceIds, filterTopN, results]
  )
  const filterSourceChoices = useMemo(() => {
    if (filterScope === 'favorites') {
      return favoritePlatforms.map((platform) => ({
        id: platform.id,
        name: platform.name,
        count: favorites.filter((favorite) => favorite.hotItem.source === platform.id).length,
        hidden: hiddenSourceIds.has(platform.id)
      }))
    }
    return sources
      .filter((source) => results[source.id]?.status === 'ready')
      .map((source) => ({
        id: source.id,
        name: source.displayName,
        count: results[source.id]?.items.length ?? 0,
        hidden: hiddenSourceIds.has(source.id)
      }))
  }, [favoritePlatforms, favorites, filterScope, hiddenSourceIds, results, sources])
  const visibleAssessments = useMemo(() => {
    if (!filterResult) return []
    return filterResult.assessments.filter((assessment) => {
      const key = hotItemKey(assessment.hotItem)
      if (ignoredAssessmentKeys.has(key)) return false
      if (fitFilter === 'high') return assessment.fit === 'high'
      if (fitFilter === 'high-medium') return assessment.fit !== 'low'
      return true
    })
  }, [filterResult, fitFilter, ignoredAssessmentKeys])

  function openTopicsFromFavorites(): void {
    localStorage.setItem('moliu:topic-favorite-ids', JSON.stringify(filteredFavorites.map((item) => item.id)))
    onNavigate('topics')
  }

  const readyCount = useMemo(
    () => Object.values(results).filter((result) => result.status === 'ready').length,
    [results]
  )
  const errorCount = useMemo(
    () => Object.values(results).filter((result) => result.status === 'error').length,
    [results]
  )

  const refreshBatch = useCallback(async (batch: string[]): Promise<void> => {
    setLoadingIds((current) => new Set([...current, ...batch]))
    try {
      const next = await window.moliu.hotspots.refresh(batch)
      setResults((current) => {
        const merged = { ...current }
        for (const result of next) merged[result.source.id] = result
        return merged
      })
    } finally {
      setLoadingIds((current) => {
        const next = new Set(current)
        for (const id of batch) next.delete(id)
        return next
      })
    }
  }, [])

  const refreshAll = useCallback(async (sourceList: HotSource[]): Promise<void> => {
    if (!sourceList.length) return
    setRefreshingAll(true)
    const ids = sourceList.map((source) => source.id)
    try {
      for (let index = 0; index < ids.length; index += BATCH_SIZE) {
        await refreshBatch(ids.slice(index, index + BATCH_SIZE))
      }
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setRefreshingAll(false)
    }
  }, [refreshBatch, showToast])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const [bootstrap, savedFavorites] = await Promise.all([
          window.moliu.hotspots.bootstrap(),
          window.moliu.hotspots.listFavorites()
        ])
        if (disposed) return
        const orderedSources = applySourcePreferences(bootstrap.sources, bootstrap.preferences)
        setService(bootstrap.service)
        setSources(orderedSources)
        setHiddenSourceIds(new Set(
          bootstrap.preferences
            .filter((preference) => preference.hidden)
            .map((preference) => preference.sourceId)
        ))
        setFavorites(savedFavorites)
        setBootError(undefined)
        await refreshAll(orderedSources)
      } catch (error) {
        if (!disposed) setBootError(errorMessage(error))
      }
    })()
    return () => {
      disposed = true
    }
  }, [refreshAll])

  async function openSource(url: string): Promise<void> {
    if (!url) return
    try {
      await window.moliu.hotspots.openSource(url)
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function addFavorite(item: HotItem, quiet = false): Promise<boolean> {
    const key = hotItemKey(item)
    if (favoriteKeys.has(key)) {
      if (!quiet) showToast({ type: 'success', message: '该热点已经在收藏夹中' })
      return false
    }
    setSavingFavoriteKeys((current) => new Set([...current, key]))
    try {
      const result = await window.moliu.hotspots.addFavorite({
        hotItem: item,
        accountId: currentAccountId,
        tags: ['待选题']
      })
      setFavorites((current) => {
        if (current.some((favorite) => favorite.id === result.favorite.id)) return current
        return [result.favorite, ...current]
      })
      if (!quiet) {
        showToast({
          type: 'success',
          message: result.created ? '已锁定源数据并加入收藏' : '该热点已经在收藏夹中'
        })
      }
      return result.created
    } catch (error) {
      if (!quiet) showToast({ type: 'error', message: errorMessage(error) })
      return false
    } finally {
      setSavingFavoriteKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  async function addSourceBatch(items: HotItem[]): Promise<void> {
    let created = 0
    for (const item of items.slice(0, 10)) {
      if (await addFavorite(item, true)) created += 1
    }
    showToast({
      type: 'success',
      message: created ? `已收藏 ${created} 条热点，源数据均已锁定` : '前 10 条热点均已收藏'
    })
  }

  async function toggleFavoriteTag(favorite: HotFavorite, tag: HotFavoriteTag): Promise<void> {
    const tags = favorite.tags.includes(tag)
      ? favorite.tags.filter((item) => item !== tag)
      : [...favorite.tags, tag]
    try {
      const updated = await window.moliu.hotspots.updateFavoriteTags({
        id: favorite.id,
        tags
      })
      setFavorites((current) =>
        current.map((item) => item.id === updated.id ? updated : item)
      )
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function removeFavorite(favorite: HotFavorite): Promise<void> {
    try {
      await window.moliu.hotspots.removeFavorite(favorite.id)
      setFavorites((current) => current.filter((item) => item.id !== favorite.id))
      showToast({ type: 'success', message: '已取消收藏' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function persistSourcePreferences(
    orderedSources: HotSource[],
    hiddenIds: Set<string>,
    notify = false
  ): Promise<void> {
    try {
      await window.moliu.hotspots.saveSourcePreferences({
        preferences: orderedSources.map((source, index) => ({
          sourceId: source.id,
          hidden: hiddenIds.has(source.id),
          sortOrder: index
        }))
      })
      if (notify) showToast({ type: 'success', message: '平台显示与顺序已保存' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  function openSourceManager(): void {
    setSourceManagerOrder([...sources])
    setSourceManagerHidden(new Set(hiddenSourceIds))
    setSourceManagerOpen(true)
  }

  async function saveSourceManager(): Promise<void> {
    setSources(sourceManagerOrder)
    setHiddenSourceIds(new Set(sourceManagerHidden))
    setSourceManagerOpen(false)
    await persistSourcePreferences(sourceManagerOrder, sourceManagerHidden, true)
  }

  function reorderWallSource(targetId: string): void {
    if (!draggedSourceId || draggedSourceId === targetId) return
    const reordered = moveSource(sources, draggedSourceId, targetId)
    setSources(reordered)
    setDraggedSourceId(undefined)
    void persistSourcePreferences(reordered, hiddenSourceIds)
  }

  function openFilterDialog(scope: 'wall' | 'favorites' = 'wall'): void {
    if (!lockedAccounts.length) {
      showToast({ type: 'error', message: '请先创建并锁定一个账号定位' })
      return
    }
    if (!availableModels.length) {
      showToast({ type: 'error', message: '请先配置一个可用模型' })
      return
    }
    const readySources = sources.filter((source) => results[source.id]?.status === 'ready')
    if (scope === 'wall' && !readySources.length) {
      showToast({ type: 'error', message: '请等待至少一个平台加载完成' })
      return
    }
    if (scope === 'favorites' && !favorites.length) {
      showToast({ type: 'error', message: '收藏夹为空，无法发起筛选' })
      return
    }
    if (!filterAccountId) setFilterAccountId(initialAccount?.id ?? lockedAccounts[0].id)
    if (!filterModelTarget && initialModel) {
      setFilterModelTarget(encodeModelTarget(initialModel.provider.id, initialModel.model.modelId))
    }
    setFilterScope(scope)
    setFilterSourceIds(new Set(
      scope === 'favorites'
        ? favoritePlatforms.map((platform) => platform.id)
        : readySources.slice(0, 3).map((source) => source.id)
    ))
    setFilterDialogOpen(true)
  }

  async function runFilter(): Promise<void> {
    const target = decodeModelTarget(filterModelTarget)
    if (!filterAccountId || !target) {
      showToast({ type: 'error', message: '请选择已锁定账号和生成模型' })
      return
    }
    if (!filterCandidates.length) {
      showToast({ type: 'error', message: '至少选择一个已加载平台' })
      return
    }
    if (filterCandidates.length > 200) {
      showToast({ type: 'error', message: '单次最多筛选 200 条，请减少平台或前 N 名' })
      return
    }

    setFiltering(true)
    try {
      const result = await window.moliu.hotspots.filter({
        accountId: filterAccountId,
        providerId: target.providerId,
        model: target.modelId,
        items: filterCandidates
      })
      setFilterResult(result)
      setIgnoredAssessmentKeys(new Set())
      setFitFilter('all')
      setView('filter')
      setFilterDialogOpen(false)
      showToast({
        type: 'success',
        message: `已完成 ${result.assessments.length} 条热点筛选 · ${result.latencyMs}ms`
      })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setFiltering(false)
    }
  }

  async function adoptAllHigh(): Promise<void> {
    if (!filterResult) return
    let created = 0
    for (const assessment of filterResult.assessments) {
      if (assessment.fit !== 'high' || ignoredAssessmentKeys.has(hotItemKey(assessment.hotItem))) {
        continue
      }
      if (await addFavorite(assessment.hotItem, true)) created += 1
    }
    showToast({
      type: 'success',
      message: created ? `已采纳并锁定 ${created} 条高契合热点` : '高契合热点均已采纳'
    })
  }

  function ignoreAssessment(item: HotItem): void {
    setIgnoredAssessmentKeys((current) => new Set([...current, hotItemKey(item)]))
  }

  if (bootError) {
    return (
      <section className="hotspot-boot-error">
        <AlertTriangle size={28} />
        <h2>内置热点服务没有启动</h2>
        <p>{bootError}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />重新启动
        </button>
      </section>
    )
  }

  return (
    <div className="hotspots-page">
      <section className="hotspot-hero">
        <div>
          <span className="eyebrow">LIVE SIGNALS</span>
          <h2>
            {view === 'wall'
              ? '今天，什么正在发生？'
              : view === 'favorites'
                ? '锁定值得继续追踪的信号'
                : '让账号定位帮你过滤噪音'}
          </h2>
          <p>
            {view === 'wall'
              ? '跨平台浏览实时热榜。热点原文保持只读，点击后在系统浏览器核实来源。'
              : view === 'favorites'
                ? '收藏源数据不可编辑，标签只用于组织。这里是后续选题模块的原料池。'
                : '筛选结果保持草稿态，只有人工采纳后才会进入锁定收藏。'}
          </p>
        </div>
        <div className="hotspot-hero-actions">
          <div className={`embedded-service-pill ${service?.state === 'ready' ? 'ready' : ''}`}>
            <Server size={15} />
            <span>
              <strong>内置数据服务</strong>
              <small>DailyHotApi v{service?.version ?? '2.0.8'}</small>
            </span>
          </div>
          <button className="button secondary" onClick={() =>
            setView((current) => current === 'wall' ? 'favorites' : 'wall')
          }>
            <FolderHeart size={16} />
            {view === 'wall' ? `收藏夹 ${favorites.length}` : '返回热榜墙'}
          </button>
          {view === 'wall' && (
            <>
              <button className="button secondary" onClick={() => openFilterDialog('wall')}>
                <Sparkles size={16} />AI 筛选
              </button>
              <button className="button secondary" onClick={openSourceManager}>
                <Settings2 size={16} />平台设置
              </button>
              <button
                className="button primary"
                disabled={refreshingAll || !sources.length}
                onClick={() => void refreshAll(sources)}
              >
                <RefreshCw size={16} className={refreshingAll ? 'spin' : ''} />
                {refreshingAll ? '正在刷新' : '刷新全部'}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="hotspot-draft-warning">
        <AlertTriangle size={16} />
        <span>
          <strong>草稿数据源</strong>
          当前引用 DailyHotApi v2.0.8。榜单来自公开渠道，可能延迟、失效或不准确，使用前请打开原链接核实。
        </span>
      </section>

      {view === 'wall' ? (
        <>
          <section className="hotspot-summary">
            <span><Flame size={15} />显示 {visibleSources.length} / {sources.length || '—'} 个平台</span>
            <span className="success"><CheckCircle2 size={15} />{readyCount} 个已加载</span>
            <span><BookmarkCheck size={15} />{favorites.length} 条已收藏</span>
            {errorCount > 0 && <span className="warning"><AlertTriangle size={15} />{errorCount} 个暂不可用</span>}
            {refreshingAll && <span><LoaderCircle size={15} className="spin" />后台分批加载中</span>}
          </section>

          <section className="hotspot-grid">
            {visibleSources.map((source) => {
              const result = results[source.id]
              const loading = loadingIds.has(source.id)
              return (
                <article
                  className={`hot-source-card ${draggedSourceId === source.id ? 'dragging' : ''}`}
                  key={source.id}
                  draggable
                  onDragStart={() => setDraggedSourceId(source.id)}
                  onDragEnd={() => setDraggedSourceId(undefined)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderWallSource(source.id)}
                >
                  <header>
                    <div className="source-identity">
                      <span className="source-mark">{source.displayName.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{result?.source.displayName || source.displayName}</strong>
                        <small>{result?.subtitle || '实时榜单'}</small>
                      </span>
                    </div>
                    <div className="source-card-actions">
                      <span className="source-drag-handle" title="拖拽调整顺序">
                        <GripVertical size={15} />
                      </span>
                      {result?.status === 'ready' && (
                        <button
                          className="icon-button"
                          title="收藏前 10 条"
                          onClick={() => void addSourceBatch(result.items)}
                        >
                          <Bookmark size={15} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        title="刷新此平台"
                        disabled={loading}
                        onClick={() => void refreshBatch([source.id])}
                      >
                        <RefreshCw size={15} className={loading ? 'spin' : ''} />
                      </button>
                    </div>
                  </header>

                  {loading && !result && (
                    <div className="source-loading">
                      <LoaderCircle size={22} className="spin" />
                      <span>正在获取榜单</span>
                    </div>
                  )}

                  {result?.status === 'error' && !loading && (
                    <div className="source-error">
                      <AlertTriangle size={20} />
                      <strong>暂时无法获取</strong>
                      <p>{result.error}</p>
                      <button onClick={() => void refreshBatch([source.id])}>重试</button>
                    </div>
                  )}

                  {result?.status === 'ready' && (
                    <>
                      <ol className="hot-item-list">
                        {result.items.map((item) => {
                          const key = hotItemKey(item)
                          const favorited = favoriteKeys.has(key)
                          const saving = savingFavoriteKeys.has(key)
                          return (
                            <li key={item.id}>
                              <span className={`hot-rank rank-${item.rank}`}>{item.rank}</span>
                              <button
                                className="hot-item-link"
                                disabled={!item.url}
                                title={item.title}
                                onClick={() => void openSource(item.url)}
                              >
                                <span>{item.title}</span>
                                {item.hotValue && <small>{item.hotValue}</small>}
                                {item.url && <ArrowUpRight size={13} />}
                              </button>
                              <button
                                className={`hot-favorite-button ${favorited ? 'active' : ''}`}
                                disabled={favorited || saving}
                                title={favorited ? '已收藏' : '收藏并锁定源数据'}
                                onClick={() => void addFavorite(item)}
                              >
                                {saving
                                  ? <LoaderCircle size={14} className="spin" />
                                  : favorited
                                    ? <BookmarkCheck size={14} />
                                    : <Bookmark size={14} />}
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                      <footer>
                        <span>{formatTime(result.updateTime)}</span>
                        <span>{result.items.length} 条</span>
                      </footer>
                    </>
                  )}
                </article>
              )
            })}
          </section>
        </>
      ) : view === 'favorites' ? (
        <section className="favorite-workspace">
          <div className="favorite-toolbar">
            <label className="search-field">
              <Search size={16} />
              <input
                value={favoriteSearch}
                onChange={(event) => setFavoriteSearch(event.target.value)}
                placeholder="搜索收藏热点"
              />
            </label>
            <div className="favorite-tag-filters">
              {([
                ['all', '全部'],
                ['待选题', '待选题'],
                ['已用', '已用']
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={favoriteFilter === value ? 'active' : ''}
                  onClick={() => setFavoriteFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="favorite-platform-filter">
              <span>平台</span>
              <select
                value={favoriteSourceFilter}
                onChange={(event) => setFavoriteSourceFilter(event.target.value)}
              >
                <option value="all">全部平台</option>
                {favoritePlatforms.map((platform) => (
                  <option key={platform.id} value={platform.id}>{platform.name}</option>
                ))}
              </select>
            </label>
            <button
              className="button secondary compact"
              disabled={!favorites.length}
              onClick={() => openFilterDialog('favorites')}
            >
              <Sparkles size={14} />AI 筛选收藏
            </button>
            <button
              className="button primary compact"
              disabled={!filteredFavorites.length}
              onClick={openTopicsFromFavorites}
            >
              <Sparkles size={14} />用收藏生成选题
            </button>
            <span className="favorite-count">{filteredFavorites.length} 条</span>
          </div>

          {filteredFavorites.length ? (
            <div className="favorite-list">
              {filteredFavorites.map((favorite) => (
                <article className="favorite-row" key={favorite.id}>
                  <span className="favorite-source-mark">
                    {favorite.hotItem.sourceTitle.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="favorite-main">
                    <button
                      className="favorite-title"
                      disabled={!favorite.hotItem.url}
                      onClick={() => void openSource(favorite.hotItem.url)}
                    >
                      {favorite.hotItem.title}
                      {favorite.hotItem.url && <ArrowUpRight size={14} />}
                    </button>
                    <div className="favorite-meta">
                      <span>{favorite.hotItem.sourceTitle} · 第 {favorite.hotItem.rank} 名</span>
                      {favorite.hotItem.hotValue && <span>{favorite.hotItem.hotValue}</span>}
                      <span>收藏于 {formatDateTime(favorite.createdAt)}</span>
                      <span className="locked-snapshot"><BookmarkCheck size={12} />源快照已锁定</span>
                    </div>
                    {favorite.hotItem.desc && <p>{favorite.hotItem.desc}</p>}
                  </div>
                  <div className="favorite-tags">
                    <span><Tags size={13} />标签</span>
                    {(['待选题', '已用'] as HotFavoriteTag[]).map((tag) => (
                      <button
                        key={tag}
                        className={favorite.tags.includes(tag) ? 'active' : ''}
                        onClick={() => void toggleFavoriteTag(favorite, tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <button
                    className="icon-button favorite-remove"
                    title="取消收藏"
                    onClick={() => void removeFavorite(favorite)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="favorite-empty">
              <FolderHeart size={30} />
              <h3>{favorites.length ? '没有匹配的收藏' : '收藏夹还是空的'}</h3>
              <p>{favorites.length ? '换个标签或关键词试试。' : '回到热榜墙，把值得继续追踪的热点锁定下来。'}</p>
              <button className="button primary" onClick={() => setView('wall')}>浏览热榜</button>
            </div>
          )}
        </section>
      ) : (
        <section className="filter-results-workspace">
          {filterResult ? (
            <>
              <div className="filter-results-toolbar">
                <div>
                  <span className="eyebrow">AI SCREENING DRAFT</span>
                  <h3>筛选结果 · 待人工采纳</h3>
                  <p>
                    {filterResult.assessments.length} 条 · {filterResult.model} · {filterResult.latencyMs}ms
                  </p>
                </div>
                <div className="filter-result-actions">
                  <button className="button secondary" onClick={() => openFilterDialog(filterScope)}>
                    <RotateCcw size={15} />重新筛选
                  </button>
                  <button className="button primary" onClick={() => void adoptAllHigh()}>
                    <Check size={15} />采纳全部高契合
                  </button>
                </div>
              </div>
              <div className="fit-filter-bar">
                {([
                  ['all', '全部'],
                  ['high', '仅高契合'],
                  ['high-medium', '高 + 中']
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={fitFilter === value ? 'active' : ''}
                    onClick={() => setFitFilter(value)}
                  >
                    {label}
                  </button>
                ))}
                <span>{visibleAssessments.length} 条可见</span>
              </div>
              <div className="filter-assessment-list">
                {visibleAssessments.map((assessment) => {
                  const key = hotItemKey(assessment.hotItem)
                  const adopted = favoriteKeys.has(key)
                  return (
                    <article className="filter-assessment-row" key={key}>
                      <span className={`fit-badge ${assessment.fit}`}>
                        {fitLabel(assessment.fit)}
                      </span>
                      <div className="filter-assessment-main">
                        <button
                          className="filter-hot-title"
                          disabled={!assessment.hotItem.url}
                          onClick={() => void openSource(assessment.hotItem.url)}
                        >
                          <span>[{assessment.hotItem.sourceTitle}] {assessment.hotItem.title}</span>
                          {assessment.hotItem.url && <ArrowUpRight size={14} />}
                        </button>
                        <dl>
                          <div><dt>判断理由</dt><dd>{assessment.reason}</dd></div>
                          <div><dt>建议角度</dt><dd>{assessment.angle}</dd></div>
                        </dl>
                      </div>
                      <div className="filter-row-actions">
                        <button
                          className="button ghost compact"
                          onClick={() => ignoreAssessment(assessment.hotItem)}
                        >
                          <EyeOff size={14} />忽略
                        </button>
                        <button
                          className={`button compact ${adopted ? 'secondary' : 'primary'}`}
                          disabled={adopted}
                          onClick={() => void addFavorite(assessment.hotItem)}
                        >
                          {adopted ? <BookmarkCheck size={14} /> : <Check size={14} />}
                          {adopted ? '已采纳' : '采纳'}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="favorite-empty">
              <Sparkles size={30} />
              <h3>还没有筛选结果</h3>
              <button className="button primary" onClick={() => openFilterDialog('wall')}>开始 AI 筛选</button>
            </div>
          )}
        </section>
      )}

      {sourceManagerOpen && (
        <div className="modal-overlay" role="presentation">
          <section className="source-manager-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">PLATFORM DISPLAY</span>
                <h2>管理热榜平台</h2>
                <p>拖拽调整顺序；隐藏只影响热榜墙，平台仍可参与 AI 筛选。</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭"
                onClick={() => setSourceManagerOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="source-manager-tools">
              <span>
                显示 {sourceManagerOrder.length - sourceManagerHidden.size} / {sourceManagerOrder.length}
              </span>
              <button
                className="button ghost compact"
                onClick={() => setSourceManagerHidden(new Set())}
              >
                全部恢复显示
              </button>
            </div>
            <div className="source-manager-list">
              {sourceManagerOrder.map((source, index) => {
                const visible = !sourceManagerHidden.has(source.id)
                return (
                  <article
                    key={source.id}
                    className={draggedSourceId === source.id ? 'dragging' : ''}
                    draggable
                    onDragStart={() => setDraggedSourceId(source.id)}
                    onDragEnd={() => setDraggedSourceId(undefined)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!draggedSourceId || draggedSourceId === source.id) return
                      setSourceManagerOrder((current) =>
                        moveSource(current, draggedSourceId, source.id)
                      )
                      setDraggedSourceId(undefined)
                    }}
                  >
                    <GripVertical size={16} />
                    <span className="source-mark">{source.displayName.slice(0, 1).toUpperCase()}</span>
                    <span className="source-manager-name">
                      <strong>{source.displayName}</strong>
                      <small>{source.id}</small>
                    </span>
                    <small className="source-manager-order">{index + 1}</small>
                    <label>
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={(event) => {
                          setSourceManagerHidden((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.delete(source.id)
                            else next.add(source.id)
                            return next
                          })
                        }}
                      />
                      {visible ? '显示' : '隐藏'}
                    </label>
                  </article>
                )
              })}
            </div>
            <footer>
              <button className="button secondary" onClick={() => setSourceManagerOpen(false)}>
                取消
              </button>
              <button className="button primary" onClick={() => void saveSourceManager()}>
                保存设置
              </button>
            </footer>
          </section>
        </div>
      )}

      {filterDialogOpen && (
        <div className="modal-overlay" role="presentation">
          <section className="hotspot-filter-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">AI HOTSPOT SCREENING</span>
                <h2>{filterScope === 'favorites' ? '筛选收藏热点' : '配置热点筛选'}</h2>
                <p>
                  {filterScope === 'favorites' ? '范围：当前收藏夹。' : '范围：已加载实时热榜。'}
                  仅使用已锁定账号定位，不叠加关键词过滤。
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭"
                disabled={filtering}
                onClick={() => setFilterDialogOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="filter-dialog-grid">
              <label className="field">
                <span>已锁定账号</span>
                <select
                  value={filterAccountId}
                  onChange={(event) => setFilterAccountId(event.target.value)}
                >
                  {lockedAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>筛选模型</span>
                <select
                  value={filterModelTarget}
                  onChange={(event) => setFilterModelTarget(event.target.value)}
                >
                  {availableModels.map(({ provider, model }) => (
                    <option
                      key={`${provider.id}:${model.id}`}
                      value={encodeModelTarget(provider.id, model.modelId)}
                    >
                      {model.displayName} · {provider.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>每个平台取前 N 名</span>
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={filterTopN}
                  onChange={(event) => setFilterTopN(
                    Math.min(100, Math.max(10, Number(event.target.value) || 20))
                  )}
                />
              </label>
              <div className="filter-estimate">
                <SlidersHorizontal size={17} />
                <span>
                  <strong>{filterCandidates.length} 条热点</strong>
                  <small>{filterCandidates.length > 200 ? '超过单次 200 条上限' : '将一次性发送给所选模型'}</small>
                </span>
              </div>
            </div>

            <div className="filter-source-picker">
              <div>
                <strong>选择平台</strong>
                <span>
                  {filterScope === 'favorites'
                    ? '按收藏来源选择'
                    : '隐藏平台仍可在这里参与筛选'}
                </span>
              </div>
              <div className="filter-source-options">
                {filterSourceChoices.map((source) => (
                    <label key={source.id}>
                      <input
                        type="checkbox"
                        checked={filterSourceIds.has(source.id)}
                        onChange={(event) => {
                          setFilterSourceIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(source.id)
                            else next.delete(source.id)
                            return next
                          })
                        }}
                      />
                      <span>{source.name}{source.hidden ? ' · 已隐藏' : ''}</span>
                      <small>{Math.min(filterTopN, source.count)} 条</small>
                    </label>
                  ))}
              </div>
            </div>

            <footer>
              <span className="filter-security-note">
                <CheckCircle2 size={14} />输入严格包裹为账号定位 XML + 热搜列表 XML
              </span>
              <button
                className="button secondary"
                disabled={filtering}
                onClick={() => setFilterDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={filtering || !filterCandidates.length || filterCandidates.length > 200}
                onClick={() => void runFilter()}
              >
                {filtering ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                {filtering ? '正在筛选' : '开始筛选'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return `更新于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function hotItemKey(item: HotItem): string {
  return `${item.source}:${item.id}`
}

function fitLabel(fit: HotspotFit): string {
  if (fit === 'high') return '高契合'
  if (fit === 'medium') return '中契合'
  return '低契合'
}

function encodeModelTarget(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId])
}

function decodeModelTarget(value: string): { providerId: string; modelId: string } | null {
  try {
    const [providerId, modelId] = JSON.parse(value) as unknown[]
    if (typeof providerId === 'string' && typeof modelId === 'string') {
      return { providerId, modelId }
    }
  } catch {
    // Invalid selection.
  }
  return null
}

function applySourcePreferences(
  sources: HotSource[],
  preferences: HotSourcePreference[]
): HotSource[] {
  const order = new Map(preferences.map((preference) => [
    preference.sourceId,
    preference.sortOrder
  ]))
  return [...sources].sort((left, right) => {
    const leftOrder = order.get(left.id)
    const rightOrder = order.get(right.id)
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
    if (leftOrder !== undefined) return -1
    if (rightOrder !== undefined) return 1
    return sources.indexOf(left) - sources.indexOf(right)
  })
}

function moveSource(sources: HotSource[], movingId: string, targetId: string): HotSource[] {
  const fromIndex = sources.findIndex((source) => source.id === movingId)
  const targetIndex = sources.findIndex((source) => source.id === targetId)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return sources
  const next = [...sources]
  const [moving] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moving)
  return next
}
