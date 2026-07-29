import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelGateway } from '../src/main/gateway/model-gateway.js'
import { GatewayError } from '../src/main/gateway/types.js'
import type { AppDatabase } from '../src/main/database.js'
import type { KeyStore } from '../src/main/security/key-store.js'
import type { ProviderSummary } from '../src/shared/contracts.js'

// 构造一个启用了 chat 能力的供应商，默认模型 moliu-test-model。
function makeProvider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: 'provider-1',
    displayName: '本地测试供应商',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    defaultModel: 'moliu-test-model',
    enabled: true,
    isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [
      {
        id: 'model-1', providerId: 'provider-1', modelId: 'moliu-test-model',
        displayName: 'Test Model', reasoningVariants: [], isDefault: true, enabled: true,
        createdAt: '', updatedAt: ''
      }
    ],
    hasApiKey: true,
    createdAt: '', updatedAt: '',
    ...overrides
  }
}

function makeGateway(provider: ProviderSummary) {
  const database = {
    getProvider: vi.fn(() => provider),
    recordModelCall: vi.fn()
  } as unknown as AppDatabase
  const keyStore = { read: vi.fn(() => 'test-api-key') } as unknown as KeyStore
  return { gateway: new ModelGateway(database, keyStore), database, keyStore }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function okResponse(content: string, model = 'moliu-test-model'): Response {
  return jsonResponse({
    model,
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 34 }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ModelGateway.chat - 正常路径 (GW-01/GW-04)', () => {
  it('OpenAI-compatible 协议返回 content / usage / finish_reason', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('hello world')))

    const result = await gateway.chat({
      providerId: 'provider-1',
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect(result.content).toBe('hello world')
    expect(result.model).toBe('moliu-test-model')
    expect(result.finishReason).toBe('stop')
    expect(result.promptTokens).toBe(12)
    expect(result.completionTokens).toBe(34)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.jsonModeSimulated).toBe(false)
    expect(result.extractionMatched).toBe(false)
  })

  it('中转站自定义 base_url（isRelay）走同一路径', async () => {
    const provider = makeProvider({
      id: 'relay-1', isRelay: true,
      baseUrl: 'http://relay.example/v1'
    })
    const { gateway } = makeGateway(provider)
    const fetchMock = vi.fn(async () => okResponse('relay-ok', 'relay-model'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await gateway.chat({
      providerId: 'relay-1', messages: [{ role: 'user', content: 'hi' }]
    })

    expect(result.content).toBe('relay-ok')
    // 端点必须拼接 /chat/completions
    const calledUrl = String((fetchMock.mock.calls as unknown[][])[0][0])
    expect(calledUrl).toBe('http://relay.example/v1/chat/completions')
  })
})

describe('ModelGateway.chat - extractBlock 集成 (GW-05/GW-06)', () => {
  it('截取指定标签的最后一个块', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(
      '前缀噪音<账号定位>第一版</账号定位>正文<账号定位>第二版</账号定位>后缀'
    )))

    const result = await gateway.chat({
      providerId: 'provider-1',
      messages: [{ role: 'user', content: 'hi' }],
      extractBlock: { tag: '账号定位' }
    })

    expect(result.extractionMatched).toBe(true)
    expect(result.extracted).toBe('第二版')
    // 原文 content 仍保留完整响应
    expect(result.content).toContain('前缀噪音')
  })

  it('未匹配标签时 matched=false 且 extracted=undefined，兜底用原文不崩', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('模型没按格式返回，纯文本')))

    const result = await gateway.chat({
      providerId: 'provider-1',
      messages: [{ role: 'user', content: 'hi' }],
      extractBlock: { tag: '账号定位' }
    })

    expect(result.extractionMatched).toBe(false)
    expect(result.extracted).toBeUndefined()
    expect(result.content).toBe('模型没按格式返回，纯文本')
  })
})

