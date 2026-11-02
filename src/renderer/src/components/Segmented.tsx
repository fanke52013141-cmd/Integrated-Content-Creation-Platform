/**
 * 分段直选控件：选项少且固定时用它替代下拉菜单，
 * 让用户不用点开就能看到全部选项（全站统一的 .segmented 样式）。
 */
export interface SegmentedOption<V extends string> {
  value: V
  label: string
  title?: string
}

export function Segmented<V extends string>({ value, options, onChange, ariaLabel, disabled }: {
  value: V
  options: ReadonlyArray<SegmentedOption<V>>
  onChange(value: V): void
  ariaLabel: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={option.value === value ? 'active' : ''}
          disabled={disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
