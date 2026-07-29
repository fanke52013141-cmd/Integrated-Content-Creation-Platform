import { AlertTriangle, X } from 'lucide-react'
import { ModalBase } from './ModalBase'

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
  // P1-6: 使用 ModalBase 统一处理 focus trap / Escape / inert 背景
  return (
    <ModalBase open={open} onClose={onCancel} titleId="confirm-title" labelledBy="confirm-title">
      <button className="icon-button modal-close" onClick={onCancel} aria-label="关闭">
        <X size={18} />
      </button>
      <span className={`modal-symbol ${danger ? 'danger' : ''}`} aria-hidden="true">
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
    </ModalBase>
  )
}
