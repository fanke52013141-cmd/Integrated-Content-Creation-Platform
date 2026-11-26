import { collapseWhitespace, decodeEntities, escapeHtml, isSafeUrl, plainTextFromHtml } from './utils.mjs'

export function renderInline(value, { markdown = false } = {}) {
  const source = String(value ?? '')
  if (markdown) return source
  let output = escapeHtml(source)
  output = output.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  output = output.replace(/!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+(?:&quot;|&#39;|")([^)]*?)(?:&quot;|&#39;|"))?\)/g,
    (match, alt, rawUrl) => {
      const url = decodeEntities(rawUrl)
      if (!isSafeUrl(url, { image: true, internal: true })) return alt
      return `<img src="${escapeHtml(url)}" alt="${alt}" loading="lazy">`
    })
  output = output.replace(/\[([^\]\n]+)\]\(([^\s)]+)(?:\s+(?:&quot;|&#39;|")([^)]*?)(?:&quot;|&#39;|"))?\)/g,
    (match, label, rawUrl) => {
      const url = decodeEntities(rawUrl)
      if (!isSafeUrl(url)) return label
      const external = /^https?:\/\//i.test(url) ? ' rel="noopener noreferrer"' : ''
      return `<a href="${escapeHtml(url)}"${external}>${label}</a>`
    })
  output = output.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  output = output.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  output = output.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  return output.replace(/ {2}\n/g, '<br>\n').replace(/\n/g, ' ')
}

export function inlineToPlainText(value) {
  return collapseWhitespace(String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, ''))
}

export function renderMarkdownBlocks(blocks) {
  return blocks.map(block => {
    switch (block.type) {
      case 'heading': return `${'#'.repeat(block.level)} ${block.text}`
      case 'paragraph': return block.text
      case 'code': {
        const fence = block.code.includes('```') ? '~~~' : '```'
        return `${fence}${block.language ?? ''}\n${block.code}\n${fence}`
      }
      case 'quote': return renderMarkdownBlocks(block.blocks).split('\n').map(line => `> ${line}`).join('\n')
      case 'list': return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`).join('\n')
      case 'table': return [
        `| ${block.headers.join(' | ')} |`,
        `| ${block.headers.map(() => '---').join(' | ')} |`,
        ...block.rows.map(row => `| ${row.join(' | ')} |`),
      ].join('\n')
      case 'thematicBreak': return '---'
      default: return ''
    }
  }).filter(Boolean).join('\n\n')
}

export function renderHtmlBlocks(blocks) {
  return blocks.map(block => {
    switch (block.type) {
      case 'heading': return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`
      case 'paragraph': return `<p>${renderInline(block.text)}</p>`
      case 'code': return `<pre><code${block.language ? ` class="language-${escapeHtml(block.language.replace(/[^\w+-]/g, ''))}"` : ''}>${escapeHtml(block.code)}</code></pre>`
      case 'quote': return `<blockquote>\n${renderHtmlBlocks(block.blocks)}\n</blockquote>`
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul'
        return `<${tag}>${block.items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`
      }
      case 'table': return `<table><thead><tr>${block.headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      case 'thematicBreak': return '<hr>'
      default: return ''
    }
  }).filter(Boolean).join('\n')
}

export function blocksToPlainText(blocks) {
  return collapseWhitespace(blocks.map(block => {
    switch (block.type) {
      case 'heading':
      case 'paragraph': return inlineToPlainText(block.text)
      case 'code': return block.code
      case 'quote': return blocksToPlainText(block.blocks)
      case 'list': return block.items.map(inlineToPlainText).join(' ')
      case 'table': return [...block.headers, ...block.rows.flat()].map(inlineToPlainText).join(' ')
      default: return ''
    }
  }).filter(Boolean).join(' '))
}

export function htmlToPlainText(value) {
  return plainTextFromHtml(value)
}
