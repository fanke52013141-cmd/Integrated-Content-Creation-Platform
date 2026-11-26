export const DOCUMENT_LIMITS = Object.freeze({
  htmlCharacters: 20_000,
  htmlBytes: 1_000_000,
  title: 32,
  author: 16,
  summary: 120
})

export function budgetLevel(value, limit) {
  if (value >= limit) return 'error'
  const ratio = value / limit
  if (ratio >= 0.9) return 'critical'
  if (ratio >= 0.8) return 'warning'
  return 'ok'
}

export function calculateBudget({ html = '', markdown = '', title = '', author = '', summary = '', blockedWords = [] } = {}) {
  const htmlCharacters = html.length
  const htmlBytes = new TextEncoder().encode(html).length
  const fields = [
    { id: 'title', label: '标题', value: title.length, limit: DOCUMENT_LIMITS.title },
    { id: 'author', label: '作者', value: author.length, limit: DOCUMENT_LIMITS.author },
    { id: 'summary', label: '摘要', value: summary.length, limit: DOCUMENT_LIMITS.summary }
  ].map(field => ({ ...field, level: budgetLevel(field.value, field.limit) }))
  const wordHits = [...new Set(blockedWords.filter(Boolean).filter(word => markdown.toLowerCase().includes(word.toLowerCase())))]
  const levels = [
    budgetLevel(htmlCharacters, DOCUMENT_LIMITS.htmlCharacters),
    budgetLevel(htmlBytes, DOCUMENT_LIMITS.htmlBytes),
    ...fields.map(field => field.level)
  ]
  const rank = { ok: 0, warning: 1, critical: 2, error: 3 }
  return {
    htmlCharacters,
    htmlCharactersRemaining: DOCUMENT_LIMITS.htmlCharacters - htmlCharacters,
    htmlBytes,
    htmlBytesRemaining: DOCUMENT_LIMITS.htmlBytes - htmlBytes,
    characterLevel: budgetLevel(htmlCharacters, DOCUMENT_LIMITS.htmlCharacters),
    byteLevel: budgetLevel(htmlBytes, DOCUMENT_LIMITS.htmlBytes),
    fields,
    wordHits,
    level: wordHits.length ? 'warning' : levels.sort((a, b) => rank[b] - rank[a])[0]
  }
}
