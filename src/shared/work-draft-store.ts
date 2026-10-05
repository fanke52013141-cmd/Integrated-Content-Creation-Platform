import type { MoliuApi, WorkDraft } from './contracts.js'

export interface DraftState {
  value: WorkDraft | null
  content?: string
  baseVersionId?: string
  status: 'loading' | 'saving' | 'saved' | 'error'
  error?: string
  edits: number
}
interface Entry { state: DraftState; listeners: Set<() => void>; pending: Promise<void> }
export function createWorkDraftStore(api: Pick<MoliuApi['articles'], 'getDraft' | 'saveDraft' | 'discardDraft'>) {
  const entries = new Map<string, Entry>()
  function publish(entry: Entry, patch: Partial<DraftState>): void {
    entry.state = { ...entry.state, ...patch }
    for (const listener of entry.listeners) listener()
  }
  function entryFor(articleId: string): Entry {
    let entry = entries.get(articleId)
    if (entry) return entry
    entry = { state: { value: null, status: articleId ? 'loading' : 'saved', edits: 0 }, listeners: new Set(), pending: Promise.resolve() }
    entries.set(articleId, entry)
    const current = entry
    current.pending = articleId ? api.getDraft(articleId).then(value => {
      publish(current, { value, ...(current.state.edits === 0 ? { content: value?.content, baseVersionId: value?.baseVersionId, status: 'saved' as const } : {}) })
    }).catch(reason => publish(current, { status: 'error', error: reason instanceof Error ? reason.message : '草稿读取失败' })) : Promise.resolve()
    return current
  }
  function subscribeDraft(articleId: string, listener: () => void): () => void {
    const entry = entryFor(articleId); entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }
  function getDraftState(articleId: string): DraftState { return entryFor(articleId).state }
  function updateWorkDraft(articleId: string, baseVersionId: string, content: string): void {
    if (!articleId || !baseVersionId) return
    const entry = entryFor(articleId)
    const baseline = entry.state.baseVersionId ?? baseVersionId
    const edit = entry.state.edits + 1
    publish(entry, { content, baseVersionId: baseline, edits: edit, status: 'saving', error: undefined })
    entry.pending = entry.pending.then(async () => {
      try {
        const value = await api.saveDraft({ articleId, baseVersionId: baseline, content, expectedRevision: entry.state.value?.revision ?? 0 })
        publish(entry, { value, ...(entry.state.edits === edit ? { status: 'saved' as const, error: undefined } : {}) })
      } catch (reason) { publish(entry, { status: 'error', error: reason instanceof Error ? reason.message : '本地暂存失败' }) }
    })
  }
  async function flushWorkDraft(articleId: string): Promise<WorkDraft | null> {
    const entry = entryFor(articleId); await entry.pending
    if (entry.state.status === 'error') throw new Error(entry.state.error)
    return entry.state.value
  }
  async function reloadWorkDraft(articleId: string, committed?: { currentVersionId: string; consumedContent?: string; rebase?: boolean }): Promise<void> {
    const entry = entryFor(articleId); await entry.pending
    const edit = entry.state.edits
    const value = await api.getDraft(articleId)
    if (entry.state.edits !== edit) return
    const content = entry.state.content
    // 保存请求发出后仍可继续输入；只清除本次实际提交的内容。
    if (committed && content !== undefined && content !== committed.consumedContent) {
      const baseline = committed.rebase === false ? entry.state.baseVersionId ?? committed.currentVersionId : committed.currentVersionId
      publish(entry, { value, baseVersionId: baseline })
      updateWorkDraft(articleId, baseline, content)
      await entry.pending
      return
    }
    publish(entry, { value, content: value?.content, baseVersionId: value?.baseVersionId, status: 'saved', error: undefined })
  }
  async function discardWorkDraft(articleId: string): Promise<void> {
    const entry = entryFor(articleId); await entry.pending
    await api.discardDraft(articleId)
    publish(entry, { value: null, content: undefined, baseVersionId: undefined, status: 'saved', error: undefined })
  }

  return { subscribeDraft, getDraftState, updateWorkDraft, flushWorkDraft, reloadWorkDraft, discardWorkDraft }
}
