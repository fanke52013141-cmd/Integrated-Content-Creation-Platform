import { assertAdapterContract, assertChannelCapability, getChannelCapabilities } from './capabilities.mjs'
import { DistributionError, normalizeDistributionError } from './errors.mjs'
import { MemoryReceiptStore } from './store.mjs'
import { buildDistributionKey, normalizeDocument, sanitizeReceiptValue } from './utils.mjs'

const TERMINAL_STATUSES = new Set(['draft', 'published', 'accepted', 'simulated'])

export class DistributionService {
  constructor({ adapters = [], store = new MemoryReceiptStore(), now = () => new Date() } = {}) {
    if (!store?.load || !store?.save || !store?.runExclusive) throw new TypeError('Receipt store must implement load/save/runExclusive')
    this.store = store
    this.now = now
    this.adapters = new Map()
    for (const adapter of Array.isArray(adapters) ? adapters : Object.values(adapters)) this.registerAdapter(adapter)
  }

  registerAdapter(adapter) {
    assertAdapterContract(adapter)
    this.adapters.set(adapter.channel, adapter)
    return this
  }

  getCapabilities(channel) {
    return getChannelCapabilities(channel, { adapter: this.requireAdapter(channel) })
  }

  async submit(request) {
    const adapter = this.requireAdapter(request?.channel)
    const requestedMode = request.requestedMode ?? request.mode ?? request.operation ?? 'draft'
    if (!['draft', 'publish'].includes(requestedMode)) {
      throw new DistributionError('requestedMode must be draft or publish', { code: 'REQUEST_VALIDATION_FAILED', category: 'validation' })
    }
    assertChannelCapability(adapter.channel, 'draft', { adapter })
    if (requestedMode === 'publish') {
      if (request.allowPublish !== true) {
        throw new DistributionError('Publishing requires allowPublish=true; draft is always the default', { code: 'PUBLISH_CONFIRMATION_REQUIRED', category: 'validation', sideEffect: 'none' })
      }
      assertChannelCapability(adapter.channel, 'publish', { adapter })
      if (typeof adapter.publish !== 'function') {
        throw new DistributionError(`${adapter.channel} adapter has no publish method`, { code: 'CHANNEL_CAPABILITY_UNSUPPORTED', category: 'validation' })
      }
    }
    const document = normalizeDocument(request.document)
    const account = sanitizeReceiptValue(request.account ?? { id: 'default' })
    const target = request.target == null ? null : sanitizeReceiptValue(request.target)
    const key = buildDistributionKey({ channel: adapter.channel, account, document, target })
    return this.store.runExclusive(key, async () => {
      let record = await this.store.load(key)
      if (!record) {
        record = this.createRecord({ key, adapter, document, account, target, requestedMode })
        await this.persist(record)
      }
      else {
        if (adapter.mode !== record.adapterMode) throw new DistributionError('Stored receipt adapter mode differs from the registered adapter', { code: 'ADAPTER_MODE_CONFLICT', category: 'validation' })
        record.requestedMode = requestedMode
        await this.persist(record)
      }
      if (record.status === 'running') {
        await this.markInterrupted(record)
        return record
      }
      if (record.status === 'needs_reconciliation') return record
      if (TERMINAL_STATUSES.has(record.status)) {
        if (requestedMode === 'draft' || record.status === 'published' || record.status === 'simulated') return record
      }
      await this.execute(record, adapter)
      return this.store.load(key)
    })
  }

  async resume(key, { reconcile = false } = {}) {
    return this.store.runExclusive(key, async () => {
      const record = await this.requireRecord(key)
      const adapter = this.requireAdapter(record.channel)
      if (record.status === 'running') await this.markInterrupted(record)
      if (record.status === 'needs_reconciliation') {
        if (!reconcile) return record
        await this.reconcileInternal(record, adapter)
        if (record.status === 'needs_reconciliation' || record.status === 'failed') return this.store.load(key)
      }
      if (TERMINAL_STATUSES.has(record.status) && (record.requestedMode === 'draft' || record.status === 'published' || record.status === 'simulated')) return record
      await this.execute(record, adapter)
      return this.store.load(key)
    })
  }

  async reconcile(key) {
    return this.store.runExclusive(key, async () => {
      const record = await this.requireRecord(key)
      const adapter = this.requireAdapter(record.channel)
      if (record.status === 'simulated') return record
      await this.reconcileInternal(record, adapter)
      return this.store.load(key)
    })
  }

  async get(key) {
    return this.store.load(key)
  }

  async list(filter) {
    if (!this.store.list) throw new TypeError('Configured receipt store does not implement list()')
    return this.store.list(filter)
  }

