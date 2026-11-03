import type { ProviderModel, ProviderSummary } from './contracts.js'

export interface ModelOption {
  provider: ProviderSummary
  model: ProviderModel
}

/** 全局兜底模型记忆键（历史行为：最后使用 = 全局默认） */
export const DEFAULT_MODEL_STORAGE_KEY = 'moliu:default-model'

/** 每个环节独立的「上次选择」记忆键：各环节互不牵连，不再一个模型走到底 */
export function stageModelStorageKey(stage: string): string {
  return `moliu:stage-model:${stage}`
}

/**
 * 解析环节实际使用的记忆键：调用方没有显式指定 storageKey（用全局默认）且提供环节标识时，
 * 自动切换为该环节的独立键；显式指定（如改稿、配图提示词的专用键）保持不变。
 */
export function resolveStageStorageKey(storageKey: string, stage?: string): string {
  return stage && storageKey === DEFAULT_MODEL_STORAGE_KEY ? stageModelStorageKey(stage) : storageKey
}

/** 可用文本模型：已启用 + 已配置密钥 + 开启文本能力 + 模型类型为文本（生图模型不出现在文本下拉里） */
export function availableModels(providers: ProviderSummary[]): ModelOption[] {
  return providers
    .filter((provider) => provider.enabled && provider.hasApiKey && provider.capabilities.chat)
    .flatMap((provider) => provider.models.filter((model) => model.enabled && (model.kind ?? 'text') === 'text').map((model) => ({ provider, model })))
}

/** 可用生图模型：已启用 + 可用凭据（密钥或即梦 CLI 登录态）+ 开启生图能力 + 模型类型为生图 */
export function availableImageModels(providers: ProviderSummary[]): ModelOption[] {
  return providers
    .filter((provider) => provider.enabled && (provider.accessMode === 'dreamina-cli' || provider.hasApiKey) && provider.capabilities.image)
    .flatMap((provider) => provider.models.filter((model) => model.enabled && model.kind === 'image' && (provider.accessMode === 'dreamina-cli' || provider.hasApiKey)).map((model) => ({ provider, model })))
}
