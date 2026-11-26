import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildIdempotencyKey,
  DeliveryMachine,
  DraftDeliveryService,
  DRAFT_ONLY_NOTE,
  MemoryDeliveryStore,
} from '../src/index.mjs'
import { createMockAdapters, mockInput, transientError } from '../src/mock.mjs'

function setup({ maxAttempts = 1, readbackTransform } = {}) {
  const store = new MemoryDeliveryStore()
  const mocks = createMockAdapters({ readbackTransform })
  const machine = new DeliveryMachine({
    store,
    ...mocks,
    retry: { maxAttempts, baseDelayMs: 0, maxDelayMs: 0 },
    sleep: async () => {},
  })
  return { store, mocks, machine }
}

function resumeMachine(dependencies, mocks) {
  return new DeliveryMachine({
    store: dependencies.store,
    ...mocks,
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    sleep: async () => {},
  })
}

function methodCalls(mocks, method) {
  return mocks.calls.filter(call => call.method === method)
}

test('happy path creates one verified draft in the required order', async () => {
  const { mocks, machine } = setup()
  const record = await machine.deliver(mockInput())

  assert.equal(record.status, 'completed')
  assert.equal(record.result.ok, true)
  assert.equal(record.result.scope, 'draft-only')
  assert.equal(record.result.note, DRAFT_ONLY_NOTE)
  assert.equal(record.result.mediaId, 'MOCK_DRAFT_1')
  assert.match(record.steps.draftAdd.output.article.content, /https:\/\/mmbiz\.qpic\.cn\/mock\/image-1/)
  assert.doesNotMatch(record.steps.draftAdd.output.article.content, /assets\/a\.png/)
  assert.equal(record.steps.draftAdd.output.article.thumb_media_id, mocks.state.thumbnails.values().next().value.mediaId)
  assert.deepEqual(record.result.comparison.differences, [])
  assert.deepEqual(mocks.calls.map(call => call.method), [
    'render',
    'inspect',
    'assets.uploadImage',
    'assets.uploadThumbnail',
    'drafts.add',
    'drafts.get',
    'verifier.compare',
  ])
  assert.deepEqual(mocks.effectCounts(), { images: 1, thumbnails: 1, draftAdds: 1, total: 3 })
  assert.equal(record.steps.render.status, 'completed')
  assert.equal(record.steps.report.status, 'completed')
  assert.ok(record.revision > 10)
  assert.ok(record.history.some(event => event.event === 'delivery-completed'))
  assert.equal(machine.publish, undefined)
  assert.equal(machine.massSend, undefined)
})

test('completed delivery and key-only resume perform zero additional work', async () => {
  const { mocks, machine } = setup()
  const input = mockInput()
  const first = await machine.deliver(input)
  const calls = mocks.calls.length
  const effects = mocks.effectCounts()

  const second = await machine.deliver(input)
  const resumed = await machine.resume(first.key)

  assert.equal(second.key, first.key)
  assert.equal(resumed.key, first.key)
  assert.equal(mocks.calls.length, calls)
  assert.deepEqual(mocks.effectCounts(), effects)
  assert.equal(mocks.state.draftByMediaId.size, 1)
})

test('idempotency key is canonical and covers document, theme, account and renderer', () => {
  const original = mockInput()
  const reordered = mockInput()
  reordered.theme = { options: original.theme.options, id: original.theme.id }
  assert.equal(buildIdempotencyKey(original), buildIdempotencyKey(reordered))

  for (const mutate of [
    input => { input.document.markdown += '\nchange' },
    input => { input.theme.options.primaryColor = '#000000' },
    input => { input.account.id = 'account-2' },
    input => { input.renderer.version = 'next-renderer' },
    input => { input.renderer.options.isShowLineNumber = true },
  ]) {
    const changed = mockInput()
    mutate(changed)
    assert.notEqual(buildIdempotencyKey(changed), buildIdempotencyKey(original))
  }
})

test('account secrets are never included in the key or persisted record', async () => {
  const { machine } = setup()
  const input = mockInput()
  input.account.appSecret = 'DO_NOT_STORE_SECRET'
  input.account.accessToken = 'DO_NOT_STORE_TOKEN'
  const record = await machine.deliver(input)
  const serialized = JSON.stringify(record)
  assert.doesNotMatch(serialized, /DO_NOT_STORE_SECRET|DO_NOT_STORE_TOKEN/)
  assert.deepEqual(record.input.account, { id: 'account-1', credentialRef: 'mock-account' })
})

