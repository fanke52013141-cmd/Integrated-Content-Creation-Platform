import { useEffect, useMemo, useState } from 'react'
import {
  Check, CircleCheckBig, FileText, Plus, RotateCcw, Settings2, Sparkles, X
} from 'lucide-react'
import type { Article, ProviderSummary, ReviewFailure, ReviewRole, ReviewTask, ReviewTaskStatus } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { ModalBase } from '../components/ModalBase'
import { Select } from '../components/Select'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { StreamingPreview } from '../components/StreamingPreview'
import { useConfirm } from '../components/useConfirm'
import { useGenerationStream, isCancelError } from '../hooks/useGenerationStream'
import { availableModels, encodeModelTarget, useModelTarget } from '../lib/models'
import { errorMessage, formatDate, markdownTitle } from '../lib'
import { useReportWork } from '../active-work'
import { isReviewBaselineStale } from '../../../shared/creation-state'

interface ReviewsPageProps {
  providers: ProviderSummary[]
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  showToast(toast: ToastState): void
}

const severityLabels: Record<string, { label: string; badge: string }> = {
  high: { label: '高', badge: 'danger' },
  medium: { label: '中', badge: 'warning' },
  low: { label: '低', badge: 'neutral' }
}

const statusLabels: Record<ReviewTaskStatus, string> = {
  running: '评审中',
  completed: '待应用',
  partial: '部分角色失败',
  failed: '评审失败',
  applied: '已应用改稿'
}

/** 状态文案以「真实产出了多少角色」为准：残留的 running 与 failures 对不上时按中断/失败显示，绝不把失败报成成功 */
function reviewStatusOf(task: ReviewTask, live: boolean): { label: string; badge: string } {
  if (task.status === 'applied') return { label: statusLabels.applied, badge: 'success' }
  if (task.status === 'running') {
    return live ? { label: statusLabels.running, badge: 'primary' } : { label: '评审已中断', badge: 'danger' }
  }
  const failedUnits = Math.max(task.failures.length, task.roleIds.length - task.opinions.length)
  if (task.roleIds.length > 0 && failedUnits >= task.roleIds.length) return { label: statusLabels.failed, badge: 'danger' }
  if (failedUnits > 0) return { label: `部分完成 · ${failedUnits} 个角色失败`, badge: 'warning' }
  if (task.status === 'partial') return { label: statusLabels.partial, badge: 'warning' }
  if (task.status === 'failed') return { label: statusLabels.failed, badge: 'danger' }
  return { label: statusLabels.completed, badge: 'success' }
}

