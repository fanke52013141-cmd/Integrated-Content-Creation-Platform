import { createNormalizedDocument } from './normalize.mjs'
import { ContentImportError } from './errors.mjs'
import { collapseWhitespace, decodeEntities, isSafeUrl, normalizeText, sha256 } from './utils.mjs'

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'link', 'meta', 'base', 'template', 'noscript'])
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'div', 'section', 'article', 'main', 'header', 'footer', 'figure', 'figcaption'])

export function parseHtmlTree(input) {
  const source = normalizeText(input)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const root = { type: 'root', children: [] }
  const stack = [root]
  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g
  let cursor = 0
  for (const match of source.matchAll(token)) {
    appendText(stack.at(-1), source.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const tag = match[0]
    if (tag.startsWith('<!') || tag.startsWith('<!--')) continue
    const closing = /^<\//.test(tag)
    const name = tag.match(/^<\/?\s*([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase()
    if (!name || DROP_TAGS.has(name)) continue
    if (closing) {
      const position = stack.map(node => node.tag).lastIndexOf(name)
      if (position > 0) stack.length = position
      continue
    }
    if (name === 'li' && stack.at(-1).tag === 'li') stack.pop()
    if (name === 'tr' && ['td', 'th', 'tr'].includes(stack.at(-1).tag)) {
      while (['td', 'th', 'tr'].includes(stack.at(-1).tag)) stack.pop()
    }
    if ((name === 'td' || name === 'th') && ['td', 'th'].includes(stack.at(-1).tag)) stack.pop()
    if (BLOCK_TAGS.has(name) && stack.at(-1).tag === 'p' && name !== 'p') stack.pop()
    if (name === 'p' && stack.at(-1).tag === 'p') stack.pop()
    const node = { type: 'element', tag: name, attrs: parseAttributes(tag), children: [] }
    stack.at(-1).children.push(node)
    if (!VOID_TAGS.has(name) && !/\/\s*>$/.test(tag)) stack.push(node)
  }
  appendText(stack.at(-1), source.slice(cursor))
  return root
}

function appendText(parent, value) {
  if (value) parent.children.push({ type: 'text', text: decodeEntities(value) })
}

function parseAttributes(tag) {
  const attrs = {}
  const body = tag.replace(/^<\s*[A-Za-z][\w:-]*/, '').replace(/\/?>$/, '')
  for (const match of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

function textContent(node) {
  if (node.type === 'text') return node.text
  return (node.children ?? []).map(textContent).join('')
}

function inlineMarkdown(node, context) {
  if (node.type === 'text') return normalizeText(node.text).replace(/\s+/g, ' ')
  if (node.type === 'root') return node.children.map(child => inlineMarkdown(child, context)).join('')
  const children = () => (node.children ?? []).map(child => inlineMarkdown(child, context)).join('')
  switch (node.tag) {
    case 'strong':
    case 'b': return `**${children().trim()}**`
    case 'em':
    case 'i': return `*${children().trim()}*`
    case 'del':
    case 's': return `~~${children().trim()}~~`
    case 'code': return `\`${textContent(node).replace(/`/g, '\\`')}\``
    case 'br': return '  \n'
    case 'a': {
      const label = children().trim() || textContent(node).trim()
      const href = node.attrs.href?.trim() ?? ''
      if (!href) return label
      if (!isSafeUrl(href)) {
        context.warnings.push({ code: 'UNSAFE_LINK_URL', message: `Rejected link URL: ${href.slice(0, 120)}` })
        return label
      }
      context.links.push(href)
      return `[${label}](${href})`
    }
    case 'img': {
      const uri = node.attrs.src?.trim() ?? ''
      const alt = collapseWhitespace(node.attrs.alt ?? '')
      if (!isSafeUrl(uri, { image: true, internal: true })) {
        context.warnings.push({ code: 'UNSAFE_IMAGE_URL', message: `Rejected image URL: ${uri.slice(0, 120)}` })
        return alt
      }
      const id = `image-${context.assets.length + 1}`
      context.assets.push({ id, kind: 'image', uri, alt })
      return `![${alt}](${uri})`
    }
    default: return children()
  }
}

function blocksFromNodes(nodes, context) {
  const blocks = []
  let inlineGroup = []
  const flush = () => {
    const text = inlineGroup.map(node => inlineMarkdown(node, context)).join('').replace(/[\t ]+/g, ' ').trim()
    if (text) blocks.push({ type: 'paragraph', text })
    inlineGroup = []
  }
  for (const node of nodes) {
    if (node.type === 'text') { inlineGroup.push(node); continue }
    const tag = node.tag
    if (/^h[1-6]$/.test(tag)) {
      flush()
      const text = inlineMarkdown(node, context).trim()
      if (text) blocks.push({ type: 'heading', level: Number(tag[1]), text })
    }
    else if (tag === 'p' || tag === 'figure' || tag === 'figcaption') {
      flush()
      const text = inlineMarkdown(node, context).replace(/[\t ]+/g, ' ').trim()
      if (text) blocks.push({ type: 'paragraph', text })
    }
    else if (tag === 'pre') {
      flush()
      blocks.push({ type: 'code', language: '', code: normalizeText(textContent(node)).replace(/^\n|\n$/g, '') })
    }
    else if (tag === 'blockquote') {
      flush()
      blocks.push({ type: 'quote', blocks: blocksFromNodes(node.children, context) })
    }
    else if (tag === 'ul' || tag === 'ol') {
      flush()
      const items = node.children.filter(child => child.tag === 'li')
        .map(item => inlineMarkdown(item, context).replace(/[\t ]+/g, ' ').trim()).filter(Boolean)
      if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items })
    }
    else if (tag === 'table') {
      flush()
      const rows = []
      walk(node, child => {
        if (child.tag === 'tr') {
          const cells = child.children.filter(cell => cell.tag === 'td' || cell.tag === 'th')
            .map(cell => inlineMarkdown(cell, context).replace(/[\t ]+/g, ' ').trim())
          if (cells.length) rows.push({ header: cells.length && child.children.some(cell => cell.tag === 'th'), cells })
        }
      })
      const headerIndex = rows.findIndex(row => row.header)
      const headers = headerIndex >= 0 ? rows.splice(headerIndex, 1)[0].cells : rows.shift()?.cells
      if (headers) blocks.push({ type: 'table', headers, rows: rows.map(row => normalizeCells(row.cells, headers.length)) })
    }
    else if (tag === 'hr') { flush(); blocks.push({ type: 'thematicBreak' }) }
    else if (['div', 'section', 'article', 'main', 'header', 'footer', 'body', 'html', 'root'].includes(tag)) {
      flush()
      blocks.push(...blocksFromNodes(node.children, context))
    }
    else if (['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'li'].includes(tag)) {
      flush()
      blocks.push(...blocksFromNodes(node.children, context))
    }
    else if (tag === 'head' || tag === 'title') continue
    else inlineGroup.push(node)
  }
  flush()
  return blocks
}

function normalizeCells(cells, length) {
  return Array.from({ length }, (_, index) => cells[index] ?? '')
}

function walk(node, visit) {
  for (const child of node.children ?? []) {
    visit(child)
    walk(child, visit)
  }
}

function findFirst(node, tag) {
  if (node.tag === tag) return node
  for (const child of node.children ?? []) {
    const found = findFirst(child, tag)
    if (found) return found
  }
  return null
}

export function importHtml(input, options = {}) {
  const sourceSha256 = sha256(String(typeof input === 'string' ? input : input?.html ?? ''))
  const source = normalizeText(typeof input === 'string' ? input : input?.html)
  const authorization = options.authorization ?? (typeof input === 'object' ? input?.authorization : null)
  if (authorization?.confirmed !== true || !collapseWhitespace(authorization.basis)) {
    throw new ContentImportError('Authorized HTML import requires authorization.confirmed=true and a non-empty basis', {
      code: 'HTML_AUTHORIZATION_REQUIRED',
    })
  }
  const root = parseHtmlTree(source)
  const context = { assets: [], links: [], warnings: [{ code: 'HTML_SANITIZED', message: 'HTML was reduced to the supported content whitelist; scripts, styles, forms, event handlers and unsafe URLs are discarded.' }] }
  const blocks = blocksFromNodes(root.children, context)
  const title = findFirst(root, 'title')
  const document = createNormalizedDocument({
    format: 'html',
    name: options.name ?? (typeof input === 'object' ? input.name : undefined),
    sourceSha256,
    metadata: { title: title ? collapseWhitespace(textContent(title)) : '', ...options.metadata },
    blocks,
    assets: context.assets,
    links: context.links,
    warnings: context.warnings,
    authorization,
  })
  return { document, media: [] }
}
