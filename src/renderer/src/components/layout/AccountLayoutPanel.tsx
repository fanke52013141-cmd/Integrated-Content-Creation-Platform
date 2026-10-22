import { useEffect, useMemo, useState } from 'react'
import type { AccountLayoutDraft, AccountLayoutVersion, Article, LayoutPreviewResult, LayoutStyleConfig, LayoutThemeInfo } from '../../../../shared/contracts'
import { DEFAULT_STYLE_CONFIG, normalizeStyleConfig, sameStyleConfig } from '../../../../shared/layout-config'
import { errorMessage, formatFullDate, markdownTitle } from '../../lib'
import type { ToastState } from '../Toast'
import { useConfirm } from '../useConfirm'
import { LayoutStyleFields } from './LayoutStyleFields'
import { layoutPreviewDocument } from './preview-document'

interface EditingLayout {
  themeId: string
  styleConfig: LayoutStyleConfig
  customCss: string
  baseVersionId: string | null
}
interface WorkingCopy extends EditingLayout { revision: number }

function sameEditing(left: EditingLayout, right: EditingLayout): boolean {
  return left.themeId === right.themeId && left.customCss === right.customCss && left.baseVersionId === right.baseVersionId && sameStyleConfig(left.styleConfig, right.styleConfig)
}

function readWorkingCopy(key: string): WorkingCopy | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as WorkingCopy | null
    if (!value || typeof value.themeId !== 'string' || !value.styleConfig || typeof value.styleConfig !== 'object' || typeof value.customCss !== 'string' || !Number.isInteger(value.revision) || !(value.baseVersionId === null || typeof value.baseVersionId === 'string')) return null
    return value
  } catch { return null }
}

function clearWorkingCopy(key: string): void {
  try { sessionStorage.removeItem(key) } catch { /* 浏览器存储不可用时不影响数据库草稿 */ }
}

