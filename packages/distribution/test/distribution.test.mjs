import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHANNEL_CAPABILITIES,
  DistributionService,
  MemoryReceiptStore,
  createChannelContractMocks,
  createContractMockAdapter,
  createWeChatAdapter,
  createWebhookAdapter,
  createWordPressAdapter,
  getChannelCapabilities,
} from '../src/index.mjs'
import {
  DeliveryMachine,
  DraftDeliveryService,
  MemoryDeliveryStore,
} from '../../wechat-publisher/src/index.mjs'
import { createMockAdapters, mockInput, transientError } from '../../wechat-publisher/src/mock.mjs'

const document = {
  id: 'doc-1',
  revision: 'rev-1',
  metadata: { title: '测试标题', summary: '摘要', author: '作者' },
  title: '测试标题',
  markdown: '# 测试标题\n\n正文',
  html: '<h1>测试标题</h1><p>正文</p>',
  plainText: '测试标题 正文',
  assets: [],
  thumbnail: { id: 'cover', src: 'assets/cover.jpg' },
}

test('capability matrix separates live, configurable and mock-only channels', () => {
  assert.equal(CHANNEL_CAPABILITIES.wechat.publish, false)
  assert.equal(CHANNEL_CAPABILITIES.wordpress.publish, true)
  assert.equal(CHANNEL_CAPABILITIES.webhook.publish, 'configurable')
  for (const channel of ['zhihu', 'juejin', 'csdn', 'toutiao']) {
    const capabilities = getChannelCapabilities(channel, { mode: 'mock' })
    assert.equal(capabilities.integration, 'mock-only')
    assert.equal(capabilities.realDraft, false)
    assert.equal(capabilities.realPublish, false)
    assert.equal(capabilities.simulated, true)
  }
})

test('all contract mocks produce explicitly simulated drafts and reject every publish attempt', async () => {
  const mocks = createChannelContractMocks()
  const service = new DistributionService({ adapters: Object.values(mocks) })
  for (const channel of Object.keys(mocks)) {
    const receipt = await service.submit({ channel, document })
    assert.equal(receipt.status, 'simulated')
    assert.equal(receipt.simulated, true)
    assert.equal(receipt.remote.simulated, true)
    assert.equal(receipt.verification.state, 'simulated')
    assert.match(receipt.remote.remoteId, new RegExp(`^MOCK_${channel.toUpperCase()}_`))
    assert.equal(mocks[channel].publish, undefined)
    await assert.rejects(service.submit({ channel, document, requestedMode: 'publish', allowPublish: true }), error => error.code === 'CHANNEL_CAPABILITY_UNSUPPORTED')
    const reconciled = await service.reconcile(receipt.key)
    assert.equal(reconciled.status, 'simulated')
  }
})

test('mock response loss is reconciled without another create and never becomes a real publication', async () => {
  const adapter = createContractMockAdapter('zhihu')
  adapter.failNext('createDraft', { after: true })
  const service = new DistributionService({ adapters: [adapter] })
  const first = await service.submit({ channel: 'zhihu', document })
  assert.equal(first.status, 'needs_reconciliation')
  const resumed = await service.resume(first.key, { reconcile: true })
  assert.equal(resumed.status, 'simulated')
  assert.equal(adapter.drafts.size, 1)
  assert.equal(adapter.calls.filter(call => call.method === 'createDraft').length, 1)
  assert.notEqual(resumed.status, 'published')
})

