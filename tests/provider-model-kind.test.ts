import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../src/main/database.js'
import { availableImageModels, availableModels, resolveStageStorageKey, stageModelStorageKey } from '../src/shared/model-options.js'
import type { ProviderSummary, SaveProviderInput } from '../src/shared/contracts.js'

const tempRoot = mkdtempSync(join(tmpdir(), 'moliu-kind-test-'))
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

function mixedProviderInput(): SaveProviderInput {
  return {
    id: 'relay-1',
    displayName: '双能力中转',
    protocol: 'openai-compatible',
    baseUrl: 'https://relay.example.com/v1',
    defaultModel: 'glm-5.3',
    enabled: true,
    isRelay: true,
    // 故意给出与模型类型矛盾的 capability：保存时应被模型类型派生覆盖
    capabilities: { chat: false, jsonMode: true, streaming: false, vision: false, image: false },
    models: [
      { modelId: 'glm-5.3', displayName: 'GLM 5.3', kind: 'text', reasoningVariants: [], isDefault: true, enabled: true },
      { modelId: 'deepseek-chat', displayName: 'DeepSeek', kind: 'text', reasoningVariants: [], isDefault: false, enabled: true },
      { modelId: 'gpt-image-2', displayName: '生图 2', kind: 'image', reasoningVariants: [], isDefault: true, enabled: true, pricePerImage: 0.04 }
    ],
    apiKey: 'sk-test'
  }
}

describe('供应商模型类型化（同一供应商可同时挂文本与生图模型）', () => {
  it('保存后两类模型各有一个默认，类型完整往返，chat/image 能力由模型类型派生', () => {
    const database = new AppDatabase(':memory:')
    const saved = database.saveProvider(mixedProviderInput(), Buffer.from('encrypted'))

    expect(saved.capabilities.chat).toBe(true)
    expect(saved.capabilities.image).toBe(true)
    expect(saved.defaultModel).toBe('glm-5.3')
    const textModels = saved.models.filter((model) => model.kind === 'text')
    const imageModels = saved.models.filter((model) => model.kind === 'image')
    expect(textModels).toHaveLength(2)
    expect(imageModels).toHaveLength(1)
    expect(textModels.filter((model) => model.isDefault)).toHaveLength(1)
    expect(imageModels.filter((model) => model.isDefault)).toHaveLength(1)

    // 同类型出现两个默认时，保存归一化只保留第一个，不会撞「每类一个默认」的唯一索引
    const collapsed = database.saveProvider({
      ...mixedProviderInput(),
      models: [
        { modelId: 'glm-5.3', displayName: 'GLM 5.3', kind: 'text', reasoningVariants: [], isDefault: true, enabled: true },
        { modelId: 'gpt-image-2', displayName: '生图 2', kind: 'image', reasoningVariants: [], isDefault: true, enabled: true },
        { modelId: 'gpt-image-2.5', displayName: '生图 2.5', kind: 'image', reasoningVariants: [], isDefault: true, enabled: true }
      ]
    })
    expect(collapsed.models.filter((model) => model.kind === 'image' && model.isDefault).map((model) => model.modelId))
      .toEqual(['gpt-image-2'])
    database.close()
  })

  it('某类模型缺少默认时自动提升第一个启用模型，不影响另一类的默认', () => {
    const database = new AppDatabase(':memory:')
    const saved = database.saveProvider({
      ...mixedProviderInput(),
      models: [
        { modelId: 'glm-5.3', displayName: 'GLM 5.3', kind: 'text', reasoningVariants: [], isDefault: true, enabled: true },
        { modelId: 'gpt-image-2', displayName: '生图 2', kind: 'image', reasoningVariants: [], isDefault: false, enabled: true },
        { modelId: 'gpt-image-2.5', displayName: '生图 2.5', kind: 'image', reasoningVariants: [], isDefault: false, enabled: true }
      ]
    })
    const imageDefaults = saved.models.filter((model) => model.kind === 'image' && model.isDefault)
    expect(imageDefaults).toHaveLength(1)
    expect(imageDefaults[0].modelId).toBe('gpt-image-2')
    expect(saved.models.find((model) => model.kind === 'text' && model.isDefault)?.modelId).toBe('glm-5.3')
    database.close()
  })

  it('纯生图供应商（无文本模型）合法保存，defaultModel 记生图默认', () => {
    const database = new AppDatabase(':memory:')
    const saved = database.saveProvider({
      id: 'img-only',
      displayName: '纯生图',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'gpt-image-2',
      enabled: true,
      isRelay: false,
      capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: true },
      models: [{ modelId: 'gpt-image-2', displayName: '生图 2', kind: 'image', reasoningVariants: [], isDefault: true, enabled: true }]
    })
    expect(saved.capabilities.chat).toBe(false)
    expect(saved.capabilities.image).toBe(true)
    expect(saved.defaultModel).toBe('gpt-image-2')
    database.close()
  })

  it('旧库迁移：按能力与成本回填类型，并给缺默认的类型补默认', () => {
    const caseDir = join(tempRoot, 'legacy-' + Date.now())
    mkdirSync(caseDir, { recursive: true })
    const dbPath = join(caseDir, 'app.db')
    const database = new AppDatabase(dbPath)
    // 纯生图供应商：旧数据里模型没有类型概念
    database.saveProvider({
      id: 'img-only',
      displayName: '纯生图',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'gpt-image-2',
      enabled: true,
      isRelay: false,
      capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: true },
      models: [{ modelId: 'gpt-image-2', displayName: '生图 2', kind: 'image', reasoningVariants: [], isDefault: true, enabled: true }]
    })
    // 双能力中转：文本默认 + 一个填过单张成本的生图模型
    database.saveProvider(mixedProviderInput(), Buffer.from('encrypted'))
    database.close()

    // 模拟迁移前的旧库状态：模型类型全部退回 text、每供应商只保留一个默认、旧版单默认索引
    const raw = new DatabaseSync(dbPath)
    raw.exec('DROP INDEX idx_provider_models_one_default')
    raw.exec("UPDATE provider_models SET is_default = 0 WHERE provider_id = 'relay-1' AND model_id = 'gpt-image-2'")
    raw.exec("UPDATE provider_models SET kind = 'text'")
    raw.exec('CREATE UNIQUE INDEX idx_provider_models_one_default ON provider_models(provider_id) WHERE is_default = 1')
    raw.close()

    const reopened = new AppDatabase(dbPath)
    const imgOnly = reopened.getProvider('img-only')!
    expect(imgOnly.models.map((model) => model.kind)).toEqual(['image'])
    expect(imgOnly.models[0].isDefault).toBe(true)

    const relay = reopened.getProvider('relay-1')!
    const imageModel = relay.models.find((model) => model.modelId === 'gpt-image-2')!
    expect(imageModel.kind).toBe('image')
    // 迁移给缺默认的生图类型补了默认，且文本默认未被破坏
    expect(imageModel.isDefault).toBe(true)
    expect(relay.models.find((model) => model.modelId === 'glm-5.3')!.isDefault).toBe(true)
    reopened.close()
  })
})

