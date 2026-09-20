import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  /** 覆盖"多少个选项起启用搜索框"，一般不传 */
  searchable?: boolean
}

// 超过这个数量，滚动找选项就比重打一遍标题更累（作品多起来后下拉尤其明显）
const SEARCH_THRESHOLD = 12

/**
 * Apple 风格自定义下拉。
 * - portal + fixed 定位，避免被父容器 overflow 裁切
 * - 键盘导航：↑/↓/Enter/Esc/Home/End；选项多时顶部自动出现搜索框
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
  emptyText = '暂无选项',
  searchable
}: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const allowSearch = searchable ?? options.length > SEARCH_THRESHOLD
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!allowSearch || !keyword) return options
    return options.filter((option) => `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(keyword))
  }, [allowSearch, options, query])
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

  // 打开时定位到选中项；带搜索框时直接把焦点交给它，打字即可收窄
  useEffect(() => {
    if (!open) return
    setQuery('')
    const index = Math.max(0, visible.findIndex((option) => option.value === value))
    setActiveIndex(index)
    if (allowSearch) {
      requestAnimationFrame(() => searchRef.current?.focus())
      return
    }
    const item = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${index}"]`)
    requestAnimationFrame(() => item?.scrollIntoView({ block: 'nearest' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 点击外部、Escape 关闭。焦点多半还在触发器上（弹层是 portal），所以 Escape 必须挂在文档上
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
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
    // 正在搜索框里打字时，Home/End 属于光标移动，不能被列表抢走
    const typing = event.target instanceof HTMLInputElement
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(visible.length - 1, current + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(0, current - 1))
      return
    }
    if (typing && (event.key === 'Home' || event.key === 'End')) return
    if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(visible.length - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = visible[activeIndex]
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
        <div ref={popoverRef} className="select-popover" style={popoverStyle} onKeyDown={onListKeydown}>
          {!options.length ? (
            <div className="select-empty">{emptyText}</div>
          ) : (
            <>
              {allowSearch && (
                <input
                  ref={searchRef}
                  className="select-search"
                  name="selectSearch"
                  autoComplete="off"
                  value={query}
                  placeholder="输入关键词筛选…"
                  aria-label={ariaLabel ? `${ariaLabel}：筛选选项` : '筛选选项'}
                  onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
                />
              )}
              {visible.length ? (
                <ul ref={listRef} id={listId} role="listbox" className="select-list">
                  {visible.map((option, index) => {
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
                <div className="select-empty">没有匹配的选项</div>
              )}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
