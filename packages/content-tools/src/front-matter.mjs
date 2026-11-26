import { ContentImportError } from './errors.mjs'
import { normalizeText } from './utils.mjs'

/** A deliberately small, deterministic YAML front-matter subset. */
export function splitFrontMatter(input) {
  const source = normalizeText(input)
  if (!source.startsWith('---\n')) return { attributes: {}, body: source }
  const end = source.indexOf('\n---', 4)
  if (end < 0 || !/^\n---[\t ]*(?:\n|$)/.test(source.slice(end))) {
    throw new ContentImportError('Unclosed YAML front matter', { code: 'FRONT_MATTER_UNCLOSED' })
  }
  const raw = source.slice(4, end)
  const body = source.slice(end).replace(/^\n---[\t ]*(?:\n|$)/, '')
  return { attributes: parseFrontMatter(raw), body }
}

export function parseFrontMatter(source) {
  const result = {}
  let arrayKey = null
  for (const [index, original] of source.split('\n').entries()) {
    const line = original.trim()
    if (!line || line.startsWith('#')) continue
    const item = line.match(/^-\s+(.+)$/)
    if (item && arrayKey) {
      result[arrayKey].push(parseScalar(item[1]))
      continue
    }
    const pair = line.match(/^([A-Za-z_][\w.-]*):[\t ]*(.*)$/)
    if (!pair) throw new ContentImportError(`Unsupported front matter at line ${index + 1}`, { code: 'FRONT_MATTER_INVALID' })
    const [, key, rawValue] = pair
    if (!rawValue) {
      result[key] = []
      arrayKey = key
    }
    else {
      result[key] = parseScalar(rawValue)
      arrayKey = null
    }
  }
  return result
}

function parseScalar(raw) {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try { return JSON.parse(value) }
      catch { throw new ContentImportError('Invalid quoted front-matter string', { code: 'FRONT_MATTER_INVALID' }) }
    }
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value)
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    return inner ? inner.split(',').map(item => parseScalar(item)) : []
  }
  return value
}
