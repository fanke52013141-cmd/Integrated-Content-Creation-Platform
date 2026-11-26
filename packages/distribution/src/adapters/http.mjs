import { DistributionError, parseResponse } from '../errors.mjs'

export async function httpRequest({
  fetchImpl,
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15_000,
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs)
  timer.unref?.()
  let response
  try {
    response = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      signal: controller.signal,
    })
  }
  catch (cause) {
    throw new DistributionError(`HTTP ${method} failed before a response was received`, {
      code: cause?.code === 'ETIMEDOUT' || controller.signal.aborted ? 'ETIMEDOUT' : cause?.code || 'FETCH_ERROR',
      category: 'transient', retryable: true, sideEffect: method === 'GET' || method === 'HEAD' ? 'none' : 'possible', cause,
    })
  }
  finally { clearTimeout(timer) }
  let data
  try { data = await parseResponse(response) }
  catch (cause) {
    throw new DistributionError(`HTTP ${method} response body could not be read`, {
      code: 'RESPONSE_READ_ERROR', category: 'transient', retryable: true,
      sideEffect: method === 'GET' || method === 'HEAD' ? 'none' : 'possible', status: response.status, cause,
    })
  }
  if (!response.ok) {
    const status = response.status
    const retryable = status === 408 || status === 425 || status === 429 || status >= 500
    throw new DistributionError(`HTTP ${method} returned ${status}`, {
      code: `HTTP_${status}`,
      category: retryable ? 'transient' : status === 401 || status === 403 ? 'authorization' : 'permanent',
      retryable,
      sideEffect: method === 'GET' || method === 'HEAD' || (!retryable && status >= 400 && status < 500) ? 'none' : 'possible',
      status,
      details: { response: safeResponseSummary(data) },
    })
  }
  return { data, status: response.status, headers: response.headers }
}

function safeResponseSummary(data) {
  if (!data || typeof data !== 'object') return {}
  const result = {}
  for (const key of ['code', 'message', 'error', 'status', 'id']) {
    if (typeof data[key] === 'string' || typeof data[key] === 'number') result[key] = String(data[key]).slice(0, 500)
  }
  return result
}

export function responseHeader(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  return headers[name] ?? headers[name.toLowerCase()]
}