test('WordPress defaults to draft, persists redacted receipts, deduplicates and requires explicit publish confirmation', async () => {
  const remote = new FakeWordPress()
  const adapter = createWordPressAdapter({
    baseUrl: 'https://wp.example',
    fetch: remote.fetch,
    credentials: { username: 'editor', applicationPassword: 'DO_NOT_STORE' },
  })
  const service = new DistributionService({ adapters: [adapter] })
  await assert.rejects(service.submit({ channel: 'wordpress', document, requestedMode: 'publish' }), error => error.code === 'PUBLISH_CONFIRMATION_REQUIRED')
  assert.equal(remote.posts.size, 0)
  const first = await service.submit({
    channel: 'wordpress', document,
    account: { id: 'site-a', credentialRef: 'secret-manager:wp-a', applicationPassword: 'DO_NOT_STORE' },
  })
  assert.equal(first.status, 'draft')
  assert.equal(first.remote.providerStatus, 'draft')
  assert.equal(first.requestedMode, 'draft')
  assert.equal(remote.posts.size, 1)
  assert.equal(remote.calls.filter(call => call.method === 'POST' && /\/posts$/.test(call.url)).length, 1)
  assert.match(remote.calls.find(call => call.method === 'POST').headers.Authorization, /^Basic /)
  assert.doesNotMatch(JSON.stringify(first), /DO_NOT_STORE/)

  const calls = remote.calls.length
  const duplicate = await service.submit({ channel: 'wordpress', document, account: { id: 'site-a', credentialRef: 'secret-manager:wp-a' } })
  assert.equal(duplicate.key, first.key)
  assert.equal(remote.calls.length, calls)
  assert.equal(remote.posts.size, 1)

  const published = await service.submit({
    channel: 'wordpress', document, requestedMode: 'publish', allowPublish: true,
    account: { id: 'site-a', credentialRef: 'secret-manager:wp-a' },
  })
  assert.equal(published.key, first.key)
  assert.equal(published.status, 'published')
  assert.equal(published.remote.providerStatus, 'publish')
  assert.equal(published.verification.state, 'verified')
  assert.equal(published.attempts.draft, 1)
  assert.equal(published.attempts.reconcile, 1)
  assert.equal(published.attempts.publish, 1)
  assert.equal(remote.posts.size, 1)
  assert.ok(published.history.some(event => event.event === 'reconciled'))
  assert.ok(published.history.some(event => event.event === 'published'))
})

test('WordPress lost create response recovers by deterministic slug with no duplicate post', async () => {
  const remote = new FakeWordPress({ loseNextCreateResponse: true })
  const service = new DistributionService({ adapters: [createWordPressAdapter({ baseUrl: 'https://wp.example', fetch: remote.fetch })] })
  const first = await service.submit({ channel: 'wordpress', document })
  assert.equal(first.status, 'needs_reconciliation')
  assert.equal(first.error.sideEffect, 'possible')
  assert.equal(remote.posts.size, 1)
  const calls = remote.calls.length
  const noRetry = await service.submit({ channel: 'wordpress', document })
  assert.equal(noRetry.status, 'needs_reconciliation')
  assert.equal(remote.calls.length, calls)
  const recovered = await service.resume(first.key, { reconcile: true })
  assert.equal(recovered.status, 'draft')
  assert.equal(recovered.remote.existing, true)
  assert.equal(recovered.verification.state, 'verified')
  assert.equal(remote.posts.size, 1)
  assert.equal(remote.calls.filter(call => call.method === 'POST' && /\/posts$/.test(call.url)).length, 1)
})

test('WordPress readback mismatch blocks publication and marks reconciliation', async () => {
  const remote = new FakeWordPress()
  const service = new DistributionService({ adapters: [createWordPressAdapter({ baseUrl: 'https://wp.example', fetch: remote.fetch })] })
  const draft = await service.submit({ channel: 'wordpress', document })
  remote.posts.get(draft.remote.remoteId).title.rendered = '被修改的标题'
  const checked = await service.reconcile(draft.key)
  assert.equal(checked.status, 'needs_reconciliation')
  assert.equal(checked.error.code, 'READBACK_MISMATCH')
  assert.equal(checked.verification.state, 'mismatch')
  assert.equal(checked.verification.differences[0].field, 'title')
  const blocked = await service.submit({ channel: 'wordpress', document, requestedMode: 'publish', allowPublish: true })
  assert.equal(blocked.status, 'needs_reconciliation')
  assert.equal(blocked.attempts.publish, 0)
})

test('WordPress malformed slug lookup fails before creating a possibly duplicate post', async () => {
  let postCalls = 0
  const adapter = createWordPressAdapter({
    baseUrl: 'https://wp.example',
    fetch: async (url, init) => {
      if ((init.method ?? 'GET') === 'POST') postCalls += 1
      return jsonResponse({ unexpected: true })
    },
  })
  const service = new DistributionService({ adapters: [adapter] })
  const receipt = await service.submit({ channel: 'wordpress', document })
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'WORDPRESS_LOOKUP_INVALID')
  assert.equal(postCalls, 0)
})

