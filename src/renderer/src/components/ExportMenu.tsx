import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'

interface ExportMenuProps {
  onExport(format: 'json' | 'markdown'): void
  disabled?: boolean
}

/** 页面级导出：默认收起，避免把两个下载按钮长期占在页头。 */
export function ExportMenu({ onExport, disabled }: ExportMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function choose(format: 'json' | 'markdown'): void {
    setOpen(false)
    onExport(format)
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        className="button ghost compact"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Download size={15} />导出
      </button>
      {open && (
        <div className="export-menu-list" role="menu" aria-label="导出格式">
          <button role="menuitem" onClick={() => choose('json')}>导出 JSON</button>
          <button role="menuitem" onClick={() => choose('markdown')}>导出 Markdown</button>
        </div>
      )}
    </div>
  )
}
