import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, ChevronUp, FilePenLine, FolderHeart, Layers3, LoaderCircle,
  Lock, LockOpen, Pencil, PenLine, Plus, Save, Sparkles, Trash2, WandSparkles, X
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
import { StreamingPreview } from '../components/StreamingPreview'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { MaterialPicker } from '../components/MaterialPicker'
import { useGenerationStream, isCancelError } from '../hooks/useGenerationStream'
import { useDraftSelection, useDraftState } from '../hooks/useDraftState'
import { resolveAccountSelection } from '../../../shared/creation-state'
import { availableModels, decodeModelTarget, encodeModelTarget, useModelTarget } from '../lib/models'
import { errorMessage, formatDate } from '../lib'

interface FrameworksPageProps {
  accounts: AccountProfileSummary[]
  providers: ProviderSummary[]
  currentAccountId?: string
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusTopicId?: string
  showToast(toast: ToastState): void
}

export function FrameworksPage({
  accounts, providers, currentAccountId, onNavigate, focusTopicId, showToast
}: FrameworksPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const stream = useGenerationStream('frameworks')
  const [templates, setTemplates] = useState<FrameworkTemplate[]>([])
  const [frameworks, setFrameworks] = useState<Framework[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [templateId, setTemplateId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [accountId, setAccountId] = useState(currentAccountId ?? '')
  // 与文章页同理：去素材库补完素材回来，勾选仍要在（refresh 里会洗掉已删除的 id）
  const [materialIds, setMaterialIds] = useDraftSelection('framework-materials')
  const [manualTopic, setManualTopic] = useDraftState('framework-topic')
  const [count, setCount] = useState(3)
  const [lastFailed, setLastFailed] = useState<Array<{ index: number; message: string }>>([])
  const [templateEditor, setTemplateEditor] = useState<FrameworkTemplate | 'new'>()
  const [editing, setEditing] = useState<Framework>()
  const [accountFilter, setAccountFilter] = useState<'all' | 'current'>('all')

  const models = useMemo(() => availableModels(providers), [providers])
  const accountInitialized = useRef(false)
  const [modelTarget, setModelTarget] = useModelTarget(models)
  const usableMaterials = useMemo(() => materials.filter((material) => material.kind !== 'image'), [materials])
  const selectedTemplate = templates.find((template) => template.id === templateId)

  async function refresh(): Promise<void> {
    const [nextTemplates, nextFrameworks, nextTopics, nextMaterials] = await Promise.all([
      window.moliu.frameworks.listTemplates(), window.moliu.frameworks.list(),
      window.moliu.topics.list(), window.moliu.materials.list()
    ])
    setTemplates(nextTemplates); setFrameworks(nextFrameworks); setTopics(nextTopics); setMaterials(nextMaterials)
    if (focusTopicId && nextTopics.some((t) => t.id === focusTopicId)) setTopicId(focusTopicId)
    setTemplateId((current) => nextTemplates.some((item) => item.id === current)
      ? current : nextTemplates.find((item) => item.isDefault)?.id ?? nextTemplates[0]?.id ?? '')
    setMaterialIds((current) => new Set([...current].filter((id) => nextMaterials.some((item) => item.id === id && item.kind !== 'image'))))
  }

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => {
    // 只在首次拿到账号列表时补默认值；用户主动选「不使用账号定位」后必须保持为空
    const next = resolveAccountSelection({ current: accountId, accounts, currentAccountId, initialized: accountInitialized.current })
    accountInitialized.current = next.initialized
    if (next.accountId !== accountId) setAccountId(next.accountId)
  }, [accounts, accountId, currentAccountId])

  async function generate(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!templateId) return showToast({ type: 'error', message: '请选择框架模板' })
    if (!topicId && !manualTopic.trim()) return showToast({ type: 'error', message: '请选择选题，或填写框架主题' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    try {
      const result = await stream.run(() => window.moliu.frameworks.generate({
        templateId, topicId: topicId || undefined, accountId: accountId || undefined,
        materialIds: [...materialIds], manualTopic: manualTopic.trim() || undefined,
        providerId: target.providerId, model: target.modelId, count
      }))
      await refresh()
      setLastFailed(result.failed)
      if (result.failed.length) showToast({ type: 'warning', message: `已生成 ${result.frameworks.length}\u00A0个框架；${result.failed.length}\u00A0个失败` })
      else showToast({ type: 'success', message: `已生成 ${result.frameworks.length}\u00A0个可编辑框架` })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消本次生成' } : { type: 'error', message: errorMessage(error) })
    }
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
    <PageHeader
      route="frameworks"
      onNavigate={onNavigate}
      title="内容框架"
      description="把选题拆成结构化章节，锁定后作为写作基线"
      actions={<button className="button secondary" onClick={() => setTemplateEditor(selectedTemplate ?? 'new')}><Layers3 size={15} />编辑框架模板</button>}
    />

    <div className="framework-studio-layout">
    <section className="framework-composer">
      <header><div><h3>生成设置</h3></div><span>{selectedTemplate ? `${selectedTemplate.sections.length}\u00A0个章节` : '选择模板'}</span></header>
      <div className="framework-compose-grid">
        <label className="field"><span>框架模板</span><Select value={templateId} onChange={setTemplateId} placeholder="选择模板" options={templates.map((template) => ({ value: template.id, label: template.name, hint: template.isDefault ? '默认' : undefined }))} ariaLabel="框架模板" /></label>
        <label className="field"><span>账号定位（可选）</span><Select value={accountId} onChange={setAccountId} placeholder="不使用账号定位" options={[{ value: '', label: '不使用账号定位' }, ...accounts.map((account) => ({ value: account.id, label: account.name, hint: account.status === 'draft' ? '草稿' : undefined }))]} ariaLabel="账号定位" /></label>
        <label className="field"><span>选题（可选）</span><Select value={topicId} onChange={setTopicId} placeholder="不关联选题" options={[{ value: '', label: '不关联选题' }, ...topics.map((topic) => ({ value: topic.id, label: topic.fields['选题主题'] || topic.seedKeyword }))]} ariaLabel="选题" /></label>
        <label className="field"><span>连接与模型</span><Select value={modelTarget} onChange={setModelTarget} placeholder="选择模型" options={[{ value: '', label: '选择模型' }, ...models.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))]} ariaLabel="连接与模型" /></label>
      </div>
      <label className="field framework-topic-field"><span>补充主题（未选选题时必填）</span><textarea name="manualTopic" autoComplete="off" rows={2} maxLength={2000} value={manualTopic} onChange={(event) => setManualTopic(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void generate() } }} placeholder="例如：为什么创作者应该先写框架，再写正文？（Ctrl+Enter 直接生成）" /></label>
      <MaterialPicker
        materials={usableMaterials}
        selected={materialIds}
        onToggle={(id, checked) => setMaterialIds((current) => {
          const next = new Set(current)
          checked ? next.add(id) : next.delete(id)
          return next
        })}
        onNavigate={onNavigate}
      />
      <footer>
        <label className="field framework-count"><span>数量</span><Select value={String(count)} onChange={(value) => setCount(Number(value))} placeholder="数量" options={[1, 2, 3].map((value) => ({ value: String(value), label: `${value} 个` }))} ariaLabel="生成数量" /></label>
        <button className="button ghost compact" onClick={() => setTemplateEditor('new')}><Plus size={14} />新建模板</button>
        <button
          className="button primary"
          disabled={stream.active || !models.length}
          onClick={() => void generate()}
          title={!models.length ? '请先在「AI 服务」配置文本模型' : undefined}
        >
          {stream.active ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
          {stream.active ? '正在生成…' : '生成框架'}
        </button>
        {/* 禁用原因就近说明，并给出去哪里配置 */}
        {!stream.active && !models.length && (
          <p className="form-hint" role="note">
            还没有可用的文本模型，请先到 <button className="text-button" onClick={() => onNavigate('providers')}>AI 服务</button> 配置。
          </p>
        )}
        {/* 其余前置条件（模板 / 主题）按钮本身可点，点击后由 toast 提示；
            这里提前说明，避免用户反复试错 */}
        {!stream.active && models.length > 0 && !templateId && (
          <p className="form-hint" role="note">请先在上方选择一个框架模板</p>
        )}
        {!stream.active && models.length > 0 && templateId && !topicId && !manualTopic.trim() && (
          <p className="form-hint" role="note">请先选择选题，或在上方填写框架主题</p>
        )}
      </footer>
    </section>

    <section className="framework-wall">
      {stream.active && <StreamingPreview content={stream.content} label="正在生成框架…" />}
      {lastFailed.length > 0 && !stream.active && (
        <p className="inline-alert">上批有 {lastFailed.length} 个未成功：{lastFailed.map((item) => `第 ${item.index} 个 ${item.message.slice(0, 50)}`).join('；')}</p>
      )}
      <header><div><h3>框架预览 <small>{frameworks.length}</small></h3></div><div className="segmented account-filter" role="group" aria-label="账号筛选"><button className={accountFilter === 'all' ? 'active' : ''} onClick={() => setAccountFilter('all')}>全部账号</button><button className={accountFilter === 'current' ? 'active' : ''} disabled={!currentAccountId} title={currentAccountId ? '只看当前账号的框架' : '尚未创建当前账号'} onClick={() => setAccountFilter('current')}>当前账号</button></div></header>
      {(() => {
        const displayed = accountFilter === 'current' ? frameworks.filter((framework) => framework.accountId === currentAccountId) : frameworks
        if (!frameworks.length) {
          return (
            <div className="large-empty">
              <WandSparkles size={34} />
              <h3>还没有内容框架</h3>
              <p className="micro-copy">
                框架是文章的结构骨架。可以先选一个选题让AI 拆解，也可以不关联选题直接手写结构。
              </p>
              <div className="article-empty-actions">
                <button className="button secondary" onClick={() => onNavigate('topics')}><Sparkles size={15} />先去选题</button>
              </div>
            </div>
          )
        }
        if (!displayed.length) {
          return (
            <div className="large-empty">
              <WandSparkles size={30} />
              <h3>当前账号下还没有框架</h3>
              <p className="micro-copy">切换到「全部账号」查看已有的 {frameworks.length} 个框架。</p>
            </div>
          )
        }
        return (
          <>
            <div className="framework-card-grid"><VirtualList items={displayed} estimateSize={() => 120} renderItem={(framework) => <FrameworkCard key={framework.id} framework={framework} onNavigate={onNavigate} onEdit={() => setEditing(framework)} onToggleLock={() => void toggleLocked(framework)} onRemove={() => void remove(framework)} />} /></div>
            <NextStepBar
              text="框架准备好后，去文章创作按它扩写成稿。"
              actionLabel="去文章创作"
              icon={<PenLine size={14} />}
              onAction={() => onNavigate('articles')}
            />
          </>
        )
      })()}
    </section>
    </div>
    {templateEditor && <TemplateDialog template={templateEditor === 'new' ? undefined : templateEditor} templates={templates} onClose={() => setTemplateEditor(undefined)} onSaved={async () => { setTemplateEditor(undefined); await refresh() }} showToast={showToast} />}
    {editing && <FrameworkEditor framework={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await refresh() }} showToast={showToast} />}
    {ConfirmPortal}
  </div>
}

