import { useEffect, useMemo, useState } from 'react'
import {
  Check, CircleCheckBig, FileText, Plus, Settings2, Sparkles, X
} from 'lucide-react'
import type { Article, ProviderSummary, ReviewRole, ReviewTask } from '../../../shared/contracts'
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

type ReviewTaskStatus = 'running' | 'completed' | 'applied'

const statusLabels: Record<ReviewTaskStatus, string> = {
  running: '评审中',
  completed: '待应用',
  applied: '已应用改稿'
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
  const [lastFailed, setLastFailed] = useState<Array<{ roleId: string; message: string }>>([])
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)

  const models = useMemo(() => availableModels(providers), [providers])
  const selectedArticle = articles.find((article) => article.id === articleId)
  const articleTasks = useMemo(
    () => tasks.filter((task) => task.articleId === articleId),
    [tasks, articleId]
  )

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

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])
  useEffect(() => { void refreshTasks().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [articleId])

  const start = async (): Promise<void> => {
    const target = availableModelTarget(modelTarget)
    if (!articleId || !selectedRoles.size || !target) return
    try {
      const result = await stream.run(() => window.moliu.reviews.start({
        articleId,
        roleIds: [...selectedRoles],
        fallbackProviderId: target.providerId,
        fallbackModel: target.modelId
      }))
      await refreshTasks()
      setLastFailed(result.failed)
      if (result.failed.length) {
        showToast({ type: 'warning', message: `评审完成：${result.failed.length} 个角色失败，其余结果已生成` })
      } else {
        showToast({ type: 'success', message: '评审完成' })
      }
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消本次评审' } : { type: 'error', message: errorMessage(error) })
    }
  }

  const apply = async (task: ReviewTask): Promise<void> => {
    const target = availableModelTarget(modelTarget)
    if (!target) return
    if (!(await confirm({ title: '应用改稿？', message: '将按采纳的问题生成一版新草稿，原文版本保留在历史记录中。', confirmLabel: '生成改稿' }))) return
    try {
      const article = await stream.run(() => window.moliu.reviews.apply(task.id, target.providerId, target.modelId))
      await refreshTasks()
      showToast({ type: 'success', message: '改稿新版本已生成' })
      if (article) onNavigate('articles', { articleId: article.id })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消改稿' } : { type: 'error', message: errorMessage(error) })
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
            <button className="button primary" disabled={!selectedRoles.size} onClick={() => void start()}><Sparkles size={15} />开始评审</button>
          )}
        </section>

        {stream.active && <StreamingPreview content={stream.content} label="正在评审…" />}

        {lastFailed.length > 0 && !stream.active && (
          <p className="inline-alert">部分角色评审失败：{lastFailed.map((item) => item.message.slice(0, 60)).join('；')}</p>
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
          ) : articleTasks.map((task) => (
            <article className="review-task" key={task.id}>
              <header className="review-task-head">
                <div>
                  <strong>{markdownTitle(selectedArticle?.rawMarkdown ?? '')}</strong>
                  <span className={`badge ${task.status === 'applied' ? 'success' : task.status === 'running' ? 'primary' : 'neutral'}`}>{statusLabels[task.status]}</span>
                  <small>{formatDate(task.createdAt)} · {task.opinions.length} 个角色 · 采纳 {allAdoptedCount(task)} 条问题</small>
                </div>
                {task.status !== 'applied' && (
                  <button className="button secondary compact" onClick={() => void apply(task)} disabled={stream.active}>
                    <Check size={14} />应用改稿
                  </button>
                )}
              </header>
              {task.opinions.map((opinion) => (
                <div className="review-opinion" key={opinion.id}>
                  <h3>{opinion.roleName}</h3>
                  {opinion.overallSuggestion && <p className="review-overall">{opinion.overallSuggestion}</p>}
                  {opinion.problems.length ? opinion.problems.map((problem) => (
                    <label className={`review-problem ${problem.adopted ? 'adopted' : ''}`} key={problem.id}>
                      <input type="checkbox" name="problemAdopted" autoComplete="off" checked={problem.adopted} onChange={async (event) => {
                        await window.moliu.reviews.updateProblem({ ...problem, adopted: event.target.checked })
                        await refreshTasks()
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
          ))}
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
