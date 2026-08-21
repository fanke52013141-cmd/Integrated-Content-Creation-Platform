import { GripVertical, X } from 'lucide-react'
import type { HotSource } from '../../../shared/contracts'
import { ModalBase } from './ModalBase'

export interface SourceManagerDialogProps {
  open: boolean
  order: HotSource[]
  hiddenIds: Set<string>
  draggedSourceId?: string
  onClose(): void
  onSetOrder(order: HotSource[]): void
  onSetHiddenIds(updater: (current: Set<string>) => Set<string>): void
  onSetDraggedSourceId(id?: string): void
  onSave(): void
}

export function SourceManagerDialog({
  open,
  order,
  hiddenIds,
  draggedSourceId,
  onClose,
  onSetOrder,
  onSetHiddenIds,
  onSetDraggedSourceId,
  onSave
}: SourceManagerDialogProps): React.JSX.Element | null {
  if (!open) return null
  return (
    <ModalBase open={open} onClose={onClose} titleId="source-manager-title" bare className="source-manager-dialog">
      <header>
        <div>
          <span className="eyebrow">PLATFORM DISPLAY</span>
          <h2 id="source-manager-title">管理热榜平台</h2>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="source-manager-tools">
        <span>
          显示 {order.length - hiddenIds.size} / {order.length}
        </span>
        <button
          className="button ghost compact"
          onClick={() => onSetHiddenIds(() => new Set())}
        >
          全部恢复显示
        </button>
      </div>
      <div className="source-manager-list">
        {order.map((source, index) => {
          const visible = !hiddenIds.has(source.id)
          return (
            <article
              key={source.id}
              className={draggedSourceId === source.id ? 'dragging' : ''}
              draggable
              onDragStart={() => onSetDraggedSourceId(source.id)}
              onDragEnd={() => onSetDraggedSourceId(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggedSourceId || draggedSourceId === source.id) return
                onSetOrder(moveSource(order, draggedSourceId, source.id))
                onSetDraggedSourceId(undefined)
              }}
            >
              <GripVertical size={16} />
              <span className={`source-mark source-${source.id}`}><SourcePlatformIcon source={source} /></span>
              <span className="source-manager-name">
                <strong>{source.displayName}</strong>
              </span>
              <small className="source-manager-order">{index + 1}</small>
              <label>
                <input
                  type="checkbox"
                  name="sourceVisible"
                  autoComplete="off"
                  checked={visible}
                  onChange={(event) => {
                    onSetHiddenIds((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.delete(source.id)
                      else next.add(source.id)
                      return next
                    })
                  }}
                />
                {visible ? '显示' : '隐藏'}
              </label>
            </article>
          )
        })}
      </div>
      <footer>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button primary" onClick={onSave}>
          保存设置
        </button>
      </footer>
    </ModalBase>
  )
}

function moveSource(sources: HotSource[], movingId: string, targetId: string): HotSource[] {
  const fromIndex = sources.findIndex((source) => source.id === movingId)
  const targetIndex = sources.findIndex((source) => source.id === targetId)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return sources
  const next = [...sources]
  const [moving] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moving)
  return next
}

function SourcePlatformIcon({ source }: { source: HotSource }): React.JSX.Element {
  const key = `${source.id} ${source.displayName}`.toLowerCase()
  if (key.includes('weibo') || key.includes('微博')) return <MessageCircleMore size={16} />
  if (key.includes('zhihu') || key.includes('知乎')) return <CircleHelp size={16} />
  if (key.includes('baidu') || key.includes('百度')) return <Search size={16} />
  if (key.includes('douyin') || key.includes('抖音')) return <Music2 size={16} />
  if (key.includes('bilibili') || key.includes('哔哩')) return <Tv2 size={16} />
  if (key.includes('news') || key.includes('新闻') || key.includes('头条')) return <Newspaper size={16} />
  if (key.includes('ithome') || key.includes('it之家')) return <Laptop size={16} />
  if (key.includes('github') || key.includes('csdn') || key.includes('51cto') || key.includes('36kr')) {
    return <Code2 size={16} />
  }
  return <Rss size={16} />
}

import {
  CircleHelp,
  Code2,
  Laptop,
  MessageCircleMore,
  Music2,
  Newspaper,
  Rss,
  Search,
  Tv2
} from 'lucide-react'