function FrameworkCard({ framework, onNavigate, onEdit, onToggleLock, onRemove }: { framework: Framework; onNavigate(route: RouteId, params?: Record<string, string>): void; onEdit(): void; onToggleLock(): void; onRemove(): void }): React.JSX.Element {
  const hasDraftReference = framework.references.some((reference) => reference.sourceStatusSnapshot === 'draft')
  return <article className="framework-card"><header><div className="framework-card-badges"><span className={`badge ${framework.status === 'locked' ? 'success' : 'neutral'}`}>{framework.status === 'locked' ? <Lock size={11} /> : <FilePenLine size={11} />}{framework.status === 'locked' ? '已锁定' : '草稿'}</span>{hasDraftReference && <span className="badge warning">引用草稿</span>}</div><div><button className="icon-button" title="编辑" aria-label="编辑" onClick={onEdit}><Pencil size={15} /></button><button className="icon-button" title={framework.status === 'locked' ? '解锁' : '锁定'} aria-label={framework.status === 'locked' ? '解锁' : '锁定'} onClick={onToggleLock}>{framework.status === 'locked' ? <LockOpen size={15} /> : <Lock size={15} />}</button><button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={15} /></button></div></header><div className="framework-card-title"><span>框架 · V{framework.versionCount}</span><h3>{framework.sections[0]?.content || framework.manualTopic || '未命名框架'}</h3></div><div className="framework-section-preview">{framework.sections.slice(1, 4).map((section) => <p key={section.name}><strong>{section.name}</strong>{section.content}</p>)}</div>{framework.status === 'locked' && <button className="button primary framework-next-step" onClick={() => onNavigate('articles', { frameworkId: framework.id })}><FilePenLine size={15} />写文章→</button>}<footer><span>{framework.model || '手动'} </span><span>{framework.materialIds.length} 条素材</span><span>{formatDate(framework.updatedAt)}</span></footer></article>
}

