import { Keyboard, X } from 'lucide-react'
import { ModalBase } from './ModalBase'
import { SHORTCUT_LIST } from './useKeyboardShortcuts'

export interface ShortcutPanelProps {
  open: boolean
  onClose(): void
}

export function ShortcutPanel({ open, onClose }: ShortcutPanelProps): React.JSX.Element | null {
  if (!open) return null
  const categories = [...new Set(SHORTCUT_LIST.map((s) => s.category))]

  return (
    <ModalBase open={open} onClose={onClose} titleId="shortcut-panel-title" bare className="shortcut-panel-dialog">
      <header>
        <div>
          
          <h2 id="shortcut-panel-title">键盘快捷键</h2>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="shortcut-panel-body">
        {categories.map((category) => (
          <div key={category} className="shortcut-category">
            <h3>{category}</h3>
            <div className="shortcut-list">
              {SHORTCUT_LIST.filter((s) => s.category === category).map((shortcut) => (
                <div key={shortcut.keys} className="shortcut-row">
                  <kbd className="shortcut-key">{shortcut.keys}</kbd>
                  <span className="shortcut-desc">{shortcut.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <footer>
        <button className="button primary" onClick={onClose}>知道了</button>
      </footer>
    </ModalBase>
  )
}