test('inspection blockers stop before any remote side effect', async () => {
  const { mocks, machine } = setup()
  const input = mockInput()
  input.document.metadata.title = ''
  const record = await machine.deliver(input)

  assert.equal(record.status, 'failed')
  assert.equal(record.currentStep, 'inspect')
  assert.equal(record.error.code, 'INSPECTION_BLOCKED')
  assert.equal(record.error.category, 'validation')
  assert.equal(mocks.effectCounts().total, 0)
  assert.equal(mocks.calls.some(call => call.method.startsWith('drafts.')), false)
})

test('transient errors retry in the same run with persistent attempt history', async () => {
  const { mocks, machine } = setup({ maxAttempts: 2 })
  mocks.failNext('render', transientError('retry renderer', { sideEffect: 'none' }))
  const record = await machine.deliver(mockInput())

  assert.equal(record.status, 'completed')
  assert.equal(methodCalls(mocks, 'render').length, 2)
  assert.equal(record.steps.render.attempts, 2)
  assert.ok(record.history.some(event => event.step === 'render' && event.event === 'failed'))
})

test('every adapter stage can be resumed without duplicating completed effects', async t => {
  const stages = [
    'render',
    'inspect',
    'assets.uploadImage',
    'assets.uploadThumbnail',
    'drafts.add',
    'drafts.get',
    'verifier.compare',
  ]
  for (const stage of stages) {
    await t.test(stage, async () => {
      const dependencies = setup()
      const { mocks, machine } = dependencies
      mocks.failNext(stage, transientError(`failure at ${stage}`))
      const input = mockInput()
      const first = await machine.deliver(input)
      assert.equal(first.status, 'failed', stage)

      const second = await resumeMachine(dependencies, mocks).deliver(input)
      assert.equal(second.status, 'completed', JSON.stringify(second.error))
      assert.equal(mocks.effectCounts().draftAdds, 1)
      assert.equal(mocks.effectCounts().images, 1)
      assert.equal(mocks.effectCounts().thumbnails, 1)
      assert.equal(mocks.state.draftByMediaId.size, 1)
    })
  }
})

test('lost image upload response reuses the same remote idempotency key', async () => {
  const dependencies = setup()
  const { mocks, machine } = dependencies
  mocks.failNext('assets.uploadImage', transientError('response lost'), { after: true })
  const input = mockInput()

  const first = await machine.deliver(input)
  assert.equal(first.status, 'failed')
  assert.equal(mocks.effectCounts().images, 1)

  const resumed = await resumeMachine(dependencies, mocks).deliver(input)
  assert.equal(resumed.status, 'completed')
  assert.equal(mocks.effectCounts().images, 1)
  assert.equal(methodCalls(mocks, 'assets.uploadImage').length, 2)
  assert.equal(methodCalls(mocks, 'assets.uploadImage')[0].idempotencyKey, methodCalls(mocks, 'assets.uploadImage')[1].idempotencyKey)
  assert.equal(mocks.effectCounts().draftAdds, 1)
})

test('lost thumbnail response cannot create a second thumbnail', async () => {
  const dependencies = setup()
  const { mocks, machine } = dependencies
  mocks.failNext('assets.uploadThumbnail', transientError('thumb response lost'), { after: true })
  const input = mockInput()

  await machine.deliver(input)
  const resumed = await resumeMachine(dependencies, mocks).deliver(input)

  assert.equal(resumed.status, 'completed')
  assert.equal(mocks.effectCounts().thumbnails, 1)
  assert.equal(methodCalls(mocks, 'assets.uploadThumbnail').length, 2)
  assert.equal(mocks.effectCounts().draftAdds, 1)
})

test('crash after draft add reconciles by key instead of adding again', async () => {
  const dependencies = setup()
  const { mocks, machine } = dependencies
  mocks.drafts.idempotentAdd = false
  mocks.failNext('drafts.add', transientError('draft response lost'), { after: true })
  const input = mockInput()

  const first = await machine.deliver(input)
  assert.equal(first.status, 'failed')
  assert.equal(first.steps.draftAdd.remoteState, 'possible')
  assert.equal(mocks.effectCounts().draftAdds, 1)

  const resumed = await resumeMachine(dependencies, mocks).deliver(input)
  assert.equal(resumed.status, 'completed')
  assert.equal(resumed.steps.draftAdd.output.reconciled, true)
  assert.equal(mocks.effectCounts().draftAdds, 1)
  assert.equal(methodCalls(mocks, 'drafts.add').length, 1)
  assert.equal(methodCalls(mocks, 'drafts.findByKey').length, 1)
})

