import test from 'node:test'
import assert from 'node:assert/strict'
import { DeliveryController } from '../lib/delivery.js'

test('only a backend terminal completed record produces success', async () => {
  const client = {
    submitDelivery: async () => ({ ok: true, record: { key: 'job-1', status: 'RECEIVED' } }),
    delivery: async () => ({ ok: true, record: { key: 'job-1', status: 'COMPLETED', readback: { equal: true } } })
  }
  const controller = new DeliveryController({ client, pollIntervalMs: 0 })
  const result = await controller.submit({ markdown: '# 测试' }, 'account-1')
  assert.equal(result.ok, true)
  assert.equal(controller.state.status, 'completed')
  assert.equal(controller.state.record.readback.equal, true)
})

test('backend failure remains failure and pending timeout is unknown, never success', async () => {
  const failed = new DeliveryController({ client: { submitDelivery: async () => ({ ok: true, record: { key: 'f', status: 'FAILED', error: 'invalid image' } }) } })
  const failure = await failed.submit({ markdown: '# 失败' }, 'account-1')
  assert.equal(failure.ok, false)
  assert.equal(failed.state.record.error, 'invalid image')

  const pending = new DeliveryController({ client: { submitDelivery: async () => ({ ok: true, record: { key: 'p', status: 'RECEIVED' } }), delivery: async () => ({ ok: true, record: { key: 'p', status: 'RENDERED' } }) }, pollIntervalMs: 0, maxPolls: 2 })
  const unknown = await pending.submit({ markdown: '# 等待' }, 'account-1')
  assert.equal(unknown.ok, false)
  assert.equal(pending.state.status, 'unknown')
  assert.match(pending.state.error, /不能据此认定草稿成功/)
})

test('busy submission queues only the latest document when auto mode is enabled', async () => {
  let release
  const submitted = []
  const client = {
    submitDelivery: document => {
      submitted.push(document.markdown)
      if (submitted.length === 1) return new Promise(resolve => { release = () => resolve({ ok: true, record: { key: 'one', status: 'COMPLETED' } }) })
      return Promise.resolve({ ok: true, record: { key: 'two', status: 'COMPLETED' } })
    }
  }
  const controller = new DeliveryController({ client })
  controller.setEnabled(true)
  const first = controller.submit({ markdown: 'first' }, 'account-1')
  const queued = await controller.submit({ markdown: 'latest' }, 'account-1')
  assert.equal(queued.queued, true)
  release()
  await first
  assert.deepEqual(submitted, ['first', 'latest'])
  assert.equal(controller.state.key, 'two')
})

test('missing account and API error do not call success callback', async () => {
  const controller = new DeliveryController({ client: {} })
  const missing = await controller.submit({ markdown: '# 测试' }, '')
  assert.equal(missing.ok, false)
  const failing = new DeliveryController({ client: { submitDelivery: async () => { throw new Error('network down') } } })
  const failed = await failing.submit({ markdown: '# 测试' }, 'account-1')
  assert.equal(failed.ok, false)
  assert.equal(failing.state.status, 'error')
})
