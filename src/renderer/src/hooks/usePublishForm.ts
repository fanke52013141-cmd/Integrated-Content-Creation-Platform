import { useEffect, useRef, useState } from 'react'
import type { ArticleSummary, PublishFormDraft } from '../../../shared/contracts'
import { errorMessage } from '../lib'

function initialForm(article: ArticleSummary | undefined, appId: string, layoutId: string, author: string): PublishFormDraft {
  const paragraph = article?.rawMarkdown.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(line => line.length > 10 && !line.startsWith('![')) ?? ''
  return { articleId: article?.id ?? '', appId, layoutId, author, digest: paragraph.slice(0, 120), coverAssetId: '', thumbMediaId: '', contentSourceUrl: '' }
}

export function usePublishForm(article: ArticleSummary | undefined, appId: string, layoutId: string, defaultAuthor: string) {
  const [stored, setStored] = useState<PublishFormDraft | null>(null)
  const [loadedId, setLoadedId] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(Promise.resolve())
  const activeId = useRef(article?.id ?? '')
  activeId.current = article?.id ?? ''
  const form = stored?.articleId === article?.id && stored?.appId === appId ? stored : initialForm(article, appId, layoutId, defaultAuthor)
  const loaded = Boolean(article && loadedId === `${article.id}:${appId}`)

  useEffect(() => {
    let alive = true
    setError('')
    if (!article) { setLoadedId(''); setStored(null); return }
    const id = article.id
    void pending.current.then(() => window.moliu.publishing.getForm(id)).then(saved => {
      if (!alive) return
      setStored(saved?.appId === appId ? { ...saved, layoutId } : initialForm(article, appId, layoutId, defaultAuthor))
      setLoadedId(`${id}:${appId}`)
    }).catch(reason => { if (alive) setError(errorMessage(reason)) })
    return () => { alive = false }
  }, [article?.id, appId])

  const update = (patch: Partial<PublishFormDraft>): void => {
    if (!article || !loaded) return
    const next = { ...form, ...patch, articleId: article.id, appId, layoutId }
    setStored(next); setError('')
    pending.current = pending.current.then(() => window.moliu.publishing.saveForm(next)).catch(reason => {
      if (activeId.current === next.articleId) setError(`发布信息暂存失败：${errorMessage(reason)}`)
    })
  }
  return { form, loaded, error, update }
}
