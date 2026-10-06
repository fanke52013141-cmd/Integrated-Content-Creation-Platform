import { useEffect, useState } from 'react'
import type { Article } from '../../../shared/contracts'
import { errorMessage } from '../lib'

/** 当前文章按 ID 读取；不依赖选择器最近一页，旧稿也可直达。 */
export function useSelectedArticle(id: string, revisionKey: unknown = '') {
  const [state, setState] = useState<{ article?: Article; loading: boolean; error?: string }>({ loading: false })
  useEffect(() => {
    let alive = true
    setState({ loading: Boolean(id) })
    if (id) void window.moliu.articles.get(id).then(article => {
      if (alive) setState(article ? { article, loading: false } : { loading: false, error: '目标文章已删除或不存在，请重新选择' })
    }).catch(error => { if (alive) setState({ loading: false, error: errorMessage(error) }) })
    return () => { alive = false }
  }, [id, revisionKey])
  return state.article && state.article.id !== id ? { loading: Boolean(id), article: undefined, error: undefined } : state
}
