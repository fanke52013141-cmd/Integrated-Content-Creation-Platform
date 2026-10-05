import { ChevronRight } from 'lucide-react'
import { PIPELINE_STAGES } from '../../../shared/creation-flow'
import type { RouteId } from './Layout'
import { useActiveWork } from '../active-work'
import { WORKBAR_STAGES } from '../../../shared/creation-flow'

/**
 * 流程步骤条只做「当前位置」指示，不显示完成勾：
 * 完成与否取决于各阶段真实数据，导航序号推断出的「已完成」是假进度。
 *
 * 阶段顺序来自 shared/creation-flow 的 PIPELINE_STAGES，
 * 与侧边栏分组、作品栏阶段同源，改流程只需改那一个文件。
 */
export function PipelineSteps({ current, onNavigate }: { current: RouteId; onNavigate(route: RouteId, params?: Record<string, string>): void }): React.JSX.Element | null {
  const { work } = useActiveWork()
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
              onClick={() => onNavigate(stage.id, work && WORKBAR_STAGES.some(item => item.id === stage.id) ? { articleId: work.articleId } : undefined)}
              aria-current={stage.id === current ? 'step' : undefined}
            >
              {stage.label}{stage.id === 'reviews' || stage.id === 'hotspots' || stage.id === 'accounts' ? '（可选）' : ''}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
