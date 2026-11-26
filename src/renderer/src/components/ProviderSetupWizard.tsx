import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Image,
  KeyRound,
  LoaderCircle,
  Search,
  Sparkles,
  WandSparkles,
  X
} from 'lucide-react'
import type { ProviderModelKind, ProviderPreset, SaveProviderInput } from '../../../shared/contracts'
import { ModalBase } from './ModalBase'
import { Select } from './Select'
import type { ToastState } from './Toast'
import { errorMessage } from '../lib'

type ScenarioId = 'writing' | 'complete' | 'visual'
type ProviderKind = Extract<ProviderModelKind, 'text' | 'search' | 'image'>

interface ProviderDraft {
  presetId: string
  displayName: string
  baseUrl: string
  apiKey: string
  modelId: string
}

const SCENARIOS: Array<{ id: ScenarioId; title: string; description: string; icon: typeof Sparkles; kinds: ProviderKind[] }> = [
  { id: 'writing', title: '只写作', description: '配置文本模型，覆盖账号、选题、框架、文章与评审', icon: Sparkles, kinds: ['text'] },
  { id: 'complete', title: '完整创作', description: '文本 + 搜索 + 生图，一次配齐资料收集与 AI 配图', icon: WandSparkles, kinds: ['text', 'search', 'image'] },
  { id: 'visual', title: '写作 + 配图', description: '文本 + 生图，适合自己找资料、需要 AI 出图的场景', icon: Image, kinds: ['text', 'image'] }
]

const KIND_META: Record<ProviderKind, { title: string; description: string; icon: typeof Sparkles }> = {
  text: { title: '文本模型', description: '用于账号定位、选题、框架、文章、评审与配图方案', icon: Sparkles },
  search: { title: '搜索模型', description: '用于素材库联网搜索与框架深度预研', icon: Search },
  image: { title: '生图模型', description: '用于智能配图与封面生成', icon: Image }
}

function presetKind(preset: ProviderPreset): ProviderKind {
  return preset.modelKind ?? 'text'
}

function presetsForKind(presets: ProviderPreset[], kind: ProviderKind): ProviderPreset[] {
  return presets.filter((preset) => presetKind(preset) === kind)
}

function defaultPresetId(presets: ProviderPreset[], kind: ProviderKind): string {
  const candidates = presetsForKind(presets, kind)
  const preferred = kind === 'text' ? 'deepseek' : kind === 'search' ? 'doubao-search' : 'toapis'
  return candidates.find((preset) => preset.id === preferred)?.id ?? candidates[0]?.id ?? ''
}

function draftFromPreset(preset?: ProviderPreset): ProviderDraft {
  return {
    presetId: preset?.id ?? '',
    displayName: preset?.displayName ?? '',
    baseUrl: preset?.baseUrl ?? '',
    apiKey: '',
    modelId: preset?.defaultModel ?? ''
  }
}