  createRecord({ key, adapter, document, account, target, requestedMode }) {
    const now = this.timestamp()
    return {
      schemaVersion: 1,
      key,
      jobId: `job_${key.slice(0, 24)}`,
      channel: adapter.channel,
      adapterMode: adapter.mode,
      simulated: adapter.mode === 'mock',
      requestedMode,
      status: 'queued',
      stage: 'draft',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      input: { document: sanitizeReceiptValue(document), account, target },
      capabilities: sanitizeReceiptValue(getChannelCapabilities(adapter.channel, { adapter })),
      attempts: { draft: 0, publish: 0, reconcile: 0 },
      remote: null,
      verification: { state: 'not-requested', differences: [] },
      history: [{ at: now, event: 'receipt-created', stage: 'draft' }],
      error: null,
    }
  }

  async execute(record, adapter) {
    if (record.status === 'simulated') return record
    if (!record.remote) {
      const outcome = await this.performStage(record, 'draft', context => adapter.createDraft(context))
      if (!outcome.ok) return record
      this.applyRemote(record, outcome.result)
      if (record.status === 'simulated') {
        await this.persist(record)
        return record
      }
    }
    else if (record.remote.status === 'published') {
      record.status = 'published'
    }
    else if (record.remote.status === 'draft') {
      record.status = 'draft'
      record.stage = 'draft'
    }

    if (record.requestedMode === 'publish') {
      if (record.status === 'published') {
        record.completedAt ??= this.timestamp()
        await this.persist(record)
        return record
      }
      if (record.status !== 'draft' || record.remote?.status !== 'draft') {
        return this.failWithoutSideEffect(record, 'publish', new DistributionError('A confirmed draft is required before publishing; an accepted webhook receipt is not a draft', { code: 'DRAFT_REQUIRED', category: 'validation' }))
      }
      const capabilities = getChannelCapabilities(record.channel, { adapter })
      if (capabilities.readback === true && typeof adapter.reconcile === 'function' && record.verification.state !== 'verified') {
        await this.reconcileInternal(record, adapter)
        if (record.status !== 'draft' || record.verification.state !== 'verified') return record
      }
      const outcome = await this.performStage(record, 'publish', context => adapter.publish(context))
      if (!outcome.ok) return record
      if (outcome.result?.status !== 'published') {
        return this.failWithoutSideEffect(record, 'publish', new DistributionError('Adapter did not confirm published status', { code: 'PUBLISH_UNCONFIRMED', sideEffect: 'possible' }), true)
      }
      this.applyRemote(record, outcome.result)
      record.status = 'published'
      record.stage = 'publish'
      record.completedAt = this.timestamp()
      record.history.push({ at: this.timestamp(), event: 'published', stage: 'publish' })
      await this.persist(record)
      return record
    }

    if (record.remote) {
      record.status = adapter.mode === 'mock' ? 'simulated' : record.remote.status
      record.stage = 'draft'
      record.completedAt = this.timestamp()
      await this.persist(record)
    }
    return record
  }

  async reconcileInternal(record, adapter) {
    if (adapter.mode === 'mock' && record.status === 'simulated') return record
    const capabilities = getChannelCapabilities(record.channel, { adapter })
    if (capabilities.reconcile !== true || (typeof adapter.reconcile !== 'function' && typeof adapter.getStatus !== 'function')) {
      record.verification = { state: 'not-supported', differences: [], checkedAt: this.timestamp() }
      record.history.push({ at: this.timestamp(), event: 'reconciliation-not-supported', stage: 'reconcile' })
      if (record.status === 'needs_reconciliation') record.error = { code: 'RECONCILIATION_UNAVAILABLE', message: 'No remote lookup is configured; inspect the channel manually before retrying.', category: 'permanent', retryable: false, sideEffect: 'possible' }
      await this.persist(record)
      return record
    }
    const operation = typeof adapter.reconcile === 'function'
      ? context => adapter.reconcile(context)
      : context => adapter.getStatus(context)
    const outcome = await this.performStage(record, 'reconcile', operation, { preserveNeedsReconciliation: true })
    if (!outcome.ok) return record
    const actual = outcome.result
    if (!actual) {
      record.status = 'needs_reconciliation'
      record.verification = { state: 'not-found', differences: [], checkedAt: this.timestamp() }
      record.error = { code: 'REMOTE_RECEIPT_NOT_FOUND', message: 'No remote draft or receipt was found; do not create another one without manual verification.', category: 'permanent', retryable: false, sideEffect: 'possible' }
      record.history.push({ at: this.timestamp(), event: 'remote-not-found', stage: 'reconcile' })
      await this.persist(record)
      return record
    }
    const differences = actual.differences ?? []
    const mismatched = actual.matches === false || differences.length > 0
    this.applyRemote(record, actual, { preserveStatus: true })
    record.verification = {
      state: adapter.mode === 'mock' ? 'simulated' : mismatched ? 'mismatch' : actual.content != null || actual.comparisonOk === true ? 'verified' : 'status-verified',
      differences: sanitizeReceiptValue(differences),
      checkedAt: this.timestamp(),
    }
    record.history.push({ at: this.timestamp(), event: mismatched ? 'readback-mismatch' : 'reconciled', stage: 'reconcile' })
    if (mismatched) {
      record.status = 'needs_reconciliation'
      record.error = { code: 'READBACK_MISMATCH', message: 'Remote content differs from the normalized document; another publish attempt is blocked.', category: 'permanent', retryable: false, sideEffect: 'none' }
    }
    else {
      record.status = adapter.mode === 'mock' ? 'simulated' : actual.status ?? record.remote.status
      record.stage = record.status === 'published' ? 'publish' : 'draft'
      record.error = null
      record.completedAt = this.timestamp()
    }
    await this.persist(record)
    return record
  }

