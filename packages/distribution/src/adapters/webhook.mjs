import { createHmac } from 'node:crypto'
import { DistributionError, validateHttpUrl } from '../errors.mjs'
import { responseHeader, httpRequest } from './http.mjs'

export class WebhookAdapter {
  channel = 'webhook'
  mode

  constructor({
    endpoint,
    fetch: fetchImpl = globalThis.fetch,
    secret,
    headers = {},
    timeoutMs = 15_000,
    idempotent = false,
    supportsPublish = false,
    publishEndpoint,
    statusEndpoint,
    mode = 'live',
  }) {
    if (!endpoint || typeof fetchImpl !== 'function') throw new TypeError('Webhook endpoint and fetch are required')
    this.endpoint = validateHttpUrl(endpoint, 'Webhook endpoint')
    this.publishEndpoint = publishEndpoint ? validateHttpUrl(publishEndpoint, 'Webhook publishEndpoint') : null
    this.statusEndpoint = statusEndpoint ? validateHttpUrl(statusEndpoint, 'Webhook statusEndpoint') : null
    this.fetch = fetchImpl
    this.secret = secret
    this.headers = headers
    this.timeoutMs = timeoutMs
    this.idempotent = idempotent === true
    this.supportsPublish = supportsPublish === true
    this.mode = mode
    if (this.supportsPublish && !this.publishEndpoint) throw new TypeError('supportsPublish requires publishEndpoint')
  }

  capabilities() {
    return {
      draft: true,
      publish: this.supportsPublish,
      readback: Boolean(this.statusEndpoint),
      reconcile: Boolean(this.statusEndpoint),
      idempotency: this.idempotent,
    }
  }

  async createDraft(context) {
    const body = envelope('content.draft.upsert', context)
    const response = await this.send(this.endpoint, body, context)
    return mapWebhookReceipt(response, { defaultStatus: 'accepted' })
  }

  async publish(context) {
    if (!this.supportsPublish || !this.publishEndpoint) {
      throw new DistributionError('Webhook publish endpoint is not configured', { code: 'CHANNEL_CAPABILITY_UNSUPPORTED', category: 'validation' })
    }
    const body = {
      ...envelope('content.publish', context),
      draft: { remoteId: context.receipt?.remote?.remoteId ?? context.remoteId },
    }
    const response = await this.send(this.publishEndpoint, body, context)
    const result = mapWebhookReceipt(response, { defaultStatus: 'accepted' })
    if (result.status !== 'published') {
      throw new DistributionError('Webhook acknowledged the publish request but did not explicitly confirm status=published', {
        code: 'PUBLISH_UNCONFIRMED', sideEffect: 'possible', details: { acknowledged: true },
      })
    }
    return result
  }

  async getStatus(context) {
    if (!this.statusEndpoint) return null
    const id = context.receipt?.remote?.receiptId ?? context.receipt?.remote?.remoteId ?? context.remoteId
    if (!id) return null
    const endpoint = this.statusEndpoint.includes(':id')
      ? this.statusEndpoint.replace(':id', encodeURIComponent(id))
      : `${this.statusEndpoint}${this.statusEndpoint.includes('?') ? '&' : '?'}receipt_id=${encodeURIComponent(id)}`
    const response = await httpRequest({
      fetchImpl: this.fetch, url: endpoint, method: 'GET', headers: this.headers, timeoutMs: this.timeoutMs,
    })
    return mapWebhookReceipt(response, { defaultStatus: 'accepted', reconciled: true, fallbackId: id })
  }

  async reconcile(context) {
    const actual = await this.getStatus(context)
    if (!actual) return null
    const differences = []
    if (actual.title != null && actual.title !== context.document.title) differences.push({ field: 'title', expected: context.document.title, actual: actual.title })
    return { ...actual, matches: differences.length === 0, differences }
  }

  send(url, body, context) {
    const raw = JSON.stringify(body)
    const headers = {
      ...this.headers,
      'Content-Type': 'application/json',
      'Idempotency-Key': context.idempotencyKey,
    }
    if (this.secret) headers['X-Content-Signature'] = `sha256=${createHmac('sha256', this.secret).update(raw).digest('hex')}`
    return httpRequest({ fetchImpl: this.fetch, url, method: 'POST', headers, body: raw, timeoutMs: this.timeoutMs })
  }
}

function envelope(event, context) {
  return {
    schemaVersion: 1,
    event,
    idempotencyKey: context.idempotencyKey,
    occurredAt: context.receipt?.createdAt ?? new Date().toISOString(),
    content: {
      id: context.document.id,
      revision: context.document.revision,
      title: context.document.title,
      metadata: context.document.metadata,
      markdown: context.document.markdown,
      html: context.document.html,
      plainText: context.document.plainText,
      assets: context.document.assets,
    },
  }
}

function mapWebhookReceipt(response, { defaultStatus, reconciled = false, fallbackId } = {}) {
  const data = response.data ?? {}
  const providerStatus = String(data.status ?? data.state ?? responseHeader(response.headers, 'x-receipt-status') ?? 'accepted').toLowerCase()
  const remoteId = data.id ?? data.remote_id ?? data.article_id ?? data.post_id ?? fallbackId
  const receiptId = data.receipt_id ?? data.request_id ?? responseHeader(response.headers, 'x-receipt-id') ?? fallbackId
  if (['failed', 'failure', 'rejected', 'error', 'cancelled', 'canceled'].includes(providerStatus)) {
    throw new DistributionError(`Webhook receiver reported ${providerStatus}`, {
      code: 'WEBHOOK_REMOTE_FAILED', category: 'permanent', sideEffect: 'none', details: { providerStatus, receiptId, remoteId },
    })
  }
  return {
    remoteId: remoteId == null ? undefined : String(remoteId),
    receiptId: receiptId == null ? undefined : String(receiptId),
    status: providerStatus === 'published' ? 'published' : ['draft', 'created'].includes(providerStatus) ? 'draft' : defaultStatus,
    providerStatus,
    url: data.url ?? data.link,
    title: data.title,
    httpStatus: response.status,
    reconciled,
  }
}

export function createWebhookAdapter(options) {
  return new WebhookAdapter(options)
}
