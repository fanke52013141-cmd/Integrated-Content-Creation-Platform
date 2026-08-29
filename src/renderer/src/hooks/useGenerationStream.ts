import { useCallback, useState } from 'react'
import type { StreamEvent } from '../../../shared/contracts'

export type StreamDomain = 'topics' | 'frameworks' | 'articles' | 'reviews' | 'visuals' | 'hotspots'

const STREAM_SUBSCRIBERS: Record<StreamDomain, (callback: (event: StreamEvent) => void) => () => void> = {
  topics: (callback) => window.moliu.topics.onStream(callback),
  frameworks: (callback) => window.moliu.frameworks.onStream(callback),
  articles: (callback) => window.moliu.articles.onStream(callback),
  reviews: (callback) => window.moliu.reviews.onStream(callback),
  visuals: (callback) => window.moliu.visuals.onStream(callback),
  hotspots: (callback) => window.moliu.hotspots.onStream(callback)
}

/**
 * 生成任务流式反馈 + 取消，统一各页面的订阅样板：
 * - run(task) 订阅流事件、清空预览、执行任务并在结束后清理；
 * - 只展示第一个候选（index === 0）的增量；
 * - cancel() 请求主进程中止该模块的生成任务。
 */
export function useGenerationStream(domain: StreamDomain): {
  active: boolean
  content: string
  run<T>(task: () => Promise<T>): Promise<T>
  cancel(): void
} {
  const [active, setActive] = useState(false)
  const [content, setContent] = useState('')

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setActive(true)
    setContent('')
    const unsubscribe = STREAM_SUBSCRIBERS[domain]((event) => {
      if (event.phase === 'start' && event.index === 0) setContent('')
      else if (event.phase === 'delta' && event.index === 0) setContent((prev) => prev + (event.delta ?? ''))
    })
    try {
      return await task()
    } finally {
      unsubscribe()
      setActive(false)
      setContent('')
    }
  }, [domain])

  const cancel = useCallback((): void => {
    void window.moliu.generation.cancel(domain)
  }, [domain])

  return { active, content, run, cancel }
}

/** 判断错误是否由用户取消引起（用于把报错降级为提示） */
export function isCancelError(error: unknown): boolean {
  return error instanceof Error && /已取消/.test(error.message)
}
