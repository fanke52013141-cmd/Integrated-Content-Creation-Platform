import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'

export interface ToastState {
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
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
 * 可堆叠通知：错误会保留直到手动关闭，其余 4.5s 自动消失（见 App）。
 */
export function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss(id: number): void }): React.JSX.Element | null {
  if (!toasts.length) return null
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const config = toastConfig[toast.type]
        const Icon = config.icon
        return (
          <div key={toast.id} className={`toast ${toast.type}`} role="status" aria-label={config.label}>
            <Icon size={17} />
            <span className="toast-body">{toast.message}</span>
            <button className="icon-button" onClick={() => onDismiss(toast.id)} aria-label="关闭通知">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
