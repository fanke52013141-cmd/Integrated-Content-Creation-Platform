import { createHash } from 'node:crypto'

const SENSITIVE_KEY = /^(?:.*(?:secret|password|token|authorization|cookie|api_?key|credentials?|private_?key)|set-cookie)$/i

export function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite number in distribution input')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (ArrayBuffer.isView(value)) return { $binarySha256: sha256Bytes(value), bytes: value.byteLength }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => item !== undefined && !SENSITIVE_KEY.test(key) && key !== 'data')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalValue(item)]))
  }
  throw new TypeError(`Unsupported distribution value: ${typeof value}`)
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export function sha256Bytes(value) {
  return createHash('sha256').update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex')
}

export function hashValue(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function sanitizeReceiptValue(value) {
  return canonicalValue(value)
}

export function buildDistributionKey({ channel, account, document, target }) {
  if (!channel || !document) throw new TypeError('channel and document are required')
  return hashValue({
    schemaVersion: 1,
    channel,
    account: { id: account?.id ?? 'default', credentialRef: account?.credentialRef },
    target: target ?? null,
    document: normalizeDocument(document),
  })
}

export function normalizeDocument(document) {
  const source = typeof document === 'string' ? { markdown: document } : document
  if (!source || typeof source !== 'object') throw new TypeError('document must be a normalized object or Markdown string')
  const metadata = { ...(source.metadata ?? {}) }
  const title = String(source.title ?? metadata.title ?? '').trim()
  const markdown = String(source.markdown ?? source.source ?? '')
  const html = String(source.html ?? source.renderedHtml ?? '')
  const plainText = String(source.plainText ?? stripHtml(html || markdown)).trim()
  if (!title) throw new DistributionValidationError('A document title is required before distribution')
  if (!markdown && !html && !plainText) throw new DistributionValidationError('Document body is empty')
  return {
    id: source.id,
    revision: source.revision ?? source.contentHash,
    metadata,
    title,
    markdown,
    html,
    plainText,
    assets: source.assets ?? source.images ?? [],
    thumbnail: source.thumbnail,
    wechatDocument: source.wechatDocument,
  }
}

class DistributionValidationError extends TypeError {
  constructor(message) {
    super(message)
    this.name = 'DistributionError'
    this.code = 'DOCUMENT_VALIDATION_FAILED'
    this.category = 'validation'
    this.retryable = false
    this.sideEffect = 'none'
  }
}

export function stripHtml(value) {
  return String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function semanticText(value) {
  return stripHtml(value).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
}
