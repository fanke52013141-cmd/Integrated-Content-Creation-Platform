import { useEffect, useMemo, useState } from 'react'
import { Code2, Copy, FileText, Send, Trash2 } from 'lucide-react'
import type { Article, ArticleLayout, LayoutPlatform } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { Select } from '../components/Select'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { useConfirm } from '../components/useConfirm'
import { errorMessage, formatDate, markdownTitle, sanitizeHtml } from '../lib'

const platformNames: Record<LayoutPlatform, string> = { wechat: '微信公众号', xiaohongshu: '小红书', web: '通用网页' }
const platformHints: Record<LayoutPlatform, string> = { wechat: '可直接推送草稿箱', xiaohongshu: '纯文本，复制使用', web: '通用网页样式' }

export function LayoutsPage({ onNavigate, focusArticleId, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [articles, setArticles] = useState<Article[]>([])
  const [layouts, setLayouts] = useState<ArticleLayout[]>([])
  const [articleId, setArticleId] = useState('')
  const [platform, setPlatform] = useState<LayoutPlatform>('wechat')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)

  const selected = layouts.find((item) => item.id === selectedId)
  const articleLayouts = useMemo(() => layouts.filter((item) => item.articleId === articleId), [layouts, articleId])
  const article = articles.find((item) => item.id === articleId)

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

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])

  const create = async (): Promise<void> => {
    if (!articleId) return
    setBusy(true)
    try {
      const item = await window.moliu.layouts.create({ articleId, platform })
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
    await navigator.clipboard.writeText(text)
    showToast({ type: 'success', message })
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
            <Select value={articleId} onChange={setArticleId} ariaLabel="文章" options={articles.map((item) => ({ value: item.id, label: markdownTitle(item.rawMarkdown), hint: item.status === 'locked' ? '已锁定' : '草稿' }))} />
          </label>
          <label className="field"><span>平台</span>
            <Select value={platform} onChange={(value) => setPlatform(value as LayoutPlatform)} ariaLabel="平台" options={(Object.keys(platformNames) as LayoutPlatform[]).map((key) => ({ value: key, label: platformNames[key], hint: platformHints[key] }))} />
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
              <button key={item.id} className={`layout-version-item ${item.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
                <strong>{platformNames[item.platform]}</strong>
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
                    <p>{selected.articleStatusSnapshot === 'draft' ? '草稿版本' : '已锁定版本'} · {formatDate(selected.createdAt)}</p>
                  </div>
                  <button className="icon-button danger" title="删除排版稿" aria-label="删除排版稿" onClick={() => void remove()}><Trash2 size={16} /></button>
                </header>
                <div className="layout-actions">
                  <button className="button secondary compact" onClick={() => void copy(selected.plainText, '发布文案已复制')}><Copy size={14} />复制发布文案</button>
                  <button className="button ghost compact" onClick={() => void copy(selected.html, '网页源码已复制')}><Code2 size={14} />复制源码</button>
                  {selected.platform === 'wechat' && (
                    <button className="button primary compact" onClick={() => onNavigate('publishing', { articleId: selected.articleId })}><Send size={14} />去发布</button>
                  )}
                </div>
                <article className="layout-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.html) }} />
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
