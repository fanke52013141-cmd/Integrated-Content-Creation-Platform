import path from 'node:path'
import { readZipEntries } from './zip.mjs'
import { attr, children, descendants, localName, parseXml, textContent } from './xml.mjs'
import { createNormalizedDocument } from './normalize.mjs'
import { ContentImportError } from './errors.mjs'
import { isSafeUrl, normalizeText, sha256 } from './utils.mjs'

const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
})

export function importDocx(input, options = {}) {
  const bytes = toBytes(input)
  const entries = readZipEntries(bytes, options.limits)
  const documentEntry = entries.get('word/document.xml')
  if (!documentEntry) throw new ContentImportError('DOCX is missing word/document.xml', { code: 'DOCX_DOCUMENT_MISSING' })
  let xml
  try { xml = parseXml(documentEntry.toString('utf8')) }
  catch (error) {
    if (error instanceof ContentImportError) throw error
    throw new ContentImportError('Invalid DOCX document XML', { code: 'DOCX_XML_INVALID', cause: error })
  }
  const relationships = readRelationships(entries.get('word/_rels/document.xml.rels'))
  const styles = readStyles(entries.get('word/styles.xml'))
  const numbering = readNumbering(entries.get('word/numbering.xml'))
  const core = readCoreProperties(entries.get('docProps/core.xml'))
  const context = { entries, relationships, styles, numbering, assets: [], media: [], links: [], warnings: [] }
  const body = descendants(xml, 'body')[0]
  if (!body) throw new ContentImportError('DOCX document body is missing', { code: 'DOCX_XML_INVALID' })
  const blocks = readBodyBlocks(body, context)
  const document = createNormalizedDocument({
    format: 'docx',
    name: options.name,
    sourceSha256: sha256(bytes),
    metadata: { ...core, ...options.metadata },
    blocks,
    assets: context.assets,
    links: context.links,
    warnings: context.warnings,
  })
  return { document, media: context.media }
}

function toBytes(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('DOCX input must be an ArrayBuffer, Buffer, or Uint8Array')
}

function readRelationships(entry) {
  const map = new Map()
  if (!entry) return map
  const root = parseXml(entry.toString('utf8'))
  for (const item of descendants(root, 'Relationship')) {
    if (attr(item, 'Id')) map.set(attr(item, 'Id'), {
      target: attr(item, 'Target') ?? '',
      external: attr(item, 'TargetMode') === 'External',
      type: attr(item, 'Type') ?? '',
    })
  }
  return map
}

function readStyles(entry) {
  const map = new Map()
  if (!entry) return map
  for (const style of descendants(parseXml(entry.toString('utf8')), 'style')) {
    const id = attr(style, 'styleId')
    const name = children(style, 'name').map(node => attr(node, 'val')).find(Boolean)
    if (id && name) map.set(id, name)
  }
  return map
}

function readNumbering(entry) {
  const result = new Map()
  if (!entry) return result
  const root = parseXml(entry.toString('utf8'))
  const abstractFormats = new Map()
  for (const abstract of descendants(root, 'abstractNum')) {
    const id = attr(abstract, 'abstractNumId')
    const level = children(abstract, 'lvl').find(item => attr(item, 'ilvl') === '0') ?? children(abstract, 'lvl')[0]
    const format = children(level, 'numFmt').map(node => attr(node, 'val')).find(Boolean)
    if (id) abstractFormats.set(id, format)
  }
  for (const num of descendants(root, 'num')) {
    const id = attr(num, 'numId')
    const abstractId = children(num, 'abstractNumId').map(node => attr(node, 'val')).find(Boolean)
    if (id) result.set(id, abstractFormats.get(abstractId) === 'decimal' ? 'ordered' : 'bullet')
  }
  return result
}

function readCoreProperties(entry) {
  if (!entry) return {}
  const root = parseXml(entry.toString('utf8'))
  const value = name => textContent(descendants(root, name)[0]).trim()
  return {
    title: value('title'), author: value('creator'), summary: value('description'),
    tags: value('keywords').split(/[,;]/).map(item => item.trim()).filter(Boolean),
  }
}

