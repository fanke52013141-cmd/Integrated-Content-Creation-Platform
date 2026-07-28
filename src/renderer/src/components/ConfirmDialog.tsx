import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel(): void
  onConfirm(): void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps): React.JSX.Element | null {
  if (!open) return null
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={onCancel} aria-label="关闭">
          <X size={18} />
        </button>
        <span className={`modal-symbol ${danger ? 'danger' : ''}`}>
          <AlertTriangle size={22} />
        </span>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="button secondary" onClick={onCancel}>取消</button>
          <button className={`button ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
