import type { ContentImportSource } from '../../../shared/contracts'

/** 外部导入来源徽标；本应用生成/手动新建时不显示。 */
export function SourceBadge({ source }: { source?: ContentImportSource }): React.JSX.Element | null {
  if (!source) return null
  const format = source.format === 'markdown' ? 'Markdown' : source.format === 'json' ? 'JSON' : source.format.toUpperCase()
  const title = `来源：${source.tool} · ${format}${source.fileName ? ` · ${source.fileName}` : ''} · ${source.importedAt.slice(0, 10)}`
  return <span className="badge neutral source-badge" title={title}>外部导入</span>
}
