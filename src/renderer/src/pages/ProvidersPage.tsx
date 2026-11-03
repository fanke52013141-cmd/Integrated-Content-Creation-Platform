import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  DatabaseBackup,
  Download,
  FolderArchive,
  KeyRound,
  Plus,
  Radio,
  RotateCcw,
  ScrollText,
  Server,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
  Zap
} from 'lucide-react'
import type {
  ModelCallLog,
  ProviderModelKind,
  ProviderPreset,
  SaveProviderModelInput,
  ProviderSummary,
  SaveProviderInput,
  ProviderAccessMode,
  DreaminaLoginInfo,
  DreaminaStatus
} from '../../../shared/contracts'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { Segmented } from '../components/Segmented'
import { ModalBase } from '../components/ModalBase'
import { FieldError, useFormErrors } from '../components/useFormErrors'
import type { RouteId } from '../components/Layout'
import { errorMessage, formatDate, formatFullDate, isSafeUrl } from '../lib'

interface ProvidersPageProps {
  providers: ProviderSummary[]
  onRefresh(): Promise<void>
  /** 从网关提示横幅跳来时携带的来源页面，配置成功后一键返回 */
  returnTo?: string
  onNavigate?(route: ProvidersPageReturnRoute): void
  showToast(toast: ToastState): void
}

type ProvidersPageReturnRoute = Extract<RouteId, 'accounts' | 'hotspots' | 'topics' | 'frameworks' | 'articles' | 'visuals' | 'reviews' | 'layouts' | 'publishing' | 'materials' | 'prompts'>

const emptyForm = (): SaveProviderInput => ({
  displayName: '',
  protocol: 'openai-compatible',
  accessMode: 'api',
  baseUrl: '',
  defaultModel: '',
  enabled: true,
  isRelay: false,
  capabilities: {
    chat: true,
    jsonMode: true,
    streaming: false,
    vision: false,
    image: false
  },
  models: [newModel(true)],
  apiKey: ''
})

/** 把"配置已保存"和"连通性已验证"分成两件事展示，验证失败或配置改动后不再显示为可用 */
function providerState(provider: ProviderSummary): { label: string; tone: string; note: string } {
  const { verification } = provider
  const testedAt = verification.lastTestAt ? `${formatDate(verification.lastTestAt)}验证` : ''
  if (!provider.enabled) return { label: '已停用', tone: 'muted', note: `${formatDate(provider.updatedAt)} 更新` }
  if (!verification.configured) return { label: '未配置密钥', tone: 'muted', note: `保存访问密钥后才能验证连接 · ${formatDate(provider.updatedAt)} 更新` }
  if (verification.verified) return { label: '已验证', tone: 'success', note: testedAt }
  if (verification.lastTestStatus === 'failure') {
    return { label: '验证失败', tone: 'danger', note: `${testedAt} · ${verification.lastTestError || '连接不可用'}` }
  }
  if (verification.stale) return { label: '需重新验证', tone: 'warning', note: `配置已修改，${testedAt || '此前验证'}已失效` }
  return { label: '未验证', tone: 'warning', note: `配置已保存但尚未验证连接 · ${formatDate(provider.updatedAt)} 更新` }
}

function newModel(isDefault = false, kind: ProviderModelKind = 'text'): SaveProviderModelInput {
  return {
    modelId: '',
    displayName: '',
    kind,
    reasoningVariants: [],
    isDefault,
    enabled: true
  }
}

/** 模型归一化类型：缺省视为文本（旧数据兼容） */
function modelKindOf(model: { kind?: ProviderModelKind }): ProviderModelKind {
  return model.kind === 'image' ? 'image' : model.kind === 'search' ? 'search' : 'text'
}

