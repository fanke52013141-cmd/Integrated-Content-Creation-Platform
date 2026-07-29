import { useCallback, useRef, useState } from 'react'

export type FormErrors<T> = Partial<Record<keyof T, string>>
export type FormRules<T> = Partial<{
  [K in keyof T]: (value: T[K], all: T) => string | null
}>

export interface UseFormErrorsResult<T> {
  errors: FormErrors<T>
  validate(values: T, rules: FormRules<T>): boolean
  clearError(field: keyof T): void
  clearAll(): void
  errorOf(field: keyof T): string | undefined
  setErrorRef(field: keyof T): (el: HTMLElement | null) => void
}

/**
 * P2-5: 表单错误管理 hook
 * - validate() 校验全部字段，返回是否通过
 * - 首个出错字段自动聚焦
 * - errorOf() 获取单个字段错误文本，供内联展示
 * - clearError() 在用户修正时清除该字段错误
 */
export function useFormErrors<T extends object>(): UseFormErrorsResult<T> {
  const [errors, setErrors] = useState<FormErrors<T>>({})
  const refs = useRef<Partial<Record<keyof T, HTMLElement | null>>>({})

  const validate = useCallback((values: T, rules: FormRules<T>): boolean => {
    const next: FormErrors<T> = {}
    let firstField: keyof T | null = null
    for (const key of Object.keys(rules) as (keyof T)[]) {
      const rule = rules[key]
      if (rule) {
        const error = rule(values[key] as never, values)
        if (error) {
          next[key] = error
          if (firstField === null) firstField = key
        }
      }
    }
    setErrors(next)
    if (firstField !== null) {
      const el = refs.current[firstField]
      if (el) requestAnimationFrame(() => el.focus())
      return false
    }
    return true
  }, [])

  const clearError = useCallback((field: keyof T): void => {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }, [])

  const clearAll = useCallback((): void => setErrors({}), [])

  const errorOf = useCallback((field: keyof T): string | undefined => errors[field], [errors])

  const setErrorRef = useCallback(
    (field: keyof T) => (el: HTMLElement | null): void => {
      refs.current[field] = el
    },
    []
  )

  return { errors, validate, clearError, clearAll, errorOf, setErrorRef }
}

/** 内联错误文本，放置在 .field 内部 */
export function FieldError({ message }: { message?: string }): React.JSX.Element | null {
  if (!message) return null
  return <span className="field-error" role="alert">{message}</span>
}
