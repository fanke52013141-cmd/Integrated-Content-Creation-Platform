import { splitFrontMatter } from './front-matter.mjs'
import { createNormalizedDocument } from './normalize.mjs'
import { inlineToPlainText } from './blocks.mjs'
import { cleanLines, isSafeUrl, normalizeText, sha256 } from './utils.mjs'

export function parseMarkdown(input) {
  const { attributes, body } = splitFrontMatter(input)
  const lines = cleanLines(body).split('\n')
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*([^\s`]*)?.*$/)
    if (fence) {
      const code = []
      const marker = fence[1]
      const language = fence[2] || ''
      index += 1
      while (index < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[\\t ]*$`).test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language, code: code.join('\n') })
      continue
    }
    const heading = line.match(/^ {0,3}(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }
    if (index + 1 < lines.length && /^\s*(=+|-+)\s*$/.test(lines[index + 1]) && line.trim()) {
      blocks.push({ type: 'heading', level: lines[index + 1].trim()[0] === '=' ? 1 : 2, text: line.trim() })
      index += 2
      continue
    }
    if (/^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      blocks.push({ type: 'thematicBreak' })
      index += 1
      continue
    }
    if (line.match(/^ {0,3}>/)) {
      const quoted = []
      while (index < lines.length && lines[index].match(/^ {0,3}>/)) {
        quoted.push(lines[index].replace(/^ {0,3}> ?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', blocks: parseMarkdown(quoted.join('\n')).blocks })
      continue
    }
    const list = line.match(/^ {0,3}([-+*]|\d+[.)])[\t ]+(.+)$/)
    if (list) {
      const ordered = /^\d/.test(list[1])
      const items = []
      while (index < lines.length) {
        const item = lines[index].match(/^ {0,3}([-+*]|\d+[.)])[\t ]+(.+)$/)
        if (!item || /^\d/.test(item[1]) !== ordered) break
        let text = item[2].trim()
        index += 1
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !lines[index].match(/^ {0,3}([-+*]|\d+[.)])[\t ]+/)) {
          text += ` ${lines[index].trim()}`
          index += 1
        }
        items.push(text)
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    if (index + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]) && lines[index + 1].includes('|')) {
      const headers = splitTableRow(line)
      const rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index], headers.length))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }
    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
  }
  return { attributes, blocks }
}

function startsBlock(lines, index) {
  const line = lines[index]
  return /^ {0,3}(#{1,6})[\t ]+/.test(line)
    || /^ {0,3}(`{3,}|~{3,})/.test(line)
    || /^ {0,3}>/.test(line)
    || /^ {0,3}([-+*]|\d+[.)])[\t ]+/.test(line)
    || /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)
}

function splitTableRow(line, expected) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = trimmed.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
  if (expected == null) return cells
  return Array.from({ length: expected }, (_, index) => cells[index] ?? '')
}

export function importMarkdown(input, options = {}) {
  const sourceSha256 = sha256(String(input ?? ''))
  const source = normalizeText(input)
  if (!source.trim()) {
    // Empty input is still normalized; inspectContent reports the actionable blocker.
  }
  const { attributes, blocks } = parseMarkdown(source)
  const warnings = []
  if (/<\s*(script|style|iframe|object|embed|svg|math)\b/i.test(source)) {
    warnings.push({ code: 'RAW_HTML_ESCAPED', message: 'Raw HTML is escaped in Markdown imports; active elements are never executed.' })
  }
  const assets = []
  const links = []
  let assetSequence = 0
  const inline = source.replace(/`{3}[\s\S]*?`{3}/g, '')
  for (const match of inline.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const [, alt, uri] = match
    if (!isSafeUrl(uri, { image: true, internal: true })) {
      warnings.push({ code: 'UNSAFE_IMAGE_URL', message: `Rejected image URL: ${uri.slice(0, 120)}` })
      continue
    }
    assetSequence += 1
    assets.push({ id: `image-${assetSequence}`, kind: 'image', uri, alt: inlineToPlainText(alt) })
  }
  for (const match of inline.matchAll(/(?<!!)\[([^\]]+)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const uri = match[2]
    if (isSafeUrl(uri)) links.push(uri)
    else warnings.push({ code: 'UNSAFE_LINK_URL', message: `Rejected link URL: ${uri.slice(0, 120)}` })
  }
  const document = createNormalizedDocument({
    format: 'markdown',
    name: options.name,
    sourceSha256,
    metadata: { ...attributes, ...options.metadata },
    blocks,
    assets,
    links,
    warnings,
  })
  return { document, media: [] }
}
