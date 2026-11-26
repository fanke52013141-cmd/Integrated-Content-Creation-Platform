import { importDocx } from './docx.mjs'
import { importHtml } from './html.mjs'
import { importMarkdown } from './markdown.mjs'
import { inspectContent } from './inspect.mjs'
import { ContentImportError } from './errors.mjs'

export { importMarkdown, parseMarkdown } from './markdown.mjs'
export { importDocx } from './docx.mjs'
export { importHtml, parseHtmlTree } from './html.mjs'
export { inspectContent, assertContentReady } from './inspect.mjs'
export { createNormalizedDocument, normalizeMetadata } from './normalize.mjs'
export { renderHtmlBlocks, renderInline, renderMarkdownBlocks, blocksToPlainText } from './blocks.mjs'
export { ContentImportError, ContentInspectionError } from './errors.mjs'

/**
 * Unified import entry point. Every result contains { document, report, media }.
 * DOCX bytes are only returned in media; the normalized document stays serializable.
 */
export function importContent(input, options = {}) {
  const descriptor = typeof input === 'object' && input !== null && !(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input) && 'data' in input
    ? input
    : { data: input }
  const data = descriptor.data
  const merged = { ...descriptor, ...options }
  delete merged.data
  const format = normalizeFormat(merged.format ?? inferFormat(merged.name) ?? (typeof data === 'string' ? 'markdown' : null))
  let result
  if (format === 'markdown') {
    if (typeof data !== 'string') throw new TypeError('Markdown import requires a string')
    result = importMarkdown(data, merged)
  }
  else if (format === 'html') {
    result = importHtml(typeof data === 'string' ? data : { html: data?.html, authorization: descriptor.authorization }, merged)
  }
  else if (format === 'docx') result = importDocx(data, merged)
  else throw new ContentImportError(`Unsupported import format: ${format ?? 'unknown'}`, { code: 'IMPORT_FORMAT_UNSUPPORTED' })
  return { ...result, report: inspectContent(result.document, merged.inspection) }
}

function inferFormat(name) {
  const extension = name?.split('.').at(-1)?.toLowerCase()
  return ({ md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', docx: 'docx' })[extension]
}

function normalizeFormat(format) {
  if (!format) return null
  const normalized = String(format).toLowerCase().replace(/^\./, '')
  return ({ md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', docx: 'docx' })[normalized] ?? normalized
}
