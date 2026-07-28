import type { BlockExtraction } from './types.js'

export function extractTaggedBlock(
  content: string,
  options: BlockExtraction
): { matched: boolean; value?: string | string[] } {
  const escapedTag = escapeRegExp(options.tag.trim())
  if (!escapedTag) return { matched: false }

  const pattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'gi')
  const matches = [...content.matchAll(pattern)]
  if (matches.length === 0) return { matched: false }

  const values = matches.map((match) => {
    const raw = options.includeTags ? match[0] : match[1]
    return raw.trim()
  })

  if (options.occurrence === 'all') return { matched: true, value: values }
  if (options.occurrence === 'first') return { matched: true, value: values[0] }
  return { matched: true, value: values.at(-1) }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