test('generic webhook records accepted rather than inferring a draft or publication', async () => {
  const calls = []
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/content',
    secret: 'signing-secret',
    fetch: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({ receipt_id: 'receipt-1', status: 'accepted' }, 202)
    },
  })
  const service = new DistributionService({ adapters: [adapter] })
  const receipt = await service.submit({ channel: 'webhook', document })
  assert.equal(receipt.status, 'accepted')
  assert.notEqual(receipt.status, 'published')
  assert.equal(receipt.remote.receiptId, 'receipt-1')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.event, 'content.draft.upsert')
  assert.equal(body.idempotencyKey, receipt.key)
  assert.equal(calls[0].init.headers['Idempotency-Key'], receipt.key)
  assert.match(calls[0].init.headers['X-Content-Signature'], /^sha256=[a-f0-9]{64}$/)
  const checked = await service.reconcile(receipt.key)
  assert.equal(checked.verification.state, 'not-supported')
  assert.equal(checked.status, 'accepted')
})

test('webhook publish is opt-in and still follows draft then explicit remote confirmation', async () => {
  const events = []
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/draft',
    publishEndpoint: 'https://hooks.example/publish',
    supportsPublish: true,
    idempotent: true,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      events.push(body.event)
      return jsonResponse(body.event === 'content.publish'
        ? { id: 'remote-1', status: 'published', url: 'https://example.com/published' }
        : { id: 'remote-1', status: 'draft' })
    },
  })
  const service = new DistributionService({ adapters: [adapter] })
  const receipt = await service.submit({ channel: 'webhook', document, requestedMode: 'publish', allowPublish: true })
  assert.equal(receipt.status, 'published')
  assert.deepEqual(events, ['content.draft.upsert', 'content.publish'])
  assert.equal(receipt.attempts.draft, 1)
  assert.equal(receipt.attempts.publish, 1)
})

test('webhook ambiguous response stays blocked when no lookup is configured', async () => {
  let calls = 0
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/draft',
    fetch: async () => { calls += 1; throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) },
  })
  const service = new DistributionService({ adapters: [adapter] })
  const first = await service.submit({ channel: 'webhook', document })
  assert.equal(first.status, 'needs_reconciliation')
  const resumed = await service.resume(first.key, { reconcile: true })
  assert.equal(resumed.status, 'needs_reconciliation')
  assert.equal(resumed.error.code, 'RECONCILIATION_UNAVAILABLE')
  assert.equal(calls, 1)
})

test('a response-body stream failure after POST remains an ambiguous side effect', async () => {
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/draft',
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => { throw new Error('stream reset') },
    }),
  })
  const service = new DistributionService({ adapters: [adapter] })
  const receipt = await service.submit({ channel: 'webhook', document })
  assert.equal(receipt.status, 'needs_reconciliation')
  assert.equal(receipt.error.code, 'RESPONSE_READ_ERROR')
  assert.equal(receipt.error.sideEffect, 'possible')
})

test('concurrent identical submissions share one receipt and one remote request', async () => {
  let calls = 0
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/draft',
    fetch: async () => {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return jsonResponse({ receipt_id: 'one', status: 'accepted' }, 202)
    },
  })
  const service = new DistributionService({ adapters: [adapter], store: new MemoryReceiptStore() })
  const [first, second] = await Promise.all([
    service.submit({ channel: 'webhook', document }),
    service.submit({ channel: 'webhook', document }),
  ])
  assert.equal(first.key, second.key)
  assert.equal(calls, 1)
  assert.equal((await service.list()).length, 1)
})

test('WeChat adapter reuses the existing verified draft state machine and exposes no publish operation', async () => {
  const input = mockInput()
  const mocks = createMockAdapters()
  const machine = new DeliveryMachine({
    store: new MemoryDeliveryStore(), ...mocks,
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 }, sleep: async () => {},
  })
  const delivery = new DraftDeliveryService({ machine, theme: input.theme, account: input.account, renderer: input.renderer })
  const adapter = createWeChatAdapter({ service: delivery })
  const service = new DistributionService({ adapters: [adapter] })
  const receipt = await service.submit({ channel: 'wechat', document, account: input.account })
  assert.equal(receipt.status, 'draft')
  assert.equal(receipt.remote.scope, 'draft-only')
  assert.equal(receipt.remote.remoteId, 'MOCK_DRAFT_1')
  assert.equal(receipt.verification.state, 'verified')
  assert.equal(adapter.publish, undefined)
  await assert.rejects(service.submit({ channel: 'wechat', document, account: input.account, requestedMode: 'publish', allowPublish: true }), error => error.code === 'CHANNEL_CAPABILITY_UNSUPPORTED')
})

