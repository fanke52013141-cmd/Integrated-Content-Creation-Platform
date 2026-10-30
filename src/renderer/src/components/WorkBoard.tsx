import { useEffect, useState } from 'react'
import type { AccountProfileSummary, ArticleSummary } from '../../../shared/contracts'
import type { RouteId } from './Layout'
import { errorMessage, formatDate } from '../lib'
import { Select } from './Select'

/** Results are paged by the database; never infer workflow stages that are not recorded. */
export function WorkBoard({ accounts, onNavigate }: { accounts: AccountProfileSummary[]; onNavigate(route: RouteId, params?: Record<string, string>): void }): React.JSX.Element {
  const [items, setItems] = useState<ArticleSummary[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [accountId, setAccountId] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(0) }, 250); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    void window.moliu.articles.listSummaries({ limit: 12, offset: page * 12, search, accountId: accountId || undefined }).then(result => {
      if (!alive) return
      setItems(result.items); setTotal(result.total); setLoading(false)
    }).catch(reason => { if (alive) { setError(errorMessage(reason)); setLoading(false) } })
    return () => { alive = false }
  }, [page, search, accountId, retry])
  return <section className="home-work-board" aria-labelledby="work-board-title">
    <header><h3 id="work-board-title">作品管理</h3><span className="micro-copy">{total} 篇</span></header>
    <div className="home-board-filters"><input type="search" aria-label="搜索作品" value={query} placeholder="搜索标题或正文" onChange={event => setQuery(event.target.value)} /><Select ariaLabel="筛选作品账号" value={accountId} onChange={value => { setAccountId(value); setPage(0) }} options={[{ value: '', label: '全部账号' }, ...accounts.map(account => ({ value: account.id, label: account.name }))]} /></div>
    {loading ? <p className="micro-copy">正在读取作品…</p> : error ? <p className="inline-alert" role="alert">作品读取失败：{error} <button className="text-button" onClick={() => setRetry(value => value + 1)}>重试</button></p> : items.length ? <div className="home-board-list">{items.map(item => <article key={item.id}>
      <div><strong>{item.title}</strong><p className="micro-copy">{accounts.find(account => account.id === item.accountId)?.name ?? '未绑定账号'} · 正文第 {item.versionCount} 版 · {item.status === 'locked' ? '已锁定' : '草稿'} · {formatDate(item.updatedAt)}</p><p className="micro-copy">{item.hasWorkDraft ? '有本地修改待保存 · ' : ''}{item.layoutStale ? '排版稿需检查 · ' : ''}{item.publicationStatus === 'published' ? '已记录发布' : item.publicationStatus === 'draft' ? '已推送草稿箱' : item.publicationStatus === 'unknown' ? '交付结果待核对' : item.publicationStatus === 'failed' ? '交付失败' : '尚无交付记录'}</p></div>
      <div className="home-board-actions"><button className="button secondary compact" onClick={() => onNavigate('articles', { articleId: item.id })}>继续写作</button><button className="button ghost compact" onClick={() => onNavigate('reviews', { articleId: item.id })}>评审</button><button className="button ghost compact" onClick={() => onNavigate('layouts', { articleId: item.id })}>排版</button></div>
    </article>)}</div> : <p className="micro-copy">{query || accountId ? '没有找到匹配的作品。' : '还没有作品，先从上方选择一个创作起点。'}</p>}
    {!loading && !error && total > 12 && <div className="home-board-pages"><button className="button ghost compact" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page + 1} / {Math.ceil(total / 12)}</span><button className="button ghost compact" disabled={(page + 1) * 12 >= total} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
  </section>
}