describe('ModelGateway.chat - 能力协商拦截 (GW-07)', () => {
  it('供应商 chat 能力关闭时直接抛 ProviderConfigError', async () => {
    const provider = makeProvider({ capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: false } })
    const { gateway, database } = makeGateway(provider)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ProviderConfigError' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect((database.recordModelCall as any).mock.calls).toHaveLength(0)
  })

  it('供应商不存在时抛 ProviderConfigError', async () => {
    const provider = makeProvider()
    const { gateway, database } = makeGateway(provider)
    ;(database.getProvider as any).mockReturnValueOnce(null)
    vi.stubGlobal('fetch', vi.fn())

    await expect(gateway.chat({
      providerId: 'missing', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ProviderConfigError' })
  })

  it('指定模型不存在或已停用时抛 ProviderConfigError', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn())

    await expect(gateway.chat({
      providerId: 'provider-1', model: 'unknown-model',
      messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ProviderConfigError' })
  })
})

describe('ModelGateway.chat - json_mode 回退 (GW-08)', () => {
  it('provider 不支持 jsonMode 时模拟实现：body 不含 response_format 且响应标注 jsonModeSimulated', async () => {
    const provider = makeProvider({ capabilities: { chat: true, jsonMode: false, streaming: false, vision: false, image: false } })
    const { gateway } = makeGateway(provider)
    let capturedBody: any
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string)
      return okResponse('{"title":"测试"}')
    }))

    const result = await gateway.chat({
      providerId: 'provider-1',
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: true
    })

    expect(result.jsonModeSimulated).toBe(true)
    expect(capturedBody.response_format).toBeUndefined()
  })

  it('provider 支持 jsonMode 时原生实现：body 含 response_format 且无模拟标志', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    let capturedBody: any
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string)
      return okResponse('{"title":"测试"}')
    }))

    const result = await gateway.chat({
      providerId: 'provider-1',
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: true
    })

    expect(result.jsonModeSimulated).toBe(false)
    expect(capturedBody.response_format).toEqual({ type: 'json_object' })
  })
})

describe('ModelGateway.chat - 重试策略 (GW-09/GW-10)', () => {
  it('5xx 错误重试至多 3 次，最终成功', async () => {
    const provider = makeProvider()
    const { gateway, database } = makeGateway(provider)
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts += 1
      if (attempts < 3) return jsonResponse({ error: { message: '内部错误' } }, 500)
      return okResponse('第三次成功')
    }))
    vi.useFakeTimers()
    // 重试间隔 500ms / 1500ms，需要推进 fake timers
    const chatPromise = gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })
    await vi.advanceTimersByTimeAsync(2_000)
    const result = await chatPromise

    expect(attempts).toBe(3)
    expect(result.content).toBe('第三次成功')
    // 失败两次、成功一次都应记录
    const calls = (database.recordModelCall as any).mock.calls
    expect(calls.filter((c: any[]) => c[0].success === false)).toHaveLength(0) // 失败中间态不记录，仅最终态
    expect(calls.filter((c: any[]) => c[0].success === true)).toHaveLength(1)
  })

  it('429 限流重试成功', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts += 1
      if (attempts === 1) return jsonResponse({ error: { message: '限流' } }, 429)
      return okResponse('限流后成功')
    }))
    vi.useFakeTimers()
    const chatPromise = gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await chatPromise

    expect(attempts).toBe(2)
    expect(result.content).toBe('限流后成功')
  })

  it('401 鉴权失败不重试，直接抛 AuthError', async () => {
    const provider = makeProvider()
    const { gateway, database } = makeGateway(provider)
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts += 1
      return jsonResponse({ error: { message: 'Invalid API Key' } }, 401)
    }))

    await expect(gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'AuthError', status: 401 })

    expect(attempts).toBe(1)
    // 失败应记录到 model_calls
    const calls = (database.recordModelCall as any).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatchObject({ success: false, errorKind: 'AuthError' })
  })

  it('404 错误不重试', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts += 1
      return jsonResponse({ error: { message: 'Not Found' } }, 404)
    }))

    await expect(gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ProviderError' })

    expect(attempts).toBe(1)
  })

  it('连续 3 次 5xx 后放弃，抛 NetworkError', async () => {
    const provider = makeProvider()
    const { gateway, database } = makeGateway(provider)
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts += 1
      return jsonResponse({ error: { message: '内部错误' } }, 503)
    }))
    vi.useFakeTimers()
    // 提前捕获避免 fake timer 推进期间的 unhandled rejection 噪声
    const caught = gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    const error = await caught
    expect(error).toMatchObject({ kind: 'NetworkError' })

    expect(attempts).toBe(3)
    const calls = (database.recordModelCall as any).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatchObject({ success: false, errorKind: 'NetworkError' })
  })
})

