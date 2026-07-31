import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  /** 副标题，例如“默认”“草稿”“v2”，靠右显示 */
  hint?: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange(value: string): void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  /** 选项为空时的提示 */
  emptyText?: string
}

/**
 * Apple 风格自定义下拉。
 * - portal + fixed 定位，避免被父容器 overflow 裁切
 * - 键盘导航：↑/↓/Enter/Esc/Home/End
 * - 选中项蓝色对勾，hover 态高亮
 * - 点击外部、Escape、选中后自动关闭
 * - 不依赖任何第三方库
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  ariaLabel,
  emptyText = '暂无选项'
}: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value))
  )
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: -9999,
    top: -9999,
    minWidth: 0
  })
  const listId = useId()

  const selected = options.find((option) => option.value === value)

  // 打开时定位 popover，并监听 resize/scroll
  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const POPOVER_MAX_HEIGHT = 320
    const GAP = 6
    const spaceBelow = window.innerHeight - rect.bottom - GAP
    const spaceAbove = rect.top - GAP
    const openBelow = spaceBelow >= Math.min(POPOVER_MAX_HEIGHT, spaceAbove) || spaceAbove < 160
    const top = openBelow ? rect.bottom + GAP : rect.top - POPOVER_MAX_HEIGHT - GAP
    const maxHeight = openBelow
      ? Math.min(POPOVER_MAX_HEIGHT, spaceBelow)
      : Math.min(POPOVER_MAX_HEIGHT, spaceAbove)
    setPopoverStyle({
      position: 'fixed',
      left: rect.left,
      top: Math.max(8, top),
      minWidth: rect.width,
      maxHeight: Math.max(160, maxHeight),
      zIndex: 1000
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    positionPopover()
    const onWindowChange = (): void => positionPopover()
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)
    return () => {
      window.removeEventListener('resize', onWindowChange)
      window.removeEventListener('scroll', onWindowChange, true)
    }
  }, [open, positionPopover])

  // 打开时聚焦选中项
  useEffect(() => {
    if (!open) return
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    const item = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`)
    requestAnimationFrame(() => item?.scrollIntoView({ block: 'nearest' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  const selectOption = useCallback((option: SelectOption): void => {
    onChange(option.value)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [onChange])

  const onTriggerKeydown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
    }
  }

  const onListKeydown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(options.length - 1, current + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(0, current - 1))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) selectOption(option)
    }
  }

  // 滚动时保持 active 项可见
  useEffect(() => {
    if (!open) return
    const item = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeydown}
      >
        <span className={`select-value ${selected ? '' : 'placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} className={`select-chevron ${open ? 'up' : ''}`} />
      </button>

      {open && createPortal(
        <div ref={popoverRef} className="select-popover" style={popoverStyle}>
          {options.length ? (
            <ul ref={listRef} id={listId} role="listbox" className="select-list" onKeyDown={onListKeydown}>
              {options.map((option, index) => {
                const isSelected = option.value === value
                const isActive = index === activeIndex
                return (
                  <li
                    key={`${option.value}:${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    className={`select-option ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                    onClick={() => selectOption(option)}
                    onMouseMove={() => setActiveIndex(index)}
                  >
                    <span className="select-option-label">{option.label}</span>
                    {option.hint && <span className="select-option-hint">{option.hint}</span>}
                    {isSelected && <Check size={14} className="select-option-check" />}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="select-empty">{emptyText}</div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
