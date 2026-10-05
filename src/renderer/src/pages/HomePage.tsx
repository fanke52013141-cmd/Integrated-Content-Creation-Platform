import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Clock3, FileInput, Flame, Gauge, Image, Import, Layers,
  ListChecks, Newspaper, PenLine, Sparkles
} from 'lucide-react'
import type { AccountProfileSummary, ArticleSummary, GenerationTask, ProviderSummary } from '../../../shared/contracts'
import { articleTitleOf, useActiveWork } from '../active-work'
import type { RouteId } from '../components/Layout'
import { PageHeader } from '../components/PageHeader'
import type { ToastState } from '../components/Toast'
import { errorMessage, formatDate } from '../lib'

interface HomePageProps {
  accounts: AccountProfileSummary[]
  providers: ProviderSummary[]
  onNavigate(route: RouteId, params?: Record<string, string>): void
  onShowTasks(): void
  showToast(toast: ToastState): void
}

/**
 * 首页只回答一件事：下一步做什么。
 * 配置好之后不再宣传账号数量，而是回到上次那篇作品、并把真正待处理的事项列出来。
 */
export function HomePage({ accounts, providers, onNavigate, onShowTasks, showToast }: HomePageProps): React.JSX.Element {
  const { work, setWork } = useActiveWork()
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [pendingDrafts, setPendingDrafts] = useState(0)
  const [loading, setLoading] = useState(true)

  const verified = providers.some((provider) => provider.enabled && provider.hasApiKey && provider.verification.verified)
  const configured = providers.some((provider) => provider.enabled && provider.hasApiKey)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextArticles, nextTasks, dirtyArticles] = await Promise.all([window.moliu.articles.listSummaries({ limit: 30 }).then(result => result.items), window.moliu.generation.list(20), window.moliu.articles.listSummaries({ dirtyOnly: true, limit: 1 })])
      setArticles(nextArticles)
      setTasks(nextTasks)
      // 工作草稿存在本地而非库里，因此这里能直接告诉用户"有稿子还没保存回去"
      setPendingDrafts(dirtyArticles.total)
      setLoading(false)
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  // 上下文里的作品可能已被删除，这里以真实列表为准
  useEffect(() => {
    if (work && !loading && !articles.some((article) => article.id === work.articleId)) { let alive = true; void window.moliu.articles.get(work.articleId).then(article => { if (alive && !article) setWork(null); else if (alive && article) setArticles(current => [...current, { ...article, title: article.rawMarkdown.split('\n')[0], hasWorkDraft: false, layoutStale: false }]) }); return () => { alive = false } }
  }, [work, articles, loading, setWork])

  const resume = useMemo(() => articles.find((article) => article.id === work?.articleId), [articles, work])
  const recent = useMemo(() => articles.filter((article) => article.id !== work?.articleId).slice(0, 5), [articles, work])
  const stuckTasks = useMemo(() => tasks.filter((task) => task.status === 'failed' || task.status === 'partial' || task.status === 'interrupted'), [tasks])
  const unlockedDrafts = useMemo(() => articles.filter((article) => article.status === 'draft').length, [articles])

  const entryPoints: Array<{ label: string; hint: string; icon: typeof PenLine; route: RouteId; params?: Record<string, string> }> = [
    { label: '从主题开始', hint: '已有明确主题，直接想框架再成稿', icon: Sparkles, route: 'frameworks' },
    { label: '从热点开始', hint: '看看今天有什么可写的角度', icon: Flame, route: 'hotspots' },
    { label: '从资料开始', hint: '先整理手头的素材与参考', icon: Newspaper, route: 'materials' },
    { label: '导入现成文章', hint: '粘贴或导入 Markdown，只做润色排版', icon: Import, route: 'articles', params: { import: '1' } }
  ]

  return (
    <div className="page home-page">
      <PageHeader title="创作台" description={configured ? '接着上次那篇写，或者选择适合你的创作入口。' : '可以先导入已有文章；需要智能生成时再连接 AI 服务。'} />

      {!configured && (
        <section className="home-setup">
          <div>
            <h3><Gauge size={16} /> 需要 AI 写作时，连接文本模型</h3>
            <p className="micro-copy">填一次接口地址和密钥，验证通过后就能写。搜索、生图、公众号推送都可以以后再配，不影响先把内容写出来。</p>
          </div>
          <button className="button primary" onClick={() => onNavigate('providers')}><ArrowRight size={15} />去AI 服务</button>
        </section>
      )}

      <p className="micro-copy creation-entry-note">账号定位、热点与评审可按需要使用。已有正文可以直接编辑、排版和导出。</p>
      <section className="home-resume">
        <header><h3><Layers size={15} /> 继续上次作品</h3></header>
        {loading ? <p className="micro-copy">正在读取本地作品…</p> : resume ? (
          <div className="home-resume-card">
            <div className="home-resume-main">
              <strong>{work?.title}</strong>
              <small>{accounts.find((account) => account.id === (work?.accountId ?? resume.accountId))?.name ?? '未绑定账号'} · 第 {resume.versionCount} 版 · {resume.status === 'locked' ? '已锁定' : '草稿'} · 更新于 {formatDate(resume.updatedAt)}</small>
            </div>
            <div className="home-resume-actions">
              <button className="button secondary compact" onClick={() => onNavigate('reviews', { articleId: resume.id })}><ListChecks size={14} />评审</button>
              <button className="button secondary compact" onClick={() => onNavigate('visuals', { articleId: resume.id })}><Image size={14} />配图</button>
              <button className="button secondary compact" onClick={() => onNavigate('layouts', { articleId: resume.id })}><Newspaper size={14} />排版</button>
              <button className="button primary" onClick={() => onNavigate('articles', { articleId: resume.id })}><PenLine size={15} />继续写作</button>
            </div>
          </div>
        ) : (
          <div className="home-empty-card">
            <p className="micro-copy">{work ? '上次打开的作品已被删除。' : '还没有开始中的作品。挑一个入口，或直接导入一篇现成稿子。'}</p>
            {!verified && <p className="inline-alert"><AlertTriangle size={13} /> AI 服务尚未验证连通，智能生成会不可用；导入与排版仍可正常使用。</p>}
          </div>
        )}
      </section>

      <section className="home-entries">
        <header><h3><FileInput size={15} /> 新建内容</h3></header>
        <div className="home-entry-grid">
          {entryPoints.map((entry) => {
            const Icon = entry.icon
            return (
              <button key={entry.label} className="home-entry" onClick={() => onNavigate(entry.route, entry.params)}>
                <span className="home-entry-icon"><Icon size={17} /></span>
                <strong>{entry.label}</strong>
                <small>{entry.hint}</small>
              </button>
            )
          })}
        </div>
      </section>

      <section className="home-pending">
        <header><h3><Clock3 size={15} /> 需要处理</h3>{stuckTasks.length > 0 && <button className="text-button" onClick={onShowTasks}>打开任务中心</button>}</header>
        <ul className="home-pending-list">
          {stuckTasks.length === 0 && unlockedDrafts === 0 && pendingDrafts === 0 && <li className="micro-copy">没有卡住的任务，也没有未保存的本地草稿。</li>}
          {stuckTasks.length > 0 && <li><span>{stuckTasks.length} 个生成任务未全部成功</span><button className="text-button" onClick={onShowTasks}>查看原因</button></li>}
          {pendingDrafts > 0 && <li><span>{pendingDrafts} 篇有本地暂存修改，尚未保存为版本</span><button className="text-button" onClick={() => onNavigate('articles', { dirty: '1' })}>查看待保存作品</button></li>}
          {unlockedDrafts > 0 && <li><span>{unlockedDrafts} 篇仍是草稿状态</span><button className="text-button" onClick={() => onNavigate('articles')}>继续打磨</button></li>}
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="home-recent">
          <header><h3><Sparkles size={15} /> 最近作品</h3></header>
          <ul className="home-recent-list">
            {recent.map((article) => (
              <li key={article.id}>
                <button className="home-recent-item" onClick={() => onNavigate('articles', { articleId: article.id })}>
                  <strong>{articleTitleOf(article.rawMarkdown)}</strong>
                  <small>{article.status === 'locked' ? '已锁定' : '草稿'} · 第 {article.versionCount} 版{article.hasWorkDraft ? ' · 有本地修改' : ''}{article.layoutStale ? ' · 排版需检查' : ''}{article.publicationStatus ? ` · ${article.publicationStatus === 'published' ? '已发布' : article.publicationStatus === 'draft' ? '已推送草稿箱' : '交付待处理'}` : ''} · {formatDate(article.updatedAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
