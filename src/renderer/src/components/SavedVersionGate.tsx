import { useState } from 'react'
import type { Article } from '../../../shared/contracts'
import type { RouteId } from './Layout'
import { useWorkDraft } from '../hooks/useWorkDraft'
import { useConfirm } from './useConfirm'
import { errorMessage } from '../lib'

/** 所有下游页使用相同的保存提示，主进程也独立校验。 */
export function SavedVersionGate({ article, onSaved, onNavigate }: { article?: Article; onSaved(): Promise<void>; onNavigate(route: RouteId, params?: Record<string, string>): void }): React.JSX.Element | null {
  const draft = useWorkDraft(article?.id ?? '', article?.rawMarkdown ?? '', article?.currentVersionId ?? '')
  const { confirm, ConfirmPortal } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!article || (!draft.dirty && draft.status !== 'error')) return null
  const save = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const local = await draft.flush()
      if (local) {
        const saved = await window.moliu.articles.commitDraft(article.id, local.revision)
        await draft.markSaved({ currentVersionId: saved.currentVersionId, consumedContent: local.content })
      }
      await onSaved()
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  const discard = async (): Promise<void> => {
    if (!(await confirm({ title: '放弃修改', message: '确认放弃这篇文章的本地修改？', danger: true, confirmLabel: '放弃修改' }))) return
    setBusy(true); setError('')
    try { await draft.discard(); await onSaved() }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  return <><section className="saved-version-gate" role="status">
    <strong>{draft.conflict ? '本地修改基于旧版本，请回正文对比或另存。' : '这篇文章有本地修改，保存为版本后才能继续。'}</strong>
    <p className="micro-copy">{draft.error || '评审、排版和交付都使用已保存版本。'}{error && ` ${error}`}</p>
    <div className="page-intro-actions">
      <button className="button primary compact" disabled={busy || draft.conflict || draft.status === 'loading'} onClick={() => void save()}>{busy ? '正在处理…' : '保存修改'}</button>
      <button className="button secondary compact" onClick={() => onNavigate('articles', { articleId: article.id })}>返回正文</button>
      <button className="button ghost compact" disabled={busy} onClick={() => void discard()}>放弃修改，使用已保存版本</button>
    </div>
  </section>{ConfirmPortal}</>
}