function TemplateDialog({ template, templates, onClose, onSaved, showToast }: { template?: FrameworkTemplate; templates: FrameworkTemplate[]; onClose(): void; onSaved(): Promise<void>; showToast(toast: ToastState): void }): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '')
  const [sections, setSections] = useState(template?.sections ?? ['标题', '开头', '论点一', '论点二', '论点三', '结尾'])
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? !templates.length)
  const [saving, setSaving] = useState(false)
  async function save(): Promise<void> { setSaving(true); try { await window.moliu.frameworks.saveTemplate({ id: template?.id, name, sections: sections.map((item) => item.trim()).filter(Boolean), isDefault }); await onSaved(); showToast({ type: 'success', message: '框架模板已保存' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setSaving(false) } }
  function move(index: number, direction: -1 | 1): void { const target = index + direction; if (target < 0 || target >= sections.length) return; setSections((current) => { const next = [...current]; const [item] = next.splice(index, 1); next.splice(target, 0, item); return next }) }
  return <ModalBase open onClose={onClose} titleId="framework-template-title" bare className="framework-template-dialog"><header><div><h2 id="framework-template-title">{template ? '编辑框架模板' : '新建框架模板'}</h2><p>章节顺序会成为模型输出与编辑卡片的固定结构。</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header><label className="field"><span>模板名称</span><input name="templateName" autoComplete="off" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如：故事型深度文章…" /></label><div className="framework-template-sections">{sections.map((section, index) => <div key={`${index}:${section}`}><strong>{index + 1}</strong><input name="sectionName" autoComplete="off" value={section} maxLength={50} onChange={(event) => setSections((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={14} /></button><button className="icon-button" disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ChevronDown size={14} /></button><button className="icon-button danger" disabled={sections.length === 1} onClick={() => setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}</div><button className="button ghost compact" disabled={sections.length >= 20} onClick={() => setSections((current) => [...current, ''])}><Plus size={15} />添加章节</button><footer><label><input type="checkbox" name="isDefault" autoComplete="off" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />设为默认模板</label><span /><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !name.trim() || !sections.some((section) => section.trim())} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存模板</button></footer></ModalBase>
}

function FrameworkEditor({ framework, onClose, onSaved, showToast }: { framework: Framework; onClose(): void; onSaved(): Promise<void>; showToast(toast: ToastState): void }): React.JSX.Element {
  const [sections, setSections] = useState<FrameworkSection[]>(framework.sections)
  const [saving, setSaving] = useState(false)
  async function save(): Promise<void> { setSaving(true); try { await window.moliu.frameworks.save({ id: framework.id, topicId: framework.topicId, accountId: framework.accountId, materialIds: framework.materialIds, templateId: framework.templateId, manualTopic: framework.manualTopic, status: framework.status, sections, providerId: framework.providerId, model: framework.model }); await onSaved(); showToast({ type: 'success', message: '已保存为框架新版本' }) } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) } finally { setSaving(false) } }
  return <ModalBase open onClose={onClose} titleId="framework-editor-title" bare className="framework-editor-dialog"><header><div><h2 id="framework-editor-title">打磨内容框架</h2><p>保存会保留当前版本，并创建新的本地版本记录。</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header><div className="framework-editor-sections">{sections.map((section, index) => <label className="field" key={section.name}><span>{section.name}</span><textarea name="sectionContent" autoComplete="off" rows={4} value={section.content} onChange={(event) => setSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item))} /></label>)}</div><footer><span>{framework.materialIds.length} 条素材引用 · {framework.status === 'locked' ? '锁定状态下编辑会创建新版本' : '草稿可继续编辑'}</span><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || sections.some((section) => !section.content.trim())} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存新版本</button></footer></ModalBase>
}

