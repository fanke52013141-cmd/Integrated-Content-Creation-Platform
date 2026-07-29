import { useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/**
 * P1-9: 虚拟列表组件，用于渲染 >50 项的大列表。
 * 基于 @tanstack/react-virtual headless 实现。
 *
 * 当 items.length <= threshold 时自动降级为普通渲染，避免虚拟化的额外开销。
 */
export interface VirtualListProps<T> {
  items: T[]
  estimateSize: (index: number) => number
  renderItem: (item: T, index: number) => ReactNode
  className?: string
  /** 触发虚拟化的阈值，默认 50 */
  threshold?: number
}

export function VirtualList<T>({
  items,
  estimateSize,
  renderItem,
  className,
  threshold = 50
}: VirtualListProps<T>): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  // 始终调用 hook 满足 Rules of Hooks
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 8,
    enabled: items.length > threshold
  })

  // 降级：小列表直接 map，性能更好且更易调试
  if (items.length <= threshold) {
    return <div className={className}>{items.map((item, index) => renderItem(item, index))}</div>
  }

  return (
    <div ref={parentRef} className={className} style={{ overflow: 'auto', maxHeight: '100%' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
