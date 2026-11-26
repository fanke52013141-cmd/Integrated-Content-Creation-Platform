import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireCore = createRequire(path.join(ROOT, 'upstream/doocs-md/packages/core/package.json'))
const { JSDOM } = requireCore('jsdom')
const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'])

export function visibleText(html) {
  const document = new JSDOM(`<body>${html}</body>`).window.document
  const chunks = []
  function visit(node) {
    if (node.nodeType === node.TEXT_NODE) {
      chunks.push(node.nodeValue ?? '')
      return
    }
    if (node.nodeType !== node.ELEMENT_NODE) return
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return
    const block = BLOCK_TAGS.has(node.tagName)
    if (block) chunks.push('\n')
    for (const child of node.childNodes) visit(child)
    if (block) chunks.push('\n')
  }
  for (const child of document.body.childNodes) visit(child)
  return chunks.join('')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[\t \u00A0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function effectiveImageSources(html) {
  const document = new JSDOM(`<body>${html}</body>`).window.document
  return [...document.querySelectorAll('img')].map(image => image.getAttribute('src') || image.getAttribute('data-src') || '')
}
