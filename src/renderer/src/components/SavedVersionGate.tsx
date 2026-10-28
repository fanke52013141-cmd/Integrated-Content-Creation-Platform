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
  if (!article) return null
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
  const needsSavedVersion = draft.dirty || draft.status === 'error'
  return <>
    <section className={`saved-version-gate ${needsSavedVersion ? '' : 'saved-version-context'}`} role="status">
      {needsSavedVersion ? <>
        <strong>{draft.conflict ? '本地修改基于旧版本，请回正文对比或另存。' : '这篇文章有本地修改，保存为版本后才能继续。'}</strong>
        <p className="micro-copy">{draft.error || '自动暂存只保护当前编辑；评审、配图、排版和交付都使用已保存版本。'}{error && ` ${error}`}</p>
        <div className="page-intro-actions">
          <button className="button primary compact" disabled={busy || draft.conflict || draft.status === 'loading'} onClick={() => void save()}>{busy ? '正在处理…' : '保存为新版本'}</button>
          <button className="button secondary compact" onClick={() => onNavigate('articles', { articleId: article.id })}>返回正文</button>
          <button className="button ghost compact" disabled={busy} onClick={() => void discard()}>放弃修改，使用已保存版本</button>
        </div>
      </> : <>
        <strong>当前使用正文第 {article.versionCount} 版{article.status === 'locked' ? '，已锁定成稿' : '，仍可继续编辑'}。</strong>
        <p className="micro-copy">保存会创建新版本；锁定用于确认当前成稿。新生成的结果使用已保存正文，已有评审、配图或排版可能基于旧版本，请检查各结果的版本提示。</p>
      </>}
    </section>
    {ConfirmPortal}
  </>
}
