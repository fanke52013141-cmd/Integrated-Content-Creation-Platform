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
]);

const TRANSIENT_WECHAT_CODES = new Set([-1, 45009]);
const AUTH_WECHAT_CODES = new Set([40001, 40014, 40125, 40164, 42001, 48001]);

export class AdapterError extends Error {
  constructor(message, {
    code = 'ADAPTER_FAILED',
    category = 'permanent',
    retryable = false,
    sideEffect = 'none',
    status,
    details,
    cause,
  } = {}) {
    super(message, { cause });
    this.name = 'AdapterError';
    this.code = code;
    this.category = category;
    this.retryable = retryable;
    this.sideEffect = sideEffect;
    if (status !== undefined) this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function classifyError(error, { sideEffect, category, retryable, details } = {}) {
  if (error instanceof AdapterError && sideEffect === undefined && category === undefined && retryable === undefined) {
    return error;
  }
  const numericWechatCode = Number(error?.errcode ?? error?.code);
  const originalCode = error?.errcode ?? error?.code ?? error?.name ?? 'ADAPTER_FAILED';
  const status = Number(error?.status ?? error?.statusCode ?? 0) || undefined;
  const networkCode = String(error?.code ?? '');
  const transient = TRANSIENT_CODES.has(networkCode)
    || TRANSIENT_WECHAT_CODES.has(numericWechatCode)
    || status === 408
    || status === 425
    || status === 429
    || (status !== undefined && status >= 500);
  const auth = AUTH_WECHAT_CODES.has(numericWechatCode) || status === 401 || status === 403;
  const validation = status === 400 || status === 404 || String(originalCode).startsWith('INVALID');
  const resolvedRetryable = retryable ?? (error?.name === 'AbortError' ? false : transient);
  const resolvedCategory = category
    ?? (auth
      ? 'auth'
      : transient
        ? 'transient'
        : validation
          ? 'validation'
          : error?.category ?? 'permanent');
  return new AdapterError(error?.message ?? String(error), {
    code: originalCode,
    category: resolvedCategory,
    retryable: resolvedRetryable,
    sideEffect: sideEffect ?? error?.sideEffect ?? (resolvedRetryable ? 'possible' : 'none'),
    status,
    details: {
      ...(error?.rid ? { rid: error.rid } : {}),
      ...(error?.details ?? {}),
      ...(details ?? {}),
    },
    cause: error,
  });
}

export function validationError(message, code = 'INVALID_ADAPTER_INPUT', details) {
  return new AdapterError(message, {
    code,
    category: 'validation',
    retryable: false,
    sideEffect: 'none',
    details,
  });
}

export function ambiguousError(message, code, details) {
  return new AdapterError(message, {
    code,
    category: 'ambiguous',
    retryable: false,
    sideEffect: 'possible',
    details,
  });
}
