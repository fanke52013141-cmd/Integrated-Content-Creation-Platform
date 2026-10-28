import { useEffect, useMemo, useState } from 'react'
import { Code2, Copy, FileDown, FileText, FileUp, Save, Send, Smartphone, Trash2 } from 'lucide-react'
import type { AccountLayoutVersion, AccountProfileSummary, LayoutPreviewResult, LayoutStyleConfig, ArticleGenre, ArticleLayout, ArticleSummary, LayoutPlatform, LayoutThemeInfo } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useSelectedArticle } from '../hooks/useSelectedArticle'
import { ArticlePicker } from '../components/ArticlePicker'
import { Select } from '../components/Select'
import { ImportDialog } from '../components/ImportDialog'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { SourceBadge } from '../components/SourceBadge'
import { EmptyState } from '../components/EmptyState'
import { useConfirm } from '../components/useConfirm'
import { errorMessage, formatDate, formatTimedDate, markdownTitle } from '../lib'
import { disambiguateOptions, resolveLayoutSelection } from '../../../shared/creation-state'
import { useReportWork } from '../active-work'
import { useWorkDraft } from '../hooks/useWorkDraft'
import { SavedVersionGate } from '../components/SavedVersionGate'
import { LayoutStyleFields } from '../components/layout/LayoutStyleFields'
import { layoutPreviewDocument } from '../components/layout/preview-document'
import { DEFAULT_STYLE_CONFIG, normalizeStyleConfig, sameStyleConfig } from '../../../shared/layout-config'

const platformNames: Record<LayoutPlatform, string> = { wechat: '微信公众号', xiaohongshu: '小红书', web: '通用网页' }

/** 文章类型的中文名。用于把主题的 suitedFor（英文 id）显示为可读文字 */
const genreLabels: Record<ArticleGenre, string> = {
  tutorial: '教程攻略',
  analysis: '深度分析',
  narrative: '叙事随笔',
  professional: '专业科技',
  listicle: '清单盘点'
}
const platformHints: Record<LayoutPlatform, string> = { wechat: '可直接推送草稿箱', xiaohongshu: '纯文本，复制使用', web: '通用网页样式' }
/** 各平台标题字数上限（0 = 不限） */
const titleLimits: Record<LayoutPlatform, number> = { wechat: 64, xiaohongshu: 20, web: 0 }


