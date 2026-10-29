import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * P1-5: 命令式 confirm hook。
 *
 * 用法：
 *   const confirm = useConfirm()
 *   if (await confirm({ title: '删除排版稿？', message: '此操作不可撤销。', danger: true })) {
 *     await removeLayout()
 *   }
 *
 * 在组件树中渲染 <ConfirmPortal /> 一次即可。
 */

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  /** 提供后显示「不再提示」勾选；用户勾选并确认时回调（例如记住本次会话跳过该确认） */
  suppressLabel?: string
  onSuppress?(): void
}

interface PendingState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export function useConfirm(): {
  confirm(options: ConfirmOptions): Promise<boolean>
  ConfirmPortal: ReactNode
} {
  const [pending, setPending] = useState<PendingState | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const handleClose = useCallback((): void => {
    pending?.resolve(false)
    setPending(null)
  }, [pending])

  const handleConfirm = useCallback((): void => {
    pending?.resolve(true)
    setPending(null)
  }, [pending])

  const ConfirmPortal: ReactNode = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      suppressLabel={pending.suppressLabel}
      onSuppress={pending.onSuppress}
      onCancel={handleClose}
      onConfirm={handleConfirm}
    />
  ) : null

  return { confirm, ConfirmPortal }
}
