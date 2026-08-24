import { useEffect, useCallback } from 'react'
import type { RouteId } from './Layout'

interface ShortcutHandlers {
  onSave?: () => void
  onNew?: () => void
  onGenerate?: () => void
  onSearch?: () => void
  onNavigate?: (route: RouteId) => void
  onShowShortcuts?: () => void
}

const NAV_SHORTCUTS: Record<string, RouteId> = {
  '1': 'accounts',
  '2': 'hotspots',
  '3': 'topics',
  '4': 'frameworks',
  '5': 'articles',
  '6': 'materials',
  '7': 'visuals',
  '8': 'reviews',
  '9': 'layouts',
  '0': 'publishing'
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    const isTyping =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.tagName === 'SELECT'

    if (event.key === '?' && event.shiftKey && !isTyping) {
      event.preventDefault()
      handlers.onShowShortcuts?.()
      return
    }

    if (event.ctrlKey || event.metaKey) {
      if (event.key === 's') {
        event.preventDefault()
        handlers.onSave?.()
        return
      }
      if (event.key === 'n' && !event.shiftKey) {
        event.preventDefault()
        handlers.onNew?.()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        handlers.onGenerate?.()
        return
      }
      if (event.key === 'f' && event.shiftKey) {
        event.preventDefault()
        handlers.onSearch?.()
        return
      }
    }

    if (!isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const route = NAV_SHORTCUTS[event.key]
      if (route && handlers.onNavigate) {
        event.preventDefault()
        handlers.onNavigate(route)
      }
    }
  }, [handlers])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

export interface ShortcutInfo {
  keys: string
  description: string
  category: string
}

export const SHORTCUT_LIST: ShortcutInfo[] = [
  { keys: 'Ctrl+S', description: '保存当前内容', category: '通用' },
  { keys: 'Ctrl+N', description: '新建草稿', category: '通用' },
  { keys: 'Ctrl+Enter', description: '触发 AI 生成', category: '通用' },
  { keys: 'Ctrl+Shift+F', description: '全局搜索', category: '通用' },
  { keys: 'Shift+?', description: '显示快捷键面板', category: '通用' },
  { keys: '1-9, 0', description: '快速切换页面', category: '导航' }
]
