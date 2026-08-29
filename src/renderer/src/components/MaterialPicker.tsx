import { useMemo, useState } from 'react'
import { FolderHeart, Search } from 'lucide-react'
import type { Material } from '../../../shared/contracts'
import type { RouteId } from './Layout'

interface MaterialPickerProps {
  materials: Material[]
  selected: Set<string>
  onToggle(id: string, checked: boolean): void
  onNavigate(route: RouteId): void
  /** 折叠高度，超出后列表内部滚动 */
  maxHeight?: number
}

/**
 * 素材引用选择器（框架 / 文章共用）。
 * 全量展示不截断：超过 8 条时提供搜索框，列表内部滚动。
 */
export function MaterialPicker({ materials, selected, onToggle, onNavigate, maxHeight = 176 }: MaterialPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return materials
    return materials.filter((material) => material.title.toLowerCase().includes(keyword))
  }, [materials, query])

  return (
    <div className="material-picker">
      <div className="material-picker-head">
        <strong><FolderHeart size={15} />引用素材{selected.size ? `（已选 ${selected.size}）` : ''}</strong>
        <button className="button ghost tiny" onClick={() => onNavigate('materials')}>管理素材</button>
      </div>
      {materials.length > 8 && (
        <label className="search-field material-picker-search">
          <Search size={14} />
          <input
            name="materialPickerQuery"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索素材标题…"
          />
        </label>
      )}
      <div className="material-picker-list" style={{ maxHeight: expanded ? 320 : maxHeight }}>
        {filtered.length ? filtered.map((material) => (
          <label key={material.id} className={selected.has(material.id) ? 'selected' : ''}>
            <input
              type="checkbox"
              name="materialId"
              autoComplete="off"
              checked={selected.has(material.id)}
              onChange={(event) => onToggle(material.id, event.target.checked)}
            />
            <span>{material.title}</span>
            <small>{material.kind === 'web' ? '网页' : material.kind === 'image' ? '图片' : '文字'}</small>
          </label>
        )) : (
          <p className="material-picker-empty">{materials.length ? '没有匹配的素材' : '暂无素材，可先到素材库收集'}</p>
        )}
      </div>
      {filtered.length > 6 && (
        <button className="button ghost tiny material-picker-expand" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : `展开全部 ${filtered.length} 条`}
        </button>
      )}
    </div>
  )
}
