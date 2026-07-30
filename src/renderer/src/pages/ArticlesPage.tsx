import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText, Check, ChevronLeft, FilePenLine, FolderHeart, History,
  LibraryBig, LoaderCircle, Lock, LockOpen, PenLine, Plus, Save, Sparkles,
  Trash2, WandSparkles
} from 'lucide-react'
import type { AccountProfileSummary, Article, Framework, Material, ProviderSummary } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { VirtualList } from '../components/VirtualList'
import { errorMessage, formatDate } from '../lib'

interface ArticlesPageProps { accounts: AccountProfileSummary[]; providers: ProviderSummary[]; currentAccountId?: string; onNavigate(route: RouteId): void; showToast(toast: ToastState): void }

export function ArticlesPage({ accounts, providers, currentAccountId, onNavigate, showToast }: ArticlesPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [articles, setArticles] = useState<Article[]>([])
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [frameworkId, setFrameworkId] = useState('')
  const [accountId, setAccountId] = useState(currentAccountId ?? '')
  const [materialIds, setMaterialIds] = useState<Set<string>>(new Set())
  const [manualOutline, setManualOutline] = useState('')
  const [modelTarget, setModelTarget] = useState('')
  const [count, setCount] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [revising, setRevising] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [alignFramework, setAlignFramework] = useState(true)
  const [draft, setDraft] = useState('')
  const [editorMode, setEditorMode] = useState<'visual' | 'source'>('visual')

  const models = providers.filter((provider) => provider.enabled && provider.hasApiKey)
    .flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({ provider, model })))
  const selected = articles.find((article) => article.id === selectedId)
  const selectedFramework = frameworks.find((framework) => framework.id === frameworkId)
  const usableMaterials = materials.filter((material) => material.kind !== 'image')

  async function refresh(): Promise<void> {
    const [nextArticles, nextFrameworks, nextMaterials] = await Promise.all([
      window.moliu.articles.list(), window.moliu.frameworks.list(), window.moliu.materials.list()
    ])
    setArticles(nextArticles); setFrameworks(nextFrameworks); setMaterials(nextMaterials)
    setSelectedId((current) => nextArticles.some((article) => article.id === current) ? current : nextArticles[0]?.id ?? '')
  }
  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => {
    if (!accountId || !accounts.some((account) => account.id === accountId)) setAccountId(currentAccountId ?? accounts[0]?.id ?? '')
  }, [accountId, accounts, currentAccountId])
  useEffect(() => {
    const preferred = models.find(({ model }) => model.isDefault) ?? models[0]
    const current = decodeModelTarget(modelTarget)
    if (!current || !models.some(({ provider, model }) => provider.id === current.providerId && model.modelId === current.model)) setModelTarget(preferred ? encodeModelTarget(preferred.provider.id, preferred.model.modelId) : '')
  }, [modelTarget, models])
  useEffect(() => { setDraft(selected?.rawMarkdown ?? '') }, [selected?.id, selected?.rawMarkdown])
  useEffect(() => {
    if (!selectedFramework) return
    setAccountId((current) => current || selectedFramework.accountId || '')
    setMaterialIds((current) => current.size ? current : new Set(selectedFramework.materialIds))
  }, [selectedFramework?.id])

  async function generate(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!frameworkId && !manualOutline.trim()) return showToast({ type: 'error', message: '请选择内容框架，或粘贴手动框架' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    setGenerating(true)
    try {
      const result = await window.moliu.articles.generate({ frameworkId: frameworkId || undefined, accountId: accountId || undefined, materialIds: [...materialIds], manualOutline: manualOutline.trim() || undefined, providerId: target.providerId, model: target.model, count })
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id)
      showToast({ type: result.failed.length ? 'error' : 'success', message: result.failed.length ? `已生成 ${result.articles.length}\u00A0篇，${result.failed.length}\u00A0篇失败` : `已生成 ${result.articles.length}\u00A0篇成稿` })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setGenerating(false) }
  }
  async function revise(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!selected) return showToast({ type: 'error', message: '请先选择一篇成稿' })
    if (!instruction.trim()) return showToast({ type: 'error', message: '请填写修改指令' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    setRevising(true)
    try {
      const result = await window.moliu.articles.revise({ articleId: selected.id, instruction: instruction.trim(), alignFramework, providerId: target.providerId, model: target.model, count })
      await refresh(); if (result.articles[0]) setSelectedId(result.articles[0].id); setInstruction('')
      showToast({ type: result.failed.length ? 'error' : 'success', message: result.failed.length ? `已完成 ${result.articles.length}\u00A0个改稿候选，${result.failed.length}\u00A0个失败` : '改稿新版本已保存' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setRevising(false) }
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
    <section className="page-intro articles-intro"><div><span className="eyebrow"><PenLine size={14} /> ARTICLE STUDIO</span><h2>文章工作台</h2></div><button className="button secondary" onClick={() => onNavigate('frameworks')}><WandSparkles size={16} />内容框架</button></section>
    <section className="article-composer"><header><div><span className="eyebrow">WRITE A DRAFT</span><h3>新建草稿</h3></div><span>{selectedFramework ? `框架 V${selectedFramework.versionCount}` : '手动框架'}</span></header><div className="article-compose-grid"><label className="field"><span>内容框架</span><select name="frameworkId" autoComplete="off" value={frameworkId} onChange={(event) => setFrameworkId(event.target.value)}><option value="">不关联框架</option>{frameworks.map((framework) => <option key={framework.id} value={framework.id}>{framework.sections[0]?.content || framework.manualTopic} · V{framework.versionCount}</option>)}</select></label><label className="field"><span>账号定位</span><select name="accountId" autoComplete="off" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">不使用账号定位</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.status === 'draft' ? ' · 草稿' : ''}</option>)}</select></label><label className="field"><span>模型</span><select name="modelTarget" autoComplete="off" value={modelTarget} onChange={(event) => setModelTarget(event.target.value)}><option value="">选择模型</option>{models.map(({ provider, model }) => <option key={`${provider.id}:${model.modelId}`} value={encodeModelTarget(provider.id, model.modelId)}>{model.displayName} · {provider.displayName}</option>)}</select></label><label className="field article-count"><span>数量</span><select name="articleCount" autoComplete="off" value={count} onChange={(event) => setCount(Number(event.target.value))}>{[1, 2, 3].map((value) => <option key={value} value={value}>{value} 篇</option>)}</select></label></div><label className="field article-outline-field"><span>手动框架</span><textarea name="manualOutline" autoComplete="off" rows={3} value={manualOutline} maxLength={30000} onChange={(event) => setManualOutline(event.target.value)} placeholder="输入文章结构" /></label><div className="article-material-picker"><div><strong><FolderHeart size={16} />引用素材</strong></div><button className="button ghost compact" onClick={() => onNavigate('materials')}>管理</button><div className="article-material-options">{usableMaterials.length ? usableMaterials.slice(0, 10).map((material) => <label key={material.id} className={materialIds.has(material.id) ? 'selected' : ''}><input type="checkbox" name="materialId" autoComplete="off" checked={materialIds.has(material.id)} onChange={(event) => setMaterialIds((current) => { const next = new Set(current); event.target.checked ? next.add(material.id) : next.delete(material.id); return next })} /><span>{material.title}</span></label>) : <p>暂无素材</p>}</div></div><footer><button className="button primary" disabled={generating || !models.length} onClick={() => void generate()}>{generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{generating ? '正在写作…' : '生成草稿'}</button></footer></section>
    <section className="article-workbench"><aside className="article-list"><header><div><span className="eyebrow">MY ARTICLES</span><h3>文章 <small>{articles.length}</small></h3></div></header>{articles.length ? <div><VirtualList items={articles} estimateSize={() => 80} renderItem={(article) => <button key={article.id} className={`article-list-item ${article.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(article.id)}><span className={`badge ${article.status === 'locked' ? 'success' : 'neutral'}`}>{article.status === 'locked' ? '已锁定' : '草稿'}</span><strong>{articleTitle(article.rawMarkdown)}</strong><small>第 {article.versionCount} 版 · {formatDate(article.updatedAt)}</small>{article.references.some((reference) => reference.sourceStatusSnapshot === 'draft') && <em>引用草稿</em>}</button>} /></div> : <div className="article-list-empty"><BookOpenText size={28} /><span>暂无文章</span></div>}</aside>{selected ? <ArticleEditor article={selected} draft={draft} editorMode={editorMode} instruction={instruction} alignFramework={alignFramework} count={count} onDraftChange={setDraft} onModeChange={setEditorMode} onInstructionChange={setInstruction} onAlignChange={setAlignFramework} onCountChange={setCount} onSave={() => void saveManual()} onRevise={() => void revise()} onLock={() => void toggleLock()} onRemove={() => void remove()} onRestore={(versionId) => void restore(versionId)} revising={revising} /> : <div className="article-empty"><LibraryBig size={40} /><h3>暂无文章</h3></div>}</section>
    {ConfirmPortal}
  </div>
}

function ArticleEditor({ article, draft, editorMode, instruction, alignFramework, count, onDraftChange, onModeChange, onInstructionChange, onAlignChange, onCountChange, onSave, onRevise, onLock, onRemove, onRestore, revising }: { article: Article; draft: string; editorMode: 'visual' | 'source'; instruction: string; alignFramework: boolean; count: number; onDraftChange(value: string): void; onModeChange(value: 'visual' | 'source'): void; onInstructionChange(value: string): void; onAlignChange(value: boolean): void; onCountChange(value: number): void; onSave(): void; onRevise(): void; onLock(): void; onRemove(): void; onRestore(versionId: string): void; revising: boolean }): React.JSX.Element {
  return <div className="article-editor"><header className="article-editor-head"><div><span className="eyebrow">ARTICLE · V{article.versionCount}</span><h2>{articleTitle(article.rawMarkdown)}</h2><p>{article.model || '手动创建'} · {article.materialIds.length} 条素材 · {formatDate(article.updatedAt)}</p></div><div><button className="button ghost compact" onClick={onLock}>{article.status === 'locked' ? <LockOpen size={14} /> : <Lock size={14} />}{article.status === 'locked' ? '解锁' : '锁定'}</button><button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={16} /></button></div></header><div className="article-editor-toolbar"><div><button className={editorMode === 'visual' ? 'active' : ''} onClick={() => onModeChange('visual')}><BookOpenText size={14} />可视编辑</button><button className={editorMode === 'source' ? 'active' : ''} onClick={() => onModeChange('source')}><FilePenLine size={14} />源码编辑</button></div><button className="button primary compact" onClick={onSave}><Save size={14} />保存</button></div>{editorMode === 'source' ? <textarea className="article-markdown-editor" name="articleMarkdown" autoComplete="off" value={draft} onChange={(event) => onDraftChange(event.target.value)} spellCheck /> : <RichMarkdownEditor key={article.id} markdown={draft} onChange={onDraftChange} />}<section className="article-revision"><header><div><span className="eyebrow">REVISE WITH AI</span><h3>智能改稿</h3></div></header><textarea name="instruction" autoComplete="off" rows={3} value={instruction} maxLength={8000} onChange={(event) => onInstructionChange(event.target.value)} placeholder="输入改稿要求" /><footer><label><input type="checkbox" name="alignFramework" autoComplete="off" checked={alignFramework} onChange={(event) => onAlignChange(event.target.checked)} />对齐框架</label><label>候选 <select name="candidateCount" autoComplete="off" value={count} onChange={(event) => onCountChange(Number(event.target.value))}>{[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><span /><button className="button secondary" disabled={revising || !instruction.trim()} onClick={onRevise}>{revising ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{revising ? '正在改稿…' : '生成改稿'}</button></footer></section><section className="article-history"><header><History size={16} /><strong>版本历史</strong></header>{article.versions.map((version) => <div key={version.id}><span>第 {version.versionNumber} 版</span><strong>{version.source === 'generate' ? '智能写作' : version.source === 'revise' ? '智能改稿' : version.source === 'manual' ? '手动编辑' : '恢复版本'}</strong><small>{version.model || '本地'} · {formatDate(version.createdAt)}</small>{version.id !== article.currentVersionId && <button className="button ghost compact" onClick={() => onRestore(version.id)}>恢复</button>}</div>)}</section></div>
}

function RichMarkdownEditor({ markdown, onChange }: { markdown: string; onChange(value: string): void }): React.JSX.Element {
  // P0-4: 用 useMemo 派生 html，markdown prop 变化时自动重算；同时 contentEditable 通过 key 重挂载避免内部状态陈旧
  const html = useMemo(() => markdownToHtml(markdown), [markdown])
  return <article key={markdown} className="article-markdown-preview article-rich-editor" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: html }} onInput={(event) => onChange(htmlToMarkdown(event.currentTarget.innerHTML))} />
}
function markdownToHtml(markdown: string): string { return markdown.split('\n').map((line) => line.startsWith('# ') ? `<h1>${escapeHtml(line.slice(2))}</h1>` : line.startsWith('## ') ? `<h2>${escapeHtml(line.slice(3))}</h2>` : line.startsWith('### ') ? `<h3>${escapeHtml(line.slice(4))}</h3>` : line.startsWith('- ') ? `<div class="rich-list">• ${escapeHtml(line.slice(2))}</div>` : line.startsWith('> ') ? `<blockquote>${escapeHtml(line.slice(2))}</blockquote>` : line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>').join('') }
function htmlToMarkdown(html: string): string { const root = document.createElement('div'); root.innerHTML = html; return Array.from(root.children).map((node) => { const text = node.textContent?.trim() ?? ''; if (!text) return ''; if (node.tagName === 'H1') return `# ${text}`; if (node.tagName === 'H2') return `## ${text}`; if (node.tagName === 'H3') return `### ${text}`; if (node.tagName === 'BLOCKQUOTE') return `> ${text}`; if (node.classList.contains('rich-list') || node.tagName === 'LI') return `- ${text.replace(/^•\s*/, '')}`; return text }).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function articleTitle(markdown: string): string { return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || markdown.split('\n').find(Boolean)?.slice(0, 70) || '未命名成稿' }
function encodeModelTarget(providerId: string, model: string): string { return JSON.stringify([providerId, model]) }
function decodeModelTarget(value: string): { providerId: string; model: string } | null { try { const [providerId, model] = JSON.parse(value) as unknown[]; return typeof providerId === 'string' && typeof model === 'string' ? { providerId, model } : null } catch { return null } }