test('interrupted running receipts fail closed instead of repeating a remote write', async () => {
  let calls = 0
  const store = new MemoryReceiptStore()
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/draft',
    fetch: async () => { calls += 1; return jsonResponse({ receipt_id: 'one', status: 'accepted' }, 202) },
  })
  const service = new DistributionService({ adapters: [adapter], store })
  const first = await service.submit({ channel: 'webhook', document })
  const interrupted = await store.load(first.key)
  interrupted.status = 'running'
  interrupted.stage = 'draft'
  interrupted.remote = null
  await store.save(interrupted)
  const resumed = await service.resume(first.key)
  assert.equal(resumed.status, 'needs_reconciliation')
  assert.equal(resumed.error.code, 'INTERRUPTED_STAGE')
  assert.equal(calls, 1)
})

test('webhook explicit receiver failure is not misreported as accepted', async () => {
  const adapter = createWebhookAdapter({
    endpoint: 'https://hooks.example/draft',
    fetch: async () => jsonResponse({ receipt_id: 'failed-1', status: 'rejected' }),
  })
  const service = new DistributionService({ adapters: [adapter] })
  const receipt = await service.submit({ channel: 'webhook', document })
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'WEBHOOK_REMOTE_FAILED')
  assert.notEqual(receipt.status, 'accepted')
})

test('WeChat provider key from a failed outer receipt enables underlying state-machine recovery', async () => {
  const input = mockInput()
  const mocks = createMockAdapters()
  mocks.failNext('drafts.add', transientError('response lost', { sideEffect: 'possible' }), { after: true })
  const machine = new DeliveryMachine({
    store: new MemoryDeliveryStore(), ...mocks,
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 }, sleep: async () => {},
  })
  const delivery = new DraftDeliveryService({ machine, theme: input.theme, account: input.account, renderer: input.renderer })
  const service = new DistributionService({ adapters: [createWeChatAdapter({ service: delivery })] })
  const first = await service.submit({ channel: 'wechat', document, account: input.account })
  assert.equal(first.status, 'needs_reconciliation')
  assert.ok(first.error.details.providerKey)
  const recovered = await service.resume(first.key, { reconcile: true })
  assert.equal(recovered.status, 'draft', JSON.stringify(recovered, null, 2))
  assert.equal(recovered.remote.remoteId, 'MOCK_DRAFT_1')
  assert.equal(mocks.state.draftByKey.size, 1)
})

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

class FakeWordPress {
  constructor({ loseNextCreateResponse = false } = {}) {
    this.posts = new Map()
    this.calls = []
    this.loseNextCreateResponse = loseNextCreateResponse
    this.sequence = 0
    this.fetch = this.fetch.bind(this)
  }

  async fetch(url, init) {
    const method = init.method ?? 'GET'
    this.calls.push({ url, method, headers: init.headers, body: init.body })
    const parsed = new URL(url)
    const collection = parsed.pathname === '/wp-json/wp/v2/posts'
    const item = parsed.pathname.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/)
    if (method === 'GET' && collection) {
      const slug = parsed.searchParams.get('slug')
      const posts = [...this.posts.values()].filter(post => !slug || post.slug === slug)
      return jsonResponse(posts)
    }
    if (method === 'POST' && collection) {
      const body = JSON.parse(init.body)
      this.sequence += 1
      const post = {
        id: String(this.sequence),
        status: body.status,
        slug: body.slug,
        title: { rendered: body.title },
        content: { rendered: body.content },
        link: `https://wp.example/?p=${this.sequence}`,
        modified: '2026-01-01T00:00:00',
      }
      this.posts.set(post.id, post)
      if (this.loseNextCreateResponse) {
        this.loseNextCreateResponse = false
        throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' })
      }
      return jsonResponse(post, 201)
    }
    if (item && this.posts.has(item[1])) {
      const post = this.posts.get(item[1])
      if (method === 'GET') return jsonResponse(post)
      if (method === 'POST') {
        Object.assign(post, JSON.parse(init.body))
        return jsonResponse(post)
      }
    }
    return jsonResponse({ code: 'not_found', message: 'Not found' }, 404)
  }
}
