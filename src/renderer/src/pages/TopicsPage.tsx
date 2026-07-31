import { useEffect, useMemo, useState } from 'react'
import {
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronUp,
  FilePenLine,
  FolderHeart,
  LibraryBig,
  Link2,
  LoaderCircle,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type {
  AccountProfileSummary,
  HotFavorite,
  ProviderSummary,
  Topic,
  TopicSchemaField
} from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { ModalBase } from '../components/ModalBase'
import { Select } from '../components/Select'
import { VirtualList } from '../components/VirtualList'
import { errorMessage, formatDate } from '../lib'

type TopicView = 'drafts' | 'library'

interface TopicsPageProps {
  accounts: AccountProfileSummary[]
  providers: ProviderSummary[]
  currentAccountId?: string
  onNavigate(route: RouteId): void
  showToast(toast: ToastState): void
}

export function TopicsPage({
  accounts,
  providers,
  currentAccountId,
  onNavigate,
  showToast
}: TopicsPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [topics, setTopics] = useState<Topic[]>([])
  const [schema, setSchema] = useState<TopicSchemaField[]>([])
  const [favorites, setFavorites] = useState<HotFavorite[]>([])
  const [view, setView] = useState<TopicView>('drafts')
  const [accountId, setAccountId] = useState(currentAccountId ?? '')
  const [modelTarget, setModelTarget] = useState('')
  const [seedKeyword, setSeedKeyword] = useState('')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('moliu:topic-favorite-ids')
      localStorage.removeItem('moliu:topic-favorite-ids')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch {
      return new Set()
    }
  })
  const [count, setCount] = useState(3)
  const [generating, setGenerating] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [editing, setEditing] = useState<Topic>()

  const lockedAccounts = accounts.filter((account) => account.status === 'locked')
  const availableModels = providers.filter((provider) => provider.enabled && provider.hasApiKey)
    .flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({ provider, model })))

  useEffect(() => {
    if (!accountId || !lockedAccounts.some((account) => account.id === accountId)) {
      setAccountId(lockedAccounts.find((account) => account.id === currentAccountId)?.id ?? lockedAccounts[0]?.id ?? '')
    }
  }, [accountId, currentAccountId, lockedAccounts])

  useEffect(() => {
    const defaultModel = availableModels.find(({ model }) => model.isDefault) ?? availableModels[0]
    if (!defaultModel) return setModelTarget('')
    const parsed = decodeModelTarget(modelTarget)
    const exists = parsed && availableModels.some(({ provider, model }) =>
      provider.id === parsed.providerId && model.modelId === parsed.model
    )
    if (!exists) setModelTarget(encodeModelTarget(defaultModel.provider.id, defaultModel.model.modelId))
  }, [availableModels, modelTarget])

  async function refresh(): Promise<void> {
    const [nextTopics, nextSchema, nextFavorites] = await Promise.all([
      window.moliu.topics.list(),
      window.moliu.topics.getSchema(),
      window.moliu.hotspots.listFavorites()
    ])
    setTopics(nextTopics)
    setSchema(nextSchema)
    setFavorites(nextFavorites)
    setFavoriteIds((current) => new Set([...current].filter((id) => nextFavorites.some((favorite) => favorite.id === id))))
  }

  useEffect(() => {
    void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) }))
  }, [])

  const selectedFavorites = favorites.filter((favorite) => favoriteIds.has(favorite.id))
  const displayedTopics = topics.filter((topic) => view === 'library' ? topic.isInLibrary : !topic.isInLibrary)

  async function generate(): Promise<void> {
    const target = decodeModelTarget(modelTarget)
    if (!accountId) return showToast({ type: 'error', message: '请先锁定一个账号定位' })
    if (!target) return showToast({ type: 'error', message: '请选择可用模型' })
    if (!seedKeyword.trim()) return showToast({ type: 'error', message: '请填写热点关键词或主题' })
    setGenerating(true)
    try {
      const result = await window.moliu.topics.generate({
        accountId,
        providerId: target.providerId,
        model: target.model,
        seedKeyword: seedKeyword.trim(),
        relatedHotFavoriteIds: [...favoriteIds],
        count
      })
      await refresh()
      setView('drafts')
      if (result.failed.length) {
        showToast({ type: 'error', message: `已生成 ${result.topics.length}\u00A0条；${result.failed.length}\u00A0条失败，可再次生成补齐` })
      } else {
        showToast({ type: 'success', message: `已生成 ${result.topics.length}\u00A0条选题草稿` })
      }
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setGenerating(false)
    }
  }

  async function saveSchema(next: TopicSchemaField[]): Promise<void> {
    try {
      const saved = await window.moliu.topics.saveSchema(next)
      setSchema(saved)
      setSchemaOpen(false)
      showToast({ type: 'success', message: '新字段已成为后续生成的全局默认' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function toggleLibrary(topic: Topic): Promise<void> {
    try {
      await window.moliu.topics.setInLibrary(topic.id, !topic.isInLibrary)
      await refresh()
      showToast({ type: 'success', message: topic.isInLibrary ? '已从选题库移除' : '已加入选题库' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function toggleLocked(topic: Topic): Promise<void> {
    try {
      await window.moliu.topics.setLocked(topic.id, topic.status !== 'locked')
      await refresh()
      showToast({ type: 'success', message: topic.status === 'locked' ? '已解锁为草稿' : '已锁定为创作基线' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function remove(topic: Topic): Promise<void> {
    if (!(await confirm({ title: '确认操作', message: `确定删除「${topic.fields['选题主题'] || '未命名选题'}」吗？`, danger: true, confirmLabel: '确认' }))) return
    try {
      await window.moliu.topics.remove(topic.id)
      await refresh()
      showToast({ type: 'success', message: '选题已删除' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  return (
    <div className="page topics-page">
      <section className="page-intro topics-intro">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> TOPIC LAB</span>
          <h2>生成选题</h2>
        </div>
        <button className="button secondary" onClick={() => setSchemaOpen(true)}>
          <FilePenLine size={16} />配置选题字段
        </button>
      </section>

      <section className="topic-composer">
        <div className="topic-composer-head">
          <div>
            <span className="eyebrow">GENERATE DRAFTS</span>
            <h3>开始一个选题批次</h3>
          </div>
          <span className="topic-schema-note">当前模板 · {schema.length} 个字段</span>
        </div>
        {!lockedAccounts.length ? (
          <div className="topic-blocked">
            <Lock size={18} />
            <span>还没有已锁定的账号定位，无法发起有基线的选题生成。</span>
            <button className="button primary compact" onClick={() => onNavigate('accounts')}>去锁定账号</button>
          </div>
        ) : (
          <>
            <div className="topic-generation-layout">
              <div className="topic-generation-main">
                <label className="field">
                  <span>账号定位</span>
                  <Select value={accountId} onChange={setAccountId} placeholder="选择账号" options={lockedAccounts.map((account) => ({ value: account.id, label: account.name, hint: `v${account.versionCount}` }))} ariaLabel="账号定位" />
                </label>
                <label className="field topic-keyword-field">
                  <span>主题</span>
                  <textarea
                    name="seedKeyword"
                    autoComplete="off"
                    value={seedKeyword}
                    onChange={(event) => setSeedKeyword(event.target.value)}
                    placeholder="输入热点关键词或内容方向"
                    rows={4}
                  />
                </label>
                <div className="topic-favorites-picker">
                  <div className="topic-favorites-heading">
                    <div><FolderHeart size={17} /><strong>关联热点</strong></div>
                    <button className="button ghost compact" onClick={() => onNavigate('hotspots')}>管理</button>
                  </div>
                  {favorites.length ? (
                    <div className="topic-favorite-options">
                      {favorites.map((favorite) => (
                        <label key={favorite.id} className={favoriteIds.has(favorite.id) ? 'selected' : ''}>
                          <input
                            type="checkbox"
                            name="favoriteId"
                            autoComplete="off"
                            checked={favoriteIds.has(favorite.id)}
                            onChange={(event) => setFavoriteIds((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(favorite.id)
                              else next.delete(favorite.id)
                              return next
                            })}
                          />
                          <span className="favorite-source-mark">{favorite.hotItem.sourceTitle.slice(0, 1)}</span>
                          <span>{favorite.hotItem.title}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="topic-no-favorites">暂无收藏</p>
                  )}
                </div>
              </div>
              <aside className="topic-generation-settings">
                <label className="field">
                  <span>模型</span>
                  <Select value={modelTarget} onChange={setModelTarget} placeholder="选择模型" options={availableModels.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))} ariaLabel="模型" />
                </label>
                <label className="field topic-count-field">
                  <span>数量</span>
                  <Select value={String(count)} onChange={(value) => setCount(Number(value))} placeholder="数量" options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} 条` }))} ariaLabel="数量" />
                </label>
                <div className="topic-template-summary">
                  <span>输出模板</span>
                  <strong>{schema.length} 个字段</strong>
                  <button className="button ghost compact" onClick={() => setSchemaOpen(true)}>编辑模板</button>
                </div>
              </aside>
            </div>
            <footer className="topic-compose-footer">
              <span><Link2 size={14} />{selectedFavorites.length} 条热点</span>
              <button className="button primary" disabled={generating || !availableModels.length} onClick={() => void generate()}>
                {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                {generating ? `正在独立生成 ${count}\u00A0条…` : `生成 ${count}\u00A0条选题`}
              </button>
            </footer>
          </>
        )}
      </section>

      <section className="topic-wall">
        <header className="topic-wall-head">
          <div className="topic-tabs">
            <button className={view === 'drafts' ? 'active' : ''} onClick={() => setView('drafts')}>
              <FilePenLine size={15} />选题草稿 <small>{topics.filter((topic) => !topic.isInLibrary).length}</small>
            </button>
            <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
              <LibraryBig size={15} />我的选题库 <small>{topics.filter((topic) => topic.isInLibrary).length}</small>
            </button>
          </div>
        </header>
        {displayedTopics.length ? (
          <div className="topic-card-list">
            <VirtualList
              items={displayedTopics}
              estimateSize={() => 110}
              renderItem={(topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  schema={schema}
                  onEdit={setEditing}
                  onToggleLibrary={() => void toggleLibrary(topic)}
                  onToggleLocked={() => void toggleLocked(topic)}
                  onRemove={() => void remove(topic)}
                  onOpenMaterials={() => {
                    localStorage.setItem('moliu:material-related-topic-id', topic.id)
                    onNavigate('materials')
                  }}
                />
              )}
            />
          </div>
        ) : (
          <div className="large-empty topic-empty">
            {view === 'drafts' ? <Sparkles size={34} /> : <LibraryBig size={34} />}
            <h3>{view === 'drafts' ? '还没有选题草稿' : '选题库还是空的'}</h3>
          </div>
        )}
      </section>

      {schemaOpen && (
        <SchemaDialog schema={schema} onClose={() => setSchemaOpen(false)} onSave={saveSchema} showToast={showToast} />
      )}
      {editing && (
        <TopicEditor
          topic={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined)
            await refresh()
          }}
          showToast={showToast}
        />
      )}
      {ConfirmPortal}
    </div>
  )
}

function TopicCard({
  topic,
  schema,
  onEdit,
  onToggleLibrary,
  onToggleLocked,
  onRemove,
  onOpenMaterials
}: {
  topic: Topic
  schema: TopicSchemaField[]
  onEdit(topic: Topic): void
  onToggleLibrary(): void
  onToggleLocked(): void
  onRemove(): void
  onOpenMaterials(): void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const orderedFields = useMemo(() => {
    const known = schema.map((field) => field.name).filter((name) => name in topic.fields)
    return [...known, ...Object.keys(topic.fields).filter((name) => !known.includes(name))]
  }, [schema, topic.fields])
  const visibleFields = expanded ? orderedFields : orderedFields.slice(0, 4)
  const draftReference = topic.references.find((reference) => reference.sourceStatusSnapshot === 'draft')
  return (
    <article className="topic-card">
      <header>
        <div className="topic-card-badges">
          <span className={`badge ${topic.status === 'locked' ? 'success' : 'neutral'}`}>
            {topic.status === 'locked' ? <Lock size={11} /> : <LockOpen size={11} />}
            {topic.status === 'locked' ? '已锁定' : '草稿'}
          </span>
          {topic.isInLibrary && <span className="badge primary"><BookmarkCheck size={11} />已入库</span>}
          {draftReference && <span className="badge warning">引用草稿账号</span>}
        </div>
        <div className="topic-card-actions">
          <button className="icon-button" title="编辑" aria-label="编辑" onClick={() => onEdit(topic)}><Pencil size={15} /></button>
          <button className="icon-button" title={topic.isInLibrary ? '移出选题库' : '加入选题库'} aria-label={topic.isInLibrary ? '移出选题库' : '加入选题库'} onClick={onToggleLibrary}>
            {topic.isInLibrary ? <BookmarkCheck size={15} /> : <LibraryBig size={15} />}
          </button>
          <button className="icon-button" title={topic.status === 'locked' ? '解锁编辑' : '锁定选题'} aria-label={topic.status === 'locked' ? '解锁编辑' : '锁定选题'} onClick={onToggleLocked}>
            {topic.status === 'locked' ? <LockOpen size={15} /> : <Lock size={15} />}
          </button>
          <button className="icon-button" title="搜集素材" aria-label="搜集素材" onClick={onOpenMaterials}><FolderHeart size={15} /></button>
          <button className="icon-button danger" title="删除" aria-label="删除" onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </header>
      <div className="topic-card-title">
        <span>TOPIC · V{topic.versionCount}</span>
        <h3>{topic.fields['选题主题'] || Object.values(topic.fields)[0] || '未命名选题'}</h3>
      </div>
      <dl className="topic-fields">
        {visibleFields.map((name) => (
          <div key={name} className={name === '选题主题' ? 'topic-primary-field' : ''}>
            <dt>{name}</dt><dd>{topic.fields[name] || '—'}</dd>
          </div>
        ))}
      </dl>
      {orderedFields.length > 4 && (
        <button className="topic-expand" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? '收起字段' : `展开其余 ${orderedFields.length - 4}\u00A0个字段`}
        </button>
      )}
      <footer>
        <span>{topic.providerId ? `${topic.model || 'AI'} 生成` : '手动创建'}</span>
        <span>关键词：{topic.seedKeyword}</span>
        <span><Link2 size={12} />{topic.relatedHotIds.length} 条热点引用</span>
        <span>{formatDate(topic.updatedAt)}</span>
      </footer>
    </article>
  )
}

function SchemaDialog({
  schema,
  onClose,
  onSave,
  showToast
}: {
  schema: TopicSchemaField[]
  onClose(): void
  onSave(fields: TopicSchemaField[]): Promise<void>
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [fields, setFields] = useState<TopicSchemaField[]>(schema)
  function update(index: number, patch: Partial<TopicSchemaField>): void {
    setFields((current) => current.map((field, currentIndex) => currentIndex === index ? { ...field, ...patch } : field))
  }
  function move(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    setFields((current) => {
      const next = [...current]
      const [field] = next.splice(index, 1)
      next.splice(target, 0, field)
      return next.map((item, order) => ({ ...item, sortOrder: order }))
    })
  }
  async function reset(): Promise<void> {
    if (!(await confirm({ title: '确认操作', message: '恢复默认的 7\u00A0个选题字段？当前自定义字段不会保留。', danger: true, confirmLabel: '确认' }))) return
    try {
      const restored = await window.moliu.topics.resetSchema()
      setFields(restored)
      showToast({ type: 'success', message: '已恢复默认字段，请保存后生效' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }
  return (
    <ModalBase open onClose={onClose} titleId="topic-schema-title" bare className="topic-schema-dialog">
        <header><div><span className="eyebrow">GLOBAL TOPIC SCHEMA</span><h2 id="topic-schema-title">配置选题字段</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="topic-schema-list">
          {fields.map((field, index) => (
            <div key={field.id} className="topic-schema-row">
              <strong>{index + 1}</strong>
              <input name="schemaFieldName" autoComplete="off" value={field.name} maxLength={50} onChange={(event) => update(index, { name: event.target.value })} />
              <label><input type="checkbox" name="fieldRequired" autoComplete="off" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />必填</label>
              <button className="icon-button" aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={15} /></button>
              <button className="icon-button" aria-label="下移" disabled={index === fields.length - 1} onClick={() => move(index, 1)}><ChevronDown size={15} /></button>
              <button className="icon-button danger" aria-label="删除字段" disabled={fields.length === 1} onClick={() => setFields((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button className="button ghost compact" disabled={fields.length >= 20} onClick={() => setFields((current) => [...current, { id: crypto.randomUUID(), name: '', required: false, sortOrder: current.length }])}><Plus size={15} />添加字段</button>
        <footer><button className="button ghost" onClick={() => void reset()}><RotateCcw size={15} />恢复默认</button><span /><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={() => void onSave(fields)}>保存字段</button></footer>
      {ConfirmPortal}
    </ModalBase>
  )
}

function TopicEditor({
  topic,
  onClose,
  onSaved,
  showToast
}: {
  topic: Topic
  onClose(): void
  onSaved(): Promise<void>
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const [fields, setFields] = useState(topic.fields)
  const [saving, setSaving] = useState(false)
  async function save(): Promise<void> {
    setSaving(true)
    try {
      await window.moliu.topics.save({
        id: topic.id,
        seedKeyword: topic.seedKeyword,
        accountIds: topic.accountIds,
        relatedHotIds: topic.relatedHotIds,
        status: topic.status,
        source: 'manual',
        fields,
        providerId: topic.providerId,
        model: topic.model
      })
      await onSaved()
      showToast({ type: 'success', message: '选题已保存为新版本' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }
  return (
    <ModalBase open onClose={onClose} titleId="topic-editor-title" bare className="topic-editor-dialog">
        <header><div><span className="eyebrow">EDIT TOPIC · V{topic.versionCount + 1}</span><h2 id="topic-editor-title">打磨选题草稿</h2><p>保存会创建新版本，旧版本仍保留在本地历史中。</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="topic-editor-fields">
          {Object.entries(fields).map(([name, value]) => (
            <label className="field" key={name}><span>{name}</span><textarea name="topicField" autoComplete="off" rows={name === '选题主题' ? 2 : 3} value={value} onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))} /></label>
          ))}
        </div>
        <footer><span>关联 {topic.relatedHotIds.length} 条热点快照</span><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存新版本</button></footer>
    </ModalBase>
  )
}

function encodeModelTarget(providerId: string, model: string): string {
  return JSON.stringify([providerId, model])
}

function decodeModelTarget(value: string): { providerId: string; model: string } | null {
  try {
    const [providerId, model] = JSON.parse(value) as unknown[]
    return typeof providerId === 'string' && typeof model === 'string' ? { providerId, model } : null
  } catch {
    return null
  }
}
