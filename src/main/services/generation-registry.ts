import { GatewayError } from '../gateway/types.js'

/**
 * 生成任务登记表：按模块互斥（同一模块同时只允许一个生成任务），
 * 并持有 AbortController 以支持用户取消与退出前统一中止。
 */
export type GenerationDomain =
  | 'account'
  | 'hotspot-filter'
  | 'topics'
  | 'frameworks'
  | 'articles'
  | 'reviews'
  | 'visuals'

const active = new Map<GenerationDomain, AbortController>()

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

export function cancelGeneration(domain: GenerationDomain): boolean {
  const controller = active.get(domain)
  if (!controller) return false
  controller.abort()
  return true
}

export function activeGenerationDomains(): GenerationDomain[] {
  return [...active.keys()]
}

/** 退出/关窗前统一中止所有在途生成 */
export function cancelAllGenerations(): void {
  for (const controller of active.values()) controller.abort()
  active.clear()
}
