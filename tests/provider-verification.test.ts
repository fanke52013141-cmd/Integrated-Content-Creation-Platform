import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'

const PROVIDER_ID = 'p1'
const MODEL_ID = 'mock-model'

function saveProvider(database: AppDatabase, displayName = '体验回归供应商'): void {
  database.saveProvider({
    id: PROVIDER_ID, displayName, protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1', defaultModel: MODEL_ID, enabled: true, isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: MODEL_ID, displayName: MODEL_ID, reasoningVariants: [], isDefault: true, enabled: true }]
  }, Buffer.from('encrypted-placeholder-key'))
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('F06 连通性验证状态与"配置已保存"严格区分', () => {
  it('刚保存的配置只算未验证，验证成功才算已连通，改配置后自动失效', async () => {
    const database = new AppDatabase(':memory:')
    saveProvider(database)
    expect(database.getProvider(PROVIDER_ID)!.verification)
      .toMatchObject({ configured: true, lastTestStatus: undefined, verified: false, stale: false })

    database.recordProviderTest(PROVIDER_ID, 'failure', '401 Unauthorized')
    expect(database.getProvider(PROVIDER_ID)!.verification)
      .toMatchObject({ lastTestStatus: 'failure', verified: false, lastTestError: '401 Unauthorized' })

    await sleep(5)
    database.recordProviderTest(PROVIDER_ID, 'success')
    const verified = database.getProvider(PROVIDER_ID)!.verification
    expect(verified).toMatchObject({ lastTestStatus: 'success', verified: true, stale: false })
    expect(verified.lastTestAt).toBeTruthy()
    expect(verified.lastTestError).toBeUndefined()

    // 换密钥或改模型后，旧验证结果不能再冒充"可用"
    await sleep(5)
    saveProvider(database, '体验回归供应商')
    expect(database.getProvider(PROVIDER_ID)!.verification)
      .toMatchObject({ lastTestStatus: 'success', verified: false, stale: true })
    database.close()
  })

  it('未保存密钥的配置不算已连通', () => {
    const database = new AppDatabase(':memory:')
    database.saveProvider({
      id: PROVIDER_ID, displayName: '缺密钥供应商', protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9999/v1', defaultModel: MODEL_ID, enabled: true, isRelay: false,
      capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
      models: [{ modelId: MODEL_ID, displayName: MODEL_ID, reasoningVariants: [], isDefault: true, enabled: true }]
    })
    expect(database.getProvider(PROVIDER_ID)!.verification)
      .toMatchObject({ configured: false, verified: false })
    database.close()
  })
})
