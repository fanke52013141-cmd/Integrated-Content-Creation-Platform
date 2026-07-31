import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  FileClock,
  KeyRound,
  Lock,
  LockOpen,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react'
import {
  DEFAULT_ACCOUNT_FIELD_NAMES,
  WIZARD_QUESTIONS,
  type AccountField,
  type AccountProfile,
  type AccountProfileSummary,
  type GenerateAccountResult,
  type ProviderSummary,
  type WizardAnswer
} from '../../../shared/contracts'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { RouteId } from '../components/Layout'
import { Select } from '../components/Select'
import { VirtualList } from '../components/VirtualList'
import { useConfirm } from '../components/useConfirm'
import type { ToastState } from '../components/Toast'
import { errorMessage, formatDate, formatFullDate } from '../lib'

type AccountMode = 'list' | 'wizard' | 'editor'

interface AccountPageProps {
  accounts: AccountProfileSummary[]
  providers: ProviderSummary[]
  onRefresh(): Promise<void>
  onNavigate(route: RouteId): void
  showToast(toast: ToastState): void
}

export function AccountPage({
  accounts,
  providers,
  onRefresh,
  onNavigate,
  showToast
}: AccountPageProps): React.JSX.Element {
  const [mode, setMode] = useState<AccountMode>('list')
  const [selectedId, setSelectedId] = useState<string>()
  const [account, setAccount] = useState<AccountProfile | null>(null)
  const [loadingAccount, setLoadingAccount] = useState(false)

  async function openAccount(id: string): Promise<void> {
    setSelectedId(id)
    setLoadingAccount(true)
    setMode('editor')
    try {
      setAccount(await window.moliu.accounts.get(id))
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
      setMode('list')
    } finally {
      setLoadingAccount(false)
    }
  }

  async function refreshAndOpen(id: string): Promise<void> {
    await onRefresh()
    await openAccount(id)
  }

  if (mode === 'wizard') {
    return (
      <AccountWizard
        providers={providers}
        onCancel={() => setMode('list')}
        onNavigate={onNavigate}
        onSaved={(saved) => void refreshAndOpen(saved.id)}
        showToast={showToast}
      />
    )
  }

  if (mode === 'editor') {
    return (
      <AccountEditor
        account={account}
        loading={loadingAccount}
        onBack={() => {
          setMode('list')
          setSelectedId(undefined)
          setAccount(null)
        }}
        onChanged={(updated) => {
          setAccount(updated)
          void onRefresh()
        }}
        onDeleted={() => {
          setMode('list')
          setSelectedId(undefined)
          setAccount(null)
          void onRefresh()
        }}
        showToast={showToast}
      />
    )
  }

  return (
    <AccountList
      accounts={accounts}
      selectedId={selectedId}
      onCreate={() => setMode('wizard')}
      onOpen={(id) => void openAccount(id)}
    />
  )
}

