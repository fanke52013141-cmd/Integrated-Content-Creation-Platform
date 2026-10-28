import { useEffect, useMemo, useState } from 'react'
import type { Article, MaterialContext, ReviewProblem } from '../../../shared/contracts'
import { extractFactCandidates } from '../../../shared/fact-candidates'
import { errorMessage, isSafeUrl } from '../lib'

export function FactCheckPanel({ article, dirty, onLocate }: { article: Article; dirty: boolean; onLocate(start: number, end: number): void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ versionId: string; evidence: MaterialContext | null; confirmed: string[] }>()
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [reviewFacts, setReviewFacts] = useState<ReviewProblem[]>([])
  const [reviewError, setReviewError] = useState('')
  const candidates = useMemo(() => extractFactCandidates(article.rawMarkdown), [article.rawMarkdown])
  useEffect(() => {
    setData(undefined); setError(''); setReviewFacts([]); setReviewError('')
    if (!open) return
    let alive = true
    void window.moliu.articles.factContext(article.id).then(result => { if (alive) setData(result) }).catch(reason => { if (alive) setError(errorMessage(reason)) })
    void window.moliu.reviews.listTasks(article.id).then(tasks => { if (alive) setReviewFacts(tasks.filter(task => task.articleVersionId === article.currentVersionId).flatMap(task => task.opinions.flatMap(opinion => opinion.problems.filter(problem => problem.reviewKind === 'fact'))) ) }).catch(reason => { if (alive) setReviewError(errorMessage(reason)) })
    return () => { alive = false }
  }, [article.id, article.currentVersionId, open])
  const toggle = async (key: string, checked: boolean): Promise<void> => {
    if (!data || data.versionId !== article.currentVersionId) return
    setBusyKey(key); setError('')
    try {
      await window.moliu.articles.confirmFact({ articleId: article.id, versionId: data.versionId, key, confirmed: checked })
      setData(current => current?.versionId === data.versionId ? { ...current, confirmed: checked ? [...current.confirmed, key] : current.confirmed.filter(item => item !== key) } : current)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusyKey('') }
  }
  return <details className="fact-check-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>事实核对 · 数字与日期</summary>
    <p className="micro-copy">仅从已保存正文识别数字线索，可能遗漏事实或包含非事实；相同数字只表示可供核对，不代表内容已证实。修改正文后须保存版本再核对。</p>
    {dirty && <p className="inline-alert" role="status">当前有未保存修改，下面显示已保存版本；保存后才能定位或确认。</p>}
    {error && <p className="inline-alert" role="alert">{error}</p>}
    {reviewError && <p className="inline-alert" role="alert">评审事实意见未能读取：{reviewError}</p>}
    {data && reviewFacts.length > 0 && <div className="fact-check-list"><strong>当前版本的事实评审意见</strong>{reviewFacts.map(problem => { const key = `review:${problem.id}`; const start = problem.anchor ? article.rawMarkdown.indexOf(problem.anchor) : -1; return <article key={key}><p>{problem.issue}</p><p className="micro-copy">{problem.evidence?.status === 'source-matched' ? '评审依据与资料片段匹配，仍需人工判断。' : '评审未提供可匹配依据，需自行核查。'}</p>{problem.evidence?.excerpt && <div className="fact-check-source"><strong>{problem.evidence.title ?? '资料片段'}</strong><p>{problem.evidence.excerpt}</p>{problem.evidence.sourceUrl && isSafeUrl(problem.evidence.sourceUrl) && <button className="text-button" onClick={() => void window.moliu.app.openExternal(problem.evidence!.sourceUrl!)}>打开来源</button>}</div>}<div className="fact-check-actions"><button className="button ghost compact" disabled={dirty || start < 0} onClick={() => onLocate(start, start + (problem.anchor?.length ?? 0))}>定位正文</button><label><input type="checkbox" disabled={dirty || Boolean(busyKey)} checked={data.confirmed.includes(key)} onChange={event => void toggle(key, event.target.checked)} />我已人工核对</label></div></article> })}</div>}
    {!data && !error ? <p className="micro-copy">正在读取依据…</p> : data && data.versionId !== article.currentVersionId ? <p className="inline-alert">正文版本已变化，请重新打开核对面板。</p> : data && !candidates.length ? <p className="micro-copy">没有识别到数字线索；仍请人工检查人物、观点和引用。</p> : data && <div className="fact-check-list">{candidates.map(candidate => {
      const sources = (data.evidence?.fragments ?? []).filter(fragment => fragment.text.includes(candidate.token)).slice(0, 3)
      return <article key={candidate.key}><strong>{candidate.token}</strong><p>{candidate.context}</p><p className="micro-copy">{sources.length ? '以下已送入模型的片段含相同文字，请核对上下文：' : '没有找到包含相同数字的生成依据；请自行查找来源。'}</p>{sources.map(source => { const index = source.text.indexOf(candidate.token); return <div className="fact-check-source" key={source.id}><strong>{source.title}</strong><p>{source.text.slice(Math.max(0, index - 100), Math.min(source.text.length, index + candidate.token.length + 100))}</p>{source.sourceUrl && isSafeUrl(source.sourceUrl) && <button className="text-button" onClick={() => void window.moliu.app.openExternal(source.sourceUrl!)}>打开来源</button>}</div> })}
        <div className="fact-check-actions"><button className="button ghost compact" disabled={dirty} onClick={() => onLocate(candidate.start, candidate.end)}>定位正文</button><label><input type="checkbox" disabled={dirty || Boolean(busyKey)} checked={data.confirmed.includes(candidate.key)} onChange={event => void toggle(candidate.key, event.target.checked)} />我已人工核对</label></div>
      </article>
    })}</div>}
  </details>
}
