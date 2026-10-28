export interface FactCandidate { key: string; token: string; context: string; start: number; end: number }

/** Heuristic only: numbers are prompts for human review, not verified facts. */
export function extractFactCandidates(markdown: string): FactCandidate[] {
  const out: FactCandidate[] = []
  const linePattern = /[^\n]+/g
  let fence = ''
  for (const line of markdown.matchAll(linePattern)) {
    const text = line[0]
    const fenceMatch = text.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) { if (!fence) fence = fenceMatch[1][0]; else if (fenceMatch[1][0] === fence) fence = ''; continue }
    if (fence) continue
    const prefix = text.match(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/)?.[0].length ?? 0
    const scan = ' '.repeat(prefix) + text.slice(prefix).replace(/\]\([^)]*\)/g, value => ' '.repeat(value.length))
    for (const match of scan.matchAll(/\d{1,4}(?:[.,]\d+)*(?:\s*(?:年|月|日|%|％|万元|亿元|万|亿|元|人|次|岁|家|个))?/g)) {
      const token = match[0]
      const start = (line.index ?? 0) + (match.index ?? 0)
      out.push({ key: `${start}:${token}`, token, context: text.slice(Math.max(0, (match.index ?? 0) - 35), Math.min(text.length, (match.index ?? 0) + token.length + 45)), start, end: start + token.length })
      if (out.length >= 100) return out
    }
  }
  return out
}
