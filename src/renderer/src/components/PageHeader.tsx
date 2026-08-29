import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { RouteId } from './Layout'
import { PipelineSteps } from './PipelineSteps'

interface PageHeaderProps {
  /** 传入主链路 route 时展示流程步骤条 */
  route?: RouteId
  title: string
  /** 中文副标题，替代原来的英文眉题 */
  description?: string
  actions?: ReactNode
  onNavigate?(route: RouteId, params?: Record<string, string>): void
}

export function PageHeader({ route, title, description, actions, onNavigate }: PageHeaderProps): React.JSX.Element {
  return (
    <>
      {route && onNavigate && <PipelineSteps current={route} onNavigate={onNavigate} />}
      <section className="page-intro">
        <div>
          <h2>{title}</h2>
          {description && <p className="micro-copy">{description}</p>}
        </div>
        {actions && <div className="page-intro-actions">{actions}</div>}
      </section>
    </>
  )
}

interface NextStepBarProps {
  text: string
  actionLabel: string
  onAction(): void
  icon?: ReactNode
}

/** 「下一步」引导条：完成当前阶段后给出明确的去向下一步 */
export function NextStepBar({ text, actionLabel, onAction, icon }: NextStepBarProps): React.JSX.Element {
  return (
    <div className="next-step-bar">
      <span className="next-step-text">{text}</span>
      <button className="button primary compact" onClick={onAction}>
        {icon}
        {actionLabel}
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
