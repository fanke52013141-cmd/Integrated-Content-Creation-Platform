import { useCallback, useState } from 'react'

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
