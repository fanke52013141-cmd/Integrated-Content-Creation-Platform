import { DistributionError } from '../errors.mjs'

/** Wraps @integrated-content/wechat-publisher's DraftDeliveryService without duplicating its state machine. */
export class WeChatAdapter {
  channel = 'wechat'
  mode
  idempotent = true

  constructor({ service, mode = 'live' }) {
    if (!service?.submit || !service?.get || !service?.resume) {
      throw new TypeError('WeChatAdapter requires an existing DraftDeliveryService with submit/get/resume')
    }
    this.service = service
    this.mode = mode
  }

  capabilities() {
    return { draft: true, publish: false, readback: true, reconcile: true, idempotency: true }
  }

  async createDraft(context) {
    const input = toWeChatDocument(context.document)
    const useBoundAccount = context.account?.id === 'default' && !context.account?.credentialRef
    const record = await this.service.submit(input, useBoundAccount ? {} : { account: context.account })
    return this.mapRecord(record)
  }

  async getStatus(context) {
    const key = context.receipt?.remote?.providerKey ?? context.providerKey
    if (!key) return null
    return this.mapRecord(await this.service.get(key))
  }

  async reconcile(context) {
    const key = context.receipt?.remote?.providerKey ?? context.providerKey
    if (!key) return null
    const record = await this.service.resume(key, { reconcile: true })
    const result = this.mapRecord(record, { reconciled: true })
    return { ...result, matches: result.comparisonOk === true, differences: result.differences ?? [] }
  }

  mapRecord(record, extra = {}) {
    if (!record) return null
    if (record.status === 'completed' && record.result?.ok && record.result?.mediaId) {
      return {
        remoteId: record.result.mediaId,
        providerKey: record.key,
        status: 'draft',
        providerStatus: record.status,
        scope: 'draft-only',
        comparisonOk: record.result.comparison?.ok ?? record.result.ok,
        differences: record.result.comparison?.differences ?? [],
        ...(this.mode === 'mock' ? { simulated: true } : {}),
        ...extra,
      }
    }
    if (record.status === 'needs_reconciliation') {
      throw new DistributionError('WeChat draft requires reconciliation before another remote operation', {
        code: 'WECHAT_RECONCILIATION_REQUIRED', category: 'transient', sideEffect: 'possible',
        details: { providerKey: record.key, providerStatus: record.status },
      })
    }
    const failure = record.error ?? {}
    throw new DistributionError(failure.message ?? `WeChat draft was not confirmed: ${record.status}`, {
      code: failure.code ?? 'WECHAT_DRAFT_UNCONFIRMED',
      category: failure.category,
      retryable: failure.retryable,
      sideEffect: failure.sideEffect ?? 'possible',
      details: { providerKey: record.key, providerStatus: record.status },
    })
  }
}

function toWeChatDocument(document) {
  if (document.wechatDocument) return document.wechatDocument
  return {
    id: document.id,
    markdown: document.markdown || document.plainText,
    metadata: {
      ...document.metadata,
      title: document.title,
      digest: document.metadata?.digest ?? document.metadata?.summary ?? '',
    },
    renderedHtml: document.html,
    images: (document.assets ?? []).map(asset => ({ ...asset, src: asset.src ?? asset.uri })),
    thumbnail: document.thumbnail,
  }
}

export function createWeChatAdapter(options) {
  return new WeChatAdapter(options)
}
