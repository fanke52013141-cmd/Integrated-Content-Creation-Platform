export { DistributionService } from './service.mjs'
export { MemoryReceiptStore } from './store.mjs'
export {
  CHANNEL_CAPABILITIES,
  MOCK_ONLY_CHANNELS,
  getChannelCapabilities,
  assertChannelCapability,
  assertAdapterContract,
} from './capabilities.mjs'
export { DistributionError, normalizeDistributionError } from './errors.mjs'
export { buildDistributionKey, canonicalJson, normalizeDocument, sanitizeReceiptValue } from './utils.mjs'
export {
  WeChatAdapter,
  WordPressRestAdapter,
  WebhookAdapter,
  ContractMockAdapter,
  createWeChatAdapter,
  createWordPressAdapter,
  createWebhookAdapter,
  createContractMockAdapter,
} from './adapters/index.mjs'

import { ContractMockAdapter } from './adapters/contract-mock.mjs'
import { MOCK_ONLY_CHANNELS } from './capabilities.mjs'

export function createChannelContractMocks() {
  return Object.fromEntries(MOCK_ONLY_CHANNELS.map(channel => [channel, new ContractMockAdapter(channel)]))
}
