import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

const PREFIX = 'moliu:draft:'

/**
 * Composer 草稿暂存：签名同 useState，值实时落 localStorage，
 * 页面切换（组件卸载）后回来不丢；提交成功后可调用 clear() 清除。
 */
export function useDraftState(key: string, initialValue: string = ''): [string, (value: string) => void, () => void] {
  const storageKey = `${PREFIX}${key}`
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? initialValue
    } catch {
      return initialValue
    }
  })

  const update = useCallback((next: string): void => {
    setValue(next)
    try {
      if (next) localStorage.setItem(storageKey, next)
      else localStorage.removeItem(storageKey)
    } catch {
      // 存储不可用时仅保留内存态
    }
  }, [storageKey])

  const clear = useCallback((): void => update(''), [update])

  return [value, update, clear]
}

/**
 * 素材勾选这类「选择型」Composer 草稿：签名同 useState<Set<string>>，值实时落 localStorage。
 * 用户中途去素材库补素材再回来，勾选的几条仍在；素材可能已被删除，
 * 因此页面拿到最新列表后要把不存在的 id 洗掉（生成时会因缺素材整体报错）。
 */
export function useDraftSelection(key: string): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const storageKey = `${PREFIX}${key}`
  const [value, setValue] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
      return Array.isArray(stored) ? new Set(stored.filter((id): id is string => typeof id === 'string')) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    try {
      if (value.size) localStorage.setItem(storageKey, JSON.stringify([...value]))
      else localStorage.removeItem(storageKey)
    } catch {
      // 存储不可用时仅保留内存态
    }
  }, [storageKey, value])

  return [value, setValue]
}
