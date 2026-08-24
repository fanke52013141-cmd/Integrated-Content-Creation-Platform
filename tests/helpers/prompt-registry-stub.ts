import type { PromptRegistry } from '../../src/main/gateway/prompt-registry.js'
import type { PromptDefBase } from '../../src/shared/contracts.js'

/**
 * 测试用 PromptRegistry 桩：不做真实数据库读写，render 返回确定性的内容，
 * 让 AI 服务的 prompts 构造参数在单测/集成测试中可被实例化。
 */
export function makePromptRegistryStub(defs: PromptDefBase[] = []): PromptRegistry {
  const byKey = new Map(defs.map((d) => [d.key, d.template]))
  return {
    seed: () => {},
    render: (key: string, vars: Record<string, string | string[] | undefined> = {}) => {
      const template = byKey.get(key) ?? `[stub:${key}]`
      return template.replace(/{{\s*([A-Za-z0-9_\u4e00-\u9fa5]+)\s*}}/g, (_m: string, name: string) => {
        const raw = vars[name]
        if (raw == null) return ''
        return Array.isArray(raw) ? raw.join('、') : raw
      })
    }
  } as PromptRegistry
}