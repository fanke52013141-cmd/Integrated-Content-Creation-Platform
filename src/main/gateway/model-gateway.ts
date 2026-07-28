import type { AppDatabase } from '../database.js'
import type { KeyStore } from '../security/key-store.js'
import { extractTaggedBlock } from './extract-block.js'
import {
  GatewayError,
  type GatewayErrorKind,
  type UnifiedRequest,
  type UnifiedResponse
} from './types.js'

interface OpenAiResponse {
  model?: string
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
  error?: {
    message?: string
  }
}

export class ModelGateway {
  constructor(
    private readonly database: AppDatabase,
    private readonly keyStore: KeyStore
  ) {}

  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const provider = this.database.getProvider(request.providerId)
    if (!provider || !provider.enabled) {
      throw new GatewayError('ProviderConfigError', '供应商不存在或已停用')
    }
    if (!provider.capabilities.chat) {
      throw new GatewayError('ProviderConfigError', '该供应商未启用文本对话能力')
    }

    const selectedModel = request.model?.trim()
      ? provider.models.find((model) => model.enabled && model.modelId === request.model?.trim())
      : provider.models.find((model) => model.enabled && model.isDefault)
    if (!selectedModel) {
      throw new GatewayError(
        'ProviderConfigError',
        request.model ? '所选模型不存在或已停用' : '该供应商没有可用的默认模型'
      )
    }
    const model = selectedModel.modelId
    const apiKey = this.keyStore.read(provider.id)
    const endpoint = buildChatEndpoint(provider.baseUrl)
    const jsonModeSimulated = Boolean(request.jsonMode && !provider.capabilities.jsonMode)
    const startedAt = performance.now()

    try {
      const result = await this.requestWithRetry(endpoint, apiKey, {
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.4,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        ...(request.jsonMode && !jsonModeSimulated
          ? { response_format: { type: 'json_object' } }
          : {})
      })

      const latencyMs = Math.round(performance.now() - startedAt)
      const content = result.choices?.[0]?.message?.content?.trim()
      if (!content) throw new GatewayError('ParseError', '模型返回了空内容')

      const extraction = request.extractBlock
        ? extractTaggedBlock(content, request.extractBlock)
        : { matched: false, value: undefined }

      this.database.recordModelCall({
        providerId: provider.id,
        model: result.model ?? model,
        latencyMs,
        promptTokens: result.usage?.prompt_tokens,
        completionTokens: result.usage?.completion_tokens,
        success: true
      })

      return {
        providerId: provider.id,
        model: result.model ?? model,
        content,
        extracted: extraction.value,
        extractionMatched: extraction.matched,
        finishReason: result.choices?.[0]?.finish_reason,
        promptTokens: result.usage?.prompt_tokens,
        completionTokens: result.usage?.completion_tokens,
        latencyMs,
        jsonModeSimulated
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt)
      const normalized = normalizeError(error)
      this.database.recordModelCall({
        providerId: provider.id,
        model,
        latencyMs,
        success: false,
        errorKind: normalized.kind
      })
      throw normalized
    }
  }

  private async requestWithRetry(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>
  ): Promise<OpenAiResponse> {
    let lastError: GatewayError | undefined

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000)

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })

        const payload = await readJson(response)
        if (!response.ok) {
          throw fromHttpError(response.status, payload.error?.message)
        }
        return payload
      } catch (error) {
        lastError = normalizeError(error)
        if (!shouldRetry(lastError) || attempt === 3) throw lastError
        await wait(attempt === 1 ? 500 : 1_500)
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError ?? new GatewayError('NetworkError', '模型请求失败')
  }
}

function buildChatEndpoint(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new GatewayError('ProviderConfigError', 'Base URL 格式不正确')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new GatewayError('ProviderConfigError', 'Base URL 只允许 HTTP 或 HTTPS')
  }
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

async function readJson(response: Response): Promise<OpenAiResponse> {
  const text = await response.text()
  try {
    return JSON.parse(text) as OpenAiResponse
  } catch {
    throw new GatewayError(
      'ParseError',
      response.ok ? '供应商返回了无法解析的响应' : `供应商请求失败（HTTP ${response.status}）`,
      response.status
    )
  }
}

function fromHttpError(status: number, message?: string): GatewayError {
  const safeMessage = message?.slice(0, 300)
  if (status === 401 || status === 403) {
    return new GatewayError('AuthError', safeMessage || 'API Key 无效或无权访问该模型', status)
  }
  if (status === 429) {
    return new GatewayError('RateLimitError', safeMessage || '供应商请求过于频繁', status)
  }
  if (status >= 500) {
    return new GatewayError('NetworkError', safeMessage || '供应商服务暂时不可用', status)
  }
  return new GatewayError('ProviderError', safeMessage || `供应商返回 HTTP ${status}`, status)
}

function normalizeError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new GatewayError('TimeoutError', '模型请求超过 60 秒')
  }
  const message = error instanceof Error ? error.message : '未知网络错误'
  return new GatewayError('NetworkError', message)
}

function shouldRetry(error: GatewayError): boolean {
  const retryable: GatewayErrorKind[] = ['RateLimitError', 'TimeoutError', 'NetworkError']
  return retryable.includes(error.kind)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
