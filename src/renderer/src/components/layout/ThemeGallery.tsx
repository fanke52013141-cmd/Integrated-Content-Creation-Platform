import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { LayoutThemeInfo } from '../../../../shared/contracts'

export function ThemeGallery({ themes, value, onChange, disabled = false }: {
  themes: LayoutThemeInfo[]
  value: string
  onChange(themeId: string): void
  disabled?: boolean
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return themes
    return themes.filter((theme) => `${theme.name} ${theme.description} ${theme.personality}`.toLowerCase().includes(keyword))
  }, [query, themes])

  return (
    <section className="theme-gallery" aria-label="排版主题画廊">
      <header>
        <div><strong>主题画廊</strong><span>先看气质，再选主题；点击即可应用</span></div>
        <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题…" aria-label="搜索排版主题" /></label>
      </header>
      <div className="theme-gallery-list">
        {filtered.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={`theme-card ${theme.id === value ? 'active' : ''}`}
            aria-pressed={theme.id === value}
            disabled={disabled}
            onClick={() => onChange(theme.id)}
            style={{ '--theme-accent': theme.accent, '--theme-surface': theme.surface ?? '#ffffff' } as React.CSSProperties}
          >
            <span className="theme-preview" aria-hidden="true">
              <span className="theme-preview-eyebrow">FEATURE / 01</span>
              <strong>让标题层级更清晰</strong>
              <span className="theme-preview-rule" />
              <span className="theme-preview-line" />
              <span className="theme-preview-line short" />
              <span className="theme-preview-quote">引用、强调与留白</span>
            </span>
            <span className="theme-card-copy"><strong>{theme.name}</strong><small>{theme.description}</small></span>
          </button>
        ))}
        {!filtered.length && <p className="theme-gallery-empty">没有匹配的主题</p>}
      </div>
    </section>
  )
}
