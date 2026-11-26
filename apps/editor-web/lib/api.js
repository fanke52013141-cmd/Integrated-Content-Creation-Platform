export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, details } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class ApiClient {
  constructor({ base = '/api', fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required')
    this.base = base.replace(/\/$/, '')
    this.fetch = fetchImpl.bind(globalThis)
    this.timeoutMs = timeoutMs
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await Promise.race([
        this.fetch(`${this.base}${path}`, {
          method,
          signal: controller.signal,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        }),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new ApiError('请求超时，请稍后重试', { code: 'API_TIMEOUT' })), { once: true })
        })
      ])
      const text = await response.text()
      let payload = null
      if (text) {
        try { payload = JSON.parse(text) }
        catch { throw new ApiError('服务器返回了非 JSON 响应', { code: 'INVALID_JSON', status: response.status }) }
      }
      if (!response.ok || payload?.ok === false) {
        const error = payload?.error
        throw new ApiError(error?.message || `请求失败（HTTP ${response.status}）`, {
          code: error?.code || 'HTTP_ERROR',
          status: response.status,
          details: error?.details
        })
      }
      return payload || {}
    }
    catch (error) {
      if (error instanceof ApiError) throw error
      if (error?.name === 'AbortError') throw new ApiError('请求超时，请稍后重试', { code: 'API_TIMEOUT' })
      throw new ApiError('后端暂不可用，当前仅保留本地编辑能力', { code: 'BACKEND_UNAVAILABLE', details: error?.message })
    }
    finally { clearTimeout(timer) }
  }

  health() { return this.request('/health') }
  themes() { return this.request('/themes') }
  render(input) { return this.request('/render', { method: 'POST', body: input }) }
  submitDelivery(document, overrides = {}) {
    return this.request('/delivery', { method: 'POST', body: { document, overrides } })
  }
  delivery(key) { return this.request(`/delivery/${encodeURIComponent(key)}`) }
  comment(input) { return this.request('/workspace/comment', { method: 'POST', body: input }) }
}