describe('每环节独立的模型记忆键', () => {
  it('带环节标识时自动切到该环节的独立键；显式指定的键不受影响', () => {
    expect(stageModelStorageKey('topic.generate')).toBe('moliu:stage-model:topic.generate')
    // 调用方用默认键（未显式指定）+ 环节标识 → 独立键
    expect(resolveStageStorageKey('moliu:default-model', 'article.generate')).toBe('moliu:stage-model:article.generate')
    // 显式指定（改稿、配图提示词等专用键）保持原样
    expect(resolveStageStorageKey('moliu:revision-model', 'article.revise')).toBe('moliu:revision-model')
    // 无环节标识保持原样
    expect(resolveStageStorageKey('moliu:default-model')).toBe('moliu:default-model')
  })
})

describe('渲染层模型下拉按类型分流', () => {
  const provider = (overrides: Partial<ProviderSummary>): ProviderSummary => ({
    id: 'p1',
    displayName: '供应商',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    defaultModel: 'text-a',
    enabled: true,
    isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: true },
    hasApiKey: true,
    verification: { configured: true, verified: true, stale: false },
    createdAt: '',
    updatedAt: '',
    models: [
      { id: 'm1', providerId: 'p1', modelId: 'text-a', displayName: '文本A', kind: 'text', reasoningVariants: [], isDefault: true, enabled: true, createdAt: '', updatedAt: '' },
      { id: 'm2', providerId: 'p1', modelId: 'img-b', displayName: '生图B', kind: 'image', reasoningVariants: [], isDefault: true, enabled: true, createdAt: '', updatedAt: '' },
      // 旧数据兼容：缺省 kind 视为文本
      { id: 'm3', providerId: 'p1', modelId: 'text-legacy', displayName: '旧文本', reasoningVariants: [], isDefault: false, enabled: true, createdAt: '', updatedAt: '' }
    ],
    ...overrides
  })

  it('文本下拉只出现文本模型（含缺省 kind 的旧模型），生图模型不混入', () => {
    const models = availableModels([provider({})])
    expect(models.map(({ model }) => model.modelId).sort()).toEqual(['text-a', 'text-legacy'])
  })

  it('生图下拉只出现生图模型，文本模型不混入', () => {
    const models = availableImageModels([provider({})])
    expect(models.map(({ model }) => model.modelId)).toEqual(['img-b'])
  })
})