export function ProviderSetupWizard({ open, onClose, onSaved, showToast }: {
  open: boolean
  onClose(): void
  onSaved(): Promise<void>
  showToast(toast: ToastState): void
}): React.JSX.Element | null {
  const [presets, setPresets] = useState<ProviderPreset[]>([])
  const [scenario, setScenario] = useState<ScenarioId>('complete')
  const [step, setStep] = useState(0)
  const [drafts, setDrafts] = useState<Record<ProviderKind, ProviderDraft>>({
    text: draftFromPreset(),
    search: draftFromPreset(),
    image: draftFromPreset()
  })
  const [loading, setLoading] = useState(false)
  const [savingKind, setSavingKind] = useState<ProviderKind>()
  const [savedKinds, setSavedKinds] = useState<Set<ProviderKind>>(new Set())
  const [error, setError] = useState('')

  const kinds = SCENARIOS.find((item) => item.id === scenario)?.kinds ?? ['text']
  const reviewStep = kinds.length + 1

  const initialize = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const nextPresets = await window.moliu.providers.presets()
      setPresets(nextPresets)
      setDrafts({
        text: draftFromPreset(nextPresets.find((preset) => preset.id === defaultPresetId(nextPresets, 'text'))),
        search: draftFromPreset(nextPresets.find((preset) => preset.id === defaultPresetId(nextPresets, 'search'))),
        image: draftFromPreset(nextPresets.find((preset) => preset.id === defaultPresetId(nextPresets, 'image')))
      })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setStep(0)
    setSavedKinds(new Set())
    setSavingKind(undefined)
    void initialize()
  }, [open, initialize])

  const currentKind = step > 0 && step <= kinds.length ? kinds[step - 1] : undefined
  const currentPreset = presets.find((preset) => preset.id === drafts[currentKind ?? 'text'].presetId)
  const currentDraft = drafts[currentKind ?? 'text']

  function updateDraft(kind: ProviderKind, patch: Partial<ProviderDraft>): void {
    setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }))
    setSavedKinds((current) => {
      const next = new Set(current)
      next.delete(kind)
      return next
    })
  }

  function choosePreset(kind: ProviderKind, presetId: string): void {
    const preset = presets.find((item) => item.id === presetId)
    updateDraft(kind, draftFromPreset(preset))
  }

  const canContinue = useMemo(() => {
    if (step === 0) return true
    if (currentKind) {
      const draft = drafts[currentKind]
      const preset = presets.find((item) => item.id === draft.presetId)
      if (!draft.displayName.trim() || !draft.modelId.trim()) return false
      if (preset?.accessMode !== 'dreamina-cli' && (!draft.baseUrl.trim() || !draft.apiKey.trim())) return false
      return true
    }
    return true
  }, [step, currentKind, drafts, presets])

  async function saveAll(): Promise<void> {
    setError('')
    try {
      for (const kind of kinds) {
        if (savedKinds.has(kind)) continue
        const draft = drafts[kind]
        const preset = presets.find((item) => item.id === draft.presetId)
        setSavingKind(kind)
        const input: SaveProviderInput = {
          displayName: draft.displayName.trim(),
          protocol: 'openai-compatible',
          accessMode: preset?.accessMode,
          baseUrl: preset?.accessMode === 'dreamina-cli' ? '' : draft.baseUrl.trim(),
          defaultModel: draft.modelId.trim(),
          enabled: true,
          isRelay: preset?.id === 'relay',
          capabilities: {
            chat: kind === 'text',
            jsonMode: kind === 'text',
            streaming: false,
            vision: false,
            image: kind === 'image'
          },
          models: [{
            modelId: draft.modelId.trim(),
            displayName: draft.modelId.trim(),
            kind,
            reasoningVariants: [],
            isDefault: true,
            enabled: true,
            params: preset?.modelParams
          }],
          apiKey: preset?.accessMode === 'dreamina-cli' ? undefined : draft.apiKey.trim() || undefined
        }
        await window.moliu.providers.testAndSave(input)
        setSavedKinds((current) => new Set([...current, kind]))
      }
      await onSaved()
      showToast({ type: 'success', message: '场景式配置完成，所需模型已测试并加密保存' })
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSavingKind(undefined)
    }
  }

  if (!open) return null

  return (
    <ModalBase open onClose={() => { if (!savingKind) onClose() }} titleId="provider-wizard-title" className="provider-wizard" scrollBody>
      <header className="provider-wizard-head">
        <div><span className="eyebrow">SCENARIO SETUP</span><h2 id="provider-wizard-title">场景式配置向导</h2><p>按创作场景一次配齐文本、搜索与生图模型</p></div>
        <button className="icon-button" aria-label="关闭配置向导" disabled={Boolean(savingKind)} onClick={onClose}><X size={20} /></button>
      </header>

      <div className="wizard-progress" aria-label="配置进度">
        {Array.from({ length: reviewStep + 1 }, (_, index) => <span key={index} className={index <= step ? 'active' : ''} />)}
      </div>

      <div className="provider-wizard-body">
        {loading ? <div className="wizard-loading"><LoaderCircle size={22} className="spin" />正在读取供应商预设…</div> : (
          <>
            {step === 0 && (
              <section className="wizard-scenario-grid">
                {SCENARIOS.map((item) => {
                  const Icon = item.icon
                  return (
                    <button key={item.id} className={`wizard-scenario-card ${scenario === item.id ? 'active' : ''}`} onClick={() => { setScenario(item.id); setSavedKinds(new Set()) }}>
                      <span className="wizard-scenario-icon"><Icon size={22} /></span>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                      <small>{item.kinds.map((kind) => KIND_META[kind].title).join(' + ')}</small>
                      {scenario === item.id && <Check size={18} />}
                    </button>
                  )
                })}
              </section>
            )}

            {currentKind && (() => {
              const meta = KIND_META[currentKind]
              const Icon = meta.icon
              const options = presetsForKind(presets, currentKind)
              const isCli = currentPreset?.accessMode === 'dreamina-cli'
              return (
                <section className="wizard-provider-step">
                  <div className="wizard-step-title"><span><Icon size={20} /></span><div><h3>{meta.title}</h3><p>{meta.description}</p></div></div>
                  <label className="field"><span>供应商预设</span><Select value={currentDraft.presetId} onChange={(value) => choosePreset(currentKind, value)} options={options.map((preset) => ({ value: preset.id, label: preset.displayName, hint: preset.defaultModel }))} ariaLabel={`${meta.title}供应商预设`} /></label>
                  <div className="wizard-form-grid">
                    <label className="field"><span>显示名称</span><input value={currentDraft.displayName} onChange={(event) => updateDraft(currentKind, { displayName: event.target.value })} placeholder="例如：DeepSeek 写作" /></label>
                    <label className="field"><span>模型标识</span><input value={currentDraft.modelId} onChange={(event) => updateDraft(currentKind, { modelId: event.target.value })} placeholder="与服务商文档一致" /></label>
                    {!isCli && <><label className="field"><span>接口地址</span><input value={currentDraft.baseUrl} onChange={(event) => updateDraft(currentKind, { baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label><label className="field"><span>API Key</span><input type="password" value={currentDraft.apiKey} onChange={(event) => updateDraft(currentKind, { apiKey: event.target.value })} placeholder="sk-…" autoComplete="off" /></label></>}
                  </div>
                  {isCli && <p className="inline-alert"><KeyRound size={16} />即梦使用本机 CLI 登录态，无需 Base URL 与 API Key；保存时会检测 CLI 状态。</p>}
                  <p className="micro-copy">点击下一步后会测试连接，测试通过才会加密保存。</p>
                </section>
              )
            })()}

            {step === reviewStep && (
              <section className="wizard-review">
                <h3>确认配置</h3>
                {kinds.map((kind) => {
                  const draft = drafts[kind]
                  const Icon = KIND_META[kind].icon
                  return <div key={kind} className="wizard-review-row"><span>{savedKinds.has(kind) ? <CheckCircle2 size={18} /> : <Icon size={18} />}</span><div><strong>{KIND_META[kind].title}</strong><small>{draft.displayName} · {draft.modelId}</small></div><em>{savedKinds.has(kind) ? '已保存' : '待测试并保存'}</em></div>
                })}
                <p className="micro-copy">文本模型用于生成内容，搜索模型用于联网资料，生图模型用于配图。生图调用可能产生费用。</p>
              </section>
            )}

            {error && <p className="inline-alert danger" role="alert">{error}</p>}
          </>
        )}
      </div>

      <footer className="provider-wizard-footer">
        <button className="button secondary" disabled={Boolean(savingKind)} onClick={() => step === 0 ? onClose() : setStep((current) => current - 1)}><ArrowLeft size={16} />{step === 0 ? '取消' : '上一步'}</button>
        <span />
        {step < reviewStep ? (
          <button className="button primary" disabled={loading || !canContinue || Boolean(savingKind)} onClick={() => setStep((current) => current + 1)}>下一步<ArrowRight size={16} /></button>
        ) : (
          <button className="button primary" disabled={Boolean(savingKind) || savedKinds.size === kinds.length} onClick={() => void saveAll()}>
            {savingKind ? <LoaderCircle size={16} className="spin" /> : <WandSparkles size={16} />}
            {savingKind ? `正在测试并保存${KIND_META[savingKind].title}…` : savedKinds.size === kinds.length ? '配置已完成' : '测试并保存全部'}
          </button>
        )}
      </footer>
    </ModalBase>
  )
}