export function ReviewsPage({ providers, onNavigate, focusArticleId, showToast }: ReviewsPageProps): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const stream = useGenerationStream('reviews')
  const [articles, setArticles] = useState<Article[]>([])
  const [roles, setRoles] = useState<ReviewRole[]>([])
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [articleId, setArticleId] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set())
  const [modelTarget, setModelTarget] = useModelTarget(availableModels(providers))
  const [lastFailed, setLastFailed] = useState<ReviewFailure[]>([])
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [reviewRunning, setReviewRunning] = useState(false)

  const models = useMemo(() => availableModels(providers), [providers])
  const selectedArticle = articles.find((article) => article.id === articleId)
  const articleTasks = useMemo(
    () => tasks.filter((task) => task.articleId === articleId),
    [tasks, articleId]
  )
  useReportWork(selectedArticle ? {
    articleId: selectedArticle.id,
    title: markdownTitle(selectedArticle.rawMarkdown),
    accountId: selectedArticle.accountId,
    versionCount: selectedArticle.versionCount,
    status: selectedArticle.status
  } : {}, 'reviews')

  const refresh = async (): Promise<void> => {
    const [nextArticles, nextRoles] = await Promise.all([window.moliu.articles.list(), window.moliu.reviews.listRoles()])
    setArticles(nextArticles)
    setRoles(nextRoles)
    setArticleId((current) => {
      if (nextArticles.some((article) => article.id === current)) return current
      if (focusArticleId && nextArticles.some((article) => article.id === focusArticleId)) return focusArticleId
      const locked = nextArticles.find((article) => article.status === 'locked')
      return locked?.id ?? nextArticles[0]?.id ?? ''
    })
  }

  const refreshTasks = async (article = articleId): Promise<void> => {
    if (!article) return
    setTasks(await window.moliu.reviews.listTasks(article))
  }

  const refreshRunning = async (): Promise<void> => {
    const history = await window.moliu.generation.list(20)
    setReviewRunning(history.some((item) => item.domain === 'reviews' && item.status === 'running'))
  }

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => {
    void Promise.all([refreshTasks(), refreshRunning()]).catch((error) => showToast({ type: 'error', message: errorMessage(error) }))
  }, [articleId, stream.active])

  const runReview = async (roleIds: string[], article = articleId): Promise<void> => {
    const target = availableModelTarget(modelTarget)
    if (!article || !roleIds.length || !target) return
    setLastFailed([])
    try {
      const result = await stream.run(() => window.moliu.reviews.start({
        articleId: article,
        roleIds,
        fallbackProviderId: target.providerId,
        fallbackModel: target.modelId
      }))
      await Promise.all([refreshTasks(article), refreshRunning()])
      setLastFailed(result.failed)
      const failedCount = result.failed.length
      if (failedCount >= roleIds.length) {
        showToast({ type: 'error', message: `评审失败：${failedCount} 个角色均未给出意见，请检查模型连接后重试` })
      } else if (failedCount) {
        showToast({ type: 'warning', message: `${roleIds.length - failedCount} 个角色已给出意见，${failedCount} 个失败` })
      } else {
        showToast({ type: 'success', message: '评审完成' })
      }
    } catch (error) {
      await refreshTasks(article).catch((reloadError) => showToast({ type: 'error', message: `评审结果刷新失败：${errorMessage(reloadError)}` }))
      showToast(isCancelError(error) ? { type: 'info', message: '已取消本次评审' } : { type: 'error', message: errorMessage(error) })
    } finally {
      await refreshRunning().catch((ledgerError) => showToast({ type: 'error', message: `任务状态刷新失败：${errorMessage(ledgerError)}` }))
    }
  }

  const start = async (): Promise<void> => {
    await runReview([...selectedRoles])
  }

  const retryFailed = async (failures: ReviewFailure[], article = articleId): Promise<void> => {
    const deleted = failures.filter((item) => item.roleId && !roles.some((role) => role.id === item.roleId))
    if (deleted.length) {
      showToast({ type: 'error', message: `失败角色「${deleted.map((item) => item.roleName || '已删除角色').join('、')}」已被删除，无法只重跑失败项，请重新勾选角色后完整评审` })
      return
    }
    const roleIds = [...new Set(failures.map((item) => item.roleId).filter(Boolean))]
    if (!roleIds.length) {
      showToast({ type: 'error', message: '这次评审没有记录到失败的具体角色，请重新勾选角色后完整评审' })
      return
    }
    setRetrying(true)
    try {
      await runReview(roleIds, article)
    } finally {
      setRetrying(false)
    }
  }

  const apply = async (task: ReviewTask): Promise<void> => {
    const target = availableModelTarget(modelTarget)
    if (!target) return
    const stale = isReviewBaselineStale(task, selectedArticle)
    if (!(await confirm({
      title: stale ? '评审基线已过期' : '应用改稿？',
      message: stale
        ? `这次评审针对的是第 ${task.articleVersionNumber} 版，当前正文已改到第 ${selectedArticle?.versionCount ?? '?'} 版。旧意见的位置可能已不适用，确认后将按当前正文生成新候选，原有版本仍保留在历史里。`
        : '将按采纳的问题生成一版新草稿，原文版本保留在历史记录中。',
      danger: stale,
      confirmLabel: stale ? '仍要应用' : '生成改稿'
    }))) return
    try {
      const article = await stream.run(() => window.moliu.reviews.apply(task.id, target.providerId, target.modelId, stale))
      await Promise.all([refreshTasks(), refreshRunning()])
      showToast({ type: 'success', message: '改稿新版本已生成' })
      if (article) onNavigate('articles', { articleId: article.id })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消改稿' } : { type: 'error', message: errorMessage(error) })
    } finally {
      await refreshRunning().catch((ledgerError) => showToast({ type: 'error', message: `任务状态刷新失败：${errorMessage(ledgerError)}` }))
    }
  }

  const toggleRole = (roleId: string, checked: boolean): void => {
    setSelectedRoles((current) => {
      const next = new Set(current)
      checked ? next.add(roleId) : next.delete(roleId)
      return next
    })
  }

  const allAdoptedCount = (task: ReviewTask): number => task.opinions.reduce((sum, opinion) => sum + opinion.problems.filter((problem) => problem.adopted).length, 0)

  return <div className="page reviews-page">
    <PageHeader
      route="reviews"
      onNavigate={onNavigate}
      title="内容评审"
      description="多角色交叉评审文章，采纳问题后一键生成改稿"
      actions={<button className="button secondary" onClick={() => setRoleDialogOpen(true)}><Settings2 size={15} />评审角色</button>}
    />

    {!articles.length ? (
      <EmptyState
        icon={FileText}
        title="还没有可评审的文章"
        description="先在「文章创作」中生成或锁定一篇文章，再回到这里发起多角色评审。"
        actionLabel="去写文章"
        onAction={() => onNavigate('articles')}
      />
    ) : (
      <>
        <section className="review-composer">
          <label className="field"><span>文章</span>
            <Select value={articleId} onChange={setArticleId} ariaLabel="文章" options={articles.map((article) => ({ value: article.id, label: markdownTitle(article.rawMarkdown), hint: article.status === 'locked' ? '已锁定' : '草稿' }))} />
          </label>
          <label className="field"><span>模型（角色未单独指定时使用）</span>
            <Select value={modelTarget} onChange={setModelTarget} ariaLabel="模型" options={models.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))} />
          </label>
          <div className="review-role-options">
            <span className="review-role-title">评审角色</span>
            {roles.length ? roles.map((role) => (
              <label key={role.id} className={selectedRoles.has(role.id) ? 'selected' : ''}>
                <input type="checkbox" name="roleId" autoComplete="off" checked={selectedRoles.has(role.id)} onChange={(event) => toggleRole(role.id, event.target.checked)} />
                {role.name}
              </label>
            )) : <button className="text-button" onClick={() => setRoleDialogOpen(true)}>+ 创建第一个评审角色</button>}
          </div>
          {stream.active ? (
            <button className="button danger" onClick={stream.cancel}><X size={15} />取消评审</button>
          ) : (
            <button className="button primary" disabled={!selectedRoles.size || retrying} onClick={() => void start()}><Sparkles size={15} />{retrying ? '重跑失败角色中…' : '开始评审'}</button>
          )}
        </section>

        {stream.active && <StreamingPreview content={stream.content} label="正在评审…" />}

        {lastFailed.length > 0 && !stream.active && (
          <p className="inline-alert">评审失败角色：{lastFailed.map((item) => `${item.roleName || '未知角色'}（${item.message.slice(0, 60)}）`).join('；')}<button className="text-button" disabled={retrying} onClick={() => void retryFailed(lastFailed)}>{retrying ? '重跑中…' : `只重跑失败的 ${lastFailed.length} 个角色`}</button></p>
        )}

        {selectedArticle?.status === 'locked' && articleTasks.some((task) => task.status === 'completed') && (
          <NextStepBar text="评审结果已就绪，采纳问题后应用改稿；也可以先给这篇文章配图。" actionLabel="去配图" onAction={() => onNavigate('visuals', { articleId: selectedArticle.id })} />
        )}

        <section className="review-results">
          {!articleTasks.length && !stream.active ? (
            <EmptyState
              icon={CircleCheckBig}
              title="这篇文章还没有评审记录"
              description="勾选评审角色后点击「开始评审」，多角色会并行给出结构与表达意见。"
            />
          ) : articleTasks.map((task) => {
            const status = reviewStatusOf(task, reviewRunning)
            return <article className="review-task" key={task.id}>
              <header className="review-task-head">
                <div>
                  <strong>{markdownTitle(selectedArticle?.rawMarkdown ?? '')}</strong>
                  <span className={`badge ${status.badge}`}>{status.label}</span>
                  {isReviewBaselineStale(task, selectedArticle) && task.status !== 'applied' && (
                    <span className="badge warning">基线已过期 · 评审第 {task.articleVersionNumber} 版</span>
                  )}
                  <small>{formatDate(task.createdAt)} · 基于第 {task.articleVersionNumber} 版 · {task.opinions.length}/{task.roleIds.length} 个角色有效 · 采纳 {allAdoptedCount(task)} 条问题</small>
                  {task.failures.length > 0 && (
                    <small className="review-task-failures">失败：{task.failures.map((item) => `${item.roleName || '未知角色'} ${item.message.slice(0, 40)}`).join('；')}</small>
                  )}
                </div>
                {task.failures.length > 0 && task.status !== 'applied' && (
                  <button className="button secondary compact" disabled={stream.active || retrying} onClick={() => void retryFailed(task.failures, task.articleId)}>
                    <RotateCcw size={14} />{retrying ? '重跑中…' : `只重跑失败的 ${task.failures.length} 个角色`}
                  </button>
                )}
                {task.status !== 'applied' && (
                  <button className="button secondary compact" onClick={() => void apply(task)} disabled={stream.active || !task.opinions.length}>
                    <Check size={14} />应用改稿
                  </button>
                )}
              </header>
              {task.opinions.map((opinion) => (
                <div className="review-opinion" key={opinion.id}>
                  <h3>{opinion.roleName}{!opinion.extractionMatched && <span className="badge warning">解析未命中，仅保留原文</span>}</h3>
                  {!opinion.extractionMatched && <p className="micro-copy">模型未按约定输出可解析的评审区块，以下内容是整段回复的兜底，不能当作已核对的结论。</p>}
                  {opinion.overallSuggestion && <p className="review-overall">{opinion.overallSuggestion}</p>}
                  {opinion.problems.length ? opinion.problems.map((problem) => (
                    <label className={`review-problem ${problem.adopted ? 'adopted' : ''}`} key={problem.id}>
                      <input type="checkbox" name="problemAdopted" autoComplete="off" checked={problem.adopted} onChange={async (event) => {
                        const adopted = event.target.checked
                        try {
                          await window.moliu.reviews.updateProblem({ ...problem, adopted })
                          await refreshTasks(task.articleId)
                          showToast({ type: 'success', message: adopted ? '已采纳，应用改稿时会带上这条' : '已取消采纳' })
                        } catch (error) {
                          await refreshTasks(task.articleId).catch((reloadError) => showToast({ type: 'error', message: `评审结果刷新失败：${errorMessage(reloadError)}` }))
                          showToast({ type: 'error', message: `${adopted ? '采纳' : '取消采纳'}未生效：${errorMessage(error)}` })
                        }
                      }} />
                      <div className="review-problem-body">
                        <div className="review-problem-meta">
                          <span className={`badge ${severityLabels[problem.severity]?.badge ?? 'neutral'}`}>{problem.position || '全文'} · 严重度 {severityLabels[problem.severity]?.label ?? problem.severity}</span>
                          {problem.isManual && <span className="badge neutral">手动添加</span>}
                        </div>
                        <strong>{problem.issue}</strong>
                        <small>建议：{problem.suggestion}</small>
                      </div>
                    </label>
                  )) : <p className="micro-copy">该角色未提出具体问题。</p>}
                </div>
              ))}
            </article>
          })}
        </section>
      </>
    )}

    {roleDialogOpen && <RoleDialog roles={roles} onClose={() => setRoleDialogOpen(false)} onSaved={async () => { setRoleDialogOpen(false); await refresh() }} showToast={showToast} />}
    {ConfirmPortal}
  </div>
}