export function AccountLayoutPanel({ accountId, accountName, showToast, onDirtyChange }: {
  accountId: string
  accountName: string
  showToast(toast: ToastState): void
  onDirtyChange(dirty: boolean): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [busy, setBusy] = useState(false)
  const [themes, setThemes] = useState<LayoutThemeInfo[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [active, setActive] = useState<AccountLayoutVersion | null>(null)
  const [versions, setVersions] = useState<AccountLayoutVersion[]>([])
  const [draft, setDraft] = useState<AccountLayoutDraft | null>(null)
  const [themeId, setThemeId] = useState('wechat-green')
  const [styleConfig, setStyleConfig] = useState<LayoutStyleConfig>(DEFAULT_STYLE_CONFIG)
  const [customCss, setCustomCss] = useState('')
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null)
  const [saved, setSaved] = useState<EditingLayout | null>(null)
  const [recovery, setRecovery] = useState<WorkingCopy | null>(null)
  const [previewSource, setPreviewSource] = useState('sample')
  const [deviceWidth, setDeviceWidth] = useState(375)
  const [preview, setPreview] = useState<LayoutPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const storageKey = `moliu:account-layout-working:${accountId}:wechat`
  const editing = useMemo(() => ({ themeId, styleConfig, customCss, baseVersionId }), [themeId, styleConfig, customCss, baseVersionId])
  const dirty = !loading && Boolean(saved && !sameEditing(saved, editing))
  const baselineChanged = !loading && baseVersionId !== (active?.id ?? null)
  const canActivate = !active || active.themeId !== themeId || (active.customCss ?? '') !== customCss || !sameStyleConfig(active.styleConfig, styleConfig)

  function applyEditing(value: EditingLayout): void {
    setThemeId(value.themeId)
    setStyleConfig(normalizeStyleConfig(value.styleConfig))
    setCustomCss(value.customCss)
    setBaseVersionId(value.baseVersionId)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    setPreview(null)
    void Promise.all([
      window.moliu.layouts.themes(),
      window.moliu.layouts.getAccountDefault(accountId, 'wechat'),
      window.moliu.layouts.listAccountVersions(accountId, 'wechat'),
      window.moliu.layouts.getAccountDraft(accountId, 'wechat'),
      window.moliu.articles.list()
    ]).then(([nextThemes, current, history, nextDraft, nextArticles]) => {
      if (cancelled) return
      setThemes(nextThemes)
      setActive(current)
      setVersions(history)
      setDraft(nextDraft)
      setArticles(nextArticles.filter((article) => article.accountId === accountId))
      const source = nextDraft ?? current
      const initial: EditingLayout = { themeId: source?.themeId ?? 'wechat-green', styleConfig: normalizeStyleConfig(source?.styleConfig), customCss: source?.customCss ?? '', baseVersionId: nextDraft ? nextDraft.baseVersionId : current?.id ?? null }
      setSaved(initial)
      const local = readWorkingCopy(storageKey)
      if (local && local.revision === (nextDraft?.revision ?? 0)) {
        applyEditing(local)
        setRecovery(null)
      } else {
        applyEditing(initial)
        setRecovery(local)
      }
    }).catch((error) => { if (!cancelled) setLoadError(errorMessage(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, reloadToken])

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (loading || loadError) return
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ ...editing, revision: draft?.revision ?? 0 }))
      else if (!recovery) sessionStorage.removeItem(storageKey)
    } catch { /* 显式保存草稿仍使用主进程存储 */ }
    const preventExit = (event: BeforeUnloadEvent): void => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', preventExit)
    return () => window.removeEventListener('beforeunload', preventExit)
  }, [loading, loadError, dirty, editing, draft?.revision, recovery, storageKey])

  useEffect(() => {
    if (loading || loadError) return
    let cancelled = false
    setPreviewLoading(true)
    const timer = window.setTimeout(() => {
      const input = { platform: 'wechat' as const, themeId, styleConfig, customCss }
      const pending = previewSource === 'sample'
        ? window.moliu.layouts.previewSample(input)
        : window.moliu.layouts.previewArticle({ ...input, articleId: previewSource })
      void pending.then((result) => {
        if (cancelled) return
        setPreview(result)
        setPreviewError('')
      }).catch((error) => { if (!cancelled) setPreviewError(errorMessage(error)) })
        .finally(() => { if (!cancelled) setPreviewLoading(false) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [loading, loadError, themeId, styleConfig, customCss, previewSource])

  async function persistDraft(): Promise<AccountLayoutDraft> {
    const result = await window.moliu.layouts.saveAccountDraft({ accountId, platform: 'wechat', themeId, styleConfig, customCss: customCss || undefined, baseVersionId, expectedRevision: draft?.revision ?? 0 })
    setDraft(result)
    setSaved(editing)
    setRecovery(null)
    return result
  }

  async function saveDraft(): Promise<void> {
    setBusy(true)
    try { await persistDraft(); showToast({ type: 'success', message: '版式草稿已保存，后续文章仍沿用当前启用版本' }) }
    catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  async function activate(): Promise<void> {
    setBusy(true)
    try {
      const target = dirty || !draft ? await persistDraft() : draft
      const version = await window.moliu.layouts.activateAccountDraft(accountId, 'wechat', target.revision)
      clearWorkingCopy(storageKey)
      setRecovery(null)
      setReloadToken((value) => value + 1)
      showToast({ type: 'success', message: `「${accountName}」公众号版式 V${version.versionNumber} 已启用，后续新排版稿自动套用` })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
      try { setActive(await window.moliu.layouts.getAccountDefault(accountId, 'wechat')) } catch { /* 保留当前编辑，仍可手动重读 */ }
    }
    finally { setBusy(false) }
  }

  async function reload(): Promise<void> {
    if (dirty && !(await confirm({ title: '重新读取版式？', message: '当前未保存参数将被放弃，已保存草稿和启用版本会重新读取。', confirmLabel: '重新读取' }))) return
    clearWorkingCopy(storageKey)
    setReloadToken((value) => value + 1)
  }

  async function updateBase(): Promise<void> {
    setBusy(true)
    try {
      const [current, history] = await Promise.all([window.moliu.layouts.getAccountDefault(accountId, 'wechat'), window.moliu.layouts.listAccountVersions(accountId, 'wechat')])
      setActive(current)
      setVersions(history)
      setBaseVersionId(current?.id ?? null)
      showToast({ type: 'success', message: '已更新启用基准并保留当前编辑参数，请检查预览后启用' })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  async function importPreset(): Promise<void> {
    if (dirty && !(await confirm({ title: '载入版式包？', message: '将替换当前未保存参数，账号已启用版本不会立即改变。', confirmLabel: '选择版式包' }))) return
    setBusy(true)
    try {
      const bundle = await window.moliu.app.importLayoutPreset()
      if (!bundle) return
      applyEditing({ themeId: bundle.themeId, styleConfig: bundle.styleConfig, customCss: '', baseVersionId: active?.id ?? null })
      setRecovery(null)
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  async function exportPreset(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.moliu.app.exportLayoutPreset({ themeId, styleConfig })
      if (result.path) showToast({ type: 'success', message: `版式包已导出：${result.path}` })
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  async function loadVersion(version: AccountLayoutVersion): Promise<void> {
    if (dirty && !(await confirm({ title: '载入历史版式？', message: '将替换当前未保存参数。启用时会创建新版本，历史稿保持原样。', confirmLabel: '载入参数' }))) return
    applyEditing({ themeId: version.themeId, styleConfig: version.styleConfig, customCss: version.customCss ?? '', baseVersionId: active?.id ?? null })
  }

  if (loading) return <section className="panel"><p>正在读取公众号版式…</p></section>
  if (loadError) return <section className="panel"><p role="alert">读取版式失败：{loadError}</p><button className="button secondary" onClick={() => setReloadToken((value) => value + 1)}>重试</button></section>

  return <section className="account-layout-panel">
    <header className="account-layout-heading">
      <div><h3>{accountName} · 公众号固定版式</h3><p className="micro-copy">{active ? `当前启用 V${active.versionNumber} · ${formatFullDate(active.createdAt)}` : '尚未启用专属版式，文章暂用系统默认主题'}{dirty ? ' · 有未保存编辑' : draft ? ' · 编辑草稿已保存' : ''}</p></div>
      <div className="layout-style-actions">
        <button className="button ghost compact" disabled={busy} onClick={() => void reload()}>重新读取</button>
        <button className="button secondary compact" disabled={busy || (!dirty && Boolean(draft))} onClick={() => void saveDraft()}>保存草稿</button>
        <button className="button primary compact" disabled={busy || !canActivate || baselineChanged} onClick={() => void activate()}>{busy ? '正在保存…' : '启用为新版本'}</button>
      </div>
    </header>
    {baselineChanged && <div className="account-layout-notice" role="status"><span>编辑草稿基于旧版式。更新基准会保留当前参数，再启用时创建新版本。</span><button className="button secondary compact" disabled={busy} onClick={() => void updateBase()}>更新启用基准</button></div>}
    {recovery && <div className="account-layout-notice"><span>本窗口有一份未保存编辑，与已保存草稿版本不同。</span><button className="button secondary compact" disabled={busy} onClick={() => { applyEditing(recovery); setRecovery(null) }}>恢复本窗口编辑</button></div>}
    <div className="account-layout-designer">
      <div className="panel account-layout-controls">
        <label className="field"><span>基础主题</span><select value={themeId} disabled={busy} onChange={(event) => setThemeId(event.target.value)}>{themeId === 'custom' && <option value="custom">已有高级 CSS 主题</option>}{themes.map((theme) => <option value={theme.id} key={theme.id}>{theme.name}</option>)}</select></label>
        {customCss && <p className="micro-copy">已保留此版本的高级 CSS；结构化版式包暂不包含这部分规则。</p>}
        <LayoutStyleFields value={styleConfig} onChange={setStyleConfig} disabled={busy} platform="wechat" themes={themes} themeId={themeId} />
        <div className="layout-style-actions"><button className="button ghost compact" disabled={busy} onClick={() => void importPreset()}>导入版式包</button><button className="button ghost compact" disabled={busy || Boolean(customCss) || themeId === 'custom'} title={customCss ? '当前含高级 CSS，暂不支持完整导出' : undefined} onClick={() => void exportPreset()}>导出当前参数</button></div>
        <p className="micro-copy">保存草稿可跨重启继续编辑；启用后仅影响新生成的排版稿。账号画像锁定与版式版本独立管理。</p>
        <details className="account-layout-history"><summary>已启用版本历史 · {versions.length}</summary>{versions.map((version) => <div className="layout-style-history-row" key={version.id}><span><strong>V{version.versionNumber}{version.id === active?.id ? ' · 当前启用' : ''}</strong><small>{formatFullDate(version.createdAt)}</small></span><button className="button ghost compact" disabled={busy} onClick={() => void loadVersion(version)}>载入参数</button></div>)}</details>
      </div>
      <div className="panel account-layout-preview">
        <div className="account-layout-preview-options">
          <label className="field"><span>预览内容</span><select value={previewSource} onChange={(event) => setPreviewSource(event.target.value)}><option value="sample">标准组件样稿</option>{articles.map((article) => <option value={article.id} key={article.id}>{markdownTitle(article.rawMarkdown)}</option>)}</select></label>
          <label className="field"><span>近似设备宽度</span><select value={deviceWidth} onChange={(event) => setDeviceWidth(Number(event.target.value))}><option value={320}>窄屏 320px</option><option value={375}>标准 375px</option><option value={430}>宽屏 430px</option></select></label>
        </div>
        <p className="micro-copy" role="status">{previewLoading ? '正在更新预览…' : previewError ? '当前参数未能生成预览' : '预览不保存正式排版稿；实际微信效果仍需粘贴和实机验收。'}</p>
        {previewError && <p className="account-layout-error" role="alert">{previewError}</p>}
        {preview && <div className="layout-device" style={{ width: deviceWidth }}><iframe className="layout-preview-frame" title={`${accountName}公众号版式设计预览`} sandbox="allow-same-origin" srcDoc={layoutPreviewDocument(preview.html)} /></div>}
      </div>
    </div>
    {ConfirmPortal}
  </section>
}
