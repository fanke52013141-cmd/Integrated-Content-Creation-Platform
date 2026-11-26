import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, ApiError } from '../lib/api.js'

function fetchResponse(payload, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) })
}

test('API client follows the actual health/themes/render/delivery/comment contract', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/delivery/key%20one')) return fetchResponse({ ok: true, record: { key: 'key one' } })(url, options)
    return fetchResponse({ ok: true, html: '<p>真实响应</p>', record: { key: 'key one' }, result: { id: 'comment-1' } })(url, options)
  }
  const client = new ApiClient({ fetchImpl })
  await client.health()
  await client.themes()
  await client.render({ markdown: '# 测试', themeId: 'tech-blue', metadata: {} })
  await client.submitDelivery({ markdown: '# 测试' }, { accountId: 'account-1' })
  await client.delivery('key one')
  await client.comment({ body: '意见', author: '编辑' })
  assert.deepEqual(calls.map(call => call.url), ['/api/health', '/api/themes', '/api/render', '/api/delivery', '/api/delivery/key%20one', '/api/workspace/comment'])
  assert.equal(calls[2].options.method, 'POST')
  assert.equal(JSON.parse(calls[3].options.body).overrides.accountId, 'account-1')
})

test('API error payload is surfaced instead of becoming success', async () => {
  const client = new ApiClient({ fetchImpl: fetchResponse({ ok: false, error: { code: 'WORKSPACE_NOT_CONFIGURED', message: '未配置' } }, 501) })
  await assert.rejects(() => client.comment({}), error => error instanceof ApiError && error.code === 'WORKSPACE_NOT_CONFIGURED' && error.status === 501)
})

test('browser-global fetch is bound and does not throw Illegal invocation', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })
  try {
    const client = new ApiClient()
    const result = await client.health()
    assert.equal(result.ok, true)
  }
  finally { globalThis.fetch = originalFetch }
})

test('network failure and timeout have explicit codes', async () => {
  const unavailable = new ApiClient({ fetchImpl: async () => { throw new Error('offline') } })
  await assert.rejects(() => unavailable.health(), error => error.code === 'BACKEND_UNAVAILABLE')
  const timeout = new ApiClient({ fetchImpl: () => new Promise(() => {}), timeoutMs: 5 })
  await assert.rejects(() => timeout.health(), error => error.code === 'API_TIMEOUT')
})
