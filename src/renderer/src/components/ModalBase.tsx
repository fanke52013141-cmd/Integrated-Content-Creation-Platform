import { useEffect, useRef, type ReactNode } from 'react'
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
  bare?: boolean
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

const modalStack: HTMLElement[] = []
let restoreBackground: (() => void) | undefined

function syncModalStack(): void {
  modalStack.forEach((dialog, index) => {
    dialog.inert = index !== modalStack.length - 1
    if (dialog.parentElement) dialog.parentElement.style.zIndex = String(1100 + index)
  })
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => element.getClientRects().length > 0 && !element.closest('[inert], [hidden]')
  )
}

export function ModalBase({
  open,
  onClose,
  titleId,
  children,
  labelledBy,
  describedBy,
  className,
  closeOnOverlay = true,
  bare = false
}: ModalBaseProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLElement>(null)
  // 输入引发重渲染时更新回调，不重建焦点锁。
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    const previousActive = document.activeElement
    if (!modalStack.length) {
      const root = document.getElementById('root')
      const wasInert = root?.inert ?? false
      const previousOverflow = document.body.style.overflow
      if (root) root.inert = true
      document.body.style.overflow = 'hidden'
      restoreBackground = () => {
        if (root) root.inert = wasInert
        document.body.style.overflow = previousOverflow
      }
    }
    modalStack.push(dialog)
    syncModalStack()
    const frame = requestAnimationFrame(() => {
      if (modalStack.at(-1) !== dialog) return
      const candidates = focusableElements(dialog)
      ;(candidates.find(element => element.hasAttribute('data-autofocus')) ?? candidates[0] ?? dialog).focus()
    })

    const handleKeydown = (event: KeyboardEvent): void => {
      if (modalStack.at(-1) !== dialog || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeRef.current()
        return
      }
      if (event.key === 'Tab' && dialog) {
        const focusables = focusableElements(dialog)
        if (focusables.length === 0) {
          event.preventDefault()
          dialog.focus()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !dialog.contains(active) || active === dialog)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeydown)
      const index = modalStack.indexOf(dialog)
      if (index !== -1) modalStack.splice(index, 1)
      syncModalStack()
      if (!modalStack.length) {
        restoreBackground?.()
        restoreBackground = undefined
      }
      if (previousActive instanceof HTMLElement && previousActive.isConnected && !previousActive.closest('[inert]')) {
        previousActive.focus()
      } else if (modalStack.length) {
        modalStack.at(-1)?.focus()
      }
    }
  }, [open])

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
        className={bare ? (className ?? '') : `modal ${className ?? ''}`}
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
