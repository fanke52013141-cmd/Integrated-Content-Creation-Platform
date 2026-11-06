/**
 * 列表分页（文章库 / 选文弹窗 / 作品管理三处共用）。
 * 单页时渲染 null——「上一页 1/1 下一页」对单页列表是纯噪音。
 */
export function Pagination({ page, pageSize, total, disabled = false, className, ariaLabel = '列表分页', onPageChange }: {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
  className?: string
  ariaLabel?: string
  onPageChange: (next: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null
  return (
    <div className={className} role="navigation" aria-label={ariaLabel}>
      <button type="button" className="button ghost compact" disabled={disabled || page <= 0} onClick={() => onPageChange(Math.max(0, page - 1))}>上一页</button>
      <span aria-live="polite">{page + 1} / {pageCount}</span>
      <button type="button" className="button ghost compact" disabled={disabled || (page + 1) * pageSize >= total} onClick={() => onPageChange(page + 1)}>下一页</button>
    </div>
  )
}
