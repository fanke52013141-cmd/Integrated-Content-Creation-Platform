import { DistributionError } from '../errors.mjs'
import { MOCK_ONLY_CHANNELS } from '../capabilities.mjs'
import { hashValue, semanticText } from '../utils.mjs'

/**
 * Replaceable contract mock for channels without a verified live integration.
 * It has no publish method by design; all results are explicitly simulated.
 */
export class ContractMockAdapter {
  mode = 'mock'
  idempotent = true

  constructor(channel) {
    if (!MOCK_ONLY_CHANNELS.includes(channel)) throw new TypeError(`Contract mock is only for: ${MOCK_ONLY_CHANNELS.join(', ')}`)
    this.channel = channel
    this.calls = []
    this.drafts = new Map()
    this.faults = new Map()
  }

  capabilities() {
    return { draft: true, publish: false, readback: true, reconcile: true, idempotency: true, simulated: true }
  }

  async createDraft(context) {
    return this.invoke('createDraft', context, async () => {
      if (!this.drafts.has(context.idempotencyKey)) {
        const suffix = hashValue({ channel: this.channel, key: context.idempotencyKey }).slice(0, 16).toUpperCase()
        this.drafts.set(context.idempotencyKey, {
          remoteId: `MOCK_${this.channel.toUpperCase()}_${suffix}`,
          document: structuredClone(context.document),
          providerStatus: 'mock-draft',
        })
      }
      return this.toResult(this.drafts.get(context.idempotencyKey))
    })
  }

  async findByKey(context) {
    return this.invoke('findByKey', context, async () => {
      const draft = this.drafts.get(context.idempotencyKey)
      return draft ? this.toResult(draft, { reconciled: true }) : null
    })
  }

  async getStatus(context) {
    const remoteId = context.receipt?.remote?.remoteId ?? context.remoteId
    if (!remoteId) return this.findByKey(context)
    return this.invoke('getStatus', context, async () => {
      const draft = [...this.drafts.values()].find(item => item.remoteId === remoteId)
      return draft ? this.toResult(draft, { reconciled: true }) : null
    })
  }

  async reconcile(context) {
    const actual = await this.getStatus(context)
    if (!actual) return null
    const differences = []
    if (actual.title !== context.document.title) differences.push({ field: 'title', expected: context.document.title, actual: actual.title })
    if (semanticText(actual.content) !== semanticText(context.document.plainText)) differences.push({ field: 'content' })
    return { ...actual, matches: differences.length === 0, differences }
  }

  failNext(method, { after = false, error } = {}) {
    const queue = this.faults.get(method) ?? []
    queue.push({ after, error: error ?? new DistributionError('Injected mock failure', { code: 'MOCK_TRANSIENT', category: 'transient', retryable: true, sideEffect: 'possible' }) })
    this.faults.set(method, queue)
  }

  async invoke(method, context, work) {
    this.calls.push({ method, channel: this.channel, idempotencyKey: context.idempotencyKey })
    const fault = this.faults.get(method)?.shift()
    if (fault && !fault.after) throw fault.error
    const result = await work()
    if (fault?.after) throw fault.error
    return result
  }

  toResult(draft, extra = {}) {
    return {
      remoteId: draft.remoteId,
      status: 'draft',
      providerStatus: draft.providerStatus,
      title: draft.document.title,
      content: draft.document.plainText,
      simulated: true,
      integration: 'mock-contract',
      ...extra,
    }
  }
}

export function createContractMockAdapter(channel) {
  return new ContractMockAdapter(channel)
}
