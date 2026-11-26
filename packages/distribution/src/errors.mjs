const TRANSIENT_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'EAI_AGAIN', 'ENETDOWN', 'ENETRESET', 'ENETUNREACH', 'ETIMEDOUT', 'FETCH_ERROR', 'RATE_LIMITED'])

export class DistributionError extends Error {
  constructor(message, {
    code = 'DISTRIBUTION_FAILED', category = 'permanent', retryable = false,
    sideEffect = 'none', status, details, cause,
  } = {}) {
    super(message, { cause })
    this.name = 'DistributionError'
    this.code = code
    this.category = category
    this.retryable = retryable
    this.sideEffect = sideEffect
    this.status = status
    this.details = details
  }
}

export function normalizeDistributionError(error, operation) {
  const status = Number(error?.status ?? error?.statusCode ?? 0) || undefined
  const code = String(error?.code || 'DISTRIBUTION_FAILED')
  const retryable = error?.retryable ?? (TRANSIENT_CODES.has(code) || status === 408 || status === 425 || status === 429 || (status ?? 0) >= 500)
  return {
    name: error?.name ?? 'Error',
    code,
    message: error?.message ?? String(error),
    category: error?.category ?? (retryable ? 'transient' : code.includes('CAPABILITY') || code.includes('VALIDATION') ? 'validation' : 'permanent'),
    retryable: Boolean(retryable),
    sideEffect: error?.sideEffect ?? (retryable ? 'possible' : 'none'),
    status,
    operation,
    details: error?.details,
  }
}

export async function parseResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try { return JSON.parse(text) }
  catch { return { text: text.slice(0, 4000) } }
}

export function validateHttpUrl(value, name = 'URL') {
  let url
  try { url = new URL(value) }
  catch { throw new DistributionError(`${name} must be an absolute HTTP(S) URL`, { code: 'ADAPTER_CONFIG_INVALID', category: 'validation' }) }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new DistributionError(`${name} must use HTTP(S)`, { code: 'ADAPTER_CONFIG_INVALID', category: 'validation' })
  }
  url.username = ''
  url.password = ''
  return url.toString().replace(/\/$/, '')
}