describe('ModelGateway.chat - 超时 (GW-12)', () => {
  it('AbortController 触发后归一化为 TimeoutError 并进入重试', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts += 1
      if (attempts < 3) throw Object.assign(new DOMException('aborted', 'AbortError'))
      return okResponse('第三次未超时')
    }))
    vi.useFakeTimers()
    const chatPromise = gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await chatPromise

    expect(attempts).toBe(3)
    expect(result.content).toBe('第三次未超时')
  })
})

describe('ModelGateway.chat - 用量记录 (GW-14)', () => {
  it('成功调用记录 latency / tokens / success=true', async () => {
    const provider = makeProvider()
    const { gateway, database } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('ok')))

    await gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })

    const call = (database.recordModelCall as any).mock.calls[0][0]
    expect(call).toMatchObject({
      providerId: 'provider-1',
      model: 'moliu-test-model',
      success: true,
      promptTokens: 12,
      completionTokens: 34
    })
    expect(call.latencyMs).toBeGreaterThanOrEqual(0)
    expect(call.errorKind).toBeUndefined()
  })

  it('空内容响应抛 ParseError 并记录 success=false', async () => {
    const provider = makeProvider()
    const { gateway, database } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      model: 'moliu-test-model',
      choices: [{ message: { content: '   ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 0 }
    })))

    await expect(gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ParseError' })

    const call = (database.recordModelCall as any).mock.calls[0][0]
    expect(call.success).toBe(false)
    expect(call.errorKind).toBe('ParseError')
  })

  it('非 JSON 响应抛 ParseError', async () => {
    const provider = makeProvider()
    const { gateway } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', {
      status: 200, headers: { 'content-type': 'text/plain' }
    })))

    await expect(gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ParseError' })
  })
})

describe('ModelGateway.chat - 端点构建边界', () => {
  it('Base URL 非法时抛 ProviderConfigError', async () => {
    const provider = makeProvider({ baseUrl: 'not-a-url' })
    const { gateway } = makeGateway(provider)
    vi.stubGlobal('fetch', vi.fn())

    await expect(gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toMatchObject({ kind: 'ProviderConfigError' })
  })

  it('Base URL 末尾斜杠被规范化', async () => {
    const provider = makeProvider({ baseUrl: 'http://127.0.0.1:9999/v1///' })
    const { gateway } = makeGateway(provider)
    const fetchMock = vi.fn(async () => okResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })

    const calledUrl = String((fetchMock.mock.calls as unknown[][])[0][0])
    expect(calledUrl).toBe('http://127.0.0.1:9999/v1/chat/completions')
  })

  it('Bearer Token 使用 KeyStore 返回的 Key', async () => {
    const provider = makeProvider()
    const { gateway, keyStore } = makeGateway(provider)
    ;(keyStore.read as any).mockReturnValue('decrypted-secret-key')
    let capturedAuth: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedAuth = (init!.headers as Record<string, string>)['Authorization']
      return okResponse('ok')
    }))

    await gateway.chat({
      providerId: 'provider-1', messages: [{ role: 'user', content: 'hi' }]
    })

    expect(capturedAuth).toBe('Bearer decrypted-secret-key')
  })
})
