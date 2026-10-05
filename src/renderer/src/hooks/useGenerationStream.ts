import { useCallback, useRef, useState } from 'react'
import type { GenerationDomain, StreamEvent } from '../../../shared/contracts'

export type StreamDomain = 'topics' | 'frameworks' | 'articles' | 'reviews' | 'visuals' | 'hotspots'

/** 流式通道名与主进程互斥域并非一一同名：热点筛选走 hotspot-filter，取消必须打到真实域 */
const CANCEL_DOMAIN: Record<StreamDomain, GenerationDomain> = {
  topics: 'topics',
  frameworks: 'frameworks',
  articles: 'articles',
  reviews: 'reviews',
  visuals: 'visuals',
  hotspots: 'hotspot-filter'
}

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
  isCancelled(): boolean
} {
  const cancelled = useRef(false)
  const [active, setActive] = useState(false)
  const [content, setContent] = useState('')

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    cancelled.current = false
    setActive(true)
    setContent('')
    const unsubscribeStatus = window.moliu.generation.events(event => { if (event.domain === CANCEL_DOMAIN[domain] && event.outcome === 'cancelled') cancelled.current = true })
    const unsubscribe = STREAM_SUBSCRIBERS[domain]((event) => {
      if (event.phase === 'start' && event.index === 0) setContent('')
      else if (event.phase === 'delta' && event.index === 0) setContent((prev) => prev + (event.delta ?? ''))
    })
    try {
      return await task()
    } finally {
      unsubscribe(); unsubscribeStatus()
      setActive(false)
      setContent('')
    }
  }, [domain])

  const cancel = useCallback((): void => {
    cancelled.current = true
    void window.moliu.generation.cancel(CANCEL_DOMAIN[domain])
  }, [domain])

  return { active, content, run, cancel, isCancelled: () => cancelled.current }
}

/** 判断错误是否由用户取消引起（用于把报错降级为提示） */
export function isCancelError(error: unknown): boolean {
  return error instanceof Error && /已取消/.test(error.message)
}
