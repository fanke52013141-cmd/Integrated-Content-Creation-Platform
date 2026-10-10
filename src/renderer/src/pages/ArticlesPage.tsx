import { LocalImageImport } from '../components/LocalImageImport'
import { MaterialContextPreview } from '../components/MaterialContextPreview'
import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import {
  AlertTriangle, BookOpenText, Check, ChevronLeft, ClipboardPaste, Download,
  FilePenLine, FilePlus2, FileUp, FolderHeart, History, RotateCcw,
  Image, Info, LibraryBig, LoaderCircle, Lock, LockOpen, PenLine, Plus, Save, Search, Sliders, Sparkles,
  Trash2, WandSparkles, X
} from 'lucide-react'
import type { AccountProfileSummary, Article, ArticleSummary, ArticleVersion, CreationRequest, GenerateArticlesInput, LayoutViolation, ReviseArticleInput, Framework, Material, ProviderSummary, VisualAsset } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import { Select } from '../components/Select'
import { ModalBase } from '../components/ModalBase'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { VirtualList } from '../components/VirtualList'
import { StreamingPreview } from '../components/StreamingPreview'
import { PageHeader } from '../components/PageHeader'
import { CreationHistory } from '../components/CreationHistory'
import { MaterialPicker } from '../components/MaterialPicker'
import { useGenerationStream, isCancelError } from '../hooks/useGenerationStream'
import { useDraftSelection, useDraftState } from '../hooks/useDraftState'
import { useWorkDraft } from '../hooks/useWorkDraft'
import { useReportWork } from '../active-work'
import { resolveAccountSelection } from '../../../shared/creation-state'
import { diffLines } from '../../../shared/text-diff'
import { availableModels, decodeModelTarget, encodeModelTarget, useModelTarget } from '../lib/models'
import { errorMessage, formatDate, markdownTitle, sanitizeHtml } from '../lib'

interface ArticlesPageProps { accounts: AccountProfileSummary[]; providers: ProviderSummary[]; currentAccountId?: string; onNavigate(route: RouteId, params?: Record<string, string>): void; focusFrameworkId?: string; focusArticleId?: string; importMode?: boolean; dirtyOnly?: boolean; showToast(toast: ToastState): void }

