import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * P1-6: 模态弹窗基础组件，统一提供：
 * - focus trap（Tab/Shift+Tab 循环）
 * - Escape 关闭
 * - 打开时聚焦首个可聚焦元素
 * - 点击遮罩关闭
 * - 背景内容 inert（避免被聚焦/读屏）
 * - aria-modal/role="dialog"
 *
 * 不依赖任何第三方库，自研实现。
 */
export interface ModalBaseProps {
  open: boolean
  onClose(): void
  titleId: string
  children: ReactNode
  labelledBy?: string
  describedBy?: string
  className?: string
  closeOnOverlay?: boolean
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ModalBase({
  open,
  onClose,
  titleId,
  children,
  labelledBy,
  describedBy,
  className,
  closeOnOverlay = true
}: ModalBaseProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLElement>(null)
  const previousActiveElement = useRef<Element | null>(null)
  const previousInert = useRef<Array<{ element: Element; wasInert: boolean }>>([])

  // P1-6: 锁定背景元素（main 与 body 直接子节点），打开时设 inert
  const setBgInert = useCallback((shouldInert: boolean) => {
    const mainEl = document.getElementById('main')
    const targets: Element[] = []
    if (mainEl) targets.push(mainEl)
    // 不直接处理 body 子节点，避免影响 modal 自身
    if (shouldInert) {
      previousInert.current = []
      for (const el of targets) {
        if (!el.hasAttribute('inert')) {
          previousInert.current.push({ element: el, wasInert: false })
          el.setAttribute('inert', '')
        }
      }
    } else {
      for (const { element } of previousInert.current) {
        element.removeAttribute('inert')
      }
      previousInert.current = []
    }
  }, [])

  useEffect(() => {
    if (!open) return

    // 保存当前焦点，关闭时还原
    previousActiveElement.current = document.activeElement
    setBgInert(true)

    const dialog = dialogRef.current
    if (dialog) {
      // 聚焦首个可聚焦元素
      const focusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable) {
        requestAnimationFrame(() => focusable.focus())
      } else {
        requestAnimationFrame(() => dialog.focus())
      }
    }

    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Tab' && dialog) {
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        if (focusables.length === 0) {
          event.preventDefault()
          dialog.focus()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
      setBgInert(false)
      // 还原焦点
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus()
      }
    }
  }, [open, onClose, setBgInert])

  if (!open) return null

  // v1.1: 使用 createPortal 渲染到 body，避免 ModalBase 设置 main inert 时把对话框自身
  // （如 MaterialsPage 内嵌的 ManualMaterialDialog）一并拦截
  return createPortal(
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className={`modal ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    document.body
  )
}
