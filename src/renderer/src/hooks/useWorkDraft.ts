import { useCallback, useEffect, useRef, useState } from 'react'
import { isDraftDirty, readWorkDraft, writeWorkDraft, type KeyValueStore } from '../../../shared/creation-state'

function browserStore(): KeyValueStore | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

export interface WorkDraft {
  draft: string
  dirty: boolean
  setDraft(value: string): void
  /** 正文已落库：清掉本地工作草稿，恢复跟随库内容 */
  markSaved(): void
  /** 放弃本地未保存修改，回到库内正文 */
  discard(saved: string): void
}

/**
 * 按文章隔离的工作草稿。articleId 变化时先取本地未保存内容，没有才用库内正文，
 * 因此切页、切文章、重启后都能回到用户最后写下的字。
 */
export function useWorkDraft(articleId: string, savedMarkdown: string): WorkDraft {
  const store = browserStore()
  const loadedArticle = useRef(articleId)
  const savedRef = useRef(savedMarkdown)
  savedRef.current = savedMarkdown

  const [draft, setDraftState] = useState(() => readWorkDraft(store, articleId) ?? savedMarkdown)
  const [dirty, setDirty] = useState(() => isDraftDirty(readWorkDraft(store, articleId), savedMarkdown))

  useEffect(() => {
    if (loadedArticle.current === articleId) return
    loadedArticle.current = articleId
    const local = readWorkDraft(store, articleId)
    setDraftState(local ?? savedRef.current)
    setDirty(isDraftDirty(local, savedRef.current))
  }, [articleId, store])

  // 同一篇文章的库内容更新（保存、改稿、恢复版本）在无脏改动时跟随；有未保存修改时不覆盖屏幕。
  // 这里以本地草稿为准再判一次：切换文章的那一帧 dirty 还是旧值，只靠它会把刚取回的草稿冲掉。
  useEffect(() => {
    if (loadedArticle.current !== articleId || dirty) return
    if (readWorkDraft(store, articleId) !== null) return
    setDraftState(savedMarkdown)
  }, [savedMarkdown, articleId, dirty, store])

  const setDraft = useCallback((value: string): void => {
    setDraftState(value)
    const next = value !== savedRef.current
    setDirty(next)
    writeWorkDraft(store, articleId, next ? value : '')
  }, [articleId, store])

  const markSaved = useCallback((): void => {
    writeWorkDraft(store, articleId, '')
    setDirty(false)
  }, [articleId, store])

  const discard = useCallback((saved: string): void => {
    writeWorkDraft(store, articleId, '')
    setDraftState(saved)
    setDirty(false)
  }, [articleId, store])

  return { draft, dirty, setDraft, markSaved, discard }
}
