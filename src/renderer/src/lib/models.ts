import { useCallback, useEffect, useState } from 'react'
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

/** 全局默认文本模型（任何页面改动即全局生效：最后使用 = 默认） */
const DEFAULT_MODEL_KEY = 'moliu:default-model'
/** 全局默认生图模型 */
export const DEFAULT_IMAGE_MODEL_KEY = 'moliu:default-image-model'

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/**
 * 模型下拉值（全局默认版）：
 * 1. 初始化优先取 localStorage 中上次使用的模型（跨页面/跨会话共享）；
 * 2. 无记录或记录已失效时回落到供应商默认模型；
 * 3. 用户改动时写回 localStorage，让其他页面下次自动带出。
 */
export function useModelTarget(models: ModelOption[], storageKey: string = DEFAULT_MODEL_KEY): [string, (value: string) => void] {
  const [target, setTarget] = useState(() => readStored(storageKey))

  useEffect(() => {
    const pick = (): ModelOption | undefined => {
      const stored = decodeModelTarget(readStored(storageKey))
      const storedMatch = stored
        ? models.find(({ provider, model }) => provider.id === stored.providerId && model.modelId === stored.modelId)
        : undefined
      return storedMatch ?? models.find(({ model }) => model.isDefault) ?? models[0]
    }
    const current = decodeModelTarget(target)
    const exists = current && models.some(({ provider, model }) => provider.id === current.providerId && model.modelId === current.modelId)
    if (exists) return
    const preferred = pick()
    setTarget(preferred ? encodeModelTarget(preferred.provider.id, preferred.model.modelId) : '')
  }, [models, target, storageKey])

  const update = useCallback((value: string): void => {
    writeStored(storageKey, value)
    setTarget(value)
  }, [storageKey])

  return [target, update]
}
