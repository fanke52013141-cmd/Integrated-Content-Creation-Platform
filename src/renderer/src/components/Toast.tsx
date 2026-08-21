import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'

export interface ToastState {
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
}

const toastConfig = {
  success: { icon: CheckCircle2, label: '成功' },
  error: { icon: CircleAlert, label: '错误' },
  info: { icon: Info, label: '提示' },
  warning: { icon: TriangleAlert, label: '警告' }
} as const

export function Toast({
  toast,
  onClose
}: {
  toast?: ToastState
  onClose(): void
}): React.JSX.Element | null {
  if (!toast) return null
  const config = toastConfig[toast.type]
  const Icon = config.icon
  return (
    <div className={`toast ${toast.type}`} role="status" aria-label={config.label}>
      <Icon size={18} />
      <span>{toast.message}</span>
      <button className="icon-button" onClick={onClose} aria-label="关闭通知">
        <X size={14} />
      </button>
    </div>
  )
}
