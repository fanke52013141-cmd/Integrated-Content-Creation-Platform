import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../src/main/database.js'
import { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { DREAMINA_IMAGE_MODELS, dreaminaGenerateImage, resolveDreaminaCliPath } from '../src/main/gateway/dreamina-cli.js'
import { resolveSearchEndpoint } from '../src/main/services/material-search-service.js'
import type { ProviderSummary } from '../src/shared/contracts.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function searchProviderFixture(enabled = true, baseUrl = 'https://open.feedcoopapi.com'): ProviderSummary {
  return {
    id: 'search-p',
    displayName: '豆包搜索',
    protocol: 'openai-compatible',
    baseUrl,
    defaultModel: 'web-search',
    enabled,
    isRelay: false,
    capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: false },
    models: [{ id: 'm', providerId: 'search-p', modelId: 'web-search', displayName: '豆包搜索', kind: 'search', reasoningVariants: [], isDefault: true, enabled: true, createdAt: '', updatedAt: '' }],
    hasApiKey: true,
    verification: { configured: true, verified: false, stale: false },
    createdAt: '',
    updatedAt: ''
  }
}

function makeGateway(provider: ProviderSummary) {
  const database = {
    getProvider: vi.fn(() => provider),
    listProviders: vi.fn(() => [provider]),
    recordModelCall: vi.fn()
  } as unknown as AppDatabase
  const keyStore = { read: vi.fn(() => 'test-key') } as never
  return { gateway: new ModelGateway(database, keyStore), database }
}

describe('搜索类型：端点解析与保存前探测', () => {
  it('baseUrl 三种形态都解析到正确端点', () => {
    expect(resolveSearchEndpoint('https://open.feedcoopapi.com')).toBe('https://open.feedcoopapi.com/search_api/web_search')
    expect(resolveSearchEndpoint('https://open.feedcoopapi.com/')).toBe('https://open.feedcoopapi.com/search_api/web_search')
    expect(resolveSearchEndpoint('https://open.feedcoopapi.com/search_api/web_search')).toBe('https://open.feedcoopapi.com/search_api/web_search')
    expect(resolveSearchEndpoint('http://127.0.0.1:9/search')).toBe('http://127.0.0.1:9/search')
    expect(resolveSearchEndpoint('')).toBe('https://open.feedcoopapi.com/search_api/web_search')
  })

  it('testDraft search 模式：成功映射延迟，错误码映射为用户可读文案', async () => {
    const { gateway } = makeGateway(searchProviderFixture())
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ResponseMetadata: { RequestId: 'r1' }, Result: { WebResults: [{ Id: 'w1', Title: 't', Url: 'https://e.com/a' }] }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ok = await gateway.testDraft({ baseUrl: 'https://open.feedcoopapi.com', apiKey: 'k', model: 'web-search', mode: 'search' })
    expect(ok.message).toContain('搜索端点可用')
    expect(fetchMock.mock.calls[0][0]).toBe('https://open.feedcoopapi.com/search_api/web_search')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ResponseMetadata: { Error: { Code: '10406' } }
    }), { status: 200 })))
    await expect(gateway.testDraft({ baseUrl: 'https://open.feedcoopapi.com', apiKey: 'k', mode: 'search' }))
      .rejects.toThrow('免费额度已耗尽')
  })
})

describe('旧搜索配置一次性迁移到供应商', () => {
  it('配置过密钥的旧库迁移出「豆包搜索」供应商，密钥与验证结论随行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-search-migrate-'))
    try {
      const dbPath = join(dir, 'app.db')
      const db = new AppDatabase(dbPath)
      db.close()
      // 模拟旧库状态：独立 search_services 配置 + 密钥
      const raw = new DatabaseSync(dbPath)
      raw.exec(`INSERT INTO search_service_secrets(service_id, encrypted_key, updated_at) VALUES ('doubao-custom', X'6b6579', '2026-01-01T00:00:00.000Z')`)
      raw.exec("UPDATE search_services SET enabled = 1, last_test_status = 'success', last_test_at = '2026-01-02T00:00:00.000Z' WHERE id = 'doubao-custom'")
      raw.close()

      const reopened = new AppDatabase(dbPath)
      const summary = reopened.getSearchService()
      expect(summary).toMatchObject({ enabled: true, hasApiKey: true })
      const provider = reopened.getProvider('doubao-search')!
      expect(provider.models[0]).toMatchObject({ modelId: 'web-search', kind: 'search', isDefault: true, enabled: true })
      expect(provider.verification.lastTestStatus).toBe('success')
      reopened.close()

      // 重复打开不再重复迁移（幂等）
      const again = new AppDatabase(dbPath)
      expect(again.listProviders().filter((item) => item.id === 'doubao-search')).toHaveLength(1)
      again.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('即梦 CLI：白名单与路径解析', () => {
  it('只开放图片 5.0 / 5.0Pro，视频型号（seedance / VIDU）直接拒绝', async () => {
    expect([...DREAMINA_IMAGE_MODELS].sort()).toEqual(['5.0', '5.0Pro'])
    for (const model of ['seedance2.5', 'vidu-1', '3.0', '4.0']) {
      await expect(dreaminaGenerateImage({ model, prompt: 'p' })).rejects.toMatchObject({
        kind: 'ProviderConfigError',
        message: expect.stringContaining('仅开放图片模型')
      })
    }
  })

  it('MOLIU_DREAMINA_PATH 环境变量优先于默认路径（原样使用用户指定值）', () => {
    vi.stubEnv('MOLIU_DREAMINA_PATH', 'C:/tools/dreamina.exe')
    expect(resolveDreaminaCliPath()).toBe('C:/tools/dreamina.exe')
  })

  it('默认安装位置存在时被识别（~/bin/dreamina.exe）', () => {
    vi.stubEnv('MOLIU_DREAMINA_PATH', '')
    const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
    const binDir = join(home, 'bin')
    const exe = join(binDir, process.platform === 'win32' ? 'dreamina.exe' : 'dreamina')
    const created = !existsSync(exe)
    if (created) {
      mkdirSync(binDir, { recursive: true })
      writeFileSync(exe, '')
    }
    try {
      expect(resolveDreaminaCliPath()).toBe(exe)
    } finally {
      if (created) rmSync(exe, { force: true })
    }
  })

  it('未安装 CLI 时 testDraft cli 模式给出安装指引', async () => {
    vi.stubEnv('MOLIU_DREAMINA_PATH', join(tmpdir(), 'definitely-missing-dreamina.exe'))
    const { gateway } = makeGateway({
      ...searchProviderFixture(),
      id: 'dreamina-p',
      accessMode: 'dreamina-cli',
      baseUrl: '',
      defaultModel: '5.0'
    })
    await expect(gateway.testDraft({ baseUrl: '', model: '5.0', mode: 'cli' }))
      .rejects.toMatchObject({ kind: 'ProviderConfigError', message: expect.stringContaining('未检测到即梦 CLI') })
  })
})
