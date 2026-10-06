import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { RouteId } from './Layout'
import { PipelineSteps } from './PipelineSteps'

interface PageHeaderProps {
  /** 当前路由。仅在 showPipeline 为true 时用于流程条定位，不再自动触发。 */
  route?: RouteId
  /**
   * 是否展示顶部流程步骤条（2026-10-06 改为显式开关，默认关闭）。
   *
   * 此前只要传了 route 就会渲染，于是每个页面顶部都出现一条 9 步流程条，
   * 与侧边栏的创作组指向同一批目的地——用户想「写文章」要在两处找
   * 不同叫法（文章创作 / 正文）。这是重复导航的主要来源。
   * 现导航统一由侧边栏承担；确有需要流程条的页面再显式开启。
   */
  showPipeline?: boolean
  title: string
  /** 中文副标题，替代原来的英文眉题 */
  description?: string
  actions?: ReactNode
  onNavigate?(route: RouteId, params?: Record<string, string>): void
}

export function PageHeader({ route, showPipeline = false, title, description, actions, onNavigate }: PageHeaderProps): React.JSX.Element {
  return (
    <>
      {showPipeline && route && onNavigate && <PipelineSteps current={route} onNavigate={onNavigate} />}
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
