import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  KeyRound,
  Plus,
  Radio,
  Server,
  ShieldCheck,
  Trash2,
  Unplug,
  Zap
} from 'lucide-react'
import type {
  ProviderPreset,
  SaveProviderModelInput,
  ProviderSummary,
  SaveProviderInput,
  SearchServiceSummary
} from '../../../shared/contracts'
import type { ToastState } from '../components/Toast'
import { useConfirm } from '../components/useConfirm'
import { errorMessage, formatDate } from '../lib'

interface ProvidersPageProps {
  providers: ProviderSummary[]
  searchService: SearchServiceSummary
  onRefresh(): Promise<void>
  showToast(toast: ToastState): void
}

const emptyForm = (): SaveProviderInput => ({
  displayName: '',
  protocol: 'openai-compatible',
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

function newModel(isDefault = false): SaveProviderModelInput {
  return {
    modelId: '',
    displayName: '',
    reasoningVariants: [],
    isDefault,
    enabled: true
  }
}

export function ProvidersPage({
  providers,
  searchService,
  onRefresh,
  showToast
}: ProvidersPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [presets, setPresets] = useState<ProviderPreset[]>([])
  const [form, setForm] = useState<SaveProviderInput>(emptyForm)
  const [selectedId, setSelectedId] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string>()
  const [testStatus, setTestStatus] = useState<Record<string, string>>({})

  useEffect(() => {
    void window.moliu.providers.presets().then(setPresets)
  }, [])

  const selected = useMemo(
    () => providers.find((provider) => provider.id === selectedId),
    [providers, selectedId]
  )

  function chooseProvider(provider: ProviderSummary): void {
    setSelectedId(provider.id)
    setForm({
      id: provider.id,
      displayName: provider.displayName,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      enabled: provider.enabled,
      isRelay: provider.isRelay,
      capabilities: provider.capabilities,
      models: provider.models.map((model) => ({
        id: model.id,
        modelId: model.modelId,
        displayName: model.displayName,
        contextLimit: model.contextLimit,
        outputLimit: model.outputLimit,
        reasoningVariants: model.reasoningVariants,
        isDefault: model.isDefault,
        enabled: model.enabled
      })),
      apiKey: ''
    })
  }

  function choosePreset(preset: ProviderPreset): void {
    setSelectedId(undefined)
    setForm({
      ...emptyForm(),
      displayName: preset.displayName,
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      isRelay: preset.id === 'relay',
      capabilities: preset.capabilities,
      models: [{
        modelId: preset.defaultModel,
        displayName: preset.defaultModel,
        reasoningVariants: [],
        isDefault: true,
        enabled: true
      }]
    })
  }

  async function save(): Promise<void> {
    const models = form.models.map((model) => ({
      ...model,
      modelId: model.modelId.trim(),
      displayName: model.displayName.trim(),
      contextLimit: normalizeOptionalNumber(model.contextLimit),
      outputLimit: normalizeOptionalNumber(model.outputLimit)
    }))
    const enabledModels = models.filter((model) => model.enabled)
    const defaultModel = enabledModels.find((model) => model.isDefault)
    if (!form.displayName.trim() || !form.baseUrl.trim()) {
      showToast({ type: 'error', message: '请完整填写连接名称和 Base URL' })
      return
    }
    if (!models.length || models.some((model) => !model.modelId || !model.displayName)) {
      showToast({ type: 'error', message: '每个模型都需要填写别名和 API 模型 ID' })
      return
    }
    if (!defaultModel) {
      showToast({ type: 'error', message: '请启用并指定一个默认模型' })
      return
    }
    if (new Set(models.map((model) => model.modelId)).size !== models.length) {
      showToast({ type: 'error', message: '同一连接内的 API 模型 ID 不能重复' })
      return
    }
    if (!form.id && !form.apiKey?.trim()) {
      showToast({ type: 'error', message: '首次创建供应商时需要填写 API Key' })
      return
    }
    setSaving(true)
    try {
      const saved = await window.moliu.providers.save({
        ...form,
        models,
        defaultModel: defaultModel.modelId,
        apiKey: form.apiKey?.trim() || undefined
      })
      await onRefresh()
      chooseProvider(saved)
      showToast({ type: 'success', message: '供应商配置已加密保存' })
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
    } catch (error) {
      setTestStatus((current) => ({
        ...current,
        [provider.id]: errorMessage(error)
      }))
    } finally {
      setTestingId(undefined)
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
      setForm(emptyForm())
      await onRefresh()
      showToast({ type: 'success', message: '供应商已删除' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  function updateModel(index: number, patch: Partial<SaveProviderModelInput>): void {
    setForm((current) => {
      const models = current.models.map((model, modelIndex) => {
        if (modelIndex !== index) {
          return patch.isDefault ? { ...model, isDefault: false } : model
        }
        return {
          ...model,
          ...patch,
          ...(patch.isDefault ? { enabled: true } : {})
        }
      })
      const defaultModel = models.find((model) => model.isDefault)?.modelId ?? ''
      return { ...current, models, defaultModel }
    })
  }

  function removeModel(index: number): void {
    setForm((current) => {
      if (current.models.length === 1) return current
      const removedWasDefault = current.models[index]?.isDefault
      const models = current.models.filter((_, modelIndex) => modelIndex !== index)
      if (removedWasDefault) models[0] = { ...models[0], isDefault: true, enabled: true }
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
          <span className="eyebrow"><ShieldCheck size={14} /> LOCAL FIRST</span>
          <h2>连接模型，不交出密钥。</h2>
          <p>Renderer 无法读取 Key；密钥在主进程中由 Windows DPAPI 加密，仅调用时短暂解密。</p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setSelectedId(undefined)
            setForm(emptyForm())
          }}
        >
          <Plus size={16} />空白配置
        </button>
      </section>

      <section className="provider-layout">
        <div className="provider-list-column">
          <div className="section-heading">
            <div><span className="eyebrow">PROVIDERS</span><h3>已配置供应商</h3></div>
            <span className="count-badge">{providers.length}</span>
          </div>

          <div className="provider-list">
            {providers.length ? providers.map((provider) => (
              <article
                key={provider.id}
                className={`provider-card ${selectedId === provider.id ? 'selected' : ''}`}
                onClick={() => chooseProvider(provider)}
              >
                <span className="provider-logo"><Server size={19} /></span>
                <div className="provider-card-copy">
                  <div>
                    <strong>{provider.displayName}</strong>
                    <span className={`status-pill ${provider.enabled && provider.hasApiKey ? 'success' : ''}`}>
                      {provider.enabled && provider.hasApiKey ? '可用' : '未就绪'}
                    </span>
                  </div>
                  <p>{provider.defaultModel} · {provider.models.length} 个模型</p>
                  <small>{testStatus[provider.id] || `${formatDate(provider.updatedAt)} 更新`}</small>
                </div>
                <div className="provider-actions">
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
                <Unplug size={25} />
                <strong>还没有供应商</strong>
                <p>从右侧预设选择一个开始。</p>
              </div>
            )}
          </div>

          <div className="security-note">
            <KeyRound size={18} />
            <div><strong>密钥不会出现在配置导出中</strong><p>日志只记录模型、延迟和 Token，不记录对话内容。</p></div>
          </div>
        </div>

        <div className="panel provider-editor">
          <div className="section-heading">
            <div>
              <span className="eyebrow">CONNECTION</span>
              <h3>{form.id ? '编辑连接' : '新建连接'}</h3>
            </div>
            {form.id && (
              <button className="icon-button danger-text" onClick={() => void remove()} title="删除" aria-label="删除">
                <Trash2 size={17} />
              </button>
            )}
          </div>

          <div className="preset-grid">
            {presets.map((preset) => (
              <button key={preset.id} className="preset-chip" onClick={() => choosePreset(preset)}>
                <Radio size={14} />{preset.displayName}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label className="field full">
              <span>显示名称</span>
              <input
                name="displayName"
                autoComplete="off"
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                placeholder="例如：DeepSeek 主账号…"
              />
            </label>
            <label className="field full">
              <span>Base URL</span>
              <input
                type="url"
                inputMode="url"
                name="baseUrl"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="https://api.example.com/v1…"
              />
              <small>系统会调用该地址下的 `/chat/completions`。</small>
            </label>
            <label className="field full">
              <span>API Key {form.id && <em>留空表示不修改</em>}</span>
              <input
                type="password"
                name="apiKey"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={form.apiKey ?? ''}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder={form.id && selected?.hasApiKey ? '••••••••••••••••' : 'sk-…'}
              />
            </label>
          </div>

          <section className="model-catalog">
            <div className="model-catalog-heading">
              <div>
                <span className="eyebrow">MODEL CATALOG</span>
                <h4>模型与别名</h4>
              </div>
              <button
                className="button ghost compact"
                onClick={() => setForm((current) => ({
                  ...current,
                  models: [...current.models, newModel(false)]
                }))}
              >
                <Plus size={15} />添加模型
              </button>
            </div>
            <div className="model-editor-list">
              {form.models.map((model, index) => (
                <article className="model-editor-card" key={model.id ?? `new-${index}`}>
                  <div className="model-editor-topline">
                    <label className="default-model-radio">
                      <input
                        type="radio"
                        name="default-model"
                        autoComplete="off"
                        checked={model.isDefault}
                        onChange={() => updateModel(index, { isDefault: true })}
                      />
                      <span>{model.isDefault ? '默认模型' : '设为默认'}</span>
                    </label>
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
                      <Trash2 size={15} />
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
                      <span>API 模型 ID</span>
                      <input
                        name="modelId"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        value={model.modelId}
                        onChange={(event) => updateModel(index, { modelId: event.target.value })}
                        placeholder="gpt-5.4-mini…"
                      />
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
                  </div>
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
              <span><strong>支持 JSON Mode</strong><small>账号定位优先使用结构化输出</small></span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                name="providerEnabled"
                autoComplete="off"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              <span><strong>启用供应商</strong><small>停用后不会出现在模型选择中</small></span>
            </label>
          </div>

          <div className="editor-footer">
            <span className="inline-security">
              {form.id && selected?.hasApiKey
                ? <><CheckCircle2 size={15} />密钥已保存</>
                : <><CircleAlert size={15} />等待保存密钥</>}
            </span>
            <button className="button primary" disabled={saving} onClick={() => void save()}>
              {saving ? <span className="spinner tiny" /> : <ShieldCheck size={16} />}
              {saving ? '保存中' : '加密保存'}
            </button>
          </div>
        </div>
      </section>
      <SearchServicePanel
        service={searchService}
        onRefresh={onRefresh}
        showToast={showToast}
      />
      {ConfirmPortal}
    </div>
  )
}

function SearchServicePanel({
  service,
  onRefresh,
  showToast
}: {
  service: SearchServiceSummary
  onRefresh(): Promise<void>
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(service.enabled)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => setEnabled(service.enabled), [service.enabled])

  async function save(): Promise<void> {
    if (!service.hasApiKey && !apiKey.trim()) {
      showToast({ type: 'error', message: '首次配置豆包搜索需要 API Key' })
      return
    }
    setSaving(true)
    try {
      await window.moliu.searchService.save({ apiKey: apiKey.trim() || undefined, enabled })
      setApiKey('')
      await onRefresh()
      showToast({ type: 'success', message: '豆包搜索 API Key 已加密保存' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function test(): Promise<void> {
    setTesting(true)
    setStatus('正在执行一次最小搜索…')
    try {
      const result = await window.moliu.searchService.test()
      setStatus(`${result.message} · ${result.latencyMs}ms`)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="search-service-panel panel">
      <div className="section-heading">
        <div><span className="eyebrow">SEARCH SERVICE</span><h3>豆包搜索 Custom 版</h3></div>
        <span className={`status-pill ${service.enabled && service.hasApiKey ? 'success' : ''}`}>
          {service.enabled && service.hasApiKey ? '可用' : '未就绪'}
        </span>
      </div>
      <p>用于素材库的网页和图片搜索；密钥只在主进程调用时短暂解密。</p>
      <div className="search-service-fields">
        <label className="field">
          <span>API Key {service.hasApiKey && <em>留空表示不修改</em>}</span>
          <input type="password" name="searchApiKey" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={service.hasApiKey ? '••••••••••••••••' : '请粘贴豆包搜索 API Key…'} />
        </label>
        <label className="switch-row">
          <input type="checkbox" name="searchEnabled" autoComplete="off" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span><strong>启用搜索服务</strong><small>停用后素材搜索入口不可用</small></span>
        </label>
      </div>
      <footer>
        <span>{status || '测试连接会消耗 1\u00A0次豆包搜索额度'}</span>
        <button className="button secondary" disabled={!service.hasApiKey || testing} onClick={() => void test()}>{testing ? <span className="spinner tiny" /> : <Zap size={15} />}测试连接</button>
        <button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? <span className="spinner tiny" /> : <ShieldCheck size={15} />}加密保存</button>
      </footer>
    </section>
  )
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
