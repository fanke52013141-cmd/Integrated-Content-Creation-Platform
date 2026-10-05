import { Layers, X } from 'lucide-react'
import type { AccountProfileSummary, GenerationDomain, GenerationTask } from '../../../shared/contracts'
import { GENERATION_DOMAIN_LABELS } from '../../../shared/contracts'
import { WORKBAR_STAGES } from '../../../shared/creation-flow'
import { useActiveWork } from '../active-work'
import type { RouteId } from './Layout'
import { ModalBase } from './ModalBase'
import { EmptyState } from './EmptyState'
import { formatDate, errorMessage } from '../lib'
import { useEffect, useState } from 'react'
import { useWorkDraft } from '../hooks/useWorkDraft'
import { CircleDashed, Clock3, ListChecks } from 'lucide-react'

/** 作品栏阶段：只含成稿之后的推进阶段，顺序与顶部流水线一致 */
const STAGES = WORKBAR_STAGES

export const DOMAIN_ROUTE: Record<GenerationDomain, RouteId> = {
  account: 'accounts',
  'hotspot-filter': 'hotspots',
  topics: 'topics',
  frameworks: 'frameworks',
  articles: 'articles',
  reviews: 'reviews',
  visuals: 'visuals'
}

const TASK_STATE: Record<GenerationTask['status'], { label: string; badge: string }> = {
  running: { label: '进行中', badge: 'neutral' },
  succeeded: { label: '已完成', badge: 'success' },
  partial: { label: '部分完成', badge: 'warning' },
  failed: { label: '失败', badge: 'danger' },
  cancelled: { label: '已取消', badge: 'neutral' },
  interrupted: { label: '中断', badge: 'warning' }
}

/** 统一作品页头：不管在哪一页，都能看见正在写的到底是哪篇、什么状态、下一步去哪 */
export function WorkBar({ accounts, onNavigate }: { accounts: AccountProfileSummary[]; onNavigate(route: RouteId, params?: Record<string, string>): void }): React.JSX.Element | null {
  const { work, setWork } = useActiveWork()
  const local = useWorkDraft(work?.articleId ?? '', work?.savedMarkdown ?? '', work?.currentVersionId ?? '')
  if (!work) return null
  const account = accounts.find((item) => item.id === work.accountId)
  return (
    <div className="work-bar" aria-label="当前作品">
      <Layers size={15} className="work-bar-icon" aria-hidden />
      <button className="work-bar-title" title={work.title} onClick={() => onNavigate('articles', { articleId: work.articleId })}>{work.title}</button>
      <span className="work-bar-meta">{account?.name ?? '未绑定账号'} · 第 {work.versionCount} 版{work.status === 'locked' ? ' · 已锁定' : ''}</span>
      <span className={`badge ${local.dirty || local.status === 'error' ? 'warning' : 'success'}`} role="status">{local.status === 'loading' ? '读取草稿…' : local.status === 'saving' ? '正在暂存…' : local.status === 'error' ? '暂存失败' : local.dirty ? '已本地暂存 · 待保存版本' : `已保存第 ${work.versionCount} 版`}</span>
      <div className="segmented work-bar-stages" role="group" aria-label="创作阶段">
        {STAGES.map((stage) => (
          <button
            key={stage.id}
            className={stage.id === work.stage ? 'active' : ''}
            onClick={() => onNavigate(stage.id, { articleId: work.articleId })}
            aria-current={stage.id === work.stage ? 'step' : undefined}
          >
            {stage.workBarLabel ?? stage.label}
          </button>
        ))}
      </div>
      <button className="icon-button" title="收起作品栏" aria-label="收起作品栏" onClick={() => setWork(null)}><X size={14} /></button>
    </div>
  )
}

/** 任务中心：跨页面与重启后仍能看到生成任务真实结果，失败与部分完成不隐藏在页面局部状态里 */
export function TaskCenterDialog({ open, onClose, onNavigate }: { open: boolean; onClose(): void; onNavigate(route: RouteId, params?: Record<string, string>): void }): React.JSX.Element | null {
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    const load = (): void => {
      window.moliu.generation.list(40)
        .then((items) => { if (alive) { setTasks(items); setError('') } })
        .catch((reason: unknown) => { if (alive) setError(errorMessage(reason)) })
    }
    load()
    const unsubscribe = window.moliu.generation.events(load)
    return () => { alive = false; unsubscribe() }
  }, [open])

  return (
    <ModalBase open={open} onClose={onClose} titleId="task-center-title" className="task-center-dialog">
      <header><div><h2 id="task-center-title"><ListChecks size={16} /> 任务中心</h2><p>每次生成都会留痕：中断、失败与部分完成都按真实结果显示。</p></div><button className="icon-button" aria-label="关闭任务中心" onClick={onClose}><X size={18} /></button></header>
      {error && <p className="inline-alert">{error}</p>}
      {tasks.length ? (
        <ul className="task-list">
          {tasks.map((task) => {
            const state = TASK_STATE[task.status]
            return (
              <li key={task.id} className="task-item">
                <span className="task-item-main">
                  <strong>{task.label}</strong>
                  <small><Clock3 size={11} /> {formatDate(task.finishedAt ?? task.startedAt)}</small>
                </span>
                {task.detail && <span className="task-item-detail" title={task.detail}>{task.detail}</span>}
                <span className={`badge ${state.badge}`}>{state.label}</span>
                {task.status === 'running' && <button className="button ghost compact" onClick={() => void window.moliu.generation.cancel(task.domain)}>取消任务</button>}
                <button className="button ghost compact" onClick={() => {
                  const target: Record<string, string> | undefined = task.articleId ? { articleId: task.articleId } : task.resultIds?.[0] && task.domain === 'frameworks' ? { frameworkId: task.resultIds[0] } : undefined
                  onNavigate(task.articleId ? DOMAIN_ROUTE[task.domain] : task.domain === 'frameworks' && target ? 'articles' : DOMAIN_ROUTE[task.domain], target); onClose()
                }}>{task.status === 'failed' || task.status === 'partial' ? '查看结果与失败原因' : '打开结果'}</button>
              </li>
            )
          })}
        </ul>
      ) : <EmptyState icon={CircleDashed} title="还没有生成任务" description="生成选题、框架或文章后，这里会留下每次运行的结果。" />}
      <footer><span className="micro-copy">任务台账保留最近 40 条，重启后仍能看到上次运行的真实结果。</span><button className="button secondary compact" onClick={onClose}>关闭</button></footer>
    </ModalBase>
  )
}
