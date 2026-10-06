import { useEffect, useMemo, useState } from 'react'
import { Code2, Copy, FileDown, FileText, Send, Smartphone, Trash2 } from 'lucide-react'
import type { ArticleGenre, ArticleLayout, ArticleSummary, LayoutPlatform, LayoutThemeInfo } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useSelectedArticle } from '../hooks/useSelectedArticle'
import { ArticlePicker } from '../components/ArticlePicker'
import { Select } from '../components/Select'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { useConfirm } from '../components/useConfirm'
import { errorMessage, formatDate, formatTimedDate, markdownTitle, sanitizeHtml } from '../lib'
import { disambiguateOptions, resolveLayoutSelection } from '../../../shared/creation-state'
import { useReportWork } from '../active-work'
import { useWorkDraft } from '../hooks/useWorkDraft'
import { SavedVersionGate } from '../components/SavedVersionGate'

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
  const [layouts, setLayouts] = useState<ArticleLayout[]>([])
  const [themes, setThemes] = useState<LayoutThemeInfo[]>([])
  const [articleId, setArticleId] = useState('')
  const [platform, setPlatform] = useState<LayoutPlatform>('wechat')
  const [themeId, setThemeId] = useState('wechat-green')
  /** 文章类型。选中后自动推荐主题，把"选色块"变成"选内容类型" */
  const [genre, setGenre] = useState<ArticleGenre | ''>('')
  const [genres, setGenres] = useState<Array<{ id: ArticleGenre; label: string; hint: string }>>([])
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)

  // 选中态始终限定在当前文章的排版稿集合内：切文章不会出现侧栏是 B、预览是 A
  const effectiveSelectedId = useMemo(() => resolveLayoutSelection(layouts, articleId, selectedId), [layouts, articleId, selectedId])
  const selected = layouts.find((item) => item.id === effectiveSelectedId)
  const articleLayouts = useMemo(() => layouts.filter((item) => item.articleId === articleId), [layouts, articleId])
  const { article, error: selectionError } = useSelectedArticle(articleId, articles)

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
    const [nextArticles, nextLayouts] = await Promise.all([window.moliu.articles.listSummaries({ limit: 30 }).then(result => result.items), window.moliu.layouts.list()])
    setArticles(nextArticles)
    setLayouts(nextLayouts)
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

  const create = async (): Promise<void> => {
    if (!articleId) return
    setBusy(true)
    try {
      const item = await window.moliu.layouts.create({
        articleId,
        platform,
        ...(platform !== 'xiaohongshu' ? { themeId } : {})
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
            <Select value={platform} onChange={(value) => setPlatform(value as LayoutPlatform)} ariaLabel="平台" options={(Object.keys(platformNames) as LayoutPlatform[]).map((key) => ({ value: key, label: platformNames[key], hint: platformHints[key] }))} />
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
            disabled={busy || !articleId || needsSavedVersion}
            onClick={() => void create()}
            title={!articleId ? '请先选择要排版的文章' : undefined}
          >
            <FileText size={15} />{busy ? '正在排版…' : '生成排版稿'}
          </button>
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
                <strong>{platformNames[item.platform]}{item.themeId && item.themeId !== 'custom' ? ` · ${themes.find((theme) => theme.id === item.themeId)?.name ?? item.themeId}` : ''}</strong>
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
            {selected ? (
              <div className="layout-preview">
                <header className="layout-preview-head">
                  <div>
                    <span className={`badge ${selected.platform === 'wechat' ? 'success' : 'neutral'}`}>{platformNames[selected.platform]}</span>
                    <h3>{selected.title}</h3>
                    <p>来自《{articles.find((item) => item.id === selected.articleId)?.title ?? '文章'}》 · {selected.articleStatusSnapshot === 'draft' ? '草稿版本' : '已锁定版本'} · {formatDate(selected.createdAt)}</p>
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
                    <button className="button primary compact" disabled={busy} onClick={() => void copyRich('wechat')}><Copy size={14} />复制图文（带格式）</button>
                    <button className="button secondary compact" disabled={busy} onClick={() => void copyRich('placeholders')}>复制正文，手动插图</button>
                  </>)}
                  <span className="layout-actions-sep" aria-hidden="true" />
                  <button className="button secondary compact" onClick={() => void copy(selected.plainText, '已复制纯文本正文')} title="复制不含样式的纯文本，适合小红书等纯文本编辑器"><Copy size={14} />复制纯文本</button>
                  <button className="button ghost compact" onClick={() => void copy(selected.html, 'HTML 源码已复制')} title="复制 HTML 源码，供网页或支持源码的编辑器使用"><Code2 size={14} />复制 HTML 源码</button>
                  <button className="button secondary compact" onClick={() => void exportHtml(selected)} title="导出图片内嵌的单文件 HTML，离线可打开"><FileDown size={14} />导出 HTML 文件</button>
                  {selected.platform === 'wechat' && (
                    <button className="button primary compact" onClick={() => onNavigate('publishing', { articleId: selected.articleId })}><Send size={14} />去发布</button>
                  )}
                </div>
                {selected.platform === 'wechat' ? (
                  <div className="layout-device-wrap">
                    <p className="layout-device-hint micro-copy"><Smartphone size={13} />按手机宽度（375px）预览，实际公众号观感以此为准</p>
                    <div className="layout-device">
                      <article className="layout-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.html) }} />
                    </div>
                  </div>
                ) : selected.platform === 'xiaohongshu' ? (
                  <div className="layout-device-wrap">
                    <p className="layout-device-hint micro-copy"><Smartphone size={13} />小红书为纯文本，复制后在 App 内粘贴使用</p>
                    <div className="layout-device">
                      <pre className="layout-plain-text">{selected.plainText}</pre>
                    </div>
                  </div>
                ) : (
                  <article className="layout-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.html) }} />
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
  </div>
}
