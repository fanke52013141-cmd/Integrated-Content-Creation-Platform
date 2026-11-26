const TRANSIENT_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
  'FETCH_ERROR',
  'RATE_LIMITED',
])

export class DeliveryError extends Error {
  constructor(message, {
    code = 'DELIVERY_FAILED',
    category = 'permanent',
    retryable = false,
    sideEffect = 'none',
    step,
    details,
    cause,
  } = {}) {
    super(message, { cause })
    this.name = 'DeliveryError'
    this.code = code
    this.category = category
    this.retryable = retryable
    this.sideEffect = sideEffect
    this.step = step
    this.details = details
  }
}

export function normalizeFailure(error, step) {
  const status = Number(error?.status ?? error?.statusCode ?? 0)
  const originalCode = error?.code == null ? '' : String(error.code)
  const transientCode = TRANSIENT_CODES.has(originalCode)
  const transientStatus = status === 408 || status === 425 || status === 429 || status >= 500
  const cancelled = error?.name === 'AbortError'
  const retryable = error?.retryable ?? (!cancelled && (transientCode || transientStatus))
  const category = error?.category
    ?? (cancelled ? 'cancelled' : retryable ? 'transient' : originalCode.startsWith('INVALID') ? 'validation' : 'permanent')
  const sideEffect = error?.sideEffect ?? (retryable ? 'possible' : 'none')

  return {
    name: error?.name ?? 'Error',
    code: originalCode || 'DELIVERY_FAILED',
    message: error?.message ?? String(error),
    category,
    retryable,
    sideEffect,
    status: status || undefined,
    step,
    details: error?.details,
    stack: error?.stack,
  }
}

export function failureFor(error, step, overrides = {}) {
  return { ...normalizeFailure(error, step), ...overrides }
}

export class StepAbort extends Error {
  constructor() {
    super('Stop the current delivery run; the record already contains the failure')
    this.name = 'StepAbort'
  }
}
