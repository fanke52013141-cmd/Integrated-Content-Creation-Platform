import { useEffect, useState } from 'react'
import type { ProviderModel, ProviderSummary } from '../../../shared/contracts'

export interface ModelOption {
  provider: ProviderSummary
  model: ProviderModel
}

/** 可用文本模型：已启用 + 已配置密钥的供应商下所有启用模型 */
export function availableModels(providers: ProviderSummary[]): ModelOption[] {
  return providers
    .filter((provider) => provider.enabled && provider.hasApiKey)
    .flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({ provider, model })))
}

export function encodeModelTarget(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId])
}

export function decodeModelTarget(value: string): { providerId: string; modelId: string } | null {
  try {
    const [providerId, modelId] = JSON.parse(value) as unknown[]
    return typeof providerId === 'string' && typeof modelId === 'string' ? { providerId, modelId } : null
  } catch {
    return null
  }
}

/** 模型下拉值：当前选择失效时自动回落到默认模型 */
export function useModelTarget(models: ModelOption[]): [string, (value: string) => void] {
  const [target, setTarget] = useState('')

  useEffect(() => {
    const current = decodeModelTarget(target)
    const exists = current && models.some(({ provider, model }) => provider.id === current.providerId && model.modelId === current.modelId)
    if (exists) return
    const preferred = models.find(({ model }) => model.isDefault) ?? models[0]
    setTarget(preferred ? encodeModelTarget(preferred.provider.id, preferred.model.modelId) : '')
  }, [models, target])

  return [target, setTarget]
}
