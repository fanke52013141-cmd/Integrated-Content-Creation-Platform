import { useCallback, useSyncExternalStore } from 'react'
import { discardWorkDraft, flushWorkDraft, getDraftState, reloadWorkDraft, subscribeDraft, updateWorkDraft } from '../lib/work-drafts'

/** 草稿与正式版本分开；即时 IPC 暂存进入 SQLite，也进入整库备份。 */
export function useWorkDraft(articleId: string, savedMarkdown: string, versionId = '') {
  const subscribe = useCallback((listener: () => void) => subscribeDraft(articleId, listener), [articleId])
  const snapshot = useCallback(() => getDraftState(articleId), [articleId])
  const state = useSyncExternalStore(subscribe, snapshot)
  const draft = state.content ?? savedMarkdown
  return {
    draft, dirty: draft !== savedMarkdown, status: state.status, error: state.error,
    conflict: Boolean(state.baseVersionId && versionId && state.baseVersionId !== versionId),
    setDraft: useCallback((value: string) => updateWorkDraft(articleId, versionId, value), [articleId, versionId]),
    flush: useCallback(() => flushWorkDraft(articleId), [articleId]),
    markSaved: useCallback((committed?: { currentVersionId: string; consumedContent?: string; rebase?: boolean }) => reloadWorkDraft(articleId, committed), [articleId]),
    discard: useCallback((_saved?: string) => discardWorkDraft(articleId), [articleId])
  }
}
