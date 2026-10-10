import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'

export interface ToastState {
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  /** 可选的就近出口：点了动作即视为处理完毕，通知随之关闭 */
  action?: { label: string; onClick(): void }
}

export interface ToastItem extends ToastState {
  id: number
}

const toastConfig = {
  success: { icon: CheckCircle2, label: '成功' },
  error: { icon: CircleAlert, label: '错误' },
  info: { icon: Info, label: '提示' },
  warning: { icon: TriangleAlert, label: '警告' }
} as const

/**
 * 可堆叠通知：所有类型都会自动消失（错误 8s、警告 6s、其余 4.5s，见 App），
 * 同文案重复触发时只刷新已有的一条，不再无限叠挂。
 */
export function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss(id: number): void }): React.JSX.Element | null {
  if (!toasts.length) return null
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const config = toastConfig[toast.type]
        const Icon = config.icon
        return (
          <div key={toast.id} className={`toast ${toast.type}`} role="status" aria-label={config.label}>
            <Icon size={17} />
            <span className="toast-body">{toast.message}</span>
            {toast.action && (
              <button
                className="text-button toast-action"
                onClick={() => { toast.action?.onClick(); onDismiss(toast.id) }}
              >
                {toast.action.label}
              </button>
            )}
            <button className="icon-button" onClick={() => onDismiss(toast.id)} aria-label="关闭通知">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
