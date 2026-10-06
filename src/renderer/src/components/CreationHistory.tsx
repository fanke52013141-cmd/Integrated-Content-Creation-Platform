import { useState } from 'react'
import type { Article, CreationRequest, GenerateArticlesResult } from '../../../shared/contracts'
import { diffLines } from '../../../shared/text-diff'
import { ModalBase } from './ModalBase'
import type { ToastState } from './Toast'
import { errorMessage, formatDate } from '../lib'

export function CreationHistory({ requests, run, refresh, openArticle, showToast }: {
  requests: CreationRequest[]; run(task: () => Promise<GenerateArticlesResult>): Promise<GenerateArticlesResult>
  refresh(): Promise<void>; openArticle(id: string): void; showToast(toast: ToastState): void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<{ id: string; index: number; content: string }>()
  const [comparison, setComparison] = useState<{ original: Article; candidate: Article }>()
  async function perform(task: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await task(); await refresh() } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }
  async function generate(task: () => Promise<GenerateArticlesResult>) {
    const result = await run(task)
    if (result.articles[0]) openArticle(result.articles[0].id)
    showToast({ type: result.failed.length ? 'warning' : 'success', message: `完成 ${result.articles.length} 项，${result.failed.length} 项仍需处理` })
  }
  return <>
    {requests.length > 0 && <details className="panel creation-history"><summary>生成结果记录 · 失败重试与未完成内容恢复</summary>
      {requests.slice(0, 20).map(request => <div key={request.id} className="creation-request">
        <strong>{request.title}</strong><small>{formatDate(request.createdAt)}</small>
        {request.results.map(result => <div key={result.index} className="creation-result">
          <span>候选 {result.index} · {result.status === 'succeeded' ? '已完成' : result.status === 'running' ? '进行中' : result.status === 'pending' ? '待运行' : '未完成'}</span>
          {result.message && <p>{result.message}</p>}
          {result.articleId && <button className="button ghost compact" onClick={() => openArticle(result.articleId!)}>打开结果</button>}
          {result.articleId && request.articleId && result.articleId !== request.articleId && <button className="button secondary compact" disabled={busy} onClick={() => void perform(async () => {
            const [original, candidate] = await Promise.all([window.moliu.articles.get(request.articleId!), window.moliu.articles.get(result.articleId!)])
            if (!original || !candidate) throw new Error('原文章或候选已删除')
            setComparison({ original, candidate })
          })}>对比并采纳</button>}
          {result.status !== 'running' && result.content && result.status !== 'succeeded' && <button className="button secondary compact" onClick={() => setEdit({ id: request.id, index: result.index, content: result.content })}>检查内容并另存</button>}
          {result.content && result.status === 'failed' && result.completion !== 'blocked' && <button className="button secondary compact" disabled={busy} onClick={() => void perform(() => generate(() => window.moliu.articles.continueResult(request.id, result.index)))}>续写完整备选稿</button>}
        </div>)}
        {request.results.some(item => item.status === 'failed' || item.status === 'pending') && <button className="button secondary compact" disabled={busy} onClick={() => void perform(() => generate(() => window.moliu.articles.retryRequest(request.id)))}>补生成失败候选</button>}
      </div>)}
    </details>}
    <ModalBase open={Boolean(edit)} onClose={() => setEdit(undefined)} titleId="recover-content-title" className="import-draft-dialog">
      <h2 id="recover-content-title">检查未完成内容</h2><p>补完并检查正文后，另存为新的手动草稿。原文章不会被修改。</p>
      <textarea rows={15} value={edit?.content ?? ''} maxLength={190000} onChange={event => setEdit(edit ? { ...edit, content: event.target.value } : undefined)} aria-label="待恢复正文" />
      <button className="button primary" disabled={busy || !edit?.content.trim()} onClick={() => void perform(async () => {
        if (!edit) return
        const article = await window.moliu.articles.recoverResult(edit.id, edit.index, edit.content)
        openArticle(article.id); setEdit(undefined)
      })}>已检查完整，另存为草稿</button>
    </ModalBase>
    <ModalBase open={Boolean(comparison)} onClose={() => setComparison(undefined)} titleId="candidate-compare-title" className="version-diff-dialog">
      <h2 id="candidate-compare-title">原文章与备选稿对比</h2>
      {comparison && <><p>原文章第 {comparison.original.versionCount} 版。绿色为备选稿新增，红色为删除；请检查事实、数字和引用。</p>
        <div className="article-diff">{diffLines(comparison.original.rawMarkdown, comparison.candidate.rawMarkdown).map((row, index) => <span key={index} className={`article-diff-row ${row.kind}`}>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '}{row.text}</span>)}</div>
        <button className="button primary" disabled={busy} onClick={() => void perform(async () => {
          const saved = await window.moliu.articles.adoptCandidate({ articleId: comparison.original.id, candidateId: comparison.candidate.id, expectedVersionId: comparison.original.currentVersionId, expectedCandidateVersionId: comparison.candidate.currentVersionId })
          openArticle(saved.id); setComparison(undefined)
        })}>采纳为原文章新版本</button></>}
    </ModalBase>
  </>
}
