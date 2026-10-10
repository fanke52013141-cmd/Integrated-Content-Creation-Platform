import { useEffect, useCallback } from 'react'
import { CREATION_FLOW } from '../../../shared/creation-flow'
import type { RouteId } from './Layout'

interface ShortcutHandlers {
  onSave?: () => void
  onNew?: () => void
  onGenerate?: () => void
  onSearch?: () => void
  onNavigate?: (route: RouteId) => void
  onShowShortcuts?: () => void
}

/**
 * 数字键1-9 依次对应创作主链路前 9 个阶段，0 为第 10 个（若有）。
 * 顺序直接取自 shared/creation-flow，与侧边栏、顶部流水线、作品栏完全一致，
 * 避免再出现「快捷键是一种顺序、导航又是另一种顺序」的情况。
 */
const NAV_SHORTCUTS: Record<string, RouteId> = Object.fromEntries(
  CREATION_FLOW.map((stage, index) => [
    String((index + 1) % 10),
    stage.id
  ])
)

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (document.querySelector('[aria-modal="true"]')) return
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
  { keys: 'Ctrl+N', description: '前往文章创作', category: '通用' },
  { keys: 'Ctrl+Enter', description: '在输入框内直接触发生成/改稿', category: '通用' },
  { keys: 'Ctrl+Shift+F', description: '前往素材库搜索', category: '通用' },
  { keys: 'Shift+?', description: '显示快捷键面板', category: '通用' },
  // 描述由流程定义生成，避免与实际按键映射不一致
  {
    keys: '1-9, 0',
    description: `按创作流程顺序切换：${CREATION_FLOW.map((stage, i) => `${(i + 1) % 10} ${stage.sidebarLabel}`).join(' · ')}`,
    category: '导航'
  }
]