/** 备份包只展示目录名，完整路径留在 title 里供核对 */
function bundleName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export function ProvidersPage({
  providers,
  onRefresh,
  returnTo,
  onNavigate,
  showToast
}: ProvidersPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const { validate, errorOf, clearError, clearAll, setErrorRef } = useFormErrors<{ displayName: string; baseUrl: string; apiKey: string }>()
  const [presets, setPresets] = useState<ProviderPreset[]>([])
  const [form, setForm] = useState<SaveProviderInput>(emptyForm)
  const [selectedId, setSelectedId] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string>()
  const [testStatus, setTestStatus] = useState<Record<string, string>>({})
  const [draftTesting, setDraftTesting] = useState(false)
  const [draftStatus, setDraftStatus] = useState<{ ok: boolean; message: string }>()
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsTarget, setLogsTarget] = useState<{ id?: string; name: string }>()
  const [logs, setLogs] = useState<ModelCallLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  /** 模型请求参数的编辑草稿（按模型下标）；保存时才解析成对象，允许中途是半截 JSON */
  const [paramsDrafts, setParamsDrafts] = useState<Record<number, string>>({})
  /** 即梦 CLI：接入状态与 headless 登录（应用不接触 token，登录态由 CLI 持久化） */
  const isCli = form.accessMode === 'dreamina-cli'
  const [cliStatus, setCliStatus] = useState<DreaminaStatus | null>(null)
  const [cliChecking, setCliChecking] = useState(false)
  const [cliLoginInfo, setCliLoginInfo] = useState<DreaminaLoginInfo | null>(null)
  const [cliLoggingIn, setCliLoggingIn] = useState(false)

  const paramsTextFor = (index: number, model: SaveProviderModelInput): string => {
    if (paramsDrafts[index] !== undefined) return paramsDrafts[index]
    return model.params && Object.keys(model.params).length ? JSON.stringify(model.params, null, 2) : ''
  }

  // 表单基线：记录最近一次「载入/保存」的表单快照。密钥与模型配置填写成本高，
  // 切换供应商 / 选预设 / 新建空白前若未保存，必须先确认而不是静默丢弃
  const formBaseline = useRef(JSON.stringify(emptyForm()))
  const formDirty = JSON.stringify(form) !== formBaseline.current || Object.keys(paramsDrafts).length > 0
  const guardUnsavedForm = async (action: string): Promise<boolean> => {
    if (saving || draftTesting) return false
    if (!formDirty) return true
    return confirm({ title: '有未保存的修改', message: `当前连接的修改还没保存，${action}会丢弃这些修改。`, danger: true, confirmLabel: '丢弃并继续' })
  }

  useEffect(() => {
    void window.moliu.providers.presets().then(setPresets)
  }, [])

  const refreshCliStatus = useCallback(async (): Promise<void> => {
    setCliChecking(true)
    try {
      setCliStatus(await window.moliu.dreamina.status())
    } catch (error) {
      showToast({ type: 'warning', message: `即梦 CLI 状态获取失败：${errorMessage(error)}` })
    } finally {
      setCliChecking(false)
    }
  }, [showToast])

  // 选中即梦供应商时自动检测；登录发起后每 2.5s 轮询直到拿到登录态
  useEffect(() => {
    if (isCli) void refreshCliStatus()
  }, [isCli, refreshCliStatus])
  useEffect(() => {
    if (!isCli || !cliLoginInfo || cliStatus?.loggedIn) return
    const timer = setInterval(() => {
      void window.moliu.dreamina.status().then(setCliStatus).catch(() => undefined)
    }, 2_500)
    return () => clearInterval(timer)
  }, [isCli, cliLoginInfo, cliStatus?.loggedIn])

  async function startCliLogin(): Promise<void> {
    setCliLoggingIn(true)
    try {
      setCliLoginInfo(await window.moliu.dreamina.login())
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setCliLoggingIn(false)
    }
  }

  const selected = useMemo(
    () => providers.find((provider) => provider.id === selectedId),
    [providers, selectedId]
  )

  async function chooseProvider(provider: ProviderSummary): Promise<void> {
    if (saving || draftTesting) return
    if (provider.id !== selectedId && !(await guardUnsavedForm('切换到其他供应商'))) return
    loadProviderIntoForm(provider)
  }

  function loadProviderIntoForm(provider: ProviderSummary): void {
    clearAll()
    setSelectedId(provider.id)
    setDraftStatus(undefined)
    setParamsDrafts({})
    const next: SaveProviderInput = {
      id: provider.id,
      displayName: provider.displayName,
      protocol: provider.protocol,
      accessMode: provider.accessMode === 'dreamina-cli' ? 'dreamina-cli' : 'api',
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      enabled: provider.enabled,
      isRelay: provider.isRelay,
      capabilities: provider.capabilities,
      models: provider.models.map((model) => ({
        id: model.id,
        modelId: model.modelId,
        displayName: model.displayName,
        kind: modelKindOf(model),
        contextLimit: model.contextLimit,
        outputLimit: model.outputLimit,
        reasoningVariants: model.reasoningVariants,
        params: model.params,
        pricePerImage: model.pricePerImage,
        isDefault: model.isDefault,
        enabled: model.enabled
      })),
      apiKey: '',
      expectedUpdatedAt: provider.updatedAt
    }
    setForm(next)
    formBaseline.current = JSON.stringify(next)
  }

  async function choosePreset(preset: ProviderPreset): Promise<void> {
    if (!(await guardUnsavedForm('选择预设'))) return
    clearAll()
    setSelectedId(undefined)
    setDraftStatus(undefined)
    setParamsDrafts({})
    const next: SaveProviderInput = {
      ...emptyForm(),
      displayName: preset.displayName,
      accessMode: preset.accessMode ?? 'api',
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      isRelay: preset.id === 'relay',
      capabilities: preset.capabilities,
      models: preset.models?.length
        ? preset.models.map((model, index) => ({
          modelId: model.modelId,
          displayName: model.displayName,
          kind: model.kind,
          reasoningVariants: [],
          isDefault: model.isDefault ?? index === 0,
          enabled: true
        }))
        : [{
          modelId: preset.defaultModel,
          displayName: preset.defaultModel,
          kind: preset.modelKind ?? 'text',
          reasoningVariants: [],
          params: preset.modelParams,
          isDefault: true,
          enabled: true
        }]
    }
    setForm(next)
    formBaseline.current = JSON.stringify(next)
  }

  /** 保存前先测试：文本 / 生图 / 搜索端点与即梦 CLI 各自探测（挂了哪类就测哪类） */
  async function testDraft(): Promise<boolean> {
    if (isCli) {
      setDraftTesting(true)
      setDraftStatus({ ok: true, message: '正在检测即梦 CLI…' })
      try {
        const result = await window.moliu.providers.testDraft({
          id: form.id,
          baseUrl: '',
          model: form.models.find((model) => model.isDefault && model.modelId.trim())?.modelId,
          mode: 'cli'
        })
        setDraftStatus({ ok: true, message: `${result.message} · ${result.latencyMs}ms` })
        void refreshCliStatus()
        return true
      } catch (error) {
        setDraftStatus({ ok: false, message: errorMessage(error) })
        return false
      } finally {
        setDraftTesting(false)
      }
    }
    if (!form.baseUrl.trim()) {
      setDraftStatus({ ok: false, message: '请先填写接口地址' })
      return false
    }
    if (!form.apiKey?.trim() && !(form.id && selected?.hasApiKey)) {
      setDraftStatus({ ok: false, message: '请先填写访问密钥' })
      return false
    }
    const enabled = form.models.filter((model) => model.enabled && model.modelId.trim())
    const textModel = enabled.find((model) => modelKindOf(model) === 'text' && model.isDefault)
      ?? enabled.find((model) => modelKindOf(model) === 'text')
    const imageModel = enabled.find((model) => modelKindOf(model) === 'image' && model.isDefault)
      ?? enabled.find((model) => modelKindOf(model) === 'image')
    const searchModel = enabled.find((model) => modelKindOf(model) === 'search' && model.isDefault)
      ?? enabled.find((model) => modelKindOf(model) === 'search')
    if (!textModel && !imageModel && !searchModel) {
      setDraftStatus({ ok: false, message: '请至少填写一个模型标识' })
      return false
    }
    setDraftTesting(true)
    setDraftStatus({ ok: true, message: '正在测试连接…' })
    try {
      const notes: string[] = []
      if (textModel) {
        const result = await window.moliu.providers.testDraft({
          id: form.id,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey?.trim() || undefined,
          model: textModel.modelId.trim(),
          mode: 'chat'
        })
        notes.push(`文本 ${result.model} · ${result.latencyMs}ms`)
      }
      if (imageModel) {
        const result = await window.moliu.providers.testDraft({
          id: form.id,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey?.trim() || undefined,
          model: imageModel.modelId.trim(),
          mode: 'image'
        })
        notes.push(`生图端点可达 · ${result.latencyMs}ms`)
      }
      if (searchModel) {
        const result = await window.moliu.providers.testDraft({
          id: form.id,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey?.trim() || undefined,
          model: searchModel.modelId.trim(),
          mode: 'search'
        })
        notes.push(`搜索端点可用 · ${result.latencyMs}ms`)
      }
      setDraftStatus({ ok: true, message: `连接成功 · ${notes.join('；')}` })
      return true
    } catch (error) {
      setDraftStatus({ ok: false, message: errorMessage(error) })
      return false
    } finally {
      setDraftTesting(false)
    }
  }

  async function save(): Promise<void> {
    let models: SaveProviderModelInput[]
    try {
      models = form.models.map((model, index) => {
        const text = paramsTextFor(index, model).trim()
        let params: Record<string, unknown> | undefined
        if (text) {
          const parsed = JSON.parse(text) as unknown
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error(`第 ${index + 1} 个模型的请求参数必须是 JSON 对象`)
          }
          params = parsed as Record<string, unknown>
        }
        return {
          ...model,
          modelId: model.modelId.trim(),
          displayName: model.displayName.trim(),
          contextLimit: normalizeOptionalNumber(model.contextLimit),
          outputLimit: normalizeOptionalNumber(model.outputLimit),
          params
        }
      })
    } catch (error) {
      showToast({ type: 'error', message: `请求参数不是合法 JSON：${errorMessage(error)}` })
      return
    }
    const enabledModels = models.filter((model) => model.enabled)
    const textDefault = enabledModels.find((model) => modelKindOf(model) === 'text' && model.isDefault)
    const imageDefault = enabledModels.find((model) => modelKindOf(model) === 'image' && model.isDefault)
    const searchDefault = enabledModels.find((model) => modelKindOf(model) === 'search' && model.isDefault)
    const valid = validate(
      { displayName: form.displayName, baseUrl: form.baseUrl, apiKey: form.apiKey ?? '' },
      {
        displayName: (value) => value.trim() ? null : '请填写连接显示名称',
        baseUrl: (value) => isCli ? null : !value.trim() ? '请填写接口地址' : isSafeUrl(value) ? null : '接口地址必须是有效的网址',
        apiKey: (value) => !form.id && !value.trim() && !isCli ? '首次创建时需要填写密钥' : null
      }
    )
    if (!valid) return
    if (!models.length || models.some((model) => !model.modelId || !model.displayName)) {
      showToast({ type: 'error', message: '每个模型都需要填写别名和模型标识' })
      return
    }
    if (!enabledModels.length) {
      showToast({ type: 'error', message: '请至少启用一个模型' })
      return
    }
    // 每类模型各自需要默认：纯生图（无文本模型）或纯文本供应商都合法
    if (enabledModels.some((model) => modelKindOf(model) === 'text') && !textDefault) {
      showToast({ type: 'error', message: '请为文本模型指定一个默认' })
      return
    }
    if (enabledModels.some((model) => modelKindOf(model) === 'image') && !imageDefault) {
      showToast({ type: 'error', message: '请为生图模型指定一个默认' })
      return
    }
    if (enabledModels.some((model) => modelKindOf(model) === 'search') && !searchDefault) {
      showToast({ type: 'error', message: '请为搜索模型指定一个默认' })
      return
    }
    if (new Set(models.map((model) => model.modelId)).size !== models.length) {
      showToast({ type: 'error', message: '同一连接内的模型标识不能重复' })
      return
    }

    if (saving || draftTesting) return
    setSaving(true)
    try {
      const saved = await window.moliu.providers.testAndSave({
        ...form,
        models,
        defaultModel: (textDefault ?? imageDefault ?? searchDefault)!.modelId,
        // chat/image 能力由模型类型派生，避免「勾了能力但没有对应类型模型」的矛盾配置
        capabilities: {
          ...form.capabilities,
          chat: Boolean(textDefault),
          image: Boolean(imageDefault)
        },
        accessMode: isCli ? 'dreamina-cli' : 'api',
        apiKey: isCli ? undefined : form.apiKey?.trim() || undefined
      })
      loadProviderIntoForm(saved)
      await onRefresh().catch(error => showToast({ type: 'warning', message: `配置已保存，列表刷新失败：${errorMessage(error)}` }))
      showToast({ type: 'success', message: '测试通过，供应商配置已加密保存' })
      if (returnTo && onNavigate && returnTo !== 'providers') {
        onNavigate(returnTo as ProvidersPageReturnRoute)
      }
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function test(provider: ProviderSummary): Promise<void> {
    setTestingId(provider.id)
    setTestStatus((current) => ({ ...current, [provider.id]: '正在连接…' }))
    try {
      const result = await window.moliu.providers.test(provider.id)
      setTestStatus((current) => ({
        ...current,
        [provider.id]: `${result.message} · ${result.latencyMs}ms`
      }))
      if (!result.ok) showToast({ type: 'error', message: result.message })
      // 结果已在主进程落库，刷新后卡片上的验证状态与页面提示保持一致
      await onRefresh()
    } catch (error) {
      setTestStatus((current) => ({
        ...current,
        [provider.id]: errorMessage(error)
      }))
    } finally {
      setTestingId(undefined)
    }
  }

  async function openLogs(target?: { id: string; name: string }): Promise<void> {
    setLogsTarget(target ?? { name: '全部连接' })
    setLogsOpen(true)
    setLogsLoading(true)
    try {
      setLogs(await window.moliu.providers.logs(target?.id))
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setLogsLoading(false)
    }
  }

  async function remove(): Promise<void> {
    if (!selected || !(await confirm({
      title: `删除供应商“${selected.displayName}”？`,
      message: '加密密钥也会一并删除。此操作不可撤销。',
      danger: true,
      confirmLabel: '删除'
    }))) {
      return
    }
    try {
      await window.moliu.providers.remove(selected.id)
      setSelectedId(undefined)
      const next = emptyForm()
      setForm(next)
      setParamsDrafts({})
      formBaseline.current = JSON.stringify(next)
      await onRefresh()
      showToast({ type: 'success', message: '供应商已删除' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  /**
   * 更新单个模型。默认互斥只作用于同类型模型；切换类型时修复两类的默认：
   * 同类出现两个默认保留被操作的那个，某类失去默认则提升该类第一个启用模型。
   */
  function updateModel(index: number, patch: Partial<SaveProviderModelInput>): void {
    setForm((current) => {
      const target = current.models[index]
      if (!target) return current
      const oldKind = modelKindOf(target)
      const nextKind = patch.kind ? modelKindOf(patch) : oldKind
      const models = current.models.map((model, modelIndex) => modelIndex === index
        ? { ...model, ...patch, ...(patch.isDefault ? { enabled: true } : {}) }
        : model)
      if (patch.isDefault || nextKind !== oldKind) {
        for (const kind of ['text', 'image', 'search'] as const) {
          const defaults = models
            .map((model, modelIndex) => ({ model, modelIndex }))
            .filter(({ model }) => modelKindOf(model) === kind && model.isDefault)
          if (defaults.length > 1) {
            const keep = defaults.find(({ modelIndex }) => modelIndex === index) ?? defaults[0]
            for (const entry of defaults) {
              if (entry.modelIndex !== keep.modelIndex) models[entry.modelIndex] = { ...entry.model, isDefault: false }
            }
          } else if (defaults.length === 0) {
            const candidate = models
              .map((model, modelIndex) => ({ model, modelIndex }))
              .find(({ model, modelIndex }) => modelKindOf(model) === kind && model.enabled && modelIndex !== index)
            if (candidate) models[candidate.modelIndex] = { ...candidate.model, isDefault: true }
          }
        }
      }
      const defaultModel = models.find((model) => model.isDefault)?.modelId ?? ''
      return { ...current, models, defaultModel }
    })
  }

  function removeModel(index: number): void {
    setParamsDrafts({})
    setForm((current) => {
      if (current.models.length === 1) return current
      const removed = current.models[index]
      const removedWasDefault = removed?.isDefault
      const removedKind = removed ? modelKindOf(removed) : 'text'
      const models = current.models.filter((_, modelIndex) => modelIndex !== index)
      // 默认被删后由同类型的第一个启用模型接任，不影响另一类的默认
      if (removedWasDefault) {
        const successorIndex = models.findIndex((model) => modelKindOf(model) === removedKind && model.enabled)
        if (successorIndex >= 0) models[successorIndex] = { ...models[successorIndex], isDefault: true }
      }
      return {
        ...current,
        models,
        defaultModel: models.find((model) => model.isDefault)?.modelId ?? ''
      }
    })
  }

  return (
    <div className="page providers-page">
      <section className="page-intro">
        <div>
          <h1>AI 服务</h1>
        </div>
        <button
          className="button secondary"
          onClick={() => void (async () => {
            if (!(await guardUnsavedForm('新建空白配置'))) return
            setSelectedId(undefined)
            const next = emptyForm()
            setForm(next)
            setParamsDrafts({})
            formBaseline.current = JSON.stringify(next)
          })()}
        >
          <Plus size={16} />空白配置
        </button>
      </section>

      <section className="provider-layout">
        <div className="provider-list-column">
          <div className="section-heading">
            <div><h3>已配置供应商</h3></div>
            <div className="section-heading-actions">
              <button
                className="button ghost compact"
                onClick={() => void openLogs()}
                title="查看全部模型调用日志"
              >
                <ScrollText size={16} />调用日志
              </button>
              <span className="count-badge">{providers.length}</span>
            </div>
          </div>

          <div className="provider-list">
            {providers.length ? providers.map((provider) => (
              <article
                key={provider.id}
                className={`provider-card ${selectedId === provider.id ? 'selected' : ''}`}
              >
                <button type="button" className="provider-select" aria-pressed={selectedId === provider.id} onClick={() => chooseProvider(provider)}>
                <span className="provider-logo"><Server size={20} /></span>
                <div className="provider-card-copy">
                  <div>
                    <strong>{provider.displayName}</strong>
                    <span className={`status-pill ${providerState(provider).tone}`}>
                      {providerState(provider).label}
                    </span>
                  </div>
                  <p>{provider.defaultModel} · {provider.models.length} 个模型{provider.accessMode === 'dreamina-cli' ? ' · 本机 CLI' : ''}</p>
                  <small>{testStatus[provider.id] || providerState(provider).note}</small>
                </div>
                </button>
                <div className="provider-actions">
                  <button
                    className="icon-button"
                    disabled={testingId === provider.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      void openLogs({ id: provider.id, name: provider.displayName })
                    }}
                    title="调用日志"
                    aria-label="调用日志"
                  >
                    <ScrollText size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!provider.hasApiKey || testingId === provider.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      void test(provider)
                    }}
                    title="测试连接"
                    aria-label="测试连接"
                  >
                    {testingId === provider.id ? <span className="spinner tiny" /> : <Zap size={16} />}
                  </button>
                  <ChevronRight size={16} />
                </div>
              </article>
            )) : (
              <div className="provider-empty">
                <Unplug size={24} />
                <strong>暂无供应商</strong>
                <p className="micro-copy">从右侧预设选择供应商并填入密钥，或使用「空白配置」。</p>
              </div>
            )}
          </div>

          <div className="security-note">
            <KeyRound size={20} />
            <div><strong>本机加密存储</strong></div>
          </div>
        </div>

        <fieldset disabled={saving || draftTesting} className="panel provider-editor">
          <div className="section-heading">
            <div>
              
              <h3>{form.id ? '编辑连接' : '新建连接'}</h3>
            </div>
            {form.id && (
              <button className="icon-button danger-text" onClick={() => void remove()} title="删除" aria-label="删除">
                <Trash2 size={20} />
              </button>
            )}
          </div>

          <details className="provider-presets">
            <summary>从服务商预设开始</summary>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button key={preset.id} className="preset-chip" onClick={() => choosePreset(preset)}>
                <Radio size={16} />{preset.displayName}
              </button>
            ))}
          </div>
          </details>

          <div className="form-grid">
            <label className={`field full ${errorOf('displayName') ? 'has-error' : ''}`}>
              <span>显示名称</span>
              <input
                name="displayName"
                autoComplete="off"
                ref={setErrorRef('displayName')}
                value={form.displayName}
                onChange={(event) => { setForm({ ...form, displayName: event.target.value }); clearError('displayName') }}
                placeholder="例如：DeepSeek 主账号…"
              />
              <FieldError message={errorOf('displayName')} />
            </label>
            {isCli ? (
              <div className="cli-access-panel">
                <KeyRound size={18} />
                <div className="cli-access-copy">
                  <strong>即梦本机 CLI 接入</strong>
                  <p className="micro-copy">
                    {cliStatus?.installed
                      ? `已检测到 CLI：${cliStatus.cliPath}`
                      : (cliStatus?.message ?? (cliChecking ? '正在检测 CLI…' : '尚未检测'))}
                  </p>
                  {cliStatus?.loggedIn && (
                    <p className="micro-copy">
                      已登录
                      {cliStatus.totalCredit !== undefined ? ` · 剩余额度 ${cliStatus.totalCredit}` : ''}
                      {cliStatus.vipLevel ? ` · ${cliStatus.vipLevel}` : ''}
                    </p>
                  )}
                  {cliLoginInfo && !cliStatus?.loggedIn && (
                    <p className="micro-copy">
                      已打开浏览器授权（设备码 {cliLoginInfo.userCode ?? cliLoginInfo.deviceCode ?? '—'}），完成后此处自动更新；浏览器没弹出时可手动访问 {cliLoginInfo.authUrl}
                    </p>
                  )}
                  <p className="micro-copy">登录态由即梦 CLI 持久化在本机，应用不接触 token；生图按即梦会员额度计费，仅开放图片 5.0 / 5.0Pro。</p>
                </div>
                <div className="cli-access-actions">
                  <button className="button secondary compact" disabled={cliChecking} onClick={() => void refreshCliStatus()}>
                    {cliChecking ? '检测中' : '重新检测'}
                  </button>
                  <button className="button primary compact" disabled={cliLoggingIn || cliStatus?.loggedIn} onClick={() => void startCliLogin()}>
                    {cliStatus?.loggedIn ? '已登录' : '登录即梦'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label className={`field full ${errorOf('baseUrl') ? 'has-error' : ''}`}>
                  <span>接口地址</span>
                  <input
                    type="url"
                    inputMode="url"
                    name="baseUrl"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    ref={setErrorRef('baseUrl')}
                    value={form.baseUrl}
                    onChange={(event) => { setForm({ ...form, baseUrl: event.target.value }); clearError('baseUrl') }}
                    placeholder="https://api.example.com/v1…"
                  />
                  <FieldError message={errorOf('baseUrl')} />
                </label>
                <label className={`field full ${errorOf('apiKey') ? 'has-error' : ''}`}>
                  <span>访问密钥 {form.id && <em>留空表示不修改</em>}</span>
                  <input
                    type="password"
                    name="apiKey"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    ref={setErrorRef('apiKey')}
                    value={form.apiKey ?? ''}
                    onChange={(event) => { setForm({ ...form, apiKey: event.target.value }); clearError('apiKey') }}
                    placeholder={form.id && selected?.hasApiKey ? '••••••••••••••••' : 'sk-…'}
                  />
                  <FieldError message={errorOf('apiKey')} />
                </label>
              </>
            )}
          </div>

          <section className="model-catalog">
            <div className="model-catalog-heading">
              <div>
                
                <h4>模型与别名</h4>
              </div>
              <button
                className="button ghost compact"
                onClick={() => setForm((current) => ({
                  ...current,
                  models: [...current.models, newModel(false)]
                }))}
              >
                <Plus size={16} />添加模型
              </button>
            </div>
            <div className="model-editor-list">
              {form.models.map((model, index) => (
                <article className="model-editor-card" key={model.id ?? `new-${index}`}>
                  <div className="model-editor-topline">
                    <label className="default-model-radio">
                      <input
                        type="radio"
                        name={`default-model-${modelKindOf(model)}`}
                        autoComplete="off"
                        checked={model.isDefault}
                        onChange={() => updateModel(index, { isDefault: true })}
                      />
                      <span>{model.isDefault ? (modelKindOf(model) === 'text' ? '文本默认' : modelKindOf(model) === 'image' ? '生图默认' : '搜索默认') : '设为默认'}</span>
                    </label>
                    <div className="model-kind-picker" title="文本模型用于各生成环节；生图模型只出现在配图与智能配图的生图下拉。同一供应商可同时挂两类模型。">
                      <Segmented
                        ariaLabel={`第 ${index + 1} 个模型的类型`}
                        value={modelKindOf(model)}
                        onChange={(kind) => updateModel(index, { kind })}
                        options={[
                          { value: 'text', label: '文本' },
                          { value: 'image', label: '生图' },
                          { value: 'search', label: '搜索', title: '搜索模型用于素材库的联网搜索（豆包）' }
                        ]}
                      />
                    </div>
                    <label className="model-enabled">
                      <input
                        type="checkbox"
                        name="modelEnabled"
                        autoComplete="off"
                        checked={model.enabled}
                        onChange={(event) => updateModel(index, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    <button
                      className="icon-button danger-text"
                      disabled={form.models.length === 1}
                      onClick={() => removeModel(index)}
                      title="移除模型"
                      aria-label="移除模型"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="model-primary-fields">
                    <label className="field">
                      <span>显示别名</span>
                      <input
                        name="modelDisplayName"
                        autoComplete="off"
                        value={model.displayName}
                        onChange={(event) => updateModel(index, { displayName: event.target.value })}
                        placeholder="GPT-5.4 Mini…"
                      />
                    </label>
                    <label className="field">
                      <span>模型标识</span>
                      <input
                        name="modelId"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        value={model.modelId}
                        onChange={(event) => updateModel(index, { modelId: event.target.value })}
                        placeholder="gpt-4o / deepseek-chat / doubao-pro"
                        aria-label="模型标识"
                      />
                      {/* 这是新手最容易填错的字段：它指外部服务商的模型名，不是显示名。
                          说明填错的后果，避免反复试错。 */}
                      <small className="field-help">
                        服务商提供的模型名称，需与其官方文档一致。填错会导致「测试连接」失败。
                      </small>
                    </label>
                  </div>
                  <div className="model-limit-fields">
                    <label className="field">
                      <span>上下文上限</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        name="contextLimit"
                        autoComplete="off"
                        min="1"
                        value={model.contextLimit ?? ''}
                        onChange={(event) => updateModel(index, {
                          contextLimit: event.target.value ? Number(event.target.value) : undefined
                        })}
                        placeholder="400000…"
                      />
                    </label>
                    <label className="field">
                      <span>输出上限</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        name="outputLimit"
                        autoComplete="off"
                        min="1"
                        value={model.outputLimit ?? ''}
                        onChange={(event) => updateModel(index, {
                          outputLimit: event.target.value ? Number(event.target.value) : undefined
                        })}
                        placeholder="128000…"
                      />
                    </label>
                    <label className="field">
                      <span>推理档位</span>
                      <input
                        name="reasoningVariants"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        value={model.reasoningVariants.join(', ')}
                        onChange={(event) => updateModel(index, {
                          reasoningVariants: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean)
                        })}
                        placeholder="low, medium, high…"
                      />
                    </label>
                    <label className="field">
                      <span>单张成本（USD）</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        name="pricePerImage"
                        autoComplete="off"
                        min="0"
                        step="0.0001"
                        value={model.pricePerImage ?? ''}
                        onChange={(event) => updateModel(index, {
                          pricePerImage: event.target.value ? Number(event.target.value) : undefined
                        })}
                        placeholder="0.02…"
                      />
                    </label>
                  </div>
                  <label className="field full">
                    <span>请求参数（JSON，可选）</span>
                    <textarea
                      name="modelParams"
                      autoComplete="off"
                      spellCheck={false}
                      rows={2}
                      value={paramsTextFor(index, model)}
                      onChange={(event) => setParamsDrafts((current) => ({ ...current, [index]: event.target.value }))}
                      placeholder='{"thinking":{"type":"disabled"}}'
                    />
                    <small className="field-help">
                      原样合并进对话请求体，可传供应商专属参数；不能覆盖 model / messages / stream。豆包推理模型默认关闭思考（预设已填）。
                    </small>
                  </label>
                </article>
              ))}
            </div>
          </section>

          <div className="capability-row">
            <label className="switch-row">
              <input
                type="checkbox"
                name="jsonMode"
                autoComplete="off"
                checked={form.capabilities.jsonMode}
                onChange={(event) => setForm({
                  ...form,
                  capabilities: { ...form.capabilities, jsonMode: event.target.checked }
                })}
              />
              <span><strong>结构化输出</strong></span>
            </label>
            <div
              className="capability-badges"
              title="文本/生图能力由模型类型自动决定：存在对应类型的启用模型即开放对应能力，保存时自动更新"
            >
              <span className={`status-pill ${form.models.some((model) => model.enabled && modelKindOf(model) === 'text') ? 'success' : 'muted'}`}>文本对话</span>
              <span className={`status-pill ${form.models.some((model) => model.enabled && modelKindOf(model) === 'image') ? 'success' : 'muted'}`}>图片生成</span>
              <span className={`status-pill ${form.models.some((model) => model.enabled && modelKindOf(model) === 'search') ? 'success' : 'muted'}`}>联网搜索</span>
            </div>
            <label className="switch-row">
              <input
                type="checkbox"
                name="providerEnabled"
                autoComplete="off"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              <span><strong>启用供应商</strong></span>
            </label>
          </div>

          <div className="editor-footer">
            <span className={`inline-security draft-status ${draftStatus ? (draftStatus.ok ? 'ok' : 'error') : ''}`}>
              {draftStatus
                ? draftStatus.ok
                  ? <><CheckCircle2 size={16} />{draftStatus.message}</>
                  : <><CircleAlert size={16} />{draftStatus.message}</>
                : form.id && selected?.hasApiKey
                  ? <><CheckCircle2 size={16} />密钥已保存，保存前仍会先测试连接</>
                  : <><CircleAlert size={16} />保存前会先测试连接，通过后才加密保存</>}
            </span>
            <div className="editor-footer-actions">
              <button
                className="button secondary"
                disabled={draftTesting || saving}
                onClick={() => void testDraft()}
              >
                {draftTesting ? <span className="spinner tiny" /> : <Zap size={16} />}
                {draftTesting ? '测试中' : '测试连接'}
              </button>
              <button
                className="button primary"
                disabled={saving || draftTesting}
                onClick={() => void save()}
              >
                {saving || draftTesting ? <span className="spinner tiny" /> : <ShieldCheck size={16} />}
                {saving ? '保存中' : draftTesting ? '测试中' : '测试并加密保存'}
              </button>
            </div>
          </div>
        </fieldset>
      </section>

      {logsOpen && (
        <ModalBase open onClose={() => setLogsOpen(false)} titleId="provider-logs-title" bare className="source-manager-dialog provider-logs-dialog">
          <header>
            <div>
              
              <h2 id="provider-logs-title">调用日志 · {logsTarget?.name}</h2>
              <p>最近 100 条记录，包含内容生成、连接测试与保存前测试。</p>
            </div>
            <button className="icon-button" aria-label="关闭" onClick={() => setLogsOpen(false)}>
              <X size={20} />
            </button>
          </header>
          <div className="provider-logs-list">
            {logsLoading ? (
              <div className="provider-logs-empty"><span className="spinner" /><span>正在读取日志…</span></div>
            ) : logs.length ? (
              logs.map((log) => (
                <article key={log.id} className={`provider-log-row ${log.success ? 'ok' : 'fail'}`}>
                  <span className={`log-state ${log.success ? 'success' : 'error'}`}>
                    {log.success ? '成功' : '失败'}
                  </span>
                  <div className="provider-log-main">
                    <strong>{log.model}</strong>
                    <small>
                      {formatFullDate(log.createdAt)} · {log.latencyMs}ms
                      {log.promptTokens !== undefined || log.completionTokens !== undefined
                        ? ` · ${log.promptTokens ?? 0} / ${log.completionTokens ?? 0} tokens`
                        : ''}
                      {log.costUsd !== undefined ? ` · $${log.costUsd.toFixed(4)}` : ''}
                      {!log.success && log.errorKind ? ` · ${errorKindLabel(log.errorKind)}` : ''}
                    </small>
                    {!log.success && log.errorMessage && <p>{log.errorMessage}</p>}
                  </div>
                </article>
              ))
            ) : (
              <div className="provider-logs-empty"><ScrollText size={20} /><span>暂无调用记录</span></div>
            )}
          </div>
        </ModalBase>
      )}
      {ConfirmPortal}
    </div>
  )
}

function errorKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    AuthError: '密钥或权限问题',
    RateLimitError: '频率/额度限制',
    TimeoutError: '请求超时',
    NetworkError: '网络错误',
    ProviderError: '供应商返回错误',
    ParseError: '响应解析失败',
    ProviderConfigError: '配置错误'
  }
  return labels[kind] ?? kind
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
