import { CheckCircle2, CircleAlert, X } from 'lucide-react'

export interface ToastState {
  type: 'success' | 'error'
  message: string
}

export function Toast({
  toast,
  onClose
}: {
  toast?: ToastState
  onClose(): void
}): React.JSX.Element | null {
  if (!toast) return null
  return (
    <div className={`toast ${toast.type}`} role="status">
      {toast.type === 'success' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      <span>{toast.message}</span>
      <button className="icon-button" onClick={onClose} aria-label="关闭通知">
        <X size={15} />
      </button>
    </div>
  )
}
