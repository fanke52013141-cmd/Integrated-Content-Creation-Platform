import type { GenerationTask } from '../../shared/contracts.js'

export function generationOutcome(result: unknown, aborted: boolean): { status: GenerationTask['status']; detail: string; resultIds: string[]; articleId?: string } {
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const failures = Array.isArray(value.failed) ? value.failed as Array<{ message?: string }> : []
  const outputs = Array.isArray(value.articles) ? value.articles : Array.isArray(value.frameworks) ? value.frameworks : Array.isArray(value.topics) ? value.topics : value.task && typeof value.task === 'object' ? (value.task as { opinions?: unknown[] }).opinions ?? [] : value.id ? [value] : []
  const resultIds = outputs.flatMap(item => item && typeof item === 'object' && typeof (item as { id?: string }).id === 'string' ? [(item as { id: string }).id] : [])
  const task = value.task as { articleId?: string } | undefined
  const articleId = Array.isArray(value.articles) ? (value.articles[0] as { id?: string } | undefined)?.id : task?.articleId ?? (typeof value.articleId === 'string' ? value.articleId : undefined)
  if (aborted) return { status: 'cancelled', detail: outputs.length ? `已取消，保留 ${outputs.length} 项已完成结果` : '已取消本次生成', resultIds, articleId }
  if (failures.length) return { status: outputs.length ? 'partial' : 'failed', detail: outputs.length ? `完成 ${outputs.length} 项，${failures.length} 项失败` : failures[0]?.message || '全部生成失败', resultIds, articleId }
  return { status: 'succeeded', detail: outputs.length ? `完成 ${outputs.length} 项` : '', resultIds, articleId }
}
