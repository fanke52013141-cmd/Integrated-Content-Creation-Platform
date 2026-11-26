import { DistributionError } from './errors.mjs'

function freeze(value) {
  for (const item of Object.values(value)) Object.freeze(item)
  return Object.freeze(value)
}

export const CHANNEL_CAPABILITIES = freeze({
  wechat: {
    label: '微信公众号', integration: 'live-adapter', draft: true, publish: false,
    readback: true, reconcile: true, idempotency: true,
    note: '仅草稿；复用 wechat-publisher，不提供发布或群发。',
  },
  wordpress: {
    label: 'WordPress REST', integration: 'live-adapter', draft: true, publish: true,
    readback: true, reconcile: true, idempotency: true,
    note: '确定性 slug 用于建稿对账；发布必须先建稿并显式允许。',
  },
  webhook: {
    label: '通用 Webhook', integration: 'live-adapter', draft: true, publish: 'configurable',
    readback: 'configurable', reconcile: 'configurable', idempotency: 'configurable',
    note: '2xx 只表示接收方响应；无明确回执时状态为 accepted，不能推断已发布。',
  },
  zhihu: { label: '知乎', integration: 'mock-only', draft: true, publish: false, readback: true, reconcile: true, idempotency: true, realDraft: false, realPublish: false, note: '仅可替换 mock 契约；未接入真实发布。' },
  juejin: { label: '掘金', integration: 'mock-only', draft: true, publish: false, readback: true, reconcile: true, idempotency: true, realDraft: false, realPublish: false, note: '仅可替换 mock 契约；未接入真实发布。' },
  csdn: { label: 'CSDN', integration: 'mock-only', draft: true, publish: false, readback: true, reconcile: true, idempotency: true, realDraft: false, realPublish: false, note: '仅可替换 mock 契约；未接入真实发布。' },
  toutiao: { label: '头条', integration: 'mock-only', draft: true, publish: false, readback: true, reconcile: true, idempotency: true, realDraft: false, realPublish: false, note: '仅可替换 mock 契约；未接入真实发布。' },
})

export const MOCK_ONLY_CHANNELS = Object.freeze(['zhihu', 'juejin', 'csdn', 'toutiao'])

export function getChannelCapabilities(channel, { adapter, mode = adapter?.mode ?? 'live' } = {}) {
  const descriptor = CHANNEL_CAPABILITIES[channel]
  if (!descriptor) throw new DistributionError(`Unknown channel: ${channel}`, { code: 'CHANNEL_UNKNOWN', category: 'validation' })
  const adapterCapabilities = typeof adapter?.capabilities === 'function' ? adapter.capabilities() : {}
  return {
    channel,
    ...descriptor,
    ...adapterCapabilities,
    integration: descriptor.integration,
    mode,
    simulated: mode === 'mock',
    realDraft: descriptor.realDraft ?? (mode === 'live' && descriptor.draft === true),
    realPublish: descriptor.realPublish ?? (mode === 'live' && (adapterCapabilities.publish ?? descriptor.publish) === true),
  }
}

export function assertChannelCapability(channel, operation, { adapter, mode = adapter?.mode ?? 'live' } = {}) {
  const capabilities = getChannelCapabilities(channel, { adapter, mode })
  if (capabilities.integration === 'mock-only' && mode !== 'mock') {
    throw new DistributionError(`${channel} has no verified live adapter; inject the contract mock explicitly`, {
      code: 'CHANNEL_REAL_ADAPTER_UNAVAILABLE', category: 'validation', sideEffect: 'none',
    })
  }
  if (operation === 'publish' && mode === 'mock') {
    throw new DistributionError(`${channel} mock cannot publish or simulate a real publication`, {
      code: 'CHANNEL_CAPABILITY_UNSUPPORTED', category: 'validation', sideEffect: 'none', details: { channel, operation, mode },
    })
  }
  if (capabilities[operation] !== true) {
    throw new DistributionError(`${channel} does not declare ${operation} capability in ${mode} mode`, {
      code: 'CHANNEL_CAPABILITY_UNSUPPORTED', category: 'validation', sideEffect: 'none', details: { channel, operation, mode, capabilities },
    })
  }
  return capabilities
}

export function assertAdapterContract(adapter) {
  if (!adapter || typeof adapter.channel !== 'string' || typeof adapter.createDraft !== 'function') {
    throw new TypeError('Adapter must declare channel and createDraft(context)')
  }
  if (!['live', 'mock'].includes(adapter.mode)) throw new TypeError('Adapter mode must be explicit: live or mock')
  const channel = CHANNEL_CAPABILITIES[adapter.channel]
  if (!channel) throw new DistributionError(`Unknown channel: ${adapter.channel}`, { code: 'CHANNEL_UNKNOWN' })
  if (channel.integration === 'mock-only' && adapter.mode !== 'mock') {
    throw new DistributionError(`${adapter.channel} only ships a mock contract; a real adapter must be explicitly reviewed and registered`, { code: 'CHANNEL_REAL_ADAPTER_UNAVAILABLE' })
  }
  if (adapter.mode === 'mock' && typeof adapter.publish === 'function') {
    throw new TypeError('Mock adapters must not expose publish(); simulated publication is forbidden')
  }
  return adapter
}
