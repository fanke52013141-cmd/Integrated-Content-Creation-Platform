export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

function safeHttpUrl(value) {
  return /^https?:\/\//i.test(value) ? value : null
}

/** Deliberately small, escaped offline preview renderer; not the WeChat renderer. */
export function renderInlineMarkdown(input) {
  const codes = []
  let text = String(input).replace(/`([^`]+)`/g, (_, code) => {
    const index = codes.push(`<code class="codespan">${escapeHtml(code)}</code>`) - 1
    return `\u0000CODE${index}\u0000`
  })
  text = escapeHtml(text)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const safe = safeHttpUrl(url)
    return safe ? `<img src="${safe}" alt="${alt}">` : alt
  })
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safe = safeHttpUrl(url)
    return safe ? `<a href="${safe}">${label}</a>` : label
  })
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>')
  return text.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codes[Number(index)])
}

function tableCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map(cell => cell.trim())
}

function isTable(lines, index) {
  if (index + 1 >= lines.length || !lines[index].includes('|')) return false
  const separator = lines[index + 1].trim()
  return separator.includes('-') && /^[\s|:-]+$/.test(separator)
}

function blockStart(lines, index) {
  const line = lines[index] || ''
  return /^(?:#{1,6}\s|```|>|---\s*$)/.test(line) || /^\s*(?:[-*+]|\d+\.)\s+/.test(line) || isTable(lines, index)
}

export function renderMarkdownPreview(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const code = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++])
      index += 1
      output.push(`<pre class="code__pre" data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      index += 1
      continue
    }
    if (/^\s*(?:---|\*\*\*)\s*$/.test(line)) {
      output.push('<hr>')
      index += 1
      continue
    }
    if (isTable(lines, index)) {
      const headers = tableCells(lines[index])
      index += 2
      const rows = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]))
      output.push(`<table><thead><tr>${headers.map(cell => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (line.trim().startsWith('>')) {
      const quotes = []
      while (index < lines.length && lines[index].trim().startsWith('>')) quotes.push(lines[index++].trim().slice(1).trim())
      output.push(`<blockquote><p>${renderInlineMarkdown(quotes.join('\n')).replace(/\n/g, '<br>')}</p></blockquote>`)
      continue
    }
    const list = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/)
    if (list) {
      const ordered = /^\d/.test(list[1])
      const items = []
      const itemPattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/
      while (index < lines.length) {
        const item = lines[index].match(itemPattern)
        if (!item) break
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
        index += 1
      }
      output.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !blockStart(lines, index)) paragraph.push(lines[index++])
    output.push(`<p>${renderInlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }
  return output.join('\n')
}
