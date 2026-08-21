export function SkeletonLine({ width }: { width?: string }): React.JSX.Element {
  return <div className="skeleton skeleton-line" style={width ? { width } : undefined} />
}

export function SkeletonCard(): React.JSX.Element {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-line" style={{ width: '40%', height: '16px', marginBottom: '12px' }} />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" style={{ width: '60%' }} />
    </div>
  )
}

export function SkeletonList({ count = 5 }: { count?: number }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