export function ArticlesPage({ accounts, providers, currentAccountId, onNavigate, focusFrameworkId, focusArticleId, importMode, dirtyOnly, showToast }: ArticlesPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const stream = useGenerationStream('articles')
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [frameworkId, setFrameworkId] = useState('')
  const [accountId, setAccountId] = useState(currentAccountId ?? '')
  // F08：勾了哪几条素材也是 composer 的一部分，切去素材库补素材再回来必须还在
  const [materialIds, setMaterialIds] = useDraftSelection('article-materials')
  const [manualOutline, setManualOutline] = useDraftState('article-outline')
  const [count, setCount] = useState(1)
  const [revising, setRevising] = useState(false)
  const [revisionMode, setRevisionMode] = useState<ReviseArticleInput['revisionMode']>('new-version')
  const [requestId, setRequestId] = useState('')
  const [requests, setRequests] = useState<CreationRequest[]>([])
  const failedRequest = useRef<{ kind: 'generate'; input: GenerateArticlesInput } | { kind: 'revise'; input: ReviseArticleInput } | undefined>(undefined)
  const [lastFailed, setLastFailed] = useState<Array<{ index: number; message: string }>>([])
  const [instruction, setInstruction, clearInstruction] = useDraftState('article-instruction')
  const [alignFramework, setAlignFramework] = useState(true)
  const [editorMode, setEditorMode] = useState<'visual' | 'source' | 'split'>('source')
  const [inheritedMaterials, setInheritedMaterials] = useState(false)
  const [frameworkAccountHint, setFrameworkAccountHint] = useState('')
  const [listQuery, setListQuery] = useState('')
  const [query, setQuery] = useState('')
  const listSequence = useRef(0)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loadedListKey, setLoadedListKey] = useState('')
  const [listStatus, setListStatus] = useState<'all' | 'locked' | 'draft'>('all')
  const [accountFilter, setAccountFilter] = useState<'all' | 'current'>('all')
  const listKey = JSON.stringify([page, query, listStatus, accountFilter, dirtyOnly, currentAccountId])
  const listLoading = loadedListKey !== listKey || listQuery !== query
  // F19：写作参数是「一次性」的，进入编辑后默认收起，避免常驻在正文上方抢走注意力
  const [composerOpen, setComposerOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  useEffect(() => { document.documentElement.dataset.writingFocus = focused ? 'true' : 'false'; return () => { delete document.documentElement.dataset.writingFocus } }, [focused])
  const [importOpen, setImportOpen] = useState(Boolean(importMode))
  const [importing, setImporting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // 页内跳转（如 文章→文章?import=1）不会重建组件：importMode 变化时同步打开导入面板
  useEffect(() => { if (importMode) setImportOpen(true) }, [importMode])

  const models = useMemo(() => availableModels(providers), [providers])
  const [modelTarget, setModelTarget] = useModelTarget(models)
  const [selected, setSelected] = useState<Article>()
  useEffect(() => { let alive = true; if (selected?.id !== selectedId) setSelected(undefined); if (selectedId) void window.moliu.articles.get(selectedId).then(value => { if (alive) setSelected(value ?? undefined) }).catch(error => showToast({ type: 'error', message: errorMessage(error) })); return () => { alive = false } }, [selectedId, articles])
  const selectedFramework = frameworks.find((framework) => framework.id === frameworkId)
  const usableMaterials = materials.filter((material) => material.kind !== 'image')
  // 正文按文章隔离的工作草稿：切页、切文章、重启后回到用户最后写下的字
  const { draft, dirty, setDraft, markSaved, discard, flush, status: draftStatus, conflict: draftConflict, error: draftError } = useWorkDraft(selected?.id ?? '', selected?.rawMarkdown ?? '', selected?.currentVersionId ?? '')
  const accountInitialized = useRef(false)
  useReportWork(selected ? {
    articleId: selected.id,
    title: articleTitle(selected.rawMarkdown),
    accountId: selected.accountId,
    versionCount: selected.versionCount,
    status: selected.status,
    dirty, savedMarkdown: selected.rawMarkdown, currentVersionId: selected.currentVersionId
  } : {}, 'articles')

  // F11：把配图方案里已生成/已导入的图片直接插进正文，不再要求用户手写 moliu-asset 地址
  const [imageAssets, setImageAssets] = useState<VisualAsset[]>([])
  useEffect(() => {
    const articleId = selected?.id
    setImageAssets([])
    if (!articleId) return
    let alive = true
    void (async () => {
      const packs = await window.moliu.visuals.list(articleId)
      const groups = await Promise.all(packs.map((pack) => window.moliu.visuals.listAssets(pack.id)))
      if (alive) setImageAssets(groups.flat().filter((asset) => asset.kind !== 'cover'))
    })().catch(() => undefined)
    return () => { alive = false }
  }, [selected?.id])

  async function refreshList(): Promise<void> {
    const sequence = ++listSequence.current
    const result = await window.moliu.articles.listSummaries({ limit: 30, offset: page * 30, search: query, status: listStatus === 'all' ? undefined : listStatus, accountId: accountFilter === 'current' ? currentAccountId : undefined, dirtyOnly })
    if (sequence !== listSequence.current) return
    setTotal(result.total); setArticles(result.items); setLoadedListKey(listKey)
    setSelectedId(current => current || focusArticleId || result.items[0]?.id || '')
  }
  async function refresh(): Promise<void> {
    const [nextFrameworks, nextMaterials, nextRequests] = await Promise.all([window.moliu.frameworks.list(), window.moliu.materials.list(), window.moliu.articles.listRequests(), refreshList()])
    setRequests(nextRequests); setFrameworks(nextFrameworks); setMaterials(nextMaterials)
    // 勾选可跨页保留，但素材可能已在素材库被删除：留着的 id 会让生成整体报错
    setMaterialIds((current) => new Set([...current].filter((id) => nextMaterials.some((item) => item.id === id && item.kind !== 'image'))))
    if (focusFrameworkId && nextFrameworks.some((f) => f.id === focusFrameworkId)) { setFrameworkId(focusFrameworkId); setComposerOpen(true) }
  }
  useEffect(() => { void refresh().catch(error => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(listQuery); setPage(0) }, 250); return () => window.clearTimeout(timer) }, [listQuery])
  useEffect(() => { void refreshList().catch(error => showToast({ type: 'error', message: errorMessage(error) })); return () => { listSequence.current++ } }, [page, query, listStatus, accountFilter, dirtyOnly, currentAccountId])
  useEffect(() => { setPage(0) }, [listStatus, accountFilter, dirtyOnly, currentAccountId])
  useEffect(() => { if (focusArticleId) setSelectedId(focusArticleId) }, [focusArticleId])
  useEffect(() => {
    // 未初始化才补默认账号；用户主动选「不使用账号定位」必须保持为空
    const next = resolveAccountSelection({ current: accountId, accounts, currentAccountId, initialized: accountInitialized.current })
    accountInitialized.current = next.initialized
    if (next.accountId !== accountId) setAccountId(next.accountId)
  }, [accountId, accounts, currentAccountId])
  useEffect(() => {
    if (!selectedFramework) { setFrameworkAccountHint(''); return }
    // 框架带素材时直接沿用（用户改过会覆盖用户选择，因此仅在切换框架时执行一次）
    if (selectedFramework.materialIds.length) {
      setMaterialIds(new Set(selectedFramework.materialIds))
      setInheritedMaterials(true)
    }
    // 框架账号与当前写作账号不同属实质变更，交给用户显式确认而非静默覆盖
    setFrameworkAccountHint(selectedFramework.accountId && selectedFramework.accountId !== accountId ? selectedFramework.accountId : '')
  }, [selectedFramework?.id])

  const filteredArticles = articles

  async function generate(candidateCount: number = count): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!frameworkId && !manualOutline.trim()) return showToast({ type: 'error', message: '请选择内容框架，或粘贴手动框架' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    try {
      const request: GenerateArticlesInput = { frameworkId: frameworkId || undefined, accountId: accountId || undefined, accountSelection: accountId ? { mode: 'specific', accountId } : { mode: 'none' }, materialIds: [...materialIds], manualOutline: manualOutline.trim() || undefined, providerId: target.providerId, model: target.modelId, count: candidateCount }
      failedRequest.current = { kind: 'generate', input: request }
      const result = await stream.run(() => window.moliu.articles.generate(request))
      setRequestId(result.requestId ?? '')
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id)
      if (result.articles.length) setComposerOpen(false)
      setLastFailed(result.failed)
      if (stream.isCancelled()) { showToast({ type: 'info', message: `已取消，保留 ${result.articles.length} 篇已完成结果` }); return }
      showToast({ type: !result.articles.length ? 'error' : result.failed.length ? 'warning' : 'success', message: result.failed.length ? `已生成 ${result.articles.length} 篇，${result.failed.length} 篇失败` : `已生成 ${result.articles.length} 篇成稿` })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消本次写作' } : { type: 'error', message: errorMessage(error) })
    }
  }
  async function revise(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!selected) return showToast({ type: 'error', message: '请先选择一篇成稿' })
    if (!instruction.trim()) return showToast({ type: 'error', message: '请填写修改指令' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    setRevising(true)
    try {
      const persistedDraft = await flush()
      const request: ReviseArticleInput = { articleId: selected.id, revisionMode, instruction: instruction.trim(), alignFramework, providerId: target.providerId, model: target.modelId, count: revisionMode === 'new-version' ? 1 : count, baseMarkdown: dirty ? draft : undefined, expectedVersionId: selected.currentVersionId, draftRevision: persistedDraft?.revision ?? 0 }
      failedRequest.current = { kind: 'revise', input: request }
      const result = await stream.run(() => window.moliu.articles.revise(request))
      setRequestId(result.requestId ?? '')
      // 写回方式由显式模式决定。另存候选时，
      // 原稿的工作草稿仍是用户尚未决定是否采纳的内容，不能因生成候选被清除。
      const revisedCurrentArticle = result.articles.some((article) => article.id === selected.id)
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id); clearInstruction()
      if (revisedCurrentArticle) { const saved = result.articles.find(item => item.id === selected.id)!; setSelected(saved); await markSaved({ currentVersionId: saved.currentVersionId, consumedContent: request.baseMarkdown ?? selected.rawMarkdown, rebase: false }) }
      setLastFailed(result.failed)
      if (stream.isCancelled()) { showToast({ type: 'info', message: `已取消，保留 ${result.articles.length} 篇已完成结果` }); return }
      showToast({ type: result.failed.length ? 'warning' : 'success', message: result.failed.length ? `已完成 ${result.articles.length} 个改稿候选，${result.failed.length} 个失败` : revisedCurrentArticle ? '改稿新版本已保存' : '改稿备选稿已保存，请比较并采纳' })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消改稿' } : { type: 'error', message: errorMessage(error) })
    } finally {
      setRevising(false)
    }
  }
  async function retryFailed(): Promise<void> {
    if (retrying) return
    const request = failedRequest.current
    if (!request || !lastFailed.length) return
    setRetrying(true)
    try {
      if (!requestId) throw new Error('未找到原始请求，请打开生成结果记录')
      const result = await stream.run(() => window.moliu.articles.retryRequest(requestId))
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id)
      setLastFailed(result.failed)
      showToast({ type: !result.articles.length ? 'error' : result.failed.length ? 'warning' : 'success', message: result.failed.length ? `补生成 ${result.articles.length} 篇，${result.failed.length} 篇失败` : `已生成 ${result.articles.length} 篇成稿` })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setRetrying(false) }
  }
  async function saveManual(): Promise<void> {
    if (!selected || !draft.trim()) return
    try { const persisted = await flush(); if (!persisted) return; const saved = await window.moliu.articles.commitDraft(selected.id, persisted.revision); setSelected(saved); setSelectedId(saved.id); await markSaved({ currentVersionId: saved.currentVersionId, consumedContent: persisted.content }); await refresh(); showToast({ type: 'success', message: '手动编辑已保存为新版本' }) }
    catch (error) { showToast({ type: 'error', message: `保存失败，内容仍留在本地草稿：${errorMessage(error)}` }) }
  }
  async function saveAsNew(): Promise<void> {
    if (!selected) return
    try {
      const local = await flush()
      const saved = await window.moliu.articles.save({ frameworkId: selected.frameworkId, accountId: selected.accountId, materialIds: selected.materialIds, manualOutline: selected.manualOutline, status: 'draft', source: 'manual', rawMarkdown: local?.content ?? draft })
      await refresh(); setSelectedId(saved.id); showToast({ type: 'success', message: '已另存为新文章，原文章及其修改仍保留' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }
  async function toggleLock(): Promise<void> {
    if (!selected) return
    // 锁定后的评审、配图与排版都以库内版本为准。明确拦住未保存的工作草稿，
    // 避免用户以为锁住了屏幕内容，实际下游仍在使用旧正文。
    if (selected.status !== 'locked' && dirty) {
      showToast({ type: 'warning', message: '正文还有未保存修改，请先保存后再锁定' })
      return
    }
    try { await window.moliu.articles.setLocked(selected.id, selected.status !== 'locked'); await refresh(); showToast({ type: 'success', message: selected.status === 'locked' ? '已恢复为草稿' : '已锁定成稿版本' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }
  async function renameVersion(versionId: string, label: string): Promise<void> { if (!selected) return; try { await window.moliu.articles.renameVersion({ articleId: selected.id, versionId, label }); await refresh(); showToast({ type: 'success', message: label.trim() ? `已把这一版命名为「${label.trim()}」` : '已清除这一版的名称' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } }
  async function restore(versionId: string): Promise<void> { if (!selected) return; if (dirty && !(await confirm({ title: '恢复历史版本', message: '恢复会放弃当前未保存修改，是否继续？', confirmLabel: '恢复' }))) return; try { await discard(); const saved = await window.moliu.articles.restore({ articleId: selected.id, versionId }); if (!saved) throw new Error('本地服务没有返回恢复结果，文章保持原样'); setSelected(saved); await markSaved({ currentVersionId: saved.currentVersionId }); await refresh(); showToast({ type: 'success', message: '已从历史版本创建新草稿' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } }
  async function remove(): Promise<void> {
    if (!selected || !(await confirm({ title: '确认操作', message: '确定删除这篇成稿及其全部本地版本吗？', danger: true, confirmLabel: '确认' }))) return
    try {
      await window.moliu.articles.remove(selected.id)
      setSelectedId('')
      // 删除作品必须同时删掉浏览器中的工作草稿；否则同一设备上的后续用户
      // 仍可能从 localStorage 恢复已删除正文。
      discard(selected.rawMarkdown)
      await refresh()
      showToast({ type: 'success', message: '成稿已删除' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }

  /** F16：不依赖模型也能进入本工具——粘贴现成稿、导入 .md 文件、或从空白开始写 */
  async function importArticle(rawMarkdown: string, label: string): Promise<void> {
    if (importing) return
    if (!rawMarkdown.trim()) return showToast({ type: 'error', message: '内容为空，无法导入' })
    setImporting(true)
    try {
      const saved = await window.moliu.articles.save({
        frameworkId: frameworkId || undefined, accountId: accountId || undefined, materialIds: [...materialIds],
        manualOutline: '', status: 'draft', rawMarkdown, source: 'manual'
      })
      setImportOpen(false); await refresh(); setSelectedId(saved.id); setComposerOpen(false)
      showToast({ type: 'success', message: `${label}已保存为本地草稿` })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setImporting(false) }
  }

  /** F12：导出到本地文件，图片内嵌，脱离应用也能看 */
  async function exportAs(format: 'markdown' | 'html'): Promise<void> {
    if (!selected) return showToast({ type: 'error', message: '请先选择一篇成稿' })
    if (dirty) return showToast({ type: 'error', message: '有未保存修改，请先保存再导出' })
    try {
      const result = await window.moliu.app.exportArticle({ articleId: selected.id, format })
      showToast(result.path
        ? { type: 'success', message: `已导出到 ${result.path}` }
        : { type: 'info', message: '已取消导出' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }

  return <div className="page articles-page">
    <PageHeader
      route="articles"
      onNavigate={onNavigate}
      title="文章工作台"
      description="按框架扩写成稿，改稿打磨后锁定进入评审与发布"
      actions={<div className="page-intro-actions">
        <button className="button secondary" onClick={() => setImportOpen(true)}><FileUp size={15} />导入现成稿</button>
        <button className="button primary" onClick={() => setComposerOpen(true)}><PenLine size={15} />新建草稿</button>
        <button className="button secondary" onClick={() => onNavigate('frameworks')}><WandSparkles size={15} />内容框架</button>
        {selected && <button className="button secondary compact focus-toggle" onClick={() => setFocused(value => !value)}>{focused ? '退出专注写作' : '专注写作'}</button>}
        {selected?.status === 'locked' && <>
          <button className="button secondary" onClick={() => onNavigate('reviews', { articleId: selected.id })}><Check size={15} />去评审</button>
          <button className="button secondary" onClick={() => onNavigate('visuals', { articleId: selected.id })}><Image size={15} />去配图</button>
          <button className="button primary" onClick={() => onNavigate('layouts', { articleId: selected.id })}><FilePenLine size={15} />去排版</button>
        </>}
      </div>}
    />
    <ModalBase open={composerOpen} onClose={() => { if (!stream.active) setComposerOpen(false) }} titleId="article-composer-title" className="article-composer-dialog" closeOnOverlay={!stream.active}>
      <header className="article-composer-heading"><div><h2 id="article-composer-title">新建草稿</h2><p>选择写作基线，补充框架和参考资料。</p></div><button className="icon-button" aria-label="关闭新建草稿" disabled={stream.active} onClick={() => setComposerOpen(false)}><X size={18} /></button></header>
      <div className="article-composer-body">
      <div className="article-compose-grid"><label className="field"><span>内容框架</span><Select value={frameworkId} onChange={setFrameworkId} placeholder="不关联框架" ariaLabel="内容框架" options={[{ value: '', label: '不关联框架' }, ...frameworks.map((framework) => ({ value: framework.id, label: framework.sections[0]?.content || framework.manualTopic, hint: `V${framework.versionCount}` }))]} /></label><label className="field"><span>账号定位</span><Select value={accountId} onChange={setAccountId} placeholder="不使用账号定位" ariaLabel="账号定位" options={[{ value: '', label: '不使用账号定位' }, ...accounts.map((account) => ({ value: account.id, label: account.name, hint: account.status === 'draft' ? '草稿' : undefined }))]} /></label><label className="field"><span>模型</span><Select value={modelTarget} onChange={setModelTarget} placeholder="选择模型" ariaLabel="模型" options={[{ value: '', label: '选择模型' }, ...models.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))]} /></label></div>
      <label className="field article-outline-field"><span>手动框架</span><textarea name="manualOutline" autoComplete="off" rows={3} value={manualOutline} maxLength={30000} onChange={(event) => setManualOutline(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void generate() } }} placeholder="输入文章结构（Ctrl+Enter 直接生成）" /></label>
      <details className="editorial-input-summary"><summary>核对本次写作基线：{accounts.find(account => account.id === accountId)?.name ?? '通用创作'} · {materialIds.size} 条资料</summary><p>主题与框架：{selectedFramework?.manualTopic || '使用所选框架章节或手动框架'}</p>{selectedFramework?.sections.map(section => <p key={section.name}><strong>{section.name}</strong>：{section.content}</p>)}<p>资料：{materials.filter(material => materialIds.has(material.id)).map(material => material.title).join('、') || '尚未提供资料，事实与数字需要人工核对'}</p></details>
      {inheritedMaterials && <p className="inline-alert">已沿用所选框架的 {materialIds.size} 条素材，可在下方调整。</p>}
      {frameworkAccountHint && <p className="inline-alert">所选框架使用账号「{accounts.find((account) => account.id === frameworkAccountHint)?.name ?? '已删除'}」定位，当前写作账号不同。<button className="text-button" onClick={() => { setAccountId(frameworkAccountHint); setFrameworkAccountHint('') }}>改用框架账号</button><button className="text-button" onClick={() => setFrameworkAccountHint('')}>保持当前</button></p>}
      <MaterialPicker materials={usableMaterials} selected={materialIds} onToggle={(id, checked) => { setInheritedMaterials(false); setMaterialIds((current) => { const next = new Set(current); checked ? next.add(id) : next.delete(id); return next }) }} onNavigate={onNavigate} />
      <MaterialContextPreview ids={materialIds} query={selectedFramework?.rawXml ?? manualOutline} baseText={selectedFramework?.rawXml ?? manualOutline} providerId={decodeModelTarget(modelTarget)?.providerId} model={decodeModelTarget(modelTarget)?.modelId} />
      <details className="composer-advanced"><summary><Sliders size={13} />高级选项</summary><label className="field article-count"><span>每批生成</span><Select value={String(count)} onChange={(value) => setCount(Number(value))} ariaLabel="每批生成" options={[1, 2, 3].map((value) => ({ value: String(value), label: `${value} 篇` }))} /></label><span className="micro-copy">一次生成多篇会按顺序排队，可在生成中随时取消。</span></details>
      {stream.active && <StreamingPreview progress={stream.progress} content={stream.content} label="正在写作…" />}
      </div>
      <footer className="article-composer-footer">
        <button className="button secondary" disabled={stream.active} onClick={() => setComposerOpen(false)}>取消</button>
        {stream.active
          ? <button className="button danger" onClick={stream.cancel}><X size={15} />取消生成</button>
          : <button
              className="button primary"
              disabled={!models.length}
              onClick={() => void generate()}
              title={!models.length ? '请先在「AI 服务」配置文本模型' : undefined}
            >
              <Sparkles size={16} />生成草稿
            </button>}
        {/* 禁用原因就近说明 */}
        {!stream.active && !models.length && (
          <p className="form-hint" role="note">
            还没有可用的文本模型，请先到 <button className="text-button" onClick={() => onNavigate('providers')}>AI 服务</button> 配置。
          </p>
        )}
      </footer>
    </ModalBase>
    {stream.active && !composerOpen && <StreamingPreview progress={stream.progress} content={stream.content} label={revising ? '正在改稿…' : '正在写作…'} />}
    {lastFailed.length > 0 && !stream.active && (
      <p className="inline-alert">上批有 {lastFailed.length} 个候选未成功：{lastFailed.map((item) => `第 ${item.index} 篇 ${item.message.slice(0, 50)}`).join('；')}
        <button className="text-button" disabled={retrying} onClick={() => { void retryFailed() }}><RotateCcw size={13} />只补生成 {lastFailed.length} 篇</button>
      </p>
    )}
    <CreationHistory requests={requests} run={stream.run} refresh={refresh} openArticle={setSelectedId} showToast={showToast} />
    {draftConflict && <p className="inline-alert">本地修改基于旧版本，保存会冲突。可以保留两份内容：<button className="button secondary compact" onClick={() => void saveAsNew()}>另存为新文章</button></p>}
    {draftError && <p className="inline-alert" role="alert">{draftError}。请先保留正文副本，再重新加载。</p>}
    <section className="article-workbench"><aside className="article-list"><header><div><h3>文章 <small>{total}</small></h3></div></header>{listLoading && <p role="status" className="micro-copy">正在读取匹配的文章…</p>}<div className="article-list-filters"><label className="search-field"><Search size={13} /><input name="articleListQuery" autoComplete="off" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="搜索标题或正文…" /></label><div className="segmented article-list-status">{(['all', 'locked', 'draft'] as const).map((value) => <button key={value} className={listStatus === value ? 'active' : ''} onClick={() => setListStatus(value)}>{value === 'all' ? '全部' : value === 'locked' ? '已锁定' : '草稿'}</button>)}</div><div className="segmented account-filter" role="group" aria-label="账号筛选"><button className={accountFilter === 'all' ? 'active' : ''} onClick={() => setAccountFilter('all')}>全部账号</button><button className={accountFilter === 'current' ? 'active' : ''} disabled={!currentAccountId} title={currentAccountId ? '只看当前账号的文章' : '尚未创建当前账号'} onClick={() => setAccountFilter('current')}>当前账号</button></div></div>{articles.length ? <div><VirtualList items={listLoading ? [] : filteredArticles} estimateSize={() => 80} renderItem={(article) => <button key={article.id} className={`article-list-item ${article.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(article.id)}><span className={`badge ${article.status === 'locked' ? 'success' : 'neutral'}`}>{article.status === 'locked' ? '已锁定' : '草稿'}</span><strong>{article.title}</strong><small>第 {article.versionCount} 版 · {formatDate(article.updatedAt)}</small>{article.hasWorkDraft && <em>待保存修改</em>}</button>} /></div> : <div className="article-list-empty"><BookOpenText size={28} /><span>{articles.length ? '没有匹配的文章' : '暂无文章'}</span></div>}<div className="article-pagination"><button className="button ghost compact" disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 30))}</span><button className="button ghost compact" disabled={(page + 1) * 30 >= total} onClick={() => setPage(page + 1)}>下一页</button></div></aside>{selected && selected.id === selectedId ? <ArticleEditor article={selected} draft={draft} dirty={dirty} editorMode={editorMode} imageAssets={imageAssets} onAssetImported={asset => setImageAssets(current => [...current, asset])} instruction={instruction} alignFramework={alignFramework} count={count} revisionMode={revisionMode} onRevisionModeChange={setRevisionMode} onDraftChange={setDraft} loadingDraft={draftStatus === 'loading'} draftStatus={draftStatus} onDiscard={() => { void confirm({ title: '放弃修改', message: '确认放弃当前未保存修改？', danger: true, confirmLabel: '放弃修改' }).then(ok => { if (ok) void discard() }) }} onModeChange={setEditorMode} onInstructionChange={setInstruction} onAlignChange={setAlignFramework} onCountChange={setCount} onSave={() => void saveManual()} onRevise={() => void revise()} onLock={() => void toggleLock()} onRemove={() => void remove()} onRestore={(versionId) => void restore(versionId)} onRenameVersion={(versionId, label) => void renameVersion(versionId, label)} revising={revising} onExport={(format) => void exportAs(format)} /> : <div className="article-empty"><LibraryBig size={40} /><h3>{articles.length ? '没有匹配的文章' : '还没有文章'}</h3><p>{articles.length ? '换个关键词或筛选条件试试。' : '可以让模型按框架写一篇，也可以直接把写好的稿子导入进来慢慢打磨。'}</p><div className="article-empty-actions"><button className="button secondary" onClick={() => setImportOpen(true)}><FileUp size={15} />导入现成稿</button><button className="button primary" onClick={() => { setComposerOpen(true); setImportOpen(false) }}><PenLine size={15} />开始写作</button></div></div>}</section>
    <ImportDraftDialog open={importOpen} busy={importing} onClose={() => setImportOpen(false)} onImport={(markdown, label) => void importArticle(markdown, label)} />
    {ConfirmPortal}
  </div>
}

function ArticleEditor({ article, draft, dirty, loadingDraft, draftStatus, editorMode, imageAssets, onAssetImported, instruction, alignFramework, count, revisionMode, onRevisionModeChange, onDraftChange, onDiscard, onModeChange, onInstructionChange, onAlignChange, onCountChange, onSave, onRevise, onLock, onRemove, onRestore, onRenameVersion, onExport, revising }: { article: Article; draft: string; dirty: boolean; loadingDraft: boolean; draftStatus: 'loading' | 'saving' | 'saved' | 'error'; editorMode: 'visual' | 'source' | 'split'; imageAssets: VisualAsset[]; onAssetImported(asset: VisualAsset): void; instruction: string; alignFramework: boolean; count: number; revisionMode: ReviseArticleInput['revisionMode']; onRevisionModeChange(value: ReviseArticleInput['revisionMode']): void; onDraftChange(value: string): void; onDiscard(): void; onModeChange(value: 'visual' | 'source' | 'split'): void; onInstructionChange(value: string): void; onAlignChange(value: boolean): void; onCountChange(value: number): void; onSave(): void; onRevise(): void; onLock(): void; onRemove(): void; onRestore(versionId: string): void; onRenameVersion(versionId: string, label: string): void; onExport(format: 'markdown' | 'html'): void; revising: boolean }): React.JSX.Element {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const selectionArticleId = useRef<string | null>(null)
  // §7.4：历史版本除了"恢复"还要能"比较"——比较不动任何内容，恢复才是动内容
  const [compareId, setCompareId] = useState('')
  // §7.4：命名只改标签，不产生新版本；一次只让一版处于可命名状态，输入框不进常态 Tab 序列
  const [namingId, setNamingId] = useState('')
  const nameCancelRef = useRef('')
  const compareVersion = article.versions.find((version) => version.id === compareId)
  const diffRows = compareVersion ? diffLines(compareVersion.rawMarkdown, draft) : []
  const addedCount = diffRows.filter((row) => row.kind === 'added').length
  const removedCount = diffRows.filter((row) => row.kind === 'removed').length
  /** 在光标处插入图片 Markdown；预览模式下追加到文末，插入后仍是未保存草稿 */
  const insertImage = (asset: VisualAsset): void => {
    const snippet = `![${asset.prompt.trim().slice(0, 24) || '配图'}](${asset.url})`
    const element = editorRef.current
    const hasSelection = selectionArticleId.current === article.id
    const start = hasSelection ? element?.selectionStart ?? draft.length : draft.length
    const end = hasSelection ? element?.selectionEnd ?? draft.length : draft.length
    // 图片替换当前选区；未选中文字时在光标处插入，不重复原有正文。
    const insertAt = start
    const prefix = !draft.slice(0, insertAt).trim() ? '' : '\n\n'
    onDraftChange(`${draft.slice(0, insertAt)}${prefix}${snippet}\n\n${draft.slice(end)}`)
    const caret = insertAt + prefix.length + snippet.length
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(caret, caret) })
  }
  function insertFormatting(before: string, after = ''): void {
    const element = editorRef.current
    const start = element?.selectionStart ?? draft.length, end = element?.selectionEnd ?? start
    onDraftChange(draft.slice(0, start) + before + draft.slice(start, end) + after + draft.slice(end))
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + before.length, end + before.length) })
  }
  return (<div className="article-editor layout-desk two-col"><div className="article-canvas"><header className="article-editor-head"><div><span className="eyebrow">文章 · V{article.versionCount}</span><h2>{articleTitle(article.rawMarkdown)}</h2><p>{article.model || '手动创建'} · {article.materialIds.length} 条素材 · {formatDate(article.updatedAt)}</p></div><div><button className="button ghost compact" onClick={onLock}>{article.status === 'locked' ? <LockOpen size={14} /> : <Lock size={14} />}{article.status === 'locked' ? '解锁' : '锁定'}</button><button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={16} /></button></div></header><div className="article-editor-toolbar"><div><button className={editorMode === 'visual' ? 'active' : ''} onClick={() => onModeChange('visual')}><BookOpenText size={14} />预览</button><button className={editorMode === 'source' ? 'active' : ''} onClick={() => onModeChange('source')}><FilePenLine size={14} />源码编辑</button><button className={editorMode === 'split' ? 'active' : ''} onClick={() => onModeChange('split')}>编辑与预览</button></div><div className="article-save-state">{dirty ? <><span className="badge warning" role="status">{draftStatus === 'error' ? '暂存失败' : draftStatus === 'saving' ? '正在本地暂存…' : '已本地暂存 · 待保存版本'}</span><button className="text-button" onClick={onDiscard}>放弃本地修改</button></> : <span className="badge neutral" role="status">{loadingDraft ? '正在读取草稿…' : '已保存版本'}</span>}<button className="button primary compact" disabled={!dirty || loadingDraft} onClick={onSave}><Save size={14} />保存</button></div></div><div className="article-supplement-tools">{editorMode !== 'visual' && <div className="markdown-formatting" role="toolbar" aria-label="正文格式">{[['标题', '\n## '], ['加粗', '**', '**'], ['列表', '\n- '], ['引用', '\n> '], ['链接', '[', '](https://)']].map(([label, before, after]) => <button key={label} className="button ghost compact" disabled={loadingDraft} onClick={() => insertFormatting(before, after)}>{label}</button>)}</div>}<div className="article-tools-end">{editorMode !== 'visual' && imageAssets.length > 0 && <Select value="" onChange={(value) => { const asset = imageAssets.find((item) => item.id === value); if (asset) insertImage(asset) }} ariaLabel="插入配图" disabled={!imageAssets.length} emptyText="还没有图片，先去智能配图导入或生成" placeholder={imageAssets.length ? `插入配图（${imageAssets.length} 张）` : '暂无配图'} options={imageAssets.map((asset, index) => ({ value: asset.id, label: `${asset.kind === 'release' ? '发布图' : '文内图'} ${index + 1}`, hint: asset.prompt.slice(0, 18) }))} />}{editorMode !== 'visual' && <LocalImageImport articleId={article.id} kind="inline" onImported={asset => { onAssetImported(asset); insertImage(asset) }} />}<div className="article-export-actions"><button className="button ghost compact" title="导出为 Markdown 文件" onClick={() => onExport('markdown')}><Download size={14} />Markdown</button><button className="button ghost compact" title="导出为图片内嵌的单文件 HTML" onClick={() => onExport('html')}><Download size={14} />HTML</button></div></div></div>{editorMode !== 'visual' ? (
          /* 源码模式左右并排：左边改字，右边同步看到微信里的真实排版（与正式排版同一渲染函数） */
          <div className={`article-split ${editorMode === 'source' ? 'source-only' : ''}`}>
            <textarea ref={editorRef} onSelect={() => { selectionArticleId.current = article.id }} disabled={loadingDraft} maxLength={190000} className="article-markdown-editor" name="articleMarkdown" autoComplete="off" value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave() } }} spellCheck />
            {editorMode === 'split' && <WechatLivePreview markdown={draft} />}
          </div>
        ) : <MarkdownPreview markdown={draft} />}</div><aside className="article-rail desk-rail"><h4 className="article-rail-title rail-h">AI 动作</h4><details className="article-revision"><summary>智能改稿 · 按要求生成新版本</summary><textarea name="instruction" autoComplete="off" rows={3} value={instruction} maxLength={8000} onChange={(event) => onInstructionChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); onRevise() } }} placeholder="输入改稿要求（Ctrl+Enter 生成改稿）" /><footer><Select value={revisionMode} onChange={value => onRevisionModeChange(value as ReviseArticleInput["revisionMode"])} ariaLabel="改稿方式" options={[{ value: "new-version", label: "当前文章新版本" }, { value: "new-candidates", label: "独立备选稿" }]} /><label><input type="checkbox" name="alignFramework" autoComplete="off" checked={alignFramework} onChange={(event) => onAlignChange(event.target.checked)} />对齐框架</label><details className="composer-advanced revision-advanced"><summary><Sliders size={13} />候选 {count} 个</summary><label className="field"><span>候选数</span><Select value={String(count)} onChange={(value) => onCountChange(Number(value))} ariaLabel="改稿候选数" options={[1, 2, 3].map((value) => ({ value: String(value), label: `${value} 个` }))} /></label></details><span /><button className="button secondary" disabled={revising || !instruction.trim()} onClick={onRevise}>{revising ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{revising ? '正在改稿…' : '生成改稿'}</button></footer></details><h4 className="article-rail-title rail-gap">版本历史</h4><details className="article-history"><summary><History size={16} />版本历史 · {article.versionCount} 个版本</summary>{article.versions.map((version) => <div key={version.id}><span>{version.label || `第 ${version.versionNumber} 版`}</span><strong>{version.source === 'generate' ? '智能写作' : version.source === 'revise' ? '智能改稿' : version.source === 'manual' ? '手动编辑' : '恢复版本'}</strong><small>{version.model || '本地'} · {formatDate(version.createdAt)}{version.label ? ` · 第 ${version.versionNumber} 版` : ''}</small><div className="article-history-actions">{namingId === version.id ? <input className="article-version-name" name={`versionName-${version.versionNumber}`} autoComplete="off" defaultValue={version.label ?? ''} maxLength={60} placeholder="给这一版起个名字，回车保存" aria-label={`命名第 ${version.versionNumber} 版`} autoFocus onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); nameCancelRef.current = version.id; setNamingId(''); return } if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} onBlur={(event) => { const value = event.currentTarget.value; if (nameCancelRef.current === version.id) nameCancelRef.current = ''; else onRenameVersion(version.id, value); setNamingId('') }} /> : <button className="button ghost compact" onClick={() => setNamingId(version.id)}>{version.label ? '改名' : '命名'}</button>}<button className="button ghost compact" onClick={() => setCompareId(version.id)}>对比</button>{version.id !== article.currentVersionId && <button className="button ghost compact" onClick={() => onRestore(version.id)}>恢复</button>}</div></div>)}</details></aside>
      <ModalBase open={Boolean(compareVersion)} onClose={() => setCompareId('')} titleId="article-diff-title" className="version-diff-dialog article-diff-dialog">
        {compareVersion && <>
          <h2 id="article-diff-title">{compareVersion.label || `第 ${compareVersion.versionNumber} 版`} ↔ 屏幕上的正文</h2>
          <p className="micro-copy">{addedCount || removedCount ? `新增 ${addedCount} 行、删除 ${removedCount} 行。` : '两边逐字相同。'}比较不会改动内容，要换回去点「恢复此版本」。</p>
          <div className="version-comparison"><section><h3>{compareVersion.label || `第 ${compareVersion.versionNumber} 版`}</h3><pre>{compareVersion.rawMarkdown}</pre></section><section><h3>屏幕上的正文</h3><pre>{draft}</pre></section></div>
          <details className="comparison-changes"><summary>逐行差异 · 新增 {addedCount} 行 / 删除 {removedCount} 行</summary><div className="article-diff">{diffRows.map((row, index) => <span key={`${row.kind}:${index}`} className={`article-diff-row ${row.kind}`}><em>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ''}</em>{row.text || ' '}</span>)}</div></details>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setCompareId('')}>关闭</button>
            {compareVersion.id !== article.currentVersionId && <button className="button primary" onClick={() => { setCompareId(''); onRestore(compareVersion.id) }}>恢复此版本</button>}
          </div>
        </>}
      </ModalBase>
    </div>
  )
}

/**
 * 微信排版实时预览。
 *
 * 关键设计：预览调用主进程的 renderLayoutMarkdown（与正式排版同一函数），
 * 因此「预览所见」= 「发布所得」。若在前端另写一套渲染，两份实现必然漂移，
 * 预览反而会误导用户——那比没有预览更糟。
 *
 * 只读：contentEditable 的 markdown↔HTML 往返会静默丢表格与嵌套列表，
 * 编辑仍在左侧源码区进行。
 *
 * 宽度档位模拟真机：微信正文渲染的就是我们输出的内联 HTML，
 * 宽度是主要变量。但需诚实标注——微信客户端渲染引擎仍有细微差异。
 */

/** 预览宽度档位。375 是主流手机宽度 */
const PREVIEW_WIDTHS = [
  { id: 'phone', label: '手机', width: 375 },
  { id: 'phone-lg', label: '大屏', width: 414 },
  { id: 'tablet', label: '平板', width: 768 },
  { id: 'full', label: '满宽', width: 0 }
] as const

function WechatLivePreview({ markdown, themeId }: { markdown: string; themeId?: string }): React.JSX.Element {
  const [html, setHtml] = useState('')
  const [violations, setViolations] = useState<LayoutViolation[]>([])
  const [widthId, setWidthId] = useState<(typeof PREVIEW_WIDTHS)[number]['id']>('phone')
  const [pending, setPending] = useState(false)

  // 防抖 300ms：逐字符触发 IPC 会让主进程忙于排版，反而卡顿
  useEffect(() => {
    if (!markdown.trim()) {
      setHtml('')
      setViolations([])
      return
    }
    let cancelled = false
    setPending(true)
    const timer = setTimeout(() => {
      window.moliu.layouts.renderPreview({ markdown, platform: 'wechat', themeId })
        .then((result) => {
          if (cancelled) return
          setHtml(result.html)
          setViolations(result.violations ?? [])
        })
        .catch(() => {
          if (!cancelled) setHtml('')
        })
        .finally(() => {
          if (!cancelled) setPending(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [markdown, themeId])

  const activeWidth = PREVIEW_WIDTHS.find((item) => item.id === widthId)
  const errors = violations.filter((violation) => violation.level === 'error')
  const warns = violations.filter((violation) => violation.level === 'warn')

  return (
    <section className="live-preview" aria-label="微信排版预览">
      <header className="live-preview-bar">
        <span className="live-preview-title">
          微信排版预览
          {pending && <em className="live-preview-pending">渲染中…</em>}
        </span>
        <div className="segmented live-preview-widths" role="group" aria-label="预览宽度">
          {PREVIEW_WIDTHS.map((item) => (
            <button key={item.id} className={widthId === item.id ? 'active' : ''} onClick={() => setWidthId(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* 合规提示：实时预览独有的价值——不预览就看不到格式会被丢弃 */}
      {errors.length > 0 && (
        <p className="live-preview-alert error" role="alert">
          <AlertTriangle size={14} />
          有 {errors.length} 处格式会在公众号丢失：{errors.map((violation) => violation.message).join('；')}
        </p>
      )}
      {warns.length > 0 && (
        <p className="live-preview-alert warn" role="note">
          <Info size={14} />
          {warns.length} 个提醒：{warns.map((violation) => violation.message).join('；')}
        </p>
      )}

      <div className="live-preview-stage">
        <div className="live-preview-canvas" style={{ maxWidth: activeWidth?.width ? `${activeWidth.width}px` : '100%' }}>
          {html
            ? <article className="article-markdown-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
            : <p className="live-preview-empty">{pending ? '正在渲染…' : '开始输入即可看到微信里的真实排版效果'}</p>}
        </div>
      </div>
      <p className="live-preview-foot micro-copy">
        预览与实际发布使用同一套排版结果。宽度与真机一致，微信客户端的字体渲染与间距可能有细微差异。
      </p>
    </section>
  )
}

/**
 * 只读预览：contentEditable 的 markdown↔HTML 往返会静默丢失表格、嵌套列表等格式，
 * 因此「预览」模式不再承担编辑职责，编辑统一走源码模式。
 * 解析统一用 markdown-it，与排版服务同一套语法，避免预览看不到加粗/链接/图片而误判内容丢失。
 */
const previewMarkdown = new MarkdownIt({ html: false, linkify: true, breaks: false })

function MarkdownPreview({ markdown }: { markdown: string }): React.JSX.Element {
  const html = useMemo(() => sanitizeHtml(previewMarkdown.render(markdown)), [markdown])
  return <div className="article-readonly-hint"><span className="micro-copy">预览模式 · 点击上方「源码编辑」修改内容</span><article className="article-markdown-preview" dangerouslySetInnerHTML={{ __html: html }} /></div>
}
function articleTitle(markdown: string): string { return markdownTitle(markdown, '未命名成稿') }

/**
 * F16：没有模型也能用本工具。粘贴成稿、导入 .md 文件、或从空白稿开始写，
 * 三者都直接落成本地草稿版本，后续改稿/评审/配图仍按正常文章流程走。
 */
function ImportDraftDialog({ open, busy, onClose, onImport }: { open: boolean; busy?: boolean; onClose(): void; onImport(markdown: string, label: string): void }): React.JSX.Element {
  const [pasted, setPasted] = useState('')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')

  function withTitle(markdown: string): string {
    if (/^\s*#\s+\S/.test(markdown)) return markdown.trimStart()
    const title = fileName.replace(/\.(md|markdown|txt)$/i, '').trim() || '导入的稿件'
    return `# ${title}\n\n${markdown.trim()}`
  }

  async function readPickedFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    setError('')
    if (!file) return
    const text = await file.text()
    if (text.length > 190_000) { setError('文件内容过长（上限约 19 万字符），请拆分后再导入'); return }
    if (!text.trim()) { setError('文件内容为空'); return }
    setFileName(file.name); setPasted(text)
  }

  return <ModalBase open={open} onClose={onClose} titleId="import-draft-title" className="import-draft-dialog">
    <header><div><span className="eyebrow">不依赖模型</span><h2 id="import-draft-title">导入现成文章</h2><p>导入后即成本地草稿版本，之后照样可以改稿、评审、配图与发布。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
    <label className="field"><span>粘贴 Markdown</span><textarea name="importMarkdown" autoComplete="off" rows={8} value={pasted} maxLength={190000} onChange={(event) => { setPasted(event.target.value); setError('') }} placeholder="# 标题&#10;&#10;把已经写好的正文粘贴到这里…" /></label>
    {fileName && <p className="micro-copy">已读取文件：{fileName}</p>}
    {error && <p className="inline-alert danger">{error}</p>}
    <footer>
      <label className="button secondary compact file-pick"><FileUp size={14} />选择 .md 文件<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(event) => void readPickedFile(event)} /></label>
      <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
      <button className="button secondary" disabled={busy || !pasted.trim()} onClick={() => onImport(withTitle(pasted), '粘贴稿')}><ClipboardPaste size={14} />导入粘贴内容</button>
      <button className="button primary" disabled={busy} onClick={() => onImport('# 未命名文章\n\n', '空白稿')}><FilePlus2 size={14} />从空白稿开始写</button>
    </footer>
  </ModalBase>
}