function readBodyBlocks(body, context) {
  const blocks = []
  let list = null
  const flushList = () => { if (list?.items.length) blocks.push(list); list = null }
  for (const node of children(body)) {
    if (localName(node) === 'p') {
      const item = readParagraph(node, context)
      if (item.list) {
        if (list && list.ordered !== (item.list === 'ordered')) flushList()
        if (!list) list = { type: 'list', ordered: item.list === 'ordered', items: [] }
        if (item.text) list.items.push(item.text)
        continue
      }
      flushList()
      if (item.heading && item.text) blocks.push({ type: 'heading', level: item.heading, text: item.text })
      else if (item.text) blocks.push({ type: 'paragraph', text: item.text })
    }
    else if (localName(node) === 'tbl') {
      flushList()
      const rows = children(node, 'tr').map(row => children(row, 'tc').map(cell =>
        children(cell, 'p').map(paragraph => readParagraph(paragraph, context).text).filter(Boolean).join(' ').trim()))
        .filter(row => row.length)
      if (rows.length) {
        const headers = rows[0]
        blocks.push({ type: 'table', headers, rows: rows.slice(1).map(row => Array.from({ length: headers.length }, (_, i) => row[i] ?? '')) })
      }
    }
  }
  flushList()
  return blocks
}

function readParagraph(paragraph, context) {
  const properties = children(paragraph, 'pPr')[0]
  const styleId = children(properties, 'pStyle').map(node => attr(node, 'val')).find(Boolean)
  const styleName = context.styles.get(styleId) ?? styleId ?? ''
  const heading = styleName.match(/^(?:heading|标题)\s*([1-6])$/i)?.[1]
  const numberProperties = children(properties, 'numPr')[0]
  const numberId = children(numberProperties, 'numId').map(node => attr(node, 'val')).find(Boolean)
  const text = inlineDocx(paragraph, context).replace(/[\t ]+/g, ' ').trim()
  return {
    text,
    heading: heading ? Number(heading) : null,
    list: numberProperties ? context.numbering.get(numberId) ?? 'bullet' : null,
  }
}

function inlineDocx(node, context) {
  if (node.type === 'text') return normalizeText(node.text)
  const name = localName(node)
  if (name === 't') return (node.children ?? []).map(inlineDocx).join('')
  if (name === 'tab') return '\t'
  if (name === 'br' || name === 'cr') return '\n'
  if (name === 'del' || name === 'instrText') return ''
  if (name === 'hyperlink') {
    const label = (node.children ?? []).map(child => inlineDocx(child, context)).join('').trim()
    const relationship = context.relationships.get(attr(node, 'id'))
    const target = relationship?.external ? relationship.target : ''
    if (target && isSafeUrl(target)) {
      context.links.push(target)
      return `[${label || target}](${target})`
    }
    if (target) context.warnings.push({ code: 'UNSAFE_LINK_URL', message: `Rejected DOCX hyperlink: ${target.slice(0, 120)}` })
    return label
  }
  if (name === 'drawing' || name === 'pict') {
    const output = []
    for (const blip of descendants(node, 'blip')) {
      const id = attr(blip, 'embed') ?? attr(blip, 'link')
      const relationship = context.relationships.get(id)
      if (relationship) output.push(addImage(relationship, context))
    }
    for (const image of descendants(node, 'imagedata')) {
      const relationship = context.relationships.get(attr(image, 'id'))
      if (relationship) output.push(addImage(relationship, context))
    }
    return output.join(' ')
  }
  return (node.children ?? []).map(child => inlineDocx(child, context)).join('')
}

function addImage(relationship, context) {
  let uri
  let source
  let mimeType
  let digest
  let size
  if (relationship.external) {
    uri = relationship.target
    if (!isSafeUrl(uri, { image: true })) {
      context.warnings.push({ code: 'UNSAFE_IMAGE_URL', message: `Rejected DOCX image URL: ${uri.slice(0, 120)}` })
      return ''
    }
  }
  else {
    source = path.posix.normalize(path.posix.join('word', relationship.target.replace(/^\//, '')))
    const data = context.entries.get(source)
    if (!data) {
      context.warnings.push({ code: 'DOCX_MEDIA_MISSING', message: `Referenced DOCX media was not found: ${source}` })
      return ''
    }
    digest = sha256(data)
    size = data.length
    uri = `asset://docx/${digest}`
    const extension = path.posix.extname(source).toLowerCase()
    mimeType = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
    const id = `image-${context.assets.length + 1}`
    context.media.push({ id, name: path.posix.basename(source), mimeType, sha256: digest, data: new Uint8Array(data) })
    context.assets.push({ id, kind: 'image', uri, alt: '', source, mimeType, sha256: digest, bytes: size })
    return `![](${uri})`
  }
  const id = `image-${context.assets.length + 1}`
  context.assets.push({ id, kind: 'image', uri, alt: '', ...(source ? { source } : {}), ...(mimeType ? { mimeType } : {}), ...(digest ? { sha256: digest } : {}), ...(size != null ? { bytes: size } : {}) })
  return `![](${uri})`
}