function AccountList({
  accounts,
  selectedId,
  onCreate,
  onOpen
}: {
  accounts: AccountProfileSummary[]
  selectedId?: string
  onCreate(): void
  onOpen(id: string): void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const filtered = accounts.filter((account) =>
    account.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  const outputFields = ['账号名称', '内容领域', '目标读者', '核心价值', '内容角度', '表达语气', '内容形式', '差异化优势']

  return (
    <div className="page account-list-page">
      <section className="page-intro">
        <div>
          <span className="eyebrow"><CircleUserRound size={14} /> IDENTITY SYSTEM</span>
          <h2>账号定位</h2>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={16} />新建账号
        </button>
      </section>

      {accounts.length ? (
        <>
          <div className="list-toolbar">
            <label className="search-field">
              <Search size={16} />
              <input
                type="search"
                inputMode="search"
                name="searchKeyword"
                autoComplete="off"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索账号名称…"
              />
            </label>
            <span>{filtered.length} 个账号</span>
          </div>
          <section className="account-card-grid">
            <VirtualList
              items={filtered}
              estimateSize={() => 90}
              renderItem={(account) => (
                <button
                  key={account.id}
                  className={`account-card ${selectedId === account.id ? 'selected' : ''}`}
                  onClick={() => onOpen(account.id)}
                >
                  <div className="account-card-head">
                    <span className="profile-avatar">{account.name.slice(0, 1)}</span>
                    <div className="account-badges">
                      {account.isCurrent && <span className="badge primary">当前</span>}
                      <span className={`badge ${account.status === 'locked' ? 'success' : 'neutral'}`}>
                        {account.status === 'locked' ? <Lock size={11} /> : <LockOpen size={11} />}
                        {account.status === 'locked' ? '已锁定' : '草稿'}
                      </span>
                    </div>
                  </div>
                  <h3>{account.name}</h3>
                  <p>{account.intro || '暂未填写账号简介'}</p>
                  <div className="account-card-domain">{account.domain || '未设置领域'}</div>
                  <footer>
                    <span>v{account.versionCount}</span>
                    <span>{formatDate(account.updatedAt)}</span>
                    <ChevronRight size={16} />
                  </footer>
                </button>
              )}
            />
          </section>
          {!filtered.length && (
            <div className="center-empty"><Search size={25} /><strong>没有匹配的账号</strong></div>
          )}
        </>
      ) : (
        <section className="account-onboarding-grid">
          <article className="account-onboarding-card panel">
            <header><CircleUserRound size={20} /><h3>建立你的内容基线</h3></header>
            <div className="account-onboarding-steps">
              <div><b>1</b><span><ClipboardStep icon={<FileClock size={18} />} label="回答 7 个问题" time="约 3 分钟" /></span></div>
              <div><b>2</b><span><ClipboardStep icon={<Sparkles size={18} />} label="智能整理定位" time="约 1 分钟" /></span></div>
              <div><b>3</b><span><ClipboardStep icon={<Lock size={18} />} label="确认并锁定" time="约 1 分钟" /></span></div>
            </div>
            <span className="account-update-chip"><RotateCcw size={14} />可随时更新</span>
            <button className="button primary large" onClick={onCreate}>
              <WandSparkles size={17} />开始定位
            </button>
          </article>
          <div className="account-onboarding-side">
            <article className="account-output-card panel">
              <header><FileClock size={20} /><h3>最终会得到</h3></header>
              <div className="account-output-list">
                {outputFields.map((field) => <span key={field}><strong>{field}</strong><i /></span>)}
              </div>
            </article>
            <article className="account-local-card panel"><KeyRound size={19} /><strong>数据仅保存在本机</strong></article>
          </div>
          <article className="account-drafts-card panel">
            <header><h3>最近草稿</h3></header>
            <div><FileClock size={25} /><span>暂无草稿</span></div>
          </article>
        </section>
      )}
    </div>
  )
}

function ClipboardStep({ icon, label, time }: { icon: React.ReactNode; label: string; time: string }): React.JSX.Element {
  return <>{icon}<strong>{label}</strong><small>{time}</small></>
}

function AccountWizard({
  providers,
  onCancel,
  onNavigate,
  onSaved,
  showToast
}: {
  providers: ProviderSummary[]
  onCancel(): void
  onNavigate(route: RouteId): void
  onSaved(account: AccountProfile): void
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const usableProviders = providers.filter((item) => item.enabled && item.hasApiKey)
  const availableModels = usableProviders.flatMap((provider) =>
    provider.models
      .filter((model) => model.enabled)
      .map((model) => ({ provider, model }))
  )
  const initialModel = availableModels.find(({ model }) => model.isDefault) ?? availableModels[0]
  const [answers, setAnswers] = useState<WizardAnswer[]>(() => {
    const stored = localStorage.getItem('moliu:wizard-draft')
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as WizardAnswer[]
        if (parsed.length === 7) return parsed
      } catch {
        // Ignore invalid local draft.
      }
    }
    return WIZARD_QUESTIONS.map((item) => ({
      questionId: item.id,
      question: item.question,
      answer: ''
    }))
  })
  const [step, setStep] = useState(0)
  const [extraContext, setExtraContext] = useState('')
  const [modelTarget, setModelTarget] = useState(
    initialModel ? encodeModelTarget(initialModel.provider.id, initialModel.model.modelId) : ''
  )
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GenerateAccountResult>()
  const [fields, setFields] = useState<AccountField[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  useEffect(() => {
    localStorage.setItem('moliu:wizard-draft', JSON.stringify(answers))
  }, [answers])

  const currentQuestion = WIZARD_QUESTIONS[step]
  const answeredCount = answers.filter((item) => item.answer.trim()).length

  function updateAnswer(value: string): void {
    setAnswers((current) =>
      current.map((item, index) => index === step ? { ...item, answer: value } : item)
    )
  }

  async function generate(): Promise<void> {
    const selectedTarget = decodeModelTarget(modelTarget)
    if (!selectedTarget) {
      showToast({ type: 'error', message: '请先配置一个可用模型供应商' })
      return
    }
    setGenerating(true)
    try {
      const result = await window.moliu.accounts.generate({
        providerId: selectedTarget.providerId,
        model: selectedTarget.modelId,
        answers,
        extraContext
      })
      setGenerated(result)
      setFields(result.fields)
      showToast({ type: 'success', message: `账号定位已生成 · ${result.latencyMs}ms` })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setGenerating(false)
      setConfirmRegenerate(false)
    }
  }

  async function save(status: 'draft' | 'locked'): Promise<void> {
    setSaving(true)
    try {
      const saved = await window.moliu.accounts.save({
        fields,
        wizardAnswers: answers,
        status,
        source: generated ? 'ai' : 'manual',
        providerId: generated?.providerId,
        model: generated?.model
      })
      localStorage.removeItem('moliu:wizard-draft')
      showToast({ type: 'success', message: status === 'locked' ? '账号已保存并锁定' : '草稿已保存' })
      onSaved(saved)
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  function startManual(): void {
    setFields(DEFAULT_ACCOUNT_FIELD_NAMES.map((name) => ({
      id: crypto.randomUUID(),
      name,
      value: name === '账号名称' ? answers[0]?.answer ?? '' : '',
      isDefault: true
    })))
  }

  return (
    <div className="page wizard-page">
      <div className="wizard-topline">
        <button className="back-button" onClick={onCancel}><X size={17} />退出向导</button>
        <span>已回答 {answeredCount} / 7</span>
      </div>

      <section className="wizard-shell">
        <aside className="wizard-steps">
          <span className="eyebrow">ACCOUNT FOUNDATION</span>
          <h2>建立账号基线</h2>
          <ol>
            {WIZARD_QUESTIONS.map((question, index) => (
              <li
                key={question.id}
                className={`${step === index ? 'active' : ''} ${answers[index].answer.trim() ? 'done' : ''}`}
              >
                <span>{answers[index].answer.trim() ? <Check size={14} /> : index + 1}</span>
                <button onClick={() => setStep(index)}>{question.question}</button>
              </li>
            ))}
            <li className={step === 7 ? 'active' : ''}>
              <span><Sparkles size={14} /></span><button onClick={() => setStep(7)}>生成结果</button>
            </li>
          </ol>
        </aside>

        <div className="wizard-workspace">
          {step < 7 && currentQuestion ? (
            <div className="question-card">
              <span className="question-number">问题 {String(step + 1).padStart(2, '0')}</span>
              <h3>{currentQuestion.question}</h3>
              <label className="textarea-field">
                <textarea
                  name="wizardAnswer"
                  autoComplete="off"
                  autoFocus
                  value={answers[step].answer}
                  onChange={(event) => updateAnswer(event.target.value)}
                  placeholder="在这里写下你的想法…"
                  maxLength={800}
                />
                <span>{answers[step].answer.length} / 800</span>
              </label>
              <div className="question-actions">
                <button
                  className="button secondary"
                  disabled={step === 0}
                  onClick={() => setStep((current) => Math.max(0, current - 1))}
                >
                  <ArrowLeft size={16} />上一问
                </button>
                <button
                  className="button primary"
                  onClick={() => setStep((current) => Math.min(7, current + 1))}
                >
                  {answers[step].answer.trim() ? '保存并继续' : '跳过这一问'}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : fields.length ? (
            <GeneratedFields
              fields={fields}
              locked={false}
              onChange={setFields}
              onAdd={() => setFields((current) => [...current, newCustomField()])}
              onRemove={(id) => setFields((current) => current.filter((field) => field.id !== id))}
            />
          ) : (
            <div className="generation-ready">
              <span className="generation-symbol"><WandSparkles size={28} /></span>
              <span className="eyebrow">READY TO GENERATE</span>
              <h3>生成账号定位</h3>
              <div className="answer-summary">
                {answers.map((item, index) => (
                  <div key={item.questionId}>
                    <span>{index + 1}</span>
                    <p><strong>{item.question}</strong><small>{item.answer || '已跳过'}</small></p>
                  </div>
                ))}
              </div>
              <label className="field">
                <span>补充说明（可选）</span>
                <textarea
                  name="extraContext"
                  autoComplete="off"
                  value={extraContext}
                  onChange={(event) => setExtraContext(event.target.value)}
                  placeholder="补充边界、偏好或背景"
                />
              </label>
              <div className="generation-controls">
                <label className="field">
                  <span>生成模型</span>
                  <Select
                    value={modelTarget}
                    onChange={setModelTarget}
                    placeholder="请选择模型"
                    ariaLabel="生成模型"
                    options={[{ value: '', label: '请选择模型' }, ...availableModels.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))]}
                  />
                </label>
                <button
                  className="button primary large"
                  disabled={!modelTarget || generating}
                  onClick={() => void generate()}
                >
                  {generating ? <span className="spinner" /> : <Sparkles size={18} />}
                  {generating ? '正在生成定位' : '生成账号定位'}
                </button>
              </div>
              {!usableProviders.length && (
                <button className="inline-alert" onClick={() => onNavigate('providers')}>
                  <KeyRound size={16} />需要先配置模型网关 <ChevronRight size={15} />
                </button>
              )}
              <button className="text-button" onClick={startManual}>手动填写字段</button>
            </div>
          )}
        </div>

        {step === 7 && fields.length > 0 && (
          <aside className="wizard-actions-panel">
            <span className="eyebrow">GENERATED DRAFT</span>
            <h3>人工确认</h3>
            {generated && (
              <div className="generation-meta">
                <span><Sparkles size={14} />{generated.model}</span>
                <span><Clock3 size={14} />{generated.latencyMs}ms</span>
              </div>
            )}
            <label className="field regenerate-model-select">
              <span>重新生成模型</span>
              <Select
                value={modelTarget}
                onChange={setModelTarget}
                ariaLabel="重新生成模型"
                options={availableModels.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))}
              />
            </label>
            <button
              className="button secondary full"
              onClick={() => setConfirmRegenerate(true)}
              disabled={generating}
            >
              <RotateCcw size={16} />换模型重新生成
            </button>
            <div className="divider" />
            <button className="button secondary full" disabled={saving} onClick={() => void save('draft')}>
              <Save size={16} />保存为草稿
            </button>
            <button className="button primary full" disabled={saving} onClick={() => void save('locked')}>
              <Lock size={16} />保存并锁定
            </button>
            <p className="micro-copy">锁定后内容只读，可随时解锁继续编辑。</p>
          </aside>
        )}
      </section>

      <ConfirmDialog
        open={confirmRegenerate}
        title="重新生成账号定位？"
        message="当前生成结果尚未保存。重新生成会替换页面上的字段内容。"
        confirmLabel="确认重新生成"
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() => void generate()}
      />
    </div>
  )
}

