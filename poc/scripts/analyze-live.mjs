import { readFile, writeFile } from 'node:fs/promises'
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

function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length)
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return index
  }
  return a.length === b.length ? -1 : limit
}

function images(html) {
  const document = new JSDOM(`<body>${html}</body>`).window.document
  return [...document.querySelectorAll('img')].map((image, index) => ({
    index: index + 1,
    src: image.getAttribute('src'),
    dataSrc: image.getAttribute('data-src'),
    localSrc: image.getAttribute('data-local-src'),
    width: image.getAttribute('data-w'),
    alt: image.getAttribute('alt'),
  }))
}

const fragmentName = process.env.POC_MP_FRAGMENT ?? 'article-fragment.html'
const fragment = await readFile(path.join(ROOT, 'poc/artifacts', fragmentName), 'utf8')
const live = JSON.parse(await readFile(path.join(ROOT, 'poc/artifacts/live-mp-result.json'), 'utf8'))
const sourceText = visibleText(fragment)
const readbackText = visibleText(live.afterContent)
const difference = firstDifference(sourceText, readbackText)
const nonWhitespaceEqual = sourceText.replace(/\s/g, '') === readbackText.replace(/\s/g, '')
const sourceImages = images(fragment)
const readbackImages = images(live.afterContent)
const effectiveUrls = items => items.map(item => item.src || item.dataSrc || '')
const sourceUrls = effectiveUrls(sourceImages)
const readbackUrls = effectiveUrls(readbackImages)
const isWeChatUrl = url => /^https:\/\/mmbiz\.qpic\.cn\//i.test(url)
const imagesValid = sourceUrls.length === readbackUrls.length && sourceUrls.every(isWeChatUrl) && readbackUrls.every(isWeChatUrl)
const result = {
  passed: nonWhitespaceEqual && imagesValid,
  visibleTextEqual: sourceText === readbackText,
  nonWhitespaceEqual,
  imagesValid,
  sourceTextCharacters: sourceText.length,
  readbackTextCharacters: readbackText.length,
  firstDifference: difference,
  sourcePreview: difference >= 0 ? sourceText.slice(Math.max(0, difference - 100), difference + 160) : '',
  readbackPreview: difference >= 0 ? readbackText.slice(Math.max(0, difference - 100), difference + 160) : '',
  sourceImages,
  readbackImages,
  note: 'Block-aware visible text comparison preserves line breaks while ignoring editor-generated wrapper whitespace.',
}
await writeFile(path.join(ROOT, 'poc/artifacts/live-mp-analysis.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
