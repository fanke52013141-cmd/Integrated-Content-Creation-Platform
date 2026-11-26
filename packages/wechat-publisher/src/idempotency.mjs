import { createHash } from 'node:crypto'

const KEY_SCHEMA = 'wechat-draft-delivery-v1'

function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Idempotency input contains a non-finite number')
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('hex') }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      const item = value[key]
      if (item === undefined) continue
      if (typeof item === 'function' || typeof item === 'symbol') {
        throw new TypeError(`Idempotency input contains non-data field: ${key}`)
      }
      result[key] = normalize(item)
    }
    return result
  }
  throw new TypeError(`Unsupported idempotency input type: ${typeof value}`)
}

/** Stable JSON: object key order and insignificant whitespace do not affect the hash. */
export function canonicalJson(value) {
  return JSON.stringify(normalize(value))
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Only an account reference is persisted. AppSecret, access tokens and arbitrary
 * credentials are deliberately excluded from both the key and the stored input.
 */
export function publicAccount(account) {
  if (!account?.id || typeof account.id !== 'string') {
    throw new DeliveryInputError('account.id is required')
  }
  return {
    id: account.id,
    ...(account.credentialRef ? { credentialRef: account.credentialRef } : {}),
  }
}

export class DeliveryInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DeliveryInputError'
    this.code = 'INVALID_DELIVERY_INPUT'
  }
}

/** Validate and clone the input into JSON-safe data suitable for persistence. */
export function normalizeDeliveryInput(input) {
  if (!input?.document || typeof input.document.markdown !== 'string') {
    throw new DeliveryInputError('document.markdown must be a string')
  }
  if (!input.theme?.id) throw new DeliveryInputError('theme.id is required')
  if (!input.renderer?.id || !input.renderer?.version) {
    throw new DeliveryInputError('renderer.id and renderer.version are required')
  }
  const normalized = {
    document: input.document,
    theme: input.theme,
    renderer: input.renderer,
    account: publicAccount(input.account),
  }
  return JSON.parse(canonicalJson(normalized))
}

/**
 * The key covers source content/metadata/assets, theme, target account and the
 * exact renderer implementation/options. Retry policy and credentials do not
 * participate, so operational changes cannot create a second logical delivery.
 */
export function buildIdempotencyKey(input) {
  const normalized = normalizeDeliveryInput(input)
  return `${KEY_SCHEMA}:${sha256(canonicalJson(normalized))}`
}

export function stepIdempotencyKey(deliveryKey, step, id = '') {
  return `${deliveryKey}:${step}${id ? `:${id}` : ''}`
}
