import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Check,
  ExternalLink,
  FileText,
  FolderHeart,
  Image,
  LibraryBig,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type {
  Material,
  MaterialSearchImageResult,
  MaterialSearchResult,
  MaterialSearchWebResult,
  SearchServiceSummary,
  Topic
} from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { FieldError, useFormErrors } from '../components/useFormErrors'
import { ModalBase } from '../components/ModalBase'
import { Select } from '../components/Select'
import { VirtualList } from '../components/VirtualList'
import { errorMessage, formatDate, isSafeUrl } from '../lib'

interface MaterialsPageProps {
  searchService: SearchServiceSummary
  onNavigate(route: RouteId): void
  showToast(toast: ToastState): void
  /** 上一步来源路由：提供时显示「返回上一步」，否则沿用默认返回行为 */
  returnTo?: string
  /** 选题交接直接带过来的标题，用于预填搜索框；缺省时由关联选题推导 */
  seedTitle?: string
  /** 预留：从文章页跳回时聚焦的文章 id */
  focusArticleId?: string
}

export function MaterialsPage({
  searchService,
  onNavigate,
  showToast,
  returnTo,
  seedTitle
}: MaterialsPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [view, setView] = useState<'search' | 'collection'>('search')
  const [materials, setMaterials] = useState<Material[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [query, setQuery] = useState('')
  const queryDirty = useRef(false)
  const seeded = useRef(false)
  const [type, setType] = useState<'web' | 'image'>('web')
  const [count, setCount] = useState(10)
  const [relatedTopicId, setRelatedTopicId] = useState(() => {
    const value = localStorage.getItem('moliu:material-related-topic-id') ?? ''
    localStorage.removeItem('moliu:material-related-topic-id')
    return value
  })
  const [searching, setSearching] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [searchResult, setSearchResult] = useState<MaterialSearchResult>()
  const [manualOpen, setManualOpen] = useState(false)
  const [collectionQuery, setCollectionQuery] = useState('')
  const [collectionKind, setCollectionKind] = useState<'all' | Material['kind']>('all')
  const [usage, setUsage] = useState<Record<string, Array<{ id: string; title: string }>>>({})
  const [usageReady, setUsageReady] = useState(false)
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused'>('all')

  async function refresh(): Promise<void> {
    const [nextMaterials, nextTopics] = await Promise.all([
      window.moliu.materials.list(),
      window.moliu.topics.list()
    ])
    setMaterials(nextMaterials)
    setTopics(nextTopics)
    // 引用关系依赖文章库；接口缺失或失败时静默降级，不影响素材列表
    try {
      setUsage(await window.moliu.materials.usage())
      setUsageReady(true)
    } catch {
      setUsage({})
      setUsageReady(false)
    }
  }

  useEffect(() => {
    void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) }))
  }, [])

  useEffect(() => setCount(type === 'web' ? 10 : 5), [type])

  // 选题→素材交接：用关联选题标题预填搜索框，仅在首次且用户尚未输入时生效
  useEffect(() => {
    if (seeded.current || queryDirty.current) return
    const related = topics.find((topic) => topic.id === relatedTopicId)
    const seed = seedTitle?.trim() || related?.fields['选题主题'] || related?.seedKeyword
    if (!seed) return
    setQuery(seed)
    seeded.current = true
  }, [relatedTopicId, seedTitle, topics])

  const savedKeys = useMemo(() => new Set(materials
    .filter((material) => material.externalId)
    .map((material) => `${material.origin}:${material.externalId}`)), [materials])
  const filteredMaterials = useMemo(() => {
    const needle = collectionQuery.trim().toLocaleLowerCase('zh-CN')
    return materials.filter((material) => {
      if (collectionKind !== 'all' && material.kind !== collectionKind) return false
      if (usageFilter !== 'all') {
        const used = (usage[material.id]?.length ?? 0) > 0
        if (usageFilter === 'used' && !used) return false
        if (usageFilter === 'unused' && used) return false
      }
      if (!needle) return true
      return [material.title, material.summary, material.sourceName, material.sourceNote]
        .filter(Boolean).some((value) => value!.toLocaleLowerCase('zh-CN').includes(needle))
    })
  }, [collectionKind, collectionQuery, materials, usage, usageFilter])

  async function search(): Promise<void> {
    if (!query.trim()) return showToast({ type: 'error', message: '请输入搜索词' })
    setSearching(true)
    try {
      const result = await window.moliu.materials.search({ query: query.trim(), type, count })
      setSearchResult(result)
      if (!result.results.length) showToast({ type: 'error', message: '没有找到可展示的结果，请调整搜索词' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setSearching(false)
    }
  }

  async function addSearchResult(result: MaterialSearchWebResult | MaterialSearchImageResult): Promise<void> {
    if (!searchResult) return
    if (searchResult.type === 'web' && !(result as MaterialSearchWebResult).summary.trim()) {
      showToast({ type: 'error', message: '该网页没有可用 Summary，不能作为 AI 素材加入' })
      return
    }
    try {
      const saved = await window.moliu.materials.addSearchResult({
        result,
        query: searchResult.query,
        relatedTopicId: relatedTopicId || undefined
      })
      if (saved.created) {
        await refresh()
        showToast({ type: 'success', message: '已加入可复用素材集合' })
      } else {
        showToast({ type: 'error', message: '该来源已在素材库中' })
      }
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  /** 外部链接统一交给主进程白名单打开，失败要给出提示而不是静默无反应 */
  async function openSource(url: string | undefined): Promise<void> {
    if (!url) return
    try {
      const ok = await window.moliu.app.openExternal(url)
      if (!ok) showToast({ type: 'error', message: '无法打开链接：仅支持 http/https 地址' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function addAllSearchResults(): Promise<void> {
    if (!searchResult) return
    const cap = searchResult.type === 'web' ? 10 : searchResult.results.length
    const items = (searchResult.results as Array<MaterialSearchWebResult | MaterialSearchImageResult>)
      .filter((result) => {
        const key = `${searchResult.type === 'web' ? 'doubao_web' : 'doubao_image'}:${result.id}`
        if (savedKeys.has(key)) return false
        if (searchResult.type === 'web' && !(result as MaterialSearchWebResult).summary.trim()) return false
        return true
      })
      .slice(0, cap)
    if (!items.length) return showToast({ type: 'info', message: '没有可入库的新结果' })
    setBulkSaving(true)
    let ok = 0
    for (const item of items) {
      try {
        const saved = await window.moliu.materials.addSearchResult({ result: item, query: searchResult.query, relatedTopicId: relatedTopicId || undefined })
        if (saved.created) ok += 1
      } catch { /* 单条失败不中断批量 */ }
    }
    setBulkSaving(false)
    await refresh()
    showToast(ok ? { type: 'success', message: `已批量入库 ${ok} 条素材` } : { type: 'error', message: '批量入库失败，请逐条重试' })
  }

  async function remove(material: Material): Promise<void> {
    if (!(await confirm({
      title: `删除素材「${material.title}」？`,
      message: '此操作不可撤销。',
      danger: true,
      confirmLabel: '删除'
    }))) return
    try {
      await window.moliu.materials.remove(material.id)
      await refresh()
      showToast({ type: 'success', message: '素材已删除' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  return (
    <div className="page materials-page">
      <section className="page-intro materials-intro">
        <div>
          {returnTo && <button className="button ghost compact" onClick={() => onNavigate(returnTo as RouteId)}><ArrowLeft size={14} />返回上一步</button>}
          <h2>素材库</h2>
        </div>
        <button className="button secondary" onClick={() => setManualOpen(true)}><Upload size={16} />添加文字素材</button>
      </section>

      <section className="material-tabs">
        <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}><Search size={15} />搜索素材</button>
        <button className={view === 'collection' ? 'active' : ''} onClick={() => setView('collection')}><LibraryBig size={15} />我的素材 <small>{materials.length}</small></button>
      </section>

      {view === 'search' ? (
        <section className="material-search-workspace">
          <div className="material-search-main">
          {!searchService.hasApiKey || !searchService.enabled ? (
            <div className="material-search-disabled">
              <Search size={24} />
              <div><strong>搜索服务未配置</strong></div>
              <button className="button primary compact" onClick={() => onNavigate('providers')}>去配置</button>
            </div>
          ) : (
            <>
              <div className="material-search-controls">
                <div className="material-search-type">
                  <button className={type === 'web' ? 'active' : ''} onClick={() => setType('web')}><FileText size={15} />网页</button>
                  <button className={type === 'image' ? 'active' : ''} onClick={() => setType('image')}><Image size={15} />图片</button>
                </div>
                <label className="material-query-input"><Search size={17} /><input type="search" inputMode="search" name="query" autoComplete="off" value={query} maxLength={100} onChange={(event) => { queryDirty.current = true; setQuery(event.target.value) }} onKeyDown={(event) => event.key === 'Enter' && void search()} placeholder={type === 'web' ? '输入一个主题、人物、案例或事实关键词…' : '输入一个图片参考关键词…'} /></label>
                <Select
                  value={String(count)}
                  onChange={(value) => setCount(Number(value))}
                  ariaLabel="结果数量"
                  options={(type === 'web' ? [5, 10, 20, 30, 50] : [1, 3, 5]).map((item) => ({ value: String(item), label: `${item} 条` }))}
                />
                <button className="button primary" disabled={searching} onClick={() => void search()}>{searching ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}{searching ? '搜索中…' : '开始搜索'}</button>
              </div>
              <div className="material-search-context">
                <span><Link2 size={14} />关联选题（可选）</span>
                <Select
                  value={relatedTopicId}
                  onChange={setRelatedTopicId}
                  placeholder="不关联选题"
                  ariaLabel="关联选题（可选）"
                  options={[{ value: '', label: '不关联选题' }, ...topics.map((topic) => ({ value: topic.id, label: topic.fields['选题主题'] || topic.seedKeyword }))]}
                />
              </div>
              {searchResult ? (
                <div className="material-search-results">
                  <header><div><h3>“{searchResult.query}”</h3></div><div className="material-results-toolbar"><span>{searchResult.results.length} 条 · {searchResult.latencyMs}ms</span><button className="button secondary compact" disabled={bulkSaving} onClick={() => void addAllSearchResults()}><Plus size={14} />{bulkSaving ? '入库中…' : searchResult.type === 'web' ? '前 10 条全部入库' : '全部入库'}</button></div></header>
                  {searchResult.type === 'web' ? (
                    <div className="web-material-results">
                      {(searchResult.results as MaterialSearchWebResult[]).map((result) => {
                        const saved = savedKeys.has(`doubao_web:${result.id}`)
                        return <article className="web-material-result" key={result.id}>
                          <div className="material-result-main"><button onClick={() => void openSource(result.sourceUrl)}>{result.title}<ExternalLink size={14} /></button><div className="material-result-meta"><span>{result.sourceName || '未知来源'}</span>{result.publishedAt && <span>{formatDate(result.publishedAt)}</span>}{result.authority && <span>{result.authority}</span>}</div><p>{result.summary || result.snippet || '该结果未提供可用摘要'}</p></div>
                          <button className={`button compact ${saved ? 'secondary' : 'primary'}`} disabled={saved || !result.summary.trim()} onClick={() => void addSearchResult(result)}>{saved ? <Check size={14} /> : <Plus size={14} />}{saved ? '已入库' : '加入素材'}</button>
                        </article>
                      })}
                    </div>
                  ) : (
                    <div className="image-material-results">
                      {(searchResult.results as MaterialSearchImageResult[]).map((result) => {
                        const saved = savedKeys.has(`doubao_image:${result.id}`)
                        return <article key={result.id} className="image-material-result"><img src={result.imageUrl} alt="" loading="lazy" decoding="async" width={result.imageWidth ?? 120} height={result.imageHeight ?? 120} /><div><strong>{result.title}</strong><p>{result.sourceName || '未知来源'} · {result.imageWidth ?? '?'} × {result.imageHeight ?? '?'} · {result.watermark === '1' ? '有水印' : '水印未知/无'}</p><button className="button ghost compact" onClick={() => void openSource(result.sourceUrl)}>查看来源 <ArrowUpRight size={13} /></button></div><button className={`button compact ${saved ? 'secondary' : 'primary'}`} disabled={saved} onClick={() => void addSearchResult(result)}>{saved ? <Check size={14} /> : <Plus size={14} />}{saved ? '已入库' : '保存参考'}</button></article>
                      })}
                    </div>
                  )}
                </div>
              ) : <div className="material-search-empty"><Search size={32} /><h3>输入关键词开始搜索</h3></div>}
            </>
          )}
          </div>
          <aside className="material-saved-rail">
            <header><div><h3>已保存 <small>{materials.length}</small></h3></div><button className="button ghost compact" onClick={() => setView('collection')}>查看全部</button></header>
            <div>
              {materials.slice(0, 6).map((material) => (
                <article key={material.id}>
                  <span className={`material-kind-mark ${material.kind}`}>{material.kind === 'web' ? <FileText size={14} /> : material.kind === 'image' ? <Image size={14} /> : <BookOpenText size={14} />}</span>
                  <div><strong>{material.title}</strong><small>{material.sourceName || material.sourceNote || '个人整理'}</small></div>
                </article>
              ))}
              {!materials.length && <div className="material-rail-empty">暂无素材</div>}
            </div>
          </aside>
        </section>
      ) : (
        <section className="material-collection-workspace">
          <header className="material-collection-toolbar"><label className="search-field"><Search size={16} /><input type="search" inputMode="search" name="collectionQuery" autoComplete="off" value={collectionQuery} onChange={(event) => setCollectionQuery(event.target.value)} placeholder="筛选标题、摘要或来源…" /></label><div>{(['all', 'web', 'image', 'text'] as const).map((kind) => <button key={kind} className={collectionKind === kind ? 'active' : ''} onClick={() => setCollectionKind(kind)}>{kind === 'all' ? '全部' : kind === 'web' ? '网页' : kind === 'image' ? '图片' : '文字'}</button>)}</div>{usageReady && <div>{([['all', '全部引用'], ['used', '已引用'], ['unused', '未引用']] as const).map(([value, label]) => <button key={value} className={usageFilter === value ? 'active' : ''} onClick={() => setUsageFilter(value)}>{label}</button>)}</div>}<button className="button primary compact" onClick={() => setManualOpen(true)}><Plus size={14} />添加文字</button></header>
          {filteredMaterials.length ? <div className="material-collection-list"><VirtualList items={filteredMaterials} estimateSize={() => 100} renderItem={(material) => <MaterialRow key={material.id} material={material} refs={usage[material.id] ?? []} onOpen={(url) => void openSource(url)} onRemove={() => void remove(material)} />} /></div> : <div className="large-empty"><h3>{materials.length ? '没有匹配的素材' : '暂无素材'}</h3></div>}
        </section>
      )}

      {manualOpen && <ManualMaterialDialog topics={topics} onClose={() => setManualOpen(false)} onSaved={async () => { setManualOpen(false); await refresh() }} showToast={showToast} />}
      {ConfirmPortal}
    </div>
  )
}

function MaterialRow({ material, refs, onOpen, onRemove }: { material: Material; refs: Array<{ id: string; title: string }>; onOpen(url: string | undefined): void; onRemove(): void }): React.JSX.Element {
  return <article className="material-row">
    <span className={`material-kind-mark ${material.kind}`}>{material.kind === 'web' ? <FileText size={16} /> : material.kind === 'image' ? <Image size={16} /> : <BookOpenText size={16} />}</span>
    <div className="material-row-main"><div><strong>{material.title}</strong><span className="material-origin">{material.origin === 'manual_text' ? '手动文字' : material.kind === 'image' ? '图片参考' : '网页 Summary'}</span></div><p>{material.kind === 'image' ? `${material.imageWidth ?? '?'} × ${material.imageHeight ?? '?'} · ${material.watermark === '1' ? '有水印' : '授权需确认'}` : material.summary}</p><small>{material.sourceName || material.sourceNote || '个人整理'} · {formatDate(material.createdAt)}</small>{refs.length ? <details className="micro-copy"><summary className="badge neutral">被 {refs.length} 篇文章引用</summary>{refs.map((ref) => <div key={ref.id}>{ref.title}</div>)}</details> : null}</div>
    <div className="material-row-actions">{material.sourceUrl && <button className="icon-button" title="打开来源" aria-label="打开来源" onClick={() => onOpen(material.sourceUrl)}><ExternalLink size={15} /></button>}<button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={15} /></button></div>
  </article>
}

function ManualMaterialDialog({ topics, onClose, onSaved, showToast }: { topics: Topic[]; onClose(): void; onSaved(): Promise<void>; showToast(toast: ToastState): void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceNote, setSourceNote] = useState('')
  const [relatedTopicId, setRelatedTopicId] = useState('')
  const [saving, setSaving] = useState(false)
  const { validate, errorOf, clearError, setErrorRef } = useFormErrors<{ title: string; summary: string; sourceUrl: string }>()

  async function save(): Promise<void> {
    if (!validate(
      { title, summary, sourceUrl },
      {
        title: (value) => value.trim() ? null : '请填写标题',
        summary: (value) => value.trim() ? null : '请填写摘要或摘录',
        sourceUrl: (value) => !value || isSafeUrl(value) ? null : '请填写有效的 http(s) URL'
      }
    )) return
    setSaving(true)
    try {
      await window.moliu.materials.addManual({ title, summary, sourceUrl: sourceUrl || undefined, sourceNote: sourceNote || undefined, relatedTopicId: relatedTopicId || undefined })
      await onSaved()
      showToast({ type: 'success', message: '文字素材已加入可复用集合' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setSaving(false) }
  }
  return <ModalBase open onClose={onClose} titleId="manual-material-title" className="manual-material-dialog"><header><div><h2 id="manual-material-title">添加文字素材</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header><div className="manual-material-fields"><label className={`field ${errorOf('title') ? 'has-error' : ''}`}><span>标题</span><input name="title" autoComplete="off" ref={setErrorRef('title')} value={title} maxLength={500} onChange={(event) => { setTitle(event.target.value); clearError('title') }} placeholder="例如：专家访谈摘录…" /><FieldError message={errorOf('title')} /></label><label className={`field ${errorOf('summary') ? 'has-error' : ''}`}><span>摘要 / 摘录</span><textarea name="summary" autoComplete="off" ref={setErrorRef('summary')} value={summary} maxLength={3_000} onChange={(event) => { setSummary(event.target.value); clearError('summary') }} rows={8} placeholder="粘贴相关笔记、观点、事实或访谈摘录…" /><small>{summary.length}/3000</small><FieldError message={errorOf('summary')} /></label><label className={`field ${errorOf('sourceUrl') ? 'has-error' : ''}`}><span>来源链接（可选）</span><input type="url" inputMode="url" name="sourceUrl" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" ref={setErrorRef('sourceUrl')} value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); clearError('sourceUrl') }} placeholder="https://…" /><FieldError message={errorOf('sourceUrl')} /></label><label className="field"><span>来源说明（可选）</span><input name="sourceNote" autoComplete="off" value={sourceNote} maxLength={500} onChange={(event) => setSourceNote(event.target.value)} placeholder="例如：个人访谈整理…" /></label><label className="field"><span>关联选题（可选）</span><Select value={relatedTopicId} onChange={setRelatedTopicId} placeholder="不关联选题" ariaLabel="关联选题（可选）" options={[{ value: '', label: '不关联选题' }, ...topics.map((topic) => ({ value: topic.id, label: topic.fields['选题主题'] || topic.seedKeyword }))]} /></label></div><footer><span /><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}加入素材库</button></footer></ModalBase>
}
