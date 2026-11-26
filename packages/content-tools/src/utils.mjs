import { createHash } from 'node:crypto'

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .normalize('NFC')
}

export function cleanLines(value) {
  return normalizeText(value)
    .split('\n')
    .map(line => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function collapseWhitespace(value) {
  return normalizeText(value).replace(/\s+/g, ' ').trim()
}

export function stableValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite numbers are not supported')
    return value
  }
  if (Array.isArray(value)) return value.map(stableValue)
  if (ArrayBuffer.isView(value)) return { $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => item !== undefined && key !== 'data')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]))
  }
  throw new TypeError(`Unsupported value: ${typeof value}`)
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

export function sha256(value) {
  const bytes = typeof value === 'string' || ArrayBuffer.isView(value)
    ? value
    : stableStringify(value)
  return createHash('sha256').update(bytes).digest('hex')
}

const ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
})

export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) {
      const point = Number.parseInt(lower.slice(2), 16)
      return validCodePoint(point) ? String.fromCodePoint(point) : '\uFFFD'
    }
    if (lower.startsWith('#')) {
      const point = Number.parseInt(lower.slice(1), 10)
      return validCodePoint(point) ? String.fromCodePoint(point) : '\uFFFD'
    }
    return ENTITIES[lower] ?? match
  })
}

function validCodePoint(point) {
  return Number.isInteger(point) && point >= 0 && point <= 0x10FFFF && !(point >= 0xD800 && point <= 0xDFFF)
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

export function plainTextFromHtml(value) {
  return collapseWhitespace(decodeEntities(String(value ?? '')
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')))
}

export function isSafeUrl(value, { image = false, internal = false } = {}) {
  const url = collapseWhitespace(decodeEntities(value)).replace(/[\u0000-\u0020]/g, '')
  if (!url) return false
  if (url.startsWith('#') || (!url.startsWith('//') && /^\.{0,2}\//.test(url))) return true
  if (!url.includes('\\') && !url.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(url)) return true
  if (internal && /^asset:(?:\/\/[a-z0-9][a-z0-9/+.-]*|[a-z0-9][a-z0-9+.-]*:)/i.test(url)) return true
  if (/^https?:\/\//i.test(url)) return true
  if (!image && /^(mailto|tel):/i.test(url)) return true
  return false
}

export function slugify(value) {
  const slug = collapseWhitespace(value).toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[\p{P}\p{S}]+/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}
