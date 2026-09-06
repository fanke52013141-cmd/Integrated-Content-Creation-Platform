import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText, Check, ChevronLeft, FilePenLine, FolderHeart, History,
  Image, LibraryBig, LoaderCircle, Lock, LockOpen, PenLine, Plus, Save, Search, Sparkles,
  Trash2, WandSparkles, X
} from 'lucide-react'
import type { AccountProfileSummary, Article, Framework, Material, ProviderSummary } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import { Select } from '../components/Select'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { VirtualList } from '../components/VirtualList'
import { StreamingPreview } from '../components/StreamingPreview'
import { PageHeader } from '../components/PageHeader'
import { MaterialPicker } from '../components/MaterialPicker'
import { useGenerationStream, isCancelError } from '../hooks/useGenerationStream'
import { useDraftState } from '../hooks/useDraftState'
import { availableModels, decodeModelTarget, encodeModelTarget, useModelTarget } from '../lib/models'
import { errorMessage, formatDate, markdownTitle } from '../lib'

interface ArticlesPageProps { accounts: AccountProfileSummary[]; providers: ProviderSummary[]; currentAccountId?: string; onNavigate(route: RouteId, params?: Record<string, string>): void; focusFrameworkId?: string; showToast(toast: ToastState): void }

export function ArticlesPage({ accounts, providers, currentAccountId, onNavigate, focusFrameworkId, showToast }: ArticlesPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const stream = useGenerationStream('articles')
  const [articles, setArticles] = useState<Article[]>([])
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [frameworkId, setFrameworkId] = useState('')
  const [accountId, setAccountId] = useState(currentAccountId ?? '')
  const [materialIds, setMaterialIds] = useState<Set<string>>(new Set())
  const [manualOutline, setManualOutline] = useDraftState('article-outline')
  const [count, setCount] = useState(1)
  const [revising, setRevising] = useState(false)
  const [lastFailed, setLastFailed] = useState<Array<{ index: number; message: string }>>([])
  const [instruction, setInstruction, clearInstruction] = useDraftState('article-instruction')
  const [alignFramework, setAlignFramework] = useState(true)
  const [draft, setDraft] = useState('')
  const [editorMode, setEditorMode] = useState<'visual' | 'source'>('visual')
  const [inheritedMaterials, setInheritedMaterials] = useState(false)
  const [listQuery, setListQuery] = useState('')
  const [listStatus, setListStatus] = useState<'all' | 'locked' | 'draft'>('all')
  const [accountFilter, setAccountFilter] = useState<'all' | 'current'>('all')

  const models = useMemo(() => availableModels(providers), [providers])
  const [modelTarget, setModelTarget] = useModelTarget(models)
  const selected = articles.find((article) => article.id === selectedId)
  const selectedFramework = frameworks.find((framework) => framework.id === frameworkId)
  const usableMaterials = materials.filter((material) => material.kind !== 'image')

  async function refresh(): Promise<void> {
    const [nextArticles, nextFrameworks, nextMaterials] = await Promise.all([
      window.moliu.articles.list(), window.moliu.frameworks.list(), window.moliu.materials.list()
    ])
    setArticles(nextArticles); setFrameworks(nextFrameworks); setMaterials(nextMaterials)
    setSelectedId((current) => nextArticles.some((article) => article.id === current) ? current : nextArticles[0]?.id ?? '')
    if (focusFrameworkId && nextFrameworks.some((f) => f.id === focusFrameworkId)) setFrameworkId(focusFrameworkId)
  }
  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => {
    if (!accountId || !accounts.some((account) => account.id === accountId)) setAccountId(currentAccountId ?? accounts[0]?.id ?? '')
  }, [accountId, accounts, currentAccountId])
  useEffect(() => { setDraft(selected?.rawMarkdown ?? '') }, [selected?.id, selected?.rawMarkdown])
  useEffect(() => {
    if (!selectedFramework) return
    setAccountId((current) => current || selectedFramework.accountId || '')
    // 框架带素材时直接沿用（用户改过会覆盖用户选择，因此仅在切换框架时执行一次）
    if (selectedFramework.materialIds.length) {
      setMaterialIds(new Set(selectedFramework.materialIds))
      setInheritedMaterials(true)
    }
  }, [selectedFramework?.id])

  const filteredArticles = useMemo(() => {
    const keyword = listQuery.trim().toLowerCase()
    return articles.filter((article) => {
      if (listStatus !== 'all' && article.status !== listStatus) return false
      if (accountFilter === 'current' && article.accountId !== currentAccountId) return false
      if (!keyword) return true
      return articleTitle(article.rawMarkdown).toLowerCase().includes(keyword)
    })
  }, [articles, listQuery, listStatus, accountFilter, currentAccountId])

  async function generate(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!frameworkId && !manualOutline.trim()) return showToast({ type: 'error', message: '请选择内容框架，或粘贴手动框架' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    try {
      const result = await stream.run(() => window.moliu.articles.generate({ frameworkId: frameworkId || undefined, accountId: accountId || undefined, materialIds: [...materialIds], manualOutline: manualOutline.trim() || undefined, providerId: target.providerId, model: target.modelId, count }))
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id)
      setLastFailed(result.failed)
      showToast({ type: result.failed.length ? 'warning' : 'success', message: result.failed.length ? `已生成 ${result.articles.length} 篇，${result.failed.length} 篇失败` : `已生成 ${result.articles.length} 篇成稿` })
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
      const result = await stream.run(() => window.moliu.articles.revise({ articleId: selected.id, instruction: instruction.trim(), alignFramework, providerId: target.providerId, model: target.modelId, count }))
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id); clearInstruction()
      setLastFailed(result.failed)
      showToast({ type: result.failed.length ? 'warning' : 'success', message: result.failed.length ? `已完成 ${result.articles.length} 个改稿候选，${result.failed.length} 个失败` : '改稿新版本已保存' })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消改稿' } : { type: 'error', message: errorMessage(error) })
    } finally {
      setRevising(false)
    }
  }
  async function saveManual(): Promise<void> {
    if (!selected || !draft.trim()) return
    try { const saved = await window.moliu.articles.save({ id: selected.id, frameworkId: selected.frameworkId, accountId: selected.accountId, materialIds: selected.materialIds, manualOutline: selected.manualOutline, status: selected.status, rawMarkdown: draft, source: 'manual', providerId: selected.providerId, model: selected.model }); await refresh(); setSelectedId(saved.id); showToast({ type: 'success', message: '手动编辑已保存为新版本' }) }
    catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }
  async function toggleLock(): Promise<void> { if (!selected) return; try { await window.moliu.articles.setLocked(selected.id, selected.status !== 'locked'); await refresh(); showToast({ type: 'success', message: selected.status === 'locked' ? '已恢复为草稿' : '已锁定成稿版本' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } }
  async function restore(versionId: string): Promise<void> { if (!selected) return; try { await window.moliu.articles.restore({ articleId: selected.id, versionId }); await refresh(); showToast({ type: 'success', message: '已从历史版本创建新草稿' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } }
  async function remove(): Promise<void> { if (!selected || !(await confirm({ title: '确认操作', message: '确定删除这篇成稿及其全部本地版本吗？', danger: true, confirmLabel: '确认' }))) return; try { await window.moliu.articles.remove(selected.id); await refresh(); showToast({ type: 'success', message: '成稿已删除' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } }

  return <div className="page articles-page">
    <PageHeader
      route="articles"
      onNavigate={onNavigate}
      title="文章工作台"
      description="按框架扩写成稿，改稿打磨后锁定进入评审与发布"
      actions={<div className="page-intro-actions">
        <button className="button secondary" onClick={() => onNavigate('frameworks')}><WandSparkles size={15} />内容框架</button>
        {selected?.status === 'locked' && <>
          <button className="button secondary" onClick={() => onNavigate('reviews', { articleId: selected.id })}><Check size={15} />去评审</button>
          <button className="button secondary" onClick={() => onNavigate('visuals', { articleId: selected.id })}><Image size={15} />去配图</button>
          <button className="button primary" onClick={() => onNavigate('layouts', { articleId: selected.id })}><FilePenLine size={15} />去排版</button>
        </>}
      </div>}
    />
    <section className="article-composer"><header><div><h3>新建草稿</h3></div><span>{selectedFramework ? `框架 V${selectedFramework.versionCount}` : '手动框架'}</span></header><div className="article-compose-grid"><label className="field"><span>内容框架</span><Select value={frameworkId} onChange={setFrameworkId} placeholder="不关联框架" ariaLabel="内容框架" options={[{ value: '', label: '不关联框架' }, ...frameworks.map((framework) => ({ value: framework.id, label: framework.sections[0]?.content || framework.manualTopic, hint: `V${framework.versionCount}` }))]} /></label><label className="field"><span>账号定位</span><Select value={accountId} onChange={setAccountId} placeholder="不使用账号定位" ariaLabel="账号定位" options={[{ value: '', label: '不使用账号定位' }, ...accounts.map((account) => ({ value: account.id, label: account.name, hint: account.status === 'draft' ? '草稿' : undefined }))]} /></label><label className="field"><span>模型</span><Select value={modelTarget} onChange={setModelTarget} placeholder="选择模型" ariaLabel="模型" options={[{ value: '', label: '选择模型' }, ...models.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))]} /></label><label className="field article-count"><span>数量</span><Select value={String(count)} onChange={(value) => setCount(Number(value))} ariaLabel="数量" options={[1, 2, 3].map((value) => ({ value: String(value), label: `${value} 篇` }))} /></label></div><label className="field article-outline-field"><span>手动框架</span><textarea name="manualOutline" autoComplete="off" rows={3} value={manualOutline} maxLength={30000} onChange={(event) => setManualOutline(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void generate() } }} placeholder="输入文章结构（Ctrl+Enter 直接生成）" /></label>{inheritedMaterials && <p className="inline-alert">已沿用所选框架的 {materialIds.size} 条素材，可在下方调整。</p>}<MaterialPicker materials={usableMaterials} selected={materialIds} onToggle={(id, checked) => { setInheritedMaterials(false); setMaterialIds((current) => { const next = new Set(current); checked ? next.add(id) : next.delete(id); return next }) }} onNavigate={onNavigate} /><footer>{stream.active ? <button className="button danger" onClick={stream.cancel}><X size={15} />取消生成</button> : <button className="button primary" disabled={!models.length} onClick={() => void generate()}><Sparkles size={16} />生成草稿</button>}</footer></section>
    {stream.active && <StreamingPreview content={stream.content} label={revising ? '正在改稿…' : '正在写作…'} />}
    {lastFailed.length > 0 && !stream.active && (
      <p className="inline-alert">上批有 {lastFailed.length} 个候选未成功：{lastFailed.map((item) => `第 ${item.index} 篇 ${item.message.slice(0, 50)}`).join('；')}</p>
    )}
    <section className="article-workbench"><aside className="article-list"><header><div><h3>文章 <small>{articles.length}</small></h3></div></header><div className="article-list-filters"><label className="search-field"><Search size={13} /><input name="articleListQuery" autoComplete="off" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="搜索标题…" /></label><div className="segmented article-list-status">{(['all', 'locked', 'draft'] as const).map((value) => <button key={value} className={listStatus === value ? 'active' : ''} onClick={() => setListStatus(value)}>{value === 'all' ? '全部' : value === 'locked' ? '已锁定' : '草稿'}</button>)}</div><div className="segmented account-filter" role="group" aria-label="账号筛选"><button className={accountFilter === 'all' ? 'active' : ''} onClick={() => setAccountFilter('all')}>全部账号</button><button className={accountFilter === 'current' ? 'active' : ''} disabled={!currentAccountId} title={currentAccountId ? '只看当前账号的文章' : '尚未创建当前账号'} onClick={() => setAccountFilter('current')}>当前账号</button></div></div>{articles.length ? <div><VirtualList items={filteredArticles} estimateSize={() => 80} renderItem={(article) => <button key={article.id} className={`article-list-item ${article.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(article.id)}><span className={`badge ${article.status === 'locked' ? 'success' : 'neutral'}`}>{article.status === 'locked' ? '已锁定' : '草稿'}</span><strong>{articleTitle(article.rawMarkdown)}</strong><small>第 {article.versionCount} 版 · {formatDate(article.updatedAt)}</small>{article.references.some((reference) => reference.sourceStatusSnapshot === 'draft') && <em>引用草稿</em>}</button>} /></div> : <div className="article-list-empty"><BookOpenText size={28} /><span>{articles.length ? '没有匹配的文章' : '暂无文章'}</span></div>}</aside>{selected ? <ArticleEditor article={selected} draft={draft} editorMode={editorMode} instruction={instruction} alignFramework={alignFramework} count={count} onDraftChange={setDraft} onModeChange={setEditorMode} onInstructionChange={setInstruction} onAlignChange={setAlignFramework} onCountChange={setCount} onSave={() => void saveManual()} onRevise={() => void revise()} onLock={() => void toggleLock()} onRemove={() => void remove()} onRestore={(versionId) => void restore(versionId)} revising={revising} /> : <div className="article-empty"><LibraryBig size={40} /><h3>暂无文章</h3></div>}</section>
    {ConfirmPortal}
  </div>
}

function ArticleEditor({ article, draft, editorMode, instruction, alignFramework, count, onDraftChange, onModeChange, onInstructionChange, onAlignChange, onCountChange, onSave, onRevise, onLock, onRemove, onRestore, revising }: { article: Article; draft: string; editorMode: 'visual' | 'source'; instruction: string; alignFramework: boolean; count: number; onDraftChange(value: string): void; onModeChange(value: 'visual' | 'source'): void; onInstructionChange(value: string): void; onAlignChange(value: boolean): void; onCountChange(value: number): void; onSave(): void; onRevise(): void; onLock(): void; onRemove(): void; onRestore(versionId: string): void; revising: boolean }): React.JSX.Element {
  return <div className="article-editor"><header className="article-editor-head"><div><span className="eyebrow">文章 · V{article.versionCount}</span><h2>{articleTitle(article.rawMarkdown)}</h2><p>{article.model || '手动创建'} · {article.materialIds.length} 条素材 · {formatDate(article.updatedAt)}</p></div><div><button className="button ghost compact" onClick={onLock}>{article.status === 'locked' ? <LockOpen size={14} /> : <Lock size={14} />}{article.status === 'locked' ? '解锁' : '锁定'}</button><button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={16} /></button></div></header><div className="article-editor-toolbar"><div><button className={editorMode === 'visual' ? 'active' : ''} onClick={() => onModeChange('visual')}><BookOpenText size={14} />预览</button><button className={editorMode === 'source' ? 'active' : ''} onClick={() => onModeChange('source')}><FilePenLine size={14} />源码编辑</button></div><button className="button primary compact" onClick={onSave}><Save size={14} />保存</button></div>{editorMode === 'source' ? <textarea className="article-markdown-editor" name="articleMarkdown" autoComplete="off" value={draft} onChange={(event) => onDraftChange(event.target.value)} spellCheck /> : <MarkdownPreview markdown={draft} />}<section className="article-revision"><header><div><h3>智能改稿</h3></div></header><textarea name="instruction" autoComplete="off" rows={3} value={instruction} maxLength={8000} onChange={(event) => onInstructionChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); onRevise() } }} placeholder="输入改稿要求（Ctrl+Enter 生成改稿）" /><footer><label><input type="checkbox" name="alignFramework" autoComplete="off" checked={alignFramework} onChange={(event) => onAlignChange(event.target.checked)} />对齐框架</label><label>候选 <Select value={String(count)} onChange={(value) => onCountChange(Number(value))} ariaLabel="候选" options={[1, 2, 3].map((value) => ({ value: String(value), label: String(value) }))} /></label><span /><button className="button secondary" disabled={revising || !instruction.trim()} onClick={onRevise}>{revising ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{revising ? '正在改稿…' : '生成改稿'}</button></footer></section><section className="article-history"><header><History size={16} /><strong>版本历史</strong></header>{article.versions.map((version) => <div key={version.id}><span>第 {version.versionNumber} 版</span><strong>{version.source === 'generate' ? '智能写作' : version.source === 'revise' ? '智能改稿' : version.source === 'manual' ? '手动编辑' : '恢复版本'}</strong><small>{version.model || '本地'} · {formatDate(version.createdAt)}</small>{version.id !== article.currentVersionId && <button className="button ghost compact" onClick={() => onRestore(version.id)}>恢复</button>}</div>)}</section></div>
}

/**
 * 只读预览：contentEditable 的 markdown↔HTML 往返会静默丢失表格、嵌套列表等格式，
 * 因此「预览」模式不再承担编辑职责，编辑统一走源码模式。
 */
function MarkdownPreview({ markdown }: { markdown: string }): React.JSX.Element {
  const html = useMemo(() => markdownToHtml(markdown), [markdown])
  return <div className="article-readonly-hint"><span className="micro-copy">预览模式 · 点击上方「源码编辑」修改内容</span><article className="article-markdown-preview" dangerouslySetInnerHTML={{ __html: html }} /></div>
}
function markdownToHtml(markdown: string): string { return markdown.split('\n').map((line) => line.startsWith('# ') ? `<h1>${escapeHtml(line.slice(2))}</h1>` : line.startsWith('## ') ? `<h2>${escapeHtml(line.slice(3))}</h2>` : line.startsWith('### ') ? `<h3>${escapeHtml(line.slice(4))}</h3>` : line.startsWith('- ') ? `<div class="rich-list">• ${escapeHtml(line.slice(2))}</div>` : line.startsWith('> ') ? `<blockquote>${escapeHtml(line.slice(2))}</blockquote>` : line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>').join('') }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function articleTitle(markdown: string): string { return markdownTitle(markdown, '未命名成稿') }