test('ambiguous add without idempotency or reconciliation is stopped, never retried blindly', async () => {
  const dependencies = setup()
  const { mocks, machine } = dependencies
  mocks.drafts.idempotentAdd = false
  delete mocks.drafts.findByKey
  mocks.failNext('drafts.add', transientError('unknown remote outcome'), { after: true })
  const input = mockInput()

  const first = await machine.deliver(input)
  assert.equal(first.status, 'needs_reconciliation')
  assert.equal(first.error.sideEffect, 'possible')
  assert.equal(mocks.effectCounts().draftAdds, 1)

  const calls = mocks.calls.length
  const second = await resumeMachine(dependencies, mocks).resume(first.key)
  assert.equal(second.status, 'needs_reconciliation')
  assert.equal(mocks.calls.length, calls)

  const third = await resumeMachine(dependencies, mocks).resume(first.key, { reconcile: true })
  assert.equal(third.status, 'needs_reconciliation')
  assert.equal(mocks.effectCounts().draftAdds, 1)
  assert.equal(methodCalls(mocks, 'drafts.add').length, 1)
})

test('readback mismatch fails closed and resume does not create another draft', async () => {
  const { mocks, machine } = setup({
    readbackTransform: article => ({ ...article, content: `${article.content}<p>changed</p>` }),
  })
  const input = mockInput()
  const first = await machine.deliver(input)

  assert.equal(first.status, 'failed')
  assert.equal(first.currentStep, 'compare')
  assert.equal(first.error.code, 'READBACK_MISMATCH')
  assert.equal(mocks.effectCounts().draftAdds, 1)
  const getCalls = methodCalls(mocks, 'drafts.get').length

  const resumed = await machine.deliver(input)
  assert.equal(resumed.status, 'failed')
  assert.equal(mocks.effectCounts().draftAdds, 1)
  assert.equal(methodCalls(mocks, 'drafts.get').length, getCalls)
  assert.equal(methodCalls(mocks, 'verifier.compare').length, 2)
})

test('concurrent duplicate submissions share one execution and one draft', async () => {
  const { mocks, machine } = setup()
  const render = mocks.renderer.render
  mocks.renderer.render = async context => {
    await new Promise(resolve => setTimeout(resolve, 20))
    return render(context)
  }
  const input = mockInput()

  const [left, right] = await Promise.all([machine.deliver(input), machine.deliver(input)])

  assert.equal(left.status, 'completed')
  assert.equal(right.status, 'completed')
  assert.equal(left.key, right.key)
  assert.equal(mocks.effectCounts().total, 3)
  assert.equal(methodCalls(mocks, 'drafts.add').length, 1)
  assert.equal(mocks.state.draftByMediaId.size, 1)
})

test('missing configured cover stops before draft add', async () => {
  const { mocks, machine } = setup()
  const input = mockInput()
  delete input.document.thumbnail
  const record = await machine.deliver(input)

  assert.equal(record.status, 'failed')
  assert.equal(record.currentStep, 'thumbnail')
  assert.equal(record.error.code, 'COVER_REQUIRED')
  assert.equal(mocks.effectCounts().draftAdds, 0)
  assert.equal(methodCalls(mocks, 'drafts.add').length, 0)
})

test('non-idempotent asset adapters are rejected before any operation', () => {
  const store = new MemoryDeliveryStore()
  const mocks = createMockAdapters()
  mocks.assets.idempotentUploads = false
  assert.throws(
    () => new DeliveryMachine({ store, ...mocks }),
    /idempotentUploads/,
  )
})

test('configured service accepts new documents without repeated operational setup', async () => {
  const { mocks, machine } = setup()
  const configured = mockInput()
  const service = new DraftDeliveryService({
    machine,
    theme: configured.theme,
    account: configured.account,
    renderer: configured.renderer,
  })

  const firstInput = mockInput()
  const first = await service.submit(firstInput.document)
  const secondInput = mockInput()
  secondInput.document.id = 'document-2'
  secondInput.document.markdown += '\nsecond article'
  const second = await service.submit(secondInput.document)

  assert.equal(first.status, 'completed')
  assert.equal(second.status, 'completed')
  assert.notEqual(first.key, second.key)
  assert.equal(mocks.effectCounts().draftAdds, 2)
  assert.equal(mocks.effectCounts().total, 6)

  const calls = mocks.calls.length
  const duplicate = await service.submit(firstInput.document)
  assert.equal(duplicate.key, first.key)
  assert.equal(mocks.calls.length, calls)
  assert.equal(mocks.effectCounts().total, 6)
})