export function LayoutsPage({ onNavigate, focusArticleId, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [accounts, setAccounts] = useState<AccountProfileSummary[]>([])
  const [layouts, setLayouts] = useState<ArticleLayout[]>([])
  const [themes, setThemes] = useState<LayoutThemeInfo[]>([])
  const [accountLayout, setAccountLayout] = useState<AccountLayoutVersion | null>(null)
  const [accountLayoutVersions, setAccountLayoutVersions] = useState<AccountLayoutVersion[]>([])
  const [styleConfig, setStyleConfig] = useState<LayoutStyleConfig>(DEFAULT_STYLE_CONFIG)
  const [customCss, setCustomCss] = useState('')
  const [accountLayoutLoading, setAccountLayoutLoading] = useState(false)
  const [articleId, setArticleId] = useState('')
  const [platform, setPlatform] = useState<LayoutPlatform>('wechat')
  const [themeId, setThemeId] = useState('wechat-green')
  /** 文章类型。选中后自动推荐主题，把"选色块"变成"选内容类型" */
  const [genre, setGenre] = useState<ArticleGenre | ''>('')
  const [genres, setGenres] = useState<Array<{ id: ArticleGenre; label: string; hint: string }>>([])
  const [selectedId, setSelectedId] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showingSamplePreview, setShowingSamplePreview] = useState(false)
  const [samplePreview, setSamplePreview] = useState<LayoutPreviewResult | null>(null)
  const [samplePreviewLoading, setSamplePreviewLoading] = useState(false)

  // 选中态始终限定在当前文章的排版稿集合内：切文章不会出现侧栏是 B、预览是 A
  const effectiveSelectedId = useMemo(() => resolveLayoutSelection(layouts, articleId, selectedId), [layouts, articleId, selectedId])
  const selected = layouts.find((item) => item.id === effectiveSelectedId)
  const articleLayouts = useMemo(() => layouts.filter((item) => item.articleId === articleId), [layouts, articleId])
  const { article, error: selectionError } = useSelectedArticle(articleId, articles)
  const accountName = accounts.find((item) => item.id === article?.accountId)?.name
  const selectedThemeName = themes.find((item) => item.id === themeId)?.name ?? themeId

  const workDraft = useWorkDraft(article?.id ?? '', article?.rawMarkdown ?? '', article?.currentVersionId ?? '')
  const needsSavedVersion = workDraft.dirty || workDraft.status !== 'saved'
  useReportWork(article ? {
    articleId: article.id,
    title: markdownTitle(article.rawMarkdown),
    accountId: article.accountId,
    versionCount: article.versionCount,
    status: article.status, savedMarkdown: article.rawMarkdown, currentVersionId: article.currentVersionId
  } : {}, 'layouts')

  const refresh = async (): Promise<void> => {
    const [nextArticles, nextLayouts, nextAccounts] = await Promise.all([window.moliu.articles.listSummaries({ limit: 30 }).then(result => result.items), window.moliu.layouts.list(), window.moliu.accounts.list()])
    setArticles(nextArticles)
    setLayouts(nextLayouts)
    setAccounts(nextAccounts)
    setArticleId((current) => {
      if (focusArticleId) return focusArticleId
      if (current) return current
      const locked = nextArticles.find((item) => item.status === 'locked')
      return locked?.id ?? (focusArticleId && nextArticles.some(item => item.id === focusArticleId) ? focusArticleId : nextArticles[0]?.id) ?? ''
    })
    setSelectedId((current) => nextLayouts.some((item) => item.id === current) ? current : nextLayouts[0]?.id ?? '')
  }

  /**
   * 把受控的选中 ID 也立即收敛到新文章，不能只依赖渲染时的派生值。
   * 这样后续删除、发布等操作即使新增回调，也不会意外沿用上一篇文章的 ID。
   */
  const selectArticle = (nextArticleId: string): void => {
    setShowingSamplePreview(false)
    setArticleId(nextArticleId)
    setSelectedId((current) => resolveLayoutSelection(layouts, nextArticleId, current))
  }

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [focusArticleId])
  useEffect(() => { if (focusArticleId) setArticleId(focusArticleId) }, [focusArticleId])
  useEffect(() => {
    void window.moliu.layouts.themes().then(setThemes).catch(() => undefined)
    void window.moliu.layouts.genres().then(setGenres).catch(() => undefined)
  }, [])

  /** 当前主题的完整信息，用于展示"为什么推荐它" */
  const selectedTheme = themes.find((theme) => theme.id === themeId)
  useEffect(() => {
    if (!showingSamplePreview) {
      setSamplePreviewLoading(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSamplePreviewLoading(true)
      void window.moliu.layouts.previewSample({ platform, themeId, styleConfig, customCss: customCss || undefined })
        .then((result) => { if (!cancelled) setSamplePreview(result) })
        .catch((error) => {
          if (cancelled) return
          setShowingSamplePreview(false)
          showToast({ type: 'error', message: `标准样稿预览失败：${errorMessage(error)}` })
        })
        .finally(() => { if (!cancelled) setSamplePreviewLoading(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [showingSamplePreview, platform, themeId, styleConfig, customCss])
  useEffect(() => {
    let cancelled = false
    setAccountLayout(null)
    setAccountLayoutVersions([])
    if (!article?.accountId) {
      setAccountLayoutLoading(false)
      setAccountLayoutVersions([])
      setThemeId('wechat-green')
      setStyleConfig(DEFAULT_STYLE_CONFIG)
      setCustomCss('')
      return () => { cancelled = true }
    }
    setAccountLayoutLoading(true)
    void Promise.all([
      window.moliu.layouts.getAccountDefault(article.accountId, platform),
      window.moliu.layouts.listAccountVersions(article.accountId, platform)
    ])
      .then(([binding, versions]) => {
        if (cancelled) return
        setAccountLayout(binding)
        setAccountLayoutVersions(versions)
        setThemeId(binding?.themeId ?? 'wechat-green')
        setStyleConfig(normalizeStyleConfig(binding?.styleConfig))
        setCustomCss(binding?.customCss ?? '')
      })
      .catch((error) => {
        if (!cancelled) showToast({ type: 'error', message: `读取账号默认版式失败：${errorMessage(error)}` })
      })
      .finally(() => { if (!cancelled) setAccountLayoutLoading(false) })
    return () => { cancelled = true }
  }, [article?.accountId, platform])

  const create = async (): Promise<void> => {
    if (!articleId) return
    setBusy(true)
    try {
      const useAccountDefault = Boolean(accountLayout && accountLayout.themeId === themeId && (accountLayout.customCss ?? '') === customCss && sameStyleConfig(accountLayout.styleConfig, styleConfig))
      const item = await window.moliu.layouts.create({
        articleId,
        platform,
        ...(platform !== 'xiaohongshu' && !useAccountDefault ? { themeId, styleConfig, customCss } : {})
      })
      await refresh()
      setSelectedId(item.id)
      // 平台合规校验结果随排版稿返回：生成成功不等于发出去不丢格式，
      // 这里如实告知问题数量，让用户在推送前就知道该不该改。
      const violations = item.violations ?? []
      const errors = violations.filter((violation) => violation.level === 'error')
      const warns = violations.filter((violation) => violation.level === 'warn')
      if (errors.length) {
        showToast({
          type: 'error',
          message: `排版稿已生成，但有 ${errors.length} 个问题会导致公众号丢格式：${errors.map((violation) => violation.message).join('；')}`
        })
      } else if (warns.length) {
        showToast({
          type: 'warning',
          message: `排版稿已生成，另有 ${warns.length} 个提醒：${warns.map((violation) => violation.message).join('；')}`
        })
      } else {
        showToast({ type: 'success', message: `${platformNames[platform]}排版稿已生成` })
      }
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const saveAccountDefault = async (): Promise<void> => {
    if (!article?.accountId || platform === 'xiaohongshu') return
    setBusy(true)
    try {
      const saved = await window.moliu.layouts.setAccountDefault({ accountId: article.accountId, platform, themeId, styleConfig, customCss: customCss || undefined, expectedVersionId: accountLayout?.id ?? null })
      setAccountLayout(saved)
      setAccountLayoutVersions((versions) => [saved, ...versions.filter((version) => version.id !== saved.id)])
      showToast({ type: 'success', message: `已将「${selectedThemeName}」保存为${accountName ? `「${accountName}」` : '当前账号'}的${platformNames[platform]}版式 V${saved.versionNumber}，后续文章将自动套用` })
    } catch (error) {
      showToast({ type: 'error', message: `保存账号默认版式失败：${errorMessage(error)}` })
    } finally {
      setBusy(false)
    }
  }

  const exportLayoutPreset = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.moliu.app.exportLayoutPreset({ themeId, styleConfig })
      showToast(result.path
        ? { type: 'success', message: `版式包已导出：${result.path}` }
        : { type: 'info', message: '已取消导出版式包' })
    } catch (error) {
      showToast({ type: 'error', message: `导出版式包失败：${errorMessage(error)}` })
    } finally {
      setBusy(false)
    }
  }

  const importLayoutPreset = async (): Promise<void> => {
    setBusy(true)
    try {
      const bundle = await window.moliu.app.importLayoutPreset()
      if (!bundle) {
        showToast({ type: 'info', message: '已取消导入' })
        return
      }
      setThemeId(bundle.themeId)
      setStyleConfig(normalizeStyleConfig(bundle.styleConfig))
      setCustomCss('')
      setSamplePreview(null)
      setShowingSamplePreview(true)
      showToast({ type: 'success', message: '版式包已载入编辑区；检查样稿后保存为账号新版式即可启用' })
    } catch (error) {
      showToast({ type: 'error', message: `导入版式包失败：${errorMessage(error)}` })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, message: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      showToast({ type: 'success', message })
    } catch (error) {
      showToast({ type: 'error', message: `复制失败：${errorMessage(error)}` })
    }
  }

  /** 带格式复制：由主进程同时写入 HTML 与纯文本，粘贴到公众号编辑器才保留样式 */
  const copyRich = async (mode: 'wechat' | 'placeholders'): Promise<void> => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const result = await window.moliu.clipboard.prepareLayout(selected.id, mode)
      showToast({ type: 'success', message: mode === 'wechat' ? `已复制图文，已准备 ${result.imageCount} 张本地图片，请粘贴后核对` : `已复制正文与 ${result.imageCount} 个图片占位，请在公众号后台插入图片` })
    } catch (error) {
      showToast({ type: 'error', message: `复制失败：${errorMessage(error)}` })
    } finally { setBusy(false) }
  }

  /** 导出单文件 HTML（图片内嵌，离线可读）；path 为 null 表示用户在保存框取消 */
  const exportHtml = async (item: ArticleLayout): Promise<void> => {
    try {
      const result = await window.moliu.app.exportLayout({ layoutId: item.id })
      if (result.path) showToast({ type: 'success', message: `已导出单文件 HTML：${result.path}` })
      else showToast({ type: 'info', message: '已取消导出' })
    } catch (error) {
      showToast({ type: 'error', message: `导出失败：${errorMessage(error)}` })
    }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    if (!(await confirm({ title: '删除排版稿？', message: '此操作不可撤销，已推送的公众号草稿不受影响。', danger: true, confirmLabel: '删除' }))) return
    try {
      await window.moliu.layouts.remove(selected.id)
      await refresh()
      showToast({ type: 'success', message: '排版稿已删除' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  return <div className="page layouts-page">
    <PageHeader
      route="layouts"
      onNavigate={onNavigate}
      title="文章排版"
      description="把成稿渲染为平台格式，直接推送公众号草稿箱"
      actions={articleId ? <button className="button secondary" onClick={() => setImportOpen(true)}><FileUp size={16} />导入 HTML</button> : undefined}
    />
    {selectionError && <p className="inline-alert" role="alert">{selectionError}</p>}
    <SavedVersionGate article={article} onSaved={refresh} onNavigate={onNavigate} />

    {!articles.length ? (
      <EmptyState
        icon={FileText}
        title="还没有可排版的文章"
        description="先在「文章创作」中生成文章，再来一键排版。"
        actionLabel="去写文章"
        onAction={() => onNavigate('articles')}
      />
    ) : (
      <>
        <section className="layout-composer">
          <label className="field"><span>文章</span>
            <ArticlePicker value={articleId} onChange={selectArticle} />
          </label>
          <label className="field"><span>平台</span>
            <Select value={platform} onChange={(value) => { setShowingSamplePreview(false); setPlatform(value as LayoutPlatform) }} ariaLabel="平台" options={(Object.keys(platformNames) as LayoutPlatform[]).map((key) => ({ value: key, label: platformNames[key], hint: platformHints[key] }))} />
          </label>
          <label className="field"><span>文章类型<em>用于推荐主题</em></span>
            <Select
              value={genre}
              onChange={(value) => {
                const next = value as ArticleGenre
                setGenre(next)
                // 按类型自动切到推荐主题，用户仍可手动改
                const matched = themes.find((theme) => theme.suitedFor.includes(next))
                if (matched) setThemeId(matched.id)
              }}
              ariaLabel="文章类型"
              placeholder="选择文章类型"
              options={genres.map((item) => ({ value: item.id, label: item.label, hint: item.hint }))}
            />
          </label>
          <label className="field"><span>主题<em>{platform === 'xiaohongshu' ? '（纯文本不适用）' : ''}</em></span>
            <Select
              value={themeId}
              onChange={setThemeId}
              ariaLabel="排版主题"
              disabled={platform === 'xiaohongshu'}
              options={(themes.length ? themes : []).map((theme) => ({
                value: theme.id,
                label: theme.name,
                // 提示里带上适合的文章类型与视觉性格，省得"选了个色块但不知道合不合适"
                hint: `${theme.personality}（适合${theme.suitedFor.map((g) => genreLabels[g] ?? g).join('、')}）`
              }))}
            />
          </label>
          {/* 当前主题的适配说明：把"为什么推荐它"讲清楚，而不是让用户猜 */}
          {platform !== 'xiaohongshu' && selectedTheme && (
            <p className="form-hint" role="note">
              {genre && selectedTheme.suitedFor.includes(genre)
                ? `已按「${genreLabels[genre] ?? genre}」推荐此主题：${selectedTheme.personality}`
                : `此主题${selectedTheme.suitedFor.length ? `适合${selectedTheme.suitedFor.map((g) => genreLabels[g] ?? g).join('、')}` : ''}：${selectedTheme.personality}`}
            </p>
          )}
          <button
            className="button primary"
            disabled={busy || !articleId || needsSavedVersion || accountLayoutLoading}
            onClick={() => void create()}
            title={!articleId ? '请先选择要排版的文章' : undefined}
          >
            <FileText size={16} />{busy ? '正在排版…' : '生成排版稿'}
          </button>
          {article?.accountId && platform !== 'xiaohongshu' && (
            <div className="layout-account-default">
              <span>{accountLayout
                ? `当前默认：${accountName ?? '此账号'} · ${themes.find((theme) => theme.id === accountLayout.themeId)?.name ?? accountLayout.themeId} · V${accountLayout.versionNumber}`
                : `${accountName ?? '此账号'}尚未设置公众号默认版式`}</span>
              <button className="button ghost compact" disabled={busy || accountLayoutLoading || (accountLayout?.themeId === themeId && (accountLayout.customCss ?? '') === customCss && sameStyleConfig(accountLayout.styleConfig, styleConfig))} onClick={() => void saveAccountDefault()}>
                <Save size={14} />{accountLayout ? '将当前设置设为新版式' : `设为${platformNames[platform]}默认版式`}
              </button>
            </div>
          )}
          {platform !== 'xiaohongshu' && (
            <details className="layout-style-editor">
              <summary>固定版式设计<span>正文、标题、引用、图片、品牌首尾组件</span></summary>
              <LayoutStyleFields value={styleConfig} onChange={setStyleConfig} disabled={accountLayoutLoading || busy} platform={platform} themes={themes} themeId={themeId} />
              <div className="layout-style-toolbar">
                <p className="micro-copy">调整后自动刷新组件样稿。JSON 版式包只含内置主题和结构化参数，不含账号凭证或本机图片资产；导入后检查样稿，再保存为账号新版式。</p>
                <div className="layout-style-actions">
                  <button className="button ghost compact" disabled={busy || accountLayoutLoading} onClick={() => void importLayoutPreset()}>导入版式包</button>
                  <button className="button ghost compact" disabled={busy || accountLayoutLoading || Boolean(customCss) || themeId === 'custom'} title={customCss ? '当前含高级 CSS，暂不支持完整导出' : undefined} onClick={() => void exportLayoutPreset()}>导出当前参数</button>
                  <button className="button secondary compact" disabled={accountLayoutLoading || samplePreviewLoading} onClick={() => {
                  if (showingSamplePreview) setShowingSamplePreview(false)
                  else { setSamplePreview(null); setShowingSamplePreview(true) }
                  }}>{samplePreviewLoading ? '正在更新样稿…' : showingSamplePreview ? '返回文章预览' : '预览完整组件样稿'}</button>
                </div>
              </div>
            </details>
          )}
          {article?.accountId && accountLayoutVersions.length > 0 && platform !== 'xiaohongshu' && (
            <details className="layout-style-history">
              <summary>账号版式历史<span>{accountLayoutVersions.length} 个版本</span></summary>
              <div className="layout-style-history-list">
                {accountLayoutVersions.map((version) => (
                  <div className="layout-style-history-row" key={version.id}>
                    <span><strong>V{version.versionNumber} · {themes.find((theme) => theme.id === version.themeId)?.name ?? version.themeId}</strong><small>{formatDate(version.createdAt)}{version.id === accountLayout?.id ? ' · 当前启用' : ''}</small></span>
                    {version.id !== accountLayout?.id && <button className="button ghost compact" disabled={accountLayoutLoading || busy} onClick={() => { setThemeId(version.themeId); setStyleConfig(normalizeStyleConfig(version.styleConfig)); setCustomCss(version.customCss ?? '') }}>载入参数</button>}
                  </div>
                ))}
              </div>
              <p className="micro-copy">载入历史参数后，点击“将当前设置设为新版式”即可作为新版本启用；已生成的排版稿不会被改写。</p>
            </details>
          )}
        </section>
        {/* 禁用原因就近说明。真实前置是「先选文章」，平台已有默认值，不需要用户额外操作 */}
        {!busy && !articleId && (
          <p className="form-hint" role="note">请先在上方选择要排版的文章</p>
        )}

        {articleLayouts.length > 0 && platform === 'wechat' && (
          <NextStepBar text="排版稿就绪，选好封面即可推送到公众号草稿箱。" actionLabel="去发布" onAction={() => onNavigate('publishing', { articleId })} />
        )}

        <section className="layout-workbench">
          <aside className="layout-versions">
            <header><h3>排版稿 <small>{articleLayouts.length}</small></h3></header>
            {articleLayouts.length ? articleLayouts.map((item) => (
              <button key={item.id} className={`layout-version-item ${item.id === effectiveSelectedId ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
                <strong>{platformNames[item.platform]}{item.themeId && item.themeId !== 'custom' ? ` · ${themes.find((theme) => theme.id === item.themeId)?.name ?? item.themeId}` : ''}{item.layoutVersionId ? ' · 账号版式快照' : ''}</strong>
                <SourceBadge source={item.importSource} />
                <small>{formatDate(item.createdAt)}</small>
              </button>
            )) : <EmptyState
              icon={FileText}
              title="暂无排版稿"
              description={articleId
                ? '当前文章还没有排版稿，点击上方「生成排版稿」即可。'
                : '先在上方选择要排版的文章，再点击「生成排版稿」。'}
            />}
          </aside>
          <main>
            {showingSamplePreview ? samplePreview ? (
              <div className="layout-preview layout-sample-preview">
                <header className="layout-preview-head">
                  <div>
                    <span className="badge success">固定版式校准样稿</span>
                    <h3>{samplePreview.title}</h3>
                    <p>包含标题层级、段落、图片说明、引用、列表、表格、代码和外链脚注。仅预览，不保存排版稿。</p>
                  </div>
                  <button className="button ghost compact" onClick={() => setShowingSamplePreview(false)}>返回文章</button>
                </header>
                <div className="layout-device-wrap">
                  <p className="layout-device-hint micro-copy"><Smartphone size={13} />样稿会随当前参数自动更新；品牌首尾文字也会同步展示</p>
                  <div className="layout-device">
                    <iframe className="layout-preview-frame" title="固定版式组件样稿预览" sandbox="allow-same-origin" srcDoc={layoutPreviewDocument(samplePreview.html)} />
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState icon={FileText} title="正在生成版式样稿" description="样稿预览不会保存成正式排版稿。" />
            ) : selected ? (
              <div className="layout-preview">
                <header className="layout-preview-head">
                  <div>
                    <span className={`badge ${selected.platform === 'wechat' ? 'success' : 'neutral'}`}>{platformNames[selected.platform]}</span>
                    <h3>{selected.title}</h3>
                    <p>来自《{articles.find((item) => item.id === selected.articleId)?.title ?? '文章'}》 · {selected.articleStatusSnapshot === 'draft' ? '草稿版本' : '已锁定版本'} · {formatDate(selected.createdAt)}</p>
                    {article && selected.articleVersionId !== article.currentVersionId && <p className="inline-alert" role="status">此排版稿基于较早正文；当前正文已更新至第 {article.versionCount} 版。可继续查看旧稿，或重新生成排版稿。</p>}
                    <div className="layout-counters">
                      <span className={`badge ${titleLimits[selected.platform] && selected.title.length > titleLimits[selected.platform] ? 'danger' : 'neutral'}`}>
                        标题 {selected.title.length}{titleLimits[selected.platform] ? `/${titleLimits[selected.platform]}` : ''} 字
                      </span>
                      <span className="badge neutral">正文 {selected.plainText.length} 字</span>
                    </div>
                  </div>
                  <button className="icon-button danger" title="删除排版稿" aria-label="删除排版稿" onClick={() => void remove()}><Trash2 size={16} /></button>
                </header>
                <div className="layout-actions">
                  {selected.platform !== 'xiaohongshu' && (<>
                    <button className="button primary compact" disabled={busy} onClick={() => void copyRich('wechat')}><Copy size={16} />复制图文（带格式）</button>
                    <button className="button secondary compact" disabled={busy} onClick={() => void copyRich('placeholders')}>复制正文，手动插图</button>
                  </>)}
                  <span className="layout-actions-sep" aria-hidden="true" />
                  <button className="button secondary compact" onClick={() => void copy(selected.plainText, '已复制纯文本正文')} title="复制不含样式的纯文本，适合小红书等纯文本编辑器"><Copy size={16} />复制纯文本</button>
                  <button className="button ghost compact" onClick={() => void copy(selected.html, 'HTML 源码已复制')} title="复制 HTML 源码，供网页或支持源码的编辑器使用"><Code2 size={16} />复制 HTML 源码</button>
                  <button className="button secondary compact" onClick={() => void exportHtml(selected)} title="导出图片内嵌的单文件 HTML，离线可打开"><FileDown size={16} />导出 HTML 文件</button>
                  {selected.platform === 'wechat' && (
                    <button className="button primary compact" onClick={() => onNavigate('publishing', { articleId: selected.articleId })}><Send size={16} />去发布</button>
                  )}
                </div>
                {selected.platform === 'wechat' ? (
                  <div className="layout-device-wrap">
                    <p className="layout-device-hint micro-copy"><Smartphone size={16} />按手机宽度（375px）预览，实际效果以微信为准</p>
                    <div className="layout-device">
                      <iframe className="layout-preview-frame" title="公众号排版预览" sandbox="allow-same-origin" srcDoc={layoutPreviewDocument(selected.html)} />
                    </div>
                  </div>
                ) : selected.platform === 'xiaohongshu' ? (
                  <div className="layout-device-wrap">
                    <p className="layout-device-hint micro-copy"><Smartphone size={16} />小红书为纯文本，复制后在 App 内粘贴使用</p>
                    <div className="layout-device">
                      <pre className="layout-plain-text">{selected.plainText}</pre>
                    </div>
                  </div>
                ) : (
                  <iframe className="layout-preview-frame layout-preview-frame-web" title="网页排版预览" sandbox="allow-same-origin" srcDoc={layoutPreviewDocument(selected.html)} />
                )}
              </div>
            ) : (
              <EmptyState icon={FileText} title="选择左侧排版稿查看预览" />
            )}
          </main>
        </section>
      </>
    )}
    {ConfirmPortal}
    <ImportDialog
      open={importOpen}
      kind="layout"
      associations={{ articleId }}
      onClose={() => setImportOpen(false)}
      onImported={(result) => { void refresh().then(() => { if (result.created[0]) setSelectedId(result.created[0].id) }) }}
      showToast={showToast}
    />
  </div>
}
