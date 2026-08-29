import type { LucideIcon } from 'lucide-react'
import { CircleAlert, RotateCcw } from 'lucide-react'

interface ErrorStateProps {
  icon?: LucideIcon
  title?: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

/** 加载失败态：与空状态明确区分，并提供重试入口 */
export function ErrorState({ icon: Icon = CircleAlert, title = '加载失败', message, actionLabel = '重试', onAction }: ErrorStateProps): React.JSX.Element {
  return (
    <div className="empty-state error-state" role="alert">
      <div className="empty-state-icon">
        <Icon size={26} />
      </div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc break-all">{message}</div>
      {onAction && (
        <button className="button secondary compact empty-state-action" onClick={onAction}>
          <RotateCcw size={14} />
          {actionLabel}
        </button>
      )}
    </div>
  )
}