function RoleDialog({ roles, onClose, onSaved, showToast }: { roles: ReviewRole[]; onClose(): void; onSaved(): Promise<void>; showToast(toast: ToastState): void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('请评审文章，并返回一个 <评审意见> 区块。')
  const [saving, setSaving] = useState(false)
  return (
    <ModalBase open onClose={onClose} titleId="role-dialog-title" bare className="review-role-dialog">
      <header>
        <div>
          <h2 id="role-dialog-title">新建评审角色</h2>
          <p>角色会以独立视角并行评审文章。</p>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
      </header>
      <label className="field"><span>名称</span><input name="roleName" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：标题党猎人" /></label>
      <label className="field"><span>角色指令</span><textarea name="systemPrompt" autoComplete="off" rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
      <footer>
        <span className="micro-copy">现有 {roles.length} 个角色</span>
        <span style={{ flex: 1 }} />
        <button className="button secondary" onClick={onClose}>取消</button>
        <button className="button primary" disabled={saving || !name.trim()} onClick={async () => {
          setSaving(true)
          try {
            await window.moliu.reviews.saveRole({ name, systemPrompt: prompt, extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: [], sortOrder: roles.length })
            await onSaved()
            showToast({ type: 'success', message: '角色已保存' })
          } catch (error) {
            showToast({ type: 'error', message: errorMessage(error) })
          } finally {
            setSaving(false)
          }
        }}><Plus size={15} />保存</button>
      </footer>
    </ModalBase>
  )
}

function availableModelTarget(target: string): { providerId: string; modelId: string } | null {
  try {
    const [providerId, modelId] = JSON.parse(target) as unknown[]
    return typeof providerId === 'string' && typeof modelId === 'string' ? { providerId, modelId } : null
  } catch {
    return null
  }
}