  async performStage(record, stage, operation, { preserveNeedsReconciliation = false } = {}) {
    record.attempts[stage] = (record.attempts[stage] ?? 0) + 1
    const attempt = record.attempts[stage]
    const previousStatus = record.status
    record.status = 'running'
    record.stage = stage
    record.error = null
    record.history.push({ at: this.timestamp(), event: 'stage-started', stage, attempt })
    await this.persist(record)
    try {
      const result = await operation(this.context(record))
      if (!result || typeof result !== 'object') throw new DistributionError(`${stage} adapter returned no receipt`, { code: 'ADAPTER_RECEIPT_INVALID', sideEffect: stage === 'reconcile' ? 'none' : 'possible' })
      record.history.push({ at: this.timestamp(), event: 'stage-completed', stage, attempt })
      return { ok: true, result }
    }
    catch (error) {
      const failure = normalizeDistributionError(error, stage)
      record.error = failure
      record.status = failure.sideEffect === 'possible' || (preserveNeedsReconciliation && previousStatus === 'needs_reconciliation') ? 'needs_reconciliation' : 'failed'
      record.history.push({ at: this.timestamp(), event: 'stage-failed', stage, attempt, error: failure })
      await this.persist(record)
      return { ok: false, error: failure }
    }
  }

  applyRemote(record, result, { preserveStatus = false } = {}) {
    const remote = sanitizeReceiptValue({ ...(record.remote ?? {}), ...result })
    record.remote = remote
    if (record.adapterMode === 'mock' || result.simulated) {
      record.simulated = true
      record.status = 'simulated'
      record.stage = 'draft'
      record.verification = { state: 'simulated', differences: [], checkedAt: this.timestamp() }
      record.completedAt = this.timestamp()
      record.history.push({ at: this.timestamp(), event: 'draft-simulated-no-real-publication', stage: 'draft' })
      return
    }
    if (!preserveStatus) {
      record.status = result.status
      record.stage = result.status === 'published' ? 'publish' : 'draft'
      record.completedAt = this.timestamp()
      record.history.push({ at: this.timestamp(), event: result.existing ? 'existing-draft-recovered' : 'draft-receipt-recorded', stage: 'draft' })
      if (result.comparisonOk === true) record.verification = { state: 'verified', differences: [], checkedAt: this.timestamp() }
      else if (record.status === 'draft') record.verification = { state: 'unverified', differences: [] }
    }
  }

  async failWithoutSideEffect(record, stage, error, possible = false) {
    const failure = normalizeDistributionError(error, stage)
    if (possible) failure.sideEffect = 'possible'
    record.error = failure
    record.status = failure.sideEffect === 'possible' ? 'needs_reconciliation' : 'failed'
    record.history.push({ at: this.timestamp(), event: 'stage-failed', stage, error: failure })
    await this.persist(record)
    return record
  }

  async markInterrupted(record) {
    record.status = 'needs_reconciliation'
    record.error = {
      code: 'INTERRUPTED_STAGE',
      message: 'A persisted running stage was interrupted; reconcile before any new remote write.',
      category: 'transient',
      retryable: true,
      sideEffect: record.stage === 'reconcile' ? 'none' : 'possible',
      operation: record.stage,
    }
    record.history.push({ at: this.timestamp(), event: 'interrupted-stage', stage: record.stage })
    await this.persist(record)
  }

  context(record) {
    return {
      idempotencyKey: record.key,
      receipt: structuredClone(record),
      document: structuredClone(record.input.document),
      account: structuredClone(record.input.account),
      target: structuredClone(record.input.target),
      remoteId: record.remote?.remoteId,
      providerKey: record.remote?.providerKey
        ?? record.error?.details?.providerKey
        ?? [...record.history].reverse().find(event => event.error?.details?.providerKey)?.error.details.providerKey,
    }
  }

  requireAdapter(channel) {
    const adapter = this.adapters.get(channel)
    if (!adapter) throw new DistributionError(`No adapter registered for channel: ${channel}`, { code: 'CHANNEL_ADAPTER_MISSING', category: 'validation' })
    return adapter
  }

  async requireRecord(key) {
    const record = await this.store.load(key)
    if (!record) throw new DistributionError(`Unknown distribution receipt: ${key}`, { code: 'RECEIPT_NOT_FOUND', category: 'validation' })
    return record
  }

  timestamp() {
    const value = this.now()
    return typeof value === 'string' ? value : value.toISOString()
  }

  async persist(record) {
    record.revision += 1
    record.updatedAt = this.timestamp()
    await this.store.save(record)
  }
}
