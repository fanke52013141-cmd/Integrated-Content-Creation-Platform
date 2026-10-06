import { useEffect, useState } from 'react'
import type { ArticleSummary } from '../../../shared/contracts'
import { Select } from './Select'
import { errorMessage, formatTimedDate } from '../lib'

/** 选择器服务端搜索分页，当前项独立加载，不限制在最近 500 篇。 */
export function ArticlePicker({ value, onChange, disabled }: { value: string; onChange(id: string): void; disabled?: boolean }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<ArticleSummary[]>([])
  const [selected, setSelected] = useState<ArticleSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => { void window.moliu.articles.listSummaries({ search: query, offset: page * 30, limit: 30 }).then(result => {
      if (alive) { setItems(result.items); setTotal(result.total); setError('') }
    }).catch(reason => { if (alive) setError(errorMessage(reason)) }) }, 200)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query, page])
  useEffect(() => {
    let alive = true
    setSelected(null)
    if (value) void window.moliu.articles.getSummary(value).then(result => { if (alive) setSelected(result) }).catch(reason => { if (alive) setError(errorMessage(reason)) })
    return () => { alive = false }
  }, [value])
  const choices = selected && !items.some(item => item.id === selected.id) ? [selected, ...items] : items
  return <div className="article-picker">
    <input aria-label="搜索可选文章" placeholder="搜索标题或正文" value={query} disabled={disabled} onChange={event => { setQuery(event.target.value); setPage(0) }} />
    <Select value={value} onChange={onChange} disabled={disabled} ariaLabel="文章" searchable={false} options={choices.map(item => ({ value: item.id, label: item.title, hint: `${item.status === 'locked' ? '已锁定' : '草稿'} · 第 ${item.versionCount} 版 · ${formatTimedDate(item.updatedAt)} · ${item.id.slice(0, 8)}` }))} />
    {total > 30 && <div className="article-picker-pagination"><button type="button" disabled={disabled || !page} onClick={() => setPage(page - 1)}>上一页</button><small>{page + 1}/{Math.ceil(total / 30)}</small><button type="button" disabled={disabled || (page + 1) * 30 >= total} onClick={() => setPage(page + 1)}>下一页</button></div>}
    {error && <p role="alert">{error}</p>}
  </div>
}
