import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ArticleStatus } from '../../shared/contracts'
import type { RouteId } from './components/Layout'

/**
 * 当前作品上下文：一篇文章在框架→成稿→评审→配图→排版→发布之间始终是同一篇。
 * 各页面只负责「报告自己正在处理哪篇」，页头与跨页跳转读这里，避免每页重新选一遍。
 */
export interface ActiveWork {
  articleId: string
  title: string
  accountId?: string
  versionCount: number
  status: ArticleStatus
  stage: RouteId
  dirty?: boolean
}

const STORAGE_KEY = 'moliu:active-work'

interface ActiveWorkValue {
  work: ActiveWork | null
  setWork(work: ActiveWork | null): void
}

const ActiveWorkContext = createContext<ActiveWorkValue | null>(null)

function readStoredWork(): ActiveWork | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActiveWork>
    if (!parsed.articleId || !parsed.title) return null
    return {
      articleId: parsed.articleId,
      title: parsed.title,
      accountId: parsed.accountId,
      versionCount: Number(parsed.versionCount) || 1,
      status: parsed.status === 'locked' ? 'locked' : 'draft',
      stage: (parsed.stage ?? 'articles') as RouteId,
      dirty: Boolean(parsed.dirty)
    }
  } catch {
    return null
  }
}

export function ActiveWorkProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [work, setWorkState] = useState<ActiveWork | null>(() => readStoredWork())

  const setWork = useCallback((next: ActiveWork | null): void => {
    setWorkState((current) => {
      if (JSON.stringify(current) === JSON.stringify(next)) return current
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
      return next
    })
  }, [])

  const value = useMemo(() => ({ work, setWork }), [work, setWork])
  return <ActiveWorkContext.Provider value={value}>{children}</ActiveWorkContext.Provider>
}

export function useActiveWork(): ActiveWorkValue {
  const context = useContext(ActiveWorkContext)
  if (!context) throw new Error('useActiveWork 必须在 ActiveWorkProvider 内使用')
  return context
}

/** 页面把当前选中作品上报给统一页头；未选中时不覆盖已有上下文 */
export function useReportWork(input: Partial<ActiveWork> & { articleId?: string }, stage: RouteId): void {
  const { setWork } = useActiveWork()
  const { articleId, title, accountId, versionCount, status, dirty } = input
  useEffect(() => {
    if (!articleId || !title) return
    setWork({ articleId, title, accountId, versionCount: versionCount ?? 1, status: status ?? 'draft', stage, dirty })
  }, [articleId, title, accountId, versionCount, status, dirty, stage, setWork])
}

/** 打开某篇作品：写入上下文并跳到指定阶段 */
export function useOpenWork(): (articleId: string, stage?: RouteId) => Promise<ActiveWork | null> {
  const { setWork } = useActiveWork()
  return useCallback(async (articleId: string, stage: RouteId = 'articles') => {
    const article = await window.moliu.articles.get(articleId)
    if (!article) return null
    const next: ActiveWork = {
      articleId: article.id,
      title: articleTitleOf(article.rawMarkdown),
      accountId: article.accountId,
      versionCount: article.versionCount,
      status: article.status,
      stage
    }
    setWork(next)
    return next
  }, [setWork])
}

export function articleTitleOf(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '未命名文章'
}
