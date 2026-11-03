import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'

function saveSearchProvider(database: AppDatabase, encryptedKey?: Buffer): void {
  database.saveProvider({
    id: 'search-provider',
    displayName: '豆包搜索',
    protocol: 'openai-compatible',
    baseUrl: 'https://open.feedcoopapi.com',
    defaultModel: 'web-search',
    enabled: true,
    isRelay: false,
    capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: false },
    models: [{ modelId: 'web-search', displayName: '豆包搜索', kind: 'search', reasoningVariants: [], isDefault: true, enabled: true }]
  }, encryptedKey)
}

describe('搜索服务状态（由「搜索」类型供应商派生）', () => {
  it('未配置时为未启用摘要；配置后随供应商验证状态变化，换密钥后旧结论失效', () => {
    const database = new AppDatabase(':memory:')
    expect(database.getSearchService()).toMatchObject({ enabled: false, hasApiKey: false, lastTestStatus: undefined })

    saveSearchProvider(database, Buffer.from('encrypted-key'))
    expect(database.getSearchService()).toMatchObject({ displayName: '豆包搜索', enabled: true, hasApiKey: true })

    database.recordProviderTest('search-provider', 'success')
    expect(database.getSearchService()).toMatchObject({ lastTestStatus: 'success', lastTestAt: expect.any(String) })

    database.recordProviderTest('search-provider', 'failure', '豆包搜索套餐额度不足')
    expect(database.getSearchService()).toMatchObject({ lastTestStatus: 'failure', lastTestError: '豆包搜索套餐额度不足' })

    // 换密钥等于换配置：供应商 verification 判定 stale，摘要不再宣称已验证
    saveSearchProvider(database, Buffer.from('encrypted-key-2'))
    expect(database.getProvider('search-provider')?.verification.stale).toBe(true)
    database.close()
  })

  it('禁用搜索供应商后摘要回到未启用', () => {
    const database = new AppDatabase(':memory:')
    database.saveProvider({
      id: 'search-provider',
      displayName: '豆包搜索',
      protocol: 'openai-compatible',
      baseUrl: 'https://open.feedcoopapi.com',
      defaultModel: 'web-search',
      enabled: false,
      isRelay: false,
      capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: false },
      models: [{ modelId: 'web-search', displayName: '豆包搜索', kind: 'search', reasoningVariants: [], isDefault: true, enabled: true }]
    }, Buffer.from('encrypted-key'))
    expect(database.getSearchService()).toMatchObject({ enabled: false, hasApiKey: true })
    database.close()
  })
})
