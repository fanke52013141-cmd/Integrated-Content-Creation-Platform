import { ContentImportError } from './errors.mjs'
import { decodeEntities, normalizeText } from './utils.mjs'

export function parseXml(input) {
  const source = normalizeText(input)
  if (/<!DOCTYPE/i.test(source)) throw new ContentImportError('DOCTYPE is not allowed in DOCX XML', { code: 'DOCX_XML_UNSAFE' })
  const root = { type: 'root', name: '#root', attrs: {}, children: [] }
  const stack = [root]
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g
  let cursor = 0
  for (const match of source.matchAll(tokens)) {
    appendText(stack.at(-1), source.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const token = match[0]
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    if (token.startsWith('<![CDATA[')) {
      stack.at(-1).children.push({ type: 'text', text: token.slice(9, -3) })
      continue
    }
    if (token.startsWith('<!')) throw new ContentImportError('Unsupported XML declaration in DOCX', { code: 'DOCX_XML_UNSAFE' })
    const closing = token.startsWith('</')
    const name = token.match(/^<\/?\s*([^\s>/]+)/)?.[1]
    if (!name) continue
    if (closing) {
      const position = stack.map(node => node.name).lastIndexOf(name)
      if (position <= 0) throw new ContentImportError(`Unexpected XML closing tag: ${name}`, { code: 'DOCX_XML_INVALID' })
      stack.length = position
      continue
    }
    const node = { type: 'element', name, attrs: parseAttributes(token), children: [] }
    stack.at(-1).children.push(node)
    if (!/\/\s*>$/.test(token)) stack.push(node)
  }
  appendText(stack.at(-1), source.slice(cursor))
  if (stack.length !== 1) throw new ContentImportError(`Unclosed XML element: ${stack.at(-1).name}`, { code: 'DOCX_XML_INVALID' })
  return root
}

function appendText(parent, text) {
  if (text) parent.children.push({ type: 'text', text: decodeEntities(text) })
}

function parseAttributes(token) {
  const attrs = {}
  const body = token.replace(/^<\s*[^\s>/]+/, '').replace(/\/?>$/, '')
  for (const match of body.matchAll(/([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

export function localName(nodeOrName) {
  const name = typeof nodeOrName === 'string' ? nodeOrName : nodeOrName?.name ?? ''
  return name.includes(':') ? name.split(':').at(-1) : name
}

export function attr(node, name) {
  if (!node?.attrs) return undefined
  if (node.attrs[name] != null) return node.attrs[name]
  const key = Object.keys(node.attrs).find(item => localName(item) === name)
  return key ? node.attrs[key] : undefined
}

export function children(node, name) {
  return (node?.children ?? []).filter(child => child.type === 'element' && (!name || localName(child) === name))
}

export function descendants(node, name) {
  const result = []
  for (const child of node?.children ?? []) {
    if (child.type === 'element') {
      if (!name || localName(child) === name) result.push(child)
      result.push(...descendants(child, name))
    }
  }
  return result
}

export function textContent(node) {
  if (node?.type === 'text') return node.text
  return (node?.children ?? []).map(textContent).join('')
}
