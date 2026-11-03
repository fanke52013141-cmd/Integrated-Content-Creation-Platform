import { useCallback, useEffect, useRef, useState } from 'react'

// 下拉过滤与记忆键解析的纯函数放在 shared，主进程测试与渲染层共用同一份实现
export { availableModels, availableImageModels } from '../../../shared/model-options'
import { DEFAULT_MODEL_STORAGE_KEY, resolveStageStorageKey } from '../../../shared/model-options'
import type { ModelOption } from '../../../shared/model-options'

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

/** 全局默认文本模型（回落用：环节没有自己的记忆时才读它） */
export const DEFAULT_MODEL_KEY = DEFAULT_MODEL_STORAGE_KEY
/** 旧的全局生图默认：拆分前两个生图环节共用，仅作为回落读取 */
export const DEFAULT_IMAGE_MODEL_KEY = 'moliu:default-image-model'
/** 配图页（封面/文内/发布图生成）独立的生图默认——与智能配图互不影响 */
export const VISUALS_IMAGE_MODEL_KEY = 'moliu:visuals-image-model'
/** 智能配图独立的生图默认 */
export const STUDIO_IMAGE_MODEL_KEY = 'moliu:studio-image-model'

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
 * 模型下拉值（每环节独立记忆版）：
 * 1. 有提示词绑定时绑定优先（「提示词」页为该环节定的默认厂商+模型）；
 * 2. 无绑定则优先取本环节自己的「上次选择」（各环节互不牵连）；
 * 3. 环节没有记忆时回落旧全局键 / legacyKeys（兼容升级前「最后使用」的连续性）；
 * 4. 再回落到供应商默认模型；
 * 5. 用户改动写回本环节的键，只影响该环节。
 */
export function useModelTarget(
  models: ModelOption[],
  storageKey: string = DEFAULT_MODEL_KEY,
  promptKey?: string,
  legacyKeys: string[] = []
): [string, (value: string) => void] {
  // 调用方未显式指定键时，按环节自动切换为独立键：避免「选题页换模型，文章页跟着变」
  const effectiveKey = resolveStageStorageKey(storageKey, promptKey)
  const fallbackKeys = effectiveKey === DEFAULT_MODEL_KEY
    ? legacyKeys
    : [...legacyKeys, DEFAULT_MODEL_KEY]
  const [target, setTarget] = useState(() => readStored(effectiveKey))
  const [bindingReady, setBindingReady] = useState(!promptKey)
  const [boundTarget, setBoundTarget] = useState('')
  const manuallySelected = useRef(false)
  useEffect(() => {
    if (!promptKey) return
    let alive = true
    manuallySelected.current = false
    setBindingReady(false)
    void window.moliu.prompts.list().then(defs => {
      if (!alive) return
      const binding = defs.find(def => def.key === promptKey)?.modelBinding
      const value = binding ? encodeModelTarget(binding.providerId, binding.modelId) : ''
      setBoundTarget(value)
      if (value && !manuallySelected.current) setTarget(value)
      setBindingReady(true)
    }).catch(() => {
      // Do not silently substitute a model if the saved routing could not be read.
      if (alive) { setTarget(''); setBoundTarget('unavailable'); setBindingReady(true) }
    })
    return () => { alive = false }
  }, [promptKey])

  useEffect(() => {
    if (!bindingReady || (boundTarget && !manuallySelected.current)) return
    const pick = (): ModelOption | undefined => {
      for (const key of [effectiveKey, ...fallbackKeys]) {
        const stored = decodeModelTarget(readStored(key))
        const storedMatch = stored
          ? models.find(({ provider, model }) => provider.id === stored.providerId && model.modelId === stored.modelId)
          : undefined
        if (storedMatch) return storedMatch
      }
      return models.find(({ model }) => model.isDefault) ?? models[0]
    }
    const current = decodeModelTarget(target)
    const exists = current && models.some(({ provider, model }) => provider.id === current.providerId && model.modelId === current.modelId)
    if (exists) return
    const preferred = pick()
    setTarget(preferred ? encodeModelTarget(preferred.provider.id, preferred.model.modelId) : '')
  }, [models, target, effectiveKey, bindingReady, boundTarget])

  const update = useCallback((value: string): void => {
    manuallySelected.current = true
    writeStored(effectiveKey, value)
    setTarget(value)
  }, [effectiveKey])

  return [bindingReady ? target : '', update]
}
