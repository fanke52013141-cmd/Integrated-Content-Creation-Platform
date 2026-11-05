import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { FrameworkGenerator } from '../src/main/services/framework-generator.js'
import type { MaterialSearchService } from '../src/main/services/material-search-service.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'

/**
 * C1 深度预研集成测试：真实装配 FrameworkGenerator + MaterialSearchService 桩，
 * 验证预研资料注入与全部降级路径（未配置/搜索失败/显式关闭）。
 */

const PROVIDER_ID = 'p1'
const MODEL_ID = 'mock-model'
const FRAMEWORK_XML = '<框架><标题>标题</标题><开头>开头</开头><结尾>结尾</结尾></框架>'

function ensureProvider(database: AppDatabase): void {
  database.saveProvider({
    id: PROVIDER_ID, displayName: '预研测试供应商', protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1', defaultModel: MODEL_ID, enabled: true, isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: MODEL_ID, displayName: MODEL_ID, reasoningVariants: [], isDefault: true, enabled: true }]
  })
}

function makeGateway(captured: UnifiedRequest[], content: string): ModelGateway {
  return {
    chat: vi.fn(async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      captured.push(request)
      return {
        providerId: request.providerId, model: request.model ?? MODEL_ID, content,
        extracted: undefined, extractionMatched: false, finishReason: 'stop',
        promptTokens: 5, completionTokens: 5, latencyMs: 1, jsonModeSimulated: false
      }
    })
  } as unknown as ModelGateway
}

function makeSearchService(overrides: { results?: Array<{ id: string; title: string; summary: string }>; error?: Error } = {}): MaterialSearchService {
  return {
    search: vi.fn(async () => {
      if (overrides.error) throw overrides.error
      return {
        query: '选题', type: 'web' as const,
        results: (overrides.results ?? [{ id: '1', title: '资料一', summary: '关键事实摘要', snippet: '', sourceUrl: 'https://a.example/1', sourceName: '示例网' }]),
        latencyMs: 5
      }
    })
  } as unknown as MaterialSearchService
}

async function setup(materialSearch?: MaterialSearchService) {
  const database = new AppDatabase(':memory:')
  ensureProvider(database)
  const template = database.saveFrameworkTemplate({ name: '最小模板', sections: ['标题', '开头', '结尾'], isDefault: true })
  const captured: UnifiedRequest[] = []
  const generator = new FrameworkGenerator(database, makeGateway(captured, FRAMEWORK_XML), makePromptRegistryStub(), materialSearch)
  return { generator, captured, templateId: template.id }
}

describe('框架生成深度预研', () => {
  const baseInput = { manualTopic: '本地写作工具评测', materialIds: [] as string[], providerId: PROVIDER_ID, model: MODEL_ID, count: 1 }

  it('配置了搜索模型：预研资料注入框架生成的用户消息', async () => {
    const search = makeSearchService()
    const { generator, captured, templateId } = await setup(search)
    const result = await generator.generate({ ...baseInput, templateId, research: true })
    expect(result.failed).toEqual([])
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ type: 'web', count: 8 }))
    const userContent = String(captured[0]!.messages[1]!.content)
    expect(userContent).toContain('<预研资料>')
    expect(userContent).toContain('资料一')
    expect(userContent).toContain('仅用于开阔角度')
  })

  it('未配置搜索模型：静默跳过，框架生成不受影响', async () => {
    const { generator, captured, templateId } = await setup(undefined)
    const result = await generator.generate({ ...baseInput, templateId, research: true })
    expect(result.frameworks).toHaveLength(1)
    expect(String(captured[0]!.messages[1]!.content)).not.toContain('<预研资料>')
  })

  it('搜索失败：静默跳过，绝不阻塞框架生成', async () => {
    const search = makeSearchService({ error: new Error('网络中断') })
    const { generator, captured, templateId } = await setup(search)
    const result = await generator.generate({ ...baseInput, templateId, research: true })
    expect(result.frameworks).toHaveLength(1)
    expect(String(captured[0]!.messages[1]!.content)).not.toContain('<预研资料>')
  })

  it('显式关闭（research=false）：不调用搜索', async () => {
    const search = makeSearchService()
    const { generator, templateId } = await setup(search)
    await generator.generate({ ...baseInput, templateId, research: false })
    expect(search.search).not.toHaveBeenCalled()
  })
})
