import { ChevronRight } from 'lucide-react'
import type { RouteId } from './Layout'

/** 创作主链路（与侧边栏顺序一致） */
export const PIPELINE_STAGES: Array<{ id: RouteId; label: string }> = [
  { id: 'accounts', label: '账号' },
  { id: 'hotspots', label: '热点' },
  { id: 'topics', label: '选题' },
  { id: 'frameworks', label: '框架' },
  { id: 'articles', label: '文章' },
  { id: 'reviews', label: '评审' },
  { id: 'visuals', label: '配图' },
  { id: 'layouts', label: '排版' },
  { id: 'publishing', label: '发布' }
]

/**
 * 流程步骤条只做「当前位置」指示，不显示完成勾：
 * 完成与否取决于各阶段真实数据，导航序号推断出的「已完成」是假进度。
 */
export function PipelineSteps({ current, onNavigate }: { current: RouteId; onNavigate(route: RouteId): void }): React.JSX.Element | null {
  const index = PIPELINE_STAGES.findIndex((stage) => stage.id === current)
  if (index < 0) return null
  return (
    <nav className="pipeline-steps" aria-label="创作流程">
      {PIPELINE_STAGES.map((stage, i) => {
        const state = i === index ? 'current' : i < index ? 'past' : ''
        return (
          <span key={stage.id} className="pipeline-step-slot" style={{ display: 'contents' }}>
            {i > 0 && <ChevronRight size={12} className="pipeline-step-arrow" aria-hidden />}
            <button
              type="button"
              className={`pipeline-step ${state}`}
              onClick={() => onNavigate(stage.id)}
            >
              {stage.label}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
