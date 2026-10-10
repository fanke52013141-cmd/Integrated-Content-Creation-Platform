import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Clock3, Flame, Gauge, Image, Import, Layers,
  ListChecks, Newspaper, PenLine, Send, Sparkles
} from 'lucide-react'
import type { AccountProfileSummary, ArticleSummary, GenerationTask, ProviderSummary } from '../../../shared/contracts'
import { useActiveWork } from '../active-work'
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
    if (work && !loading && !articles.some((article) => article.id === work.articleId)) { let alive = true; void window.moliu.articles.getSummary(work.articleId).then(article => { if (alive && !article) setWork(null); else if (alive && article) setArticles(current => [...current, { ...article, title: article.title }]) }); return () => { alive = false } }
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
      <PageHeader title="创作台" description="从一个想法，到一篇好作品。" actions={<button className="button primary" onClick={() => onNavigate('frameworks')}><PenLine size={15} />开始创作</button>} />

      <div className="home-studio-grid">
        <div className="home-studio-main">

          {!configured && (
            <section className="home-setup">
              <div>
                <h3><Gauge size={16} /> 需要 AI 写作时，连接文本模型</h3>
                <p className="micro-copy">填一次接口地址和密钥，验证通过后就能写。搜索、生图、公众号推送都可以以后再配，不影响先把内容写出来。</p>
              </div>
              <button className="button secondary compact" onClick={() => onNavigate('providers')}><ArrowRight size={15} />去AI 服务</button>
            </section>
          )}

          <section className="home-resume">
            <header><h3><Layers size={15} /> 继续上次作品</h3></header>
            {loading ? <p className="micro-copy">正在读取本地作品…</p> : resume ? (
              <div className="home-resume-card">
                <div className="home-resume-main">
                  <strong>{resume.title}</strong>
                  <small>{accounts.find((account) => account.id === (work?.accountId ?? resume.accountId))?.name ?? '未绑定账号'} · 第 {resume.versionCount} 版 · {resume.status === 'locked' ? '已锁定' : '草稿'} · 更新于 {formatDate(resume.updatedAt)}</small>
                </div>
                <div className="home-resume-actions">
                  <button className="button primary" onClick={() => onNavigate('articles', { articleId: resume.id })}><PenLine size={15} />继续写作</button>
                  <div className="home-resume-secondary">
                    <button className="button ghost compact" onClick={() => onNavigate('reviews', { articleId: resume.id })}><ListChecks size={14} />评审</button>
                    <button className="button ghost compact" onClick={() => onNavigate('visuals', { articleId: resume.id })}><Image size={14} />配图</button>
                    <button className="button ghost compact" onClick={() => onNavigate('layouts', { articleId: resume.id })}><Newspaper size={14} />排版</button>
                    <button className="button ghost compact" onClick={() => onNavigate('publishing', { articleId: resume.id })}><Send size={14} />发布</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="home-empty-card">
                <span className="home-empty-icon" aria-hidden="true"><PenLine size={24} /></span>
                <strong>{work ? '上次打开的作品已被删除。' : '下一篇好内容，从这里开始'}</strong>
                <p className="micro-copy">选择下方入口开始创作，或导入一篇现成稿子。</p>
                {!verified && <p className="inline-alert"><AlertTriangle size={13} /> AI 服务尚未验证连通，智能生成会不可用；导入与排版仍可正常使用。</p>}
              </div>
            )}
          </section>

          <section className="home-start">
            <header><h3>开始新的创作</h3><span className="micro-copy">选一个适合你的起点</span></header>
            <div className="home-entry-bar" role="group" aria-label="新建内容">
              {entryPoints.map((entry) => {
                const Icon = entry.icon
                return (
                  <button key={entry.label} className="home-entry-chip" onClick={() => onNavigate(entry.route, entry.params)} title={entry.hint}>
                    <Icon size={18} />
                    <span><strong>{entry.label}</strong><small>{entry.hint}</small></span>
                    <ArrowRight size={14} />
                  </button>
                )
              })}
            </div>
          </section>

          {/* 「最近作品」改为可折叠（2026-10-06）
              它是回溯功能，而首页的职责是回答「下一步做什么」。
              默认收起、保留入口与数量提示：功能一点没少，只是不再占据主视线。
              用原生 <details>，展开状态由浏览器管理，不引入新状态。 */}
          {recent.length > 0 && (
            <details className="home-recent">
              <summary>
                <Sparkles size={15} />
                最近作品
                <span className="home-recent-count">{recent.length}</span>
              </summary>
              <ul className="home-recent-list">
                {recent.map((article) => (
                  <li key={article.id}>
                    <button className="home-recent-item" onClick={() => onNavigate('articles', { articleId: article.id })}>
                      <strong>{article.title}</strong>
                      <small>{article.status === 'locked' ? '已锁定' : '草稿'} · 第 {article.versionCount} 版{article.hasWorkDraft ? ' · 有本地修改' : ''}{article.layoutStale ? ' · 排版需检查' : ''}{article.publicationStatus ? ` · ${article.publicationStatus === 'published' ? '已发布' : article.publicationStatus === 'draft' ? '已推送草稿箱' : '交付待处理'}` : ''} · {formatDate(article.updatedAt)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      <aside className="home-studio-aside" aria-label="创作辅助">
        <section className="home-pending">
          <header><h3><Clock3 size={15} />需要处理</h3>{stuckTasks.length > 0 && <button className="text-button" onClick={onShowTasks}>任务中心</button>}</header>
          <ul className="home-pending-list">
            {loading ? <li className="micro-copy">正在读取待处理事项…</li> : <>
              {stuckTasks.length === 0 && unlockedDrafts === 0 && pendingDrafts === 0 && <li className="home-pending-clear"><ListChecks size={20} /><strong>一切就绪</strong><span>没有卡住的任务或待保存修改。</span></li>}
              {stuckTasks.length > 0 && <li><span><strong>{stuckTasks.length} 个任务需要检查</strong><small>生成结果未全部完成</small></span><button className="text-button" onClick={onShowTasks}>查看</button></li>}
              {pendingDrafts > 0 && <li><span><strong>{pendingDrafts} 篇修改待保存</strong><small>本地修改尚未保存为版本</small></span><button className="text-button" onClick={() => onNavigate('articles', { dirty: '1' })}>查看</button></li>}
              {unlockedDrafts > 0 && <li><span><strong>{unlockedDrafts} 篇草稿待完善</strong><small>继续打磨后再交付</small></span><button className="text-button" onClick={() => onNavigate('articles')}>打开</button></li>}
            </>}
          </ul>
        </section>
        <section className="home-note"><Sparkles size={16} /><h3>按你的节奏创作</h3><p className="micro-copy">不必走完每个步骤。已有正文可以直接编辑、配图、排版和导出。</p></section>
      </aside>
      </div>
    </div>
  )
}
