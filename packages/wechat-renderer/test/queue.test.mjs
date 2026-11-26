import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SerialTaskQueue, withTimeout } from '../src/index.mjs'

test('serial queue never overlaps tasks and preserves submission order', async () => {
  const queue = new SerialTaskQueue()
  const events = []
  let active = 0
  let maxActive = 0
  const work = (id, delay) => async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    events.push(`start-${id}`)
    await new Promise(resolve => setTimeout(resolve, delay))
    events.push(`end-${id}`)
    active -= 1
    return id
  }

  const results = await Promise.all([queue.run(work('a', 25)), queue.run(work('b', 1)), queue.run(work('c', 1))])
  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.deepEqual(events, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c'])
  assert.equal(maxActive, 1)
  assert.equal(queue.pending, 0)
})

test('one rejected task does not poison the following task', async () => {
  const queue = new SerialTaskQueue()
  const failed = queue.run(async () => { throw new Error('expected') })
  const next = queue.run(async () => 'ok')
  await assert.rejects(failed, /expected/)
  assert.equal(await next, 'ok')
})

test('close drains accepted work and rejects later submissions', async () => {
  const queue = new SerialTaskQueue()
  const events = []
  const task = queue.run(async () => {
    await new Promise(resolve => setTimeout(resolve, 10))
    events.push('work')
  })
  const closed = queue.close(async () => { events.push('dispose') })
  await assert.rejects(queue.run(async () => 'late'), error => error.code === 'RENDERER_CLOSED')
  await Promise.all([task, closed])
  assert.deepEqual(events, ['work', 'dispose'])
  await queue.close(async () => { throw new Error('dispose must be called once') })
})

test('withTimeout rejects with a stable error code', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10),
    error => error.code === 'RENDER_TIMEOUT',
  )
  assert.equal(await withTimeout(Promise.resolve('done'), 100), 'done')
})