function AccountEditor({
  account,
  loading,
  onBack,
  onChanged,
  onDeleted,
  showToast
}: {
  account: AccountProfile | null
  loading: boolean
  onBack(): void
  onChanged(account: AccountProfile): void
  onDeleted(): void
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [fields, setFields] = useState<AccountField[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restoreVersionId, setRestoreVersionId] = useState<string>()

  useEffect(() => {
    setFields(account?.fields ?? [])
    setDirty(false)
  }, [account])

  if (loading || !account) {
    return <div className="page loading-page"><span className="spinner" /><p>正在读取账号…</p></div>
  }

  const loadedAccount = account
  const locked = loadedAccount.status === 'locked'

  function updateFields(next: AccountField[]): void {
    setFields(next)
    setDirty(true)
  }

  async function save(status: 'draft' | 'locked' = loadedAccount.status): Promise<void> {
    setSaving(true)
    try {
      const updated = await window.moliu.accounts.save({
        id: loadedAccount.id,
        fields,
        wizardAnswers: loadedAccount.wizardAnswers,
        status,
        source: 'manual'
      })
      setDirty(false)
      onChanged(updated)
      showToast({ type: 'success', message: status === 'locked' ? '新版本已保存并锁定' : '新版本已保存' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function unlock(): Promise<void> {
    try {
      const updated = await window.moliu.accounts.setLocked(loadedAccount.id, false)
      onChanged(updated)
      showToast({ type: 'success', message: '账号已解锁，可以继续编辑' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function setCurrent(): Promise<void> {
    try {
      await window.moliu.accounts.setCurrent(loadedAccount.id)
      const updated = await window.moliu.accounts.get(loadedAccount.id)
      if (updated) onChanged(updated)
      showToast({ type: 'success', message: '已设为当前账号' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function restore(): Promise<void> {
    if (!restoreVersionId) return
    try {
      const updated = await window.moliu.accounts.restore({
        profileId: loadedAccount.id,
        versionId: restoreVersionId
      })
      setRestoreVersionId(undefined)
      onChanged(updated)
      showToast({ type: 'success', message: '历史版本已恢复为新草稿' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  async function remove(): Promise<void> {
    try {
      await window.moliu.accounts.remove(loadedAccount.id)
      showToast({ type: 'success', message: '账号已删除' })
      onDeleted()
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  return (
    <div className="page account-editor-page">
      <div className="editor-heading">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} />账号列表</button>
        <div className="editor-title">
          <span className="profile-avatar">{loadedAccount.name.slice(0, 1)}</span>
          <div>
            <span className="eyebrow">ACCOUNT PROFILE · V{loadedAccount.versionCount}</span>
            <h2>{loadedAccount.name}</h2>
          </div>
          <span className={`badge ${locked ? 'success' : 'neutral'}`}>
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            {locked ? '已锁定' : '草稿'}
          </span>
          {dirty && <span className="unsaved-dot">未保存</span>}
        </div>
        <div className="editor-heading-actions">
          {!loadedAccount.isCurrent && (
            <button className="button secondary" onClick={() => void setCurrent()}>设为当前</button>
          )}
          {locked ? (
            <button className="button secondary" onClick={() => void unlock()}>
              <LockOpen size={16} />解锁编辑
            </button>
          ) : (
            <>
              <button className="button secondary" disabled={!dirty || saving} onClick={() => void save('draft')}>
                <Save size={16} />保存版本
              </button>
              <button className="button primary" disabled={saving} onClick={() => void save('locked')}>
                <Lock size={16} />保存并锁定
              </button>
            </>
          )}
        </div>
      </div>

      <section className="account-editor-grid">
        <div className="panel fields-panel">
          <div className="section-heading">
            <div><span className="eyebrow">POSITIONING FIELDS</span><h3>定位字段</h3></div>
            {!locked && (
              <button className="button ghost compact" onClick={() => updateFields([...fields, newCustomField()])}>
                <Plus size={15} />添加字段
              </button>
            )}
          </div>
          <GeneratedFields
            fields={fields}
            locked={locked}
            onChange={updateFields}
            onAdd={() => updateFields([...fields, newCustomField()])}
            onRemove={(id) => updateFields(fields.filter((field) => field.id !== id))}
          />
        </div>

        <aside className="account-context">
          <section className="panel xml-panel">
            <div className="section-heading">
              <div><span className="eyebrow">DOWNSTREAM PAYLOAD</span><h3>结构预览</h3></div>
              <button
                className="icon-button"
                title="复制"
                aria-label="复制"
                onClick={() => {
                  void navigator.clipboard.writeText(serializePreview(fields))
                  showToast({ type: 'success', message: '结构内容已复制' })
                }}
              >
                <Copy size={16} />
              </button>
            </div>
            <pre>{serializePreview(fields)}</pre>
          </section>

          <section className="panel version-panel">
            <div className="section-heading">
              <div><span className="eyebrow">VERSION HISTORY</span><h3>版本历史</h3></div>
              <span className="count-badge">{loadedAccount.versions.length}</span>
            </div>
            <div className="version-list">
              {loadedAccount.versions.map((version) => (
                <button
                  key={version.id}
                  className={`version-item ${version.id === loadedAccount.currentVersionId ? 'current' : ''}`}
                  onClick={() => {
                    if (version.id !== loadedAccount.currentVersionId) setRestoreVersionId(version.id)
                  }}
                >
                  <span className="version-icon"><FileClock size={15} /></span>
                  <span>
                    <strong>版本 {version.versionNumber}</strong>
                    <small>{formatFullDate(version.createdAt)} · {sourceLabel(version.source)}</small>
                  </span>
                  {version.id === loadedAccount.currentVersionId && <span className="badge primary">当前</span>}
                </button>
              ))}
            </div>
          </section>

          <button className="danger-zone-button" onClick={async () => {
            if (await confirm({
              title: '删除这个账号？',
              message: `“${loadedAccount.name}”及其全部版本将被永久删除，且无法恢复。`,
              danger: true,
              confirmLabel: '永久删除'
            })) {
              await remove()
            }
          }}>
            <Trash2 size={16} />删除账号
          </button>
        </aside>
      </section>

      <ConfirmDialog
        open={Boolean(restoreVersionId)}
        title="恢复历史版本？"
        message="所选版本会复制为一个新的草稿版本，当前版本仍会保留。"
        confirmLabel="恢复为新草稿"
        onCancel={() => setRestoreVersionId(undefined)}
        onConfirm={() => void restore()}
      />
      {ConfirmPortal}
    </div>
  )
}

function GeneratedFields({
  fields,
  locked,
  onChange,
  onAdd,
  onRemove
}: {
  fields: AccountField[]
  locked: boolean
  onChange(fields: AccountField[]): void
  onAdd(): void
  onRemove(id: string): void
}): React.JSX.Element {
  function update(id: string, patch: Partial<AccountField>): void {
    onChange(fields.map((field) => field.id === id ? { ...field, ...patch } : field))
  }

  return (
    <div className="generated-fields">
      {fields.map((field, index) => (
        <div className="generated-field" key={field.id}>
          <span className="field-index">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <input
              className="field-name-input"
              name="fieldName"
              autoComplete="off"
              value={field.name}
              readOnly={locked}
              onChange={(event) => update(field.id, { name: event.target.value })}
              aria-label={`字段 ${index + 1} 名称`}
            />
            <textarea
              name="fieldValue"
              autoComplete="off"
              value={field.value}
              readOnly={locked}
              onChange={(event) => update(field.id, { value: event.target.value })}
              placeholder="填写字段内容…"
              aria-label={`${field.name || `字段 ${index + 1}`}内容`}
            />
          </div>
          {!locked && (
            <button className="icon-button field-remove" onClick={() => onRemove(field.id)} title="删除字段" aria-label="删除字段">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {!locked && (
        <button className="add-field-button" onClick={onAdd}><Plus size={16} />添加自定义字段</button>
      )}
    </div>
  )
}

function newCustomField(): AccountField {
  return {
    id: crypto.randomUUID(),
    name: '自定义字段',
    value: '',
    isDefault: false
  }
}

function serializePreview(fields: AccountField[]): string {
  const body = fields
    .map((field) => `${escapeXml(field.name.trim())}：${escapeXml(field.value.trim())}`)
    .join('\n')
  return `<账号定位>\n${body}\n</账号定位>`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function sourceLabel(source: 'ai' | 'manual' | 'restore'): string {
  return source === 'ai' ? '智能生成' : source === 'restore' ? '版本恢复' : '手动保存'
}

function encodeModelTarget(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId])
}

function decodeModelTarget(value: string): { providerId: string; modelId: string } | null {
  try {
    const [providerId, modelId] = JSON.parse(value) as [string, string]
    return providerId && modelId ? { providerId, modelId } : null
  } catch {
    return null
  }
}
