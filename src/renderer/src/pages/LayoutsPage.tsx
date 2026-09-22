import { useEffect, useMemo, useState } from 'react'
import { Code2, Copy, FileDown, FileText, Send, Smartphone, Trash2 } from 'lucide-react'
import type { Article, ArticleLayout, LayoutPlatform, LayoutThemeInfo } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { Select } from '../components/Select'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { useConfirm } from '../components/useConfirm'
import { errorMessage, formatDate, formatTimedDate, markdownTitle, sanitizeHtml } from '../lib'
import { disambiguateOptions, resolveLayoutSelection } from '../../../shared/creation-state'
import { useReportWork } from '../active-work'

const platformNames: Record<LayoutPlatform, string> = { wechat: '微信公众号', xiaohongshu: '小红书', web: '通用网页' }
const platformHints: Record<LayoutPlatform, string> = { wechat: '可直接推送草稿箱', xiaohongshu: '纯文本，复制使用', web: '通用网页样式' }
/** 各平台标题字数上限（0 = 不限） */
const titleLimits: Record<LayoutPlatform, number> = { wechat: 64, xiaohongshu: 20, web: 0 }

export function LayoutsPage({ onNavigate, focusArticleId, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [articles, setArticles] = useState<Article[]>([])
  const [layouts, setLayouts] = useState<ArticleLayout[]>([])
  const [themes, setThemes] = useState<LayoutThemeInfo[]>([])
  const [articleId, setArticleId] = useState('')
  const [platform, setPlatform] = useState<LayoutPlatform>('wechat')
  const [themeId, setThemeId] = useState('wechat-green')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)

  // 选中态始终限定在当前文章的排版稿集合内：切文章不会出现侧栏是 B、预览是 A
  const effectiveSelectedId = useMemo(() => resolveLayoutSelection(layouts, articleId, selectedId), [layouts, articleId, selectedId])
  const selected = layouts.find((item) => item.id === effectiveSelectedId)
  const articleLayouts = useMemo(() => layouts.filter((item) => item.articleId === articleId), [layouts, articleId])
  const article = articles.find((item) => item.id === articleId)

  useReportWork(article ? {
    articleId: article.id,
    title: markdownTitle(article.rawMarkdown),
    accountId: article.accountId,
    versionCount: article.versionCount,
    status: article.status
  } : {}, 'layouts')

  const refresh = async (): Promise<void> => {
    const [nextArticles, nextLayouts] = await Promise.all([window.moliu.articles.list(), window.moliu.layouts.list()])
    setArticles(nextArticles)
    setLayouts(nextLayouts)
    setArticleId((current) => {
      if (nextArticles.some((item) => item.id === current)) return current
      if (focusArticleId && nextArticles.some((item) => item.id === focusArticleId)) return focusArticleId
      const locked = nextArticles.find((item) => item.status === 'locked')
      return locked?.id ?? nextArticles[0]?.id ?? ''
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

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => { void window.moliu.layouts.themes().then(setThemes).catch(() => undefined) }, [])

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
      showToast({ type: 'success', message: `${platformNames[platform]}排版稿已生成` })
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
  const copyRich = async (html: string, text: string): Promise<void> => {
    try {
      const ok = await window.moliu.clipboard.writeRichText(html, text)
      showToast(ok
        ? { type: 'success', message: '已复制带格式正文，可直接粘贴到公众号编辑器' }
        : { type: 'error', message: '复制失败：主进程未写入剪贴板，请重试' })
    } catch (error) {
      showToast({ type: 'error', message: `复制失败：${errorMessage(error)}` })
    }
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
            <Select value={articleId} onChange={selectArticle} ariaLabel="文章" options={disambiguateOptions(articles.map((item) => ({ value: item.id, label: markdownTitle(item.rawMarkdown), hint: item.status === 'locked' ? '已锁定' : '草稿', distinct: formatTimedDate(item.updatedAt) })))} />
          </label>
          <label className="field"><span>平台</span>
            <Select value={platform} onChange={(value) => setPlatform(value as LayoutPlatform)} ariaLabel="平台" options={(Object.keys(platformNames) as LayoutPlatform[]).map((key) => ({ value: key, label: platformNames[key], hint: platformHints[key] }))} />
          </label>
          <label className="field"><span>主题<em>{platform === 'xiaohongshu' ? '（纯文本不适用）' : ''}</em></span>
            <Select
              value={themeId}
              onChange={setThemeId}
              ariaLabel="排版主题"
              disabled={platform === 'xiaohongshu'}
              options={(themes.length ? themes : [{ id: 'wechat-green', name: '微信绿', description: '', accent: '' }]).map((theme) => ({ value: theme.id, label: theme.name, hint: theme.description }))}
            />
          </label>
          <button className="button primary" disabled={busy || !articleId} onClick={() => void create()}><FileText size={15} />{busy ? '正在排版…' : '生成排版稿'}</button>
        </section>

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
            )) : <EmptyState icon={FileText} title="暂无排版稿" description="选择平台后点击「生成排版稿」。" />}
          </aside>
          <main>
            {selected ? (
              <div className="layout-preview">
                <header className="layout-preview-head">
                  <div>
                    <span className={`badge ${selected.platform === 'wechat' ? 'success' : 'neutral'}`}>{platformNames[selected.platform]}</span>
                    <h3>{selected.title}</h3>
                    <p>来自《{markdownTitle(articles.find((item) => item.id === selected.articleId)?.rawMarkdown ?? '')}》 · {selected.articleStatusSnapshot === 'draft' ? '草稿版本' : '已锁定版本'} · {formatDate(selected.createdAt)}</p>
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
                  {selected.platform !== 'xiaohongshu' && (
                    <button className="button primary compact" onClick={() => void copyRich(selected.html, selected.plainText)}><Copy size={14} />复制图文（带格式）</button>
                  )}
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
