import { GatewayError } from '../gateway/types.js'
import type { GenerationDomain } from '../../shared/contracts.js'

/**
 * 生成任务登记表：按模块互斥（同一模块同时只允许一个生成任务），
 * 并持有 AbortController 以支持用户取消与退出前统一中止。
 */
export type { GenerationDomain }

const active = new Map<GenerationDomain, AbortController>()
/**
 * 允许并发的子任务（批量生图）：同一模块下可以同时存在多个，
 * 但不与模块级互斥锁混用——批量生图不应该挡住同页面的其它生成。
 */
const children = new Map<GenerationDomain, Set<AbortController>>()

export class GenerationConflictError extends GatewayError {
  constructor(domain: GenerationDomain) {
    super('ConflictError', '该模块已有生成任务进行中，请等待完成或先取消')
    this.name = 'GenerationConflictError'
    void domain
  }
}

export function beginGeneration(domain: GenerationDomain): AbortController {
  const existing = active.get(domain)
  if (existing) throw new GenerationConflictError(domain)
  const controller = new AbortController()
  active.set(domain, controller)
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
  const controller = active.get(domain)
  controller?.abort()
  const set = children.get(domain)
  if (set) {
    for (const child of set) child.abort()
    children.delete(domain)
  }
  return Boolean(controller || set?.size)
}

export function activeGenerationDomains(): GenerationDomain[] {
  return [...new Set([...active.keys(), ...children.keys()])]
}

/** 退出/关窗前统一中止所有在途生成 */
export function cancelAllGenerations(): void {
  for (const controller of active.values()) controller.abort()
  for (const set of children.values()) for (const controller of set) controller.abort()
  active.clear()
  children.clear()
}
