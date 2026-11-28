import { GatewayError } from '../gateway/types.js'
import { GENERATION_DOMAIN_LABELS, type GenerationDomain } from '../../shared/contracts.js'

/**
 * 生成任务登记表：按模块互斥（同一模块同时只允许一个生成任务），
 * 并持有 AbortController 与运行标签以支持清晰冲突提示与用户取消。
 */
export type { GenerationDomain }

const active = new Map<GenerationDomain, { controller: AbortController; label: string }>()
/**
 * 允许并发的子任务（批量生图）：同一模块下可以同时存在多个，
 * 但不与模块级互斥锁混用——批量生图不应该挡住同页面的其它生成。
 */
const children = new Map<GenerationDomain, Set<AbortController>>()

export class GenerationConflictError extends GatewayError {
  readonly domain: GenerationDomain
  constructor(domain: GenerationDomain, runningLabel?: string) {
    const label = runningLabel || GENERATION_DOMAIN_LABELS[domain] || domain
    super('ConflictError', `「${label}」任务正在运行中，请等待完成或先在任务中心取消`)
    this.name = 'GenerationConflictError'
    this.domain = domain
  }
}

export function beginGeneration(domain: GenerationDomain, label?: string): AbortController {
  const existing = active.get(domain)
  if (existing) throw new GenerationConflictError(domain, existing.label)
  const controller = new AbortController()
  active.set(domain, { controller, label: label || GENERATION_DOMAIN_LABELS[domain] || domain })
  return controller
}

export function endGeneration(domain: GenerationDomain): void {
  active.delete(domain)
}

/** 注册一个可并发的子任务（批量生图的每一张图） */
export function beginGenerationChild(domain: GenerationDomain): AbortController {
  const controller = new AbortController()
  const set = children.get(domain) ?? new Set<AbortController>()
  set.add(controller)
  children.set(domain, set)
  return controller
}

export function endGenerationChild(domain: GenerationDomain, controller: AbortController): void {
  const set = children.get(domain)
  if (!set) return
  set.delete(controller)
  if (!set.size) children.delete(domain)
}

export function cancelGeneration(domain: GenerationDomain): boolean {
  const entry = active.get(domain)
  entry?.controller.abort()
  const set = children.get(domain)
  if (set) {
    for (const child of set) child.abort()
    children.delete(domain)
  }
  return Boolean(entry || set?.size)
}

export function activeGenerationDomains(): GenerationDomain[] {
  return [...new Set([...active.keys(), ...children.keys()])]
}

/** 退出/关窗前统一中止所有在途生成 */
export function cancelAllGenerations(): void {
  for (const entry of active.values()) entry.controller.abort()
  for (const set of children.values()) for (const controller of set) controller.abort()
  active.clear()
  children.clear()
}
