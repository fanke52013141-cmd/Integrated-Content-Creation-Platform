import { useEffect, useMemo, useState } from 'react'
import {
  Check, ChevronDown, ChevronUp, FilePenLine, FolderHeart, Layers3, LoaderCircle,
  Lock, LockOpen, Pencil, Plus, Save, Sparkles, Trash2, WandSparkles, X
} from 'lucide-react'
import type {
  AccountProfileSummary, Framework, FrameworkSection, FrameworkTemplate, Material, ProviderSummary, Topic
} from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { ModalBase } from '../components/ModalBase'
import { Select } from '../components/Select'
import { VirtualList } from '../components/VirtualList'
import { errorMessage, formatDate } from '../lib'

interface FrameworksPageProps {
  accounts: AccountProfileSummary[]
  providers: ProviderSummary[]
  currentAccountId?: string
  onNavigate(route: RouteId): void
  showToast(toast: ToastState): void
}

export function FrameworksPage({
  accounts, providers, currentAccountId, onNavigate, showToast
}: FrameworksPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [templates, setTemplates] = useState<FrameworkTemplate[]>([])
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [templateId, setTemplateId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [accountId, setAccountId] = useState(currentAccountId ?? '')
  const [materialIds, setMaterialIds] = useState<Set<string>>(new Set())
  const [manualTopic, setManualTopic] = useState('')
  const [modelTarget, setModelTarget] = useState('')
  const [count, setCount] = useState(3)
  const [generating, setGenerating] = useState(false)
  const [templateEditor, setTemplateEditor] = useState<FrameworkTemplate | 'new'>()
  const [editing, setEditing] = useState<Framework>()

  const availableModels = providers.filter((provider) => provider.enabled && provider.hasApiKey)
    .flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({ provider, model })))
  const usableMaterials = materials.filter((material) => material.kind !== 'image')
  const selectedTemplate = templates.find((template) => template.id === templateId)

  async function refresh(): Promise<void> {
    const [nextTemplates, nextFrameworks, nextTopics, nextMaterials] = await Promise.all([
      window.moliu.frameworks.listTemplates(), window.moliu.frameworks.list(),
      window.moliu.topics.list(), window.moliu.materials.list()
    ])
    setTemplates(nextTemplates); setFrameworks(nextFrameworks); setTopics(nextTopics); setMaterials(nextMaterials)
    setTemplateId((current) => nextTemplates.some((item) => item.id === current)
      ? current : nextTemplates.find((item) => item.isDefault)?.id ?? nextTemplates[0]?.id ?? '')
    setMaterialIds((current) => new Set([...current].filter((id) => nextMaterials.some((item) => item.id === id && item.kind !== 'image'))))
  }

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => {
    if (!accountId || !accounts.some((account) => account.id === accountId)) setAccountId(currentAccountId ?? accounts[0]?.id ?? '')
  }, [accounts, accountId, currentAccountId])
  useEffect(() => {
    const preferred = availableModels.find(({ model }) => model.isDefault) ?? availableModels[0]
    const current = decodeModelTarget(modelTarget)
    const exists = current && availableModels.some(({ provider, model }) => provider.id === current.providerId && model.modelId === current.model)
    if (!exists) setModelTarget(preferred ? encodeModelTarget(preferred.provider.id, preferred.model.modelId) : '')
  }, [availableModels, modelTarget])

  async function generate(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!templateId) return showToast({ type: 'error', message: '请选择框架模板' })
    if (!topicId && !manualTopic.trim()) return showToast({ type: 'error', message: '请选择选题，或填写框架主题' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    setGenerating(true)
    try {
      const result = await window.moliu.frameworks.generate({
        templateId, topicId: topicId || undefined, accountId: accountId || undefined,
        materialIds: [...materialIds], manualTopic: manualTopic.trim() || undefined,
        providerId: target.providerId, model: target.model, count
      })
      await refresh()
      if (result.failed.length) showToast({ type: 'error', message: `已生成 ${result.frameworks.length}\u00A0个框架；${result.failed.length}\u00A0个失败` })
      else showToast({ type: 'success', message: `已生成 ${result.frameworks.length}\u00A0个可编辑框架` })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setGenerating(false) }
  }

  async function toggleLocked(framework: Framework): Promise<void> {
    try {
      await window.moliu.frameworks.setLocked(framework.id, framework.status !== 'locked')
      await refresh()
      showToast({ type: 'success', message: framework.status === 'locked' ? '已恢复为草稿' : '已锁定框架版本' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }
  async function remove(framework: Framework): Promise<void> {
    if (!(await confirm({ title: '确认操作', message: '确定删除这个内容框架吗？其本地版本记录会一并删除。', danger: true, confirmLabel: '确认' }))) return
    try { await window.moliu.frameworks.remove(framework.id); await refresh(); showToast({ type: 'success', message: '内容框架已删除' }) }
    catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
  }

  return <div className="page frameworks-page">
    <section className="page-intro frameworks-intro">
      <div><span className="eyebrow"><WandSparkles size={14} /> OUTLINE STUDIO</span><h2>内容框架</h2></div>
      <button className="button secondary" onClick={() => setTemplateEditor(selectedTemplate ?? 'new')}><Layers3 size={16} />编辑框架模板</button>
    </section>

    <div className="framework-studio-layout">
    <section className="framework-composer">
      <header><div><span className="eyebrow">SETTINGS</span><h3>生成设置</h3></div><span>{selectedTemplate ? `${selectedTemplate.sections.length}\u00A0个章节` : '选择模板'}</span></header>
      <div className="framework-compose-grid">
        <label className="field"><span>框架模板</span><Select value={templateId} onChange={setTemplateId} placeholder="选择模板" options={templates.map((template) => ({ value: template.id, label: template.name, hint: template.isDefault ? '默认' : undefined }))} ariaLabel="框架模板" /></label>
        <label className="field"><span>账号定位（可选）</span><Select value={accountId} onChange={setAccountId} placeholder="不使用账号定位" options={[{ value: '', label: '不使用账号定位' }, ...accounts.map((account) => ({ value: account.id, label: account.name, hint: account.status === 'draft' ? '草稿' : undefined }))]} ariaLabel="账号定位" /></label>
        <label className="field"><span>选题（可选）</span><Select value={topicId} onChange={setTopicId} placeholder="不关联选题" options={[{ value: '', label: '不关联选题' }, ...topics.map((topic) => ({ value: topic.id, label: topic.fields['选题主题'] || topic.seedKeyword }))]} ariaLabel="选题" /></label>
        <label className="field"><span>连接与模型</span><Select value={modelTarget} onChange={setModelTarget} placeholder="选择模型" options={[{ value: '', label: '选择模型' }, ...availableModels.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))]} ariaLabel="连接与模型" /></label>
      </div>
      <label className="field framework-topic-field"><span>补充主题（未选选题时必填）</span><textarea name="manualTopic" autoComplete="off" rows={2} maxLength={2000} value={manualTopic} onChange={(event) => setManualTopic(event.target.value)} placeholder="例如：为什么创作者应该先写框架，再写正文？…" /></label>
      <div className="framework-material-picker"><div><strong><FolderHeart size={16} />引用素材</strong></div><button className="button ghost compact" onClick={() => onNavigate('materials')}>管理</button><div className="framework-material-options">{usableMaterials.length ? usableMaterials.slice(0, 12).map((material) => <label key={material.id} className={materialIds.has(material.id) ? 'selected' : ''}><input type="checkbox" name="materialId" autoComplete="off" checked={materialIds.has(material.id)} onChange={(event) => setMaterialIds((current) => { const next = new Set(current); event.target.checked ? next.add(material.id) : next.delete(material.id); return next })} /><span>{material.title}</span><small>{material.kind === 'web' ? '网页' : '文字'}</small></label>) : <p>暂无素材</p>}</div></div>
      <footer><label className="field framework-count"><span>数量</span><Select value={String(count)} onChange={(value) => setCount(Number(value))} placeholder="数量" options={[1, 2, 3].map((value) => ({ value: String(value), label: `${value} 个` }))} ariaLabel="生成数量" /></label><button className="button ghost compact" onClick={() => setTemplateEditor('new')}><Plus size={14} />新建模板</button><button className="button primary" disabled={generating || !availableModels.length} onClick={() => void generate()}>{generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{generating ? '正在生成…' : '生成框架'}</button></footer>
    </section>

    <section className="framework-wall"><header><div><span className="eyebrow">OUTLINE DRAFTS</span><h3>框架预览 <small>{frameworks.length}</small></h3></div></header>{frameworks.length ? <div className="framework-card-grid"><VirtualList items={frameworks} estimateSize={() => 120} renderItem={(framework) => <FrameworkCard key={framework.id} framework={framework} onEdit={() => setEditing(framework)} onToggleLock={() => void toggleLocked(framework)} onRemove={() => void remove(framework)} />} /></div> : <div className="large-empty"><WandSparkles size={34} /><h3>还没有内容框架</h3></div>}</section>
    </div>
    {templateEditor && <TemplateDialog template={templateEditor === 'new' ? undefined : templateEditor} templates={templates} onClose={() => setTemplateEditor(undefined)} onSaved={async () => { setTemplateEditor(undefined); await refresh() }} showToast={showToast} />}
    {editing && <FrameworkEditor framework={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await refresh() }} showToast={showToast} />}
    {ConfirmPortal}
  </div>
}

function FrameworkCard({ framework, onEdit, onToggleLock, onRemove }: { framework: Framework; onEdit(): void; onToggleLock(): void; onRemove(): void }): React.JSX.Element {
  const hasDraftReference = framework.references.some((reference) => reference.sourceStatusSnapshot === 'draft')
  return <article className="framework-card"><header><div className="framework-card-badges"><span className={`badge ${framework.status === 'locked' ? 'success' : 'neutral'}`}>{framework.status === 'locked' ? <Lock size={11} /> : <FilePenLine size={11} />}{framework.status === 'locked' ? '已锁定' : '草稿'}</span>{hasDraftReference && <span className="badge warning">引用草稿</span>}</div><div><button className="icon-button" title="编辑" aria-label="编辑" onClick={onEdit}><Pencil size={15} /></button><button className="icon-button" title={framework.status === 'locked' ? '解锁' : '锁定'} aria-label={framework.status === 'locked' ? '解锁' : '锁定'} onClick={onToggleLock}>{framework.status === 'locked' ? <LockOpen size={15} /> : <Lock size={15} />}</button><button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={15} /></button></div></header><div className="framework-card-title"><span>OUTLINE · V{framework.versionCount}</span><h3>{framework.sections[0]?.content || framework.manualTopic || '未命名框架'}</h3></div><div className="framework-section-preview">{framework.sections.slice(1, 4).map((section) => <p key={section.name}><strong>{section.name}</strong>{section.content}</p>)}</div><footer><span>{framework.model || '手动'} </span><span>{framework.materialIds.length} 条素材</span><span>{formatDate(framework.updatedAt)}</span></footer></article>
}

function TemplateDialog({ template, templates, onClose, onSaved, showToast }: { template?: FrameworkTemplate; templates: FrameworkTemplate[]; onClose(): void; onSaved(): Promise<void>; showToast(toast: ToastState): void }): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '')
  const [sections, setSections] = useState(template?.sections ?? ['标题', '开头', '论点一', '论点二', '论点三', '结尾'])
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? !templates.length)
  const [saving, setSaving] = useState(false)
  async function save(): Promise<void> { setSaving(true); try { await window.moliu.frameworks.saveTemplate({ id: template?.id, name, sections: sections.map((item) => item.trim()).filter(Boolean), isDefault }); await onSaved(); showToast({ type: 'success', message: '框架模板已保存' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setSaving(false) } }
  function move(index: number, direction: -1 | 1): void { const target = index + direction; if (target < 0 || target >= sections.length) return; setSections((current) => { const next = [...current]; const [item] = next.splice(index, 1); next.splice(target, 0, item); return next }) }
  return <ModalBase open onClose={onClose} titleId="framework-template-title" bare className="framework-template-dialog"><header><div><span className="eyebrow">FRAMEWORK TEMPLATE</span><h2 id="framework-template-title">{template ? '编辑框架模板' : '新建框架模板'}</h2><p>章节顺序会成为模型输出与编辑卡片的固定结构。</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header><label className="field"><span>模板名称</span><input name="templateName" autoComplete="off" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如：故事型深度文章…" /></label><div className="framework-template-sections">{sections.map((section, index) => <div key={`${index}:${section}`}><strong>{index + 1}</strong><input name="sectionName" autoComplete="off" value={section} maxLength={50} onChange={(event) => setSections((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={14} /></button><button className="icon-button" disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ChevronDown size={14} /></button><button className="icon-button danger" disabled={sections.length === 1} onClick={() => setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}</div><button className="button ghost compact" disabled={sections.length >= 20} onClick={() => setSections((current) => [...current, ''])}><Plus size={15} />添加章节</button><footer><label><input type="checkbox" name="isDefault" autoComplete="off" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />设为默认模板</label><span /><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !name.trim() || !sections.some((section) => section.trim())} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存模板</button></footer></ModalBase>
}

function FrameworkEditor({ framework, onClose, onSaved, showToast }: { framework: Framework; onClose(): void; onSaved(): Promise<void>; showToast(toast: ToastState): void }): React.JSX.Element {
  const [sections, setSections] = useState<FrameworkSection[]>(framework.sections)
  const [saving, setSaving] = useState(false)
  async function save(): Promise<void> { setSaving(true); try { await window.moliu.frameworks.save({ id: framework.id, topicId: framework.topicId, accountId: framework.accountId, materialIds: framework.materialIds, templateId: framework.templateId, manualTopic: framework.manualTopic, status: framework.status, sections, providerId: framework.providerId, model: framework.model }); await onSaved(); showToast({ type: 'success', message: '已保存为框架新版本' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setSaving(false) } }
  return <ModalBase open onClose={onClose} titleId="framework-editor-title" bare className="framework-editor-dialog"><header><div><span className="eyebrow">EDIT OUTLINE · V{framework.versionCount + 1}</span><h2 id="framework-editor-title">打磨内容框架</h2><p>保存会保留当前版本，并创建新的本地版本记录。</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header><div className="framework-editor-sections">{sections.map((section, index) => <label className="field" key={section.name}><span>{section.name}</span><textarea name="sectionContent" autoComplete="off" rows={4} value={section.content} onChange={(event) => setSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item))} /></label>)}</div><footer><span>{framework.materialIds.length} 条素材引用 · {framework.status === 'locked' ? '锁定状态下编辑会创建新版本' : '草稿可继续编辑'}</span><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || sections.some((section) => !section.content.trim())} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存新版本</button></footer></ModalBase>
}

function encodeModelTarget(providerId: string, model: string): string { return JSON.stringify([providerId, model]) }
function decodeModelTarget(value: string): { providerId: string; model: string } | null { try { const [providerId, model] = JSON.parse(value) as unknown[]; return typeof providerId === 'string' && typeof model === 'string' ? { providerId, model } : null } catch { return null } }
