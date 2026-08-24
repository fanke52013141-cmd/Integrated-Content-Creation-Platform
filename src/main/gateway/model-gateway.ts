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
    message?: { content?: string | null; reasoning_content?: string | null }
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

/**
 * 提取助手回复文本。推理型模型（如 GLM-5.2）常把回复放在 reasoning_content、
 * 而 message.content 为 null，这里做回退以确保解析不到空内容。
 */
function extractReplyText(message?: { content?: string | null; reasoning_content?: string | null }): string {
  if (!message) return ''
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  if (content) return content
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : ''
  return reasoning
}

export class ModelGateway {
  constructor(
    private readonly database: AppDatabase,
    private readonly keyStore: KeyStore
  ) {}

  /**
   * 未保存前使用表单里的 baseUrl / apiKey / 模型做一次最小对话测试。
   * 不依赖已保存的供应商配置，测试结果不会加密落库。
   */
  async testDraft(input: {
    providerId?: string
    baseUrl: string
    apiKey?: string
    model?: string
    onLog?: (entry: { success: boolean; latencyMs: number; model: string; errorKind?: string; errorMessage?: string }) => void
  }): Promise<{ latencyMs: number; model: string; message: string }> {
    const apiKey = input.apiKey?.trim()
      ? input.apiKey.trim()
      : input.providerId
        ? this.keyStore.read(input.providerId)
        : ''
    if (!apiKey) throw new GatewayError('ProviderConfigError', '请先填写访问密钥，或使用已保存密钥的连接')

    const model = input.model?.trim() || '默认模型'
    const endpoint = buildChatEndpoint(input.baseUrl)
    const startedAt = performance.now()
    try {
      const result = await this.requestOnce(endpoint, apiKey, {
        model,
        messages: [{ role: 'user', content: '只回复 OK' }],
        temperature: 0,
        max_tokens: 16
      })
      const content = extractReplyText(result.choices?.[0]?.message)
      if (!content) throw new GatewayError('ParseError', '供应商连接成功，但模型返回了空内容，请检查模型标识是否正确')
      const latencyMs = Math.round(performance.now() - startedAt)
      const responseModel = result.model ?? model
      input.onLog?.({ success: true, latencyMs, model: responseModel })
      return {
        latencyMs,
        model: responseModel,
        message: `连接成功 · 模型 ${responseModel} 正常响应`
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt)
      const normalized = normalizeError(error, endpoint)
      input.onLog?.({
        success: false,
        latencyMs,
        model,
        errorKind: normalized.kind,
        errorMessage: normalized.message
      })
      throw normalized
    }
  }

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
      const content = extractReplyText(result.choices?.[0]?.message)
      if (!content) throw new GatewayError('ParseError', '模型返回了空内容，请确认该模型的回复是否放在额外字段中')

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
      const normalized = normalizeError(error, endpoint)
      this.database.recordModelCall({
        providerId: provider.id,
        model,
        latencyMs,
        success: false,
        errorKind: normalized.kind,
        errorMessage: normalized.message
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
      try {
        return await this.requestOnce(endpoint, apiKey, body)
      } catch (error) {
        lastError = normalizeError(error, endpoint)
        if (!shouldRetry(lastError) || attempt === 3) throw lastError
        await wait(attempt === 1 ? 500 : 1_500)
      }
    }

    throw lastError ?? new GatewayError('NetworkError', '模型请求失败')
  }

  private async requestOnce(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>
  ): Promise<OpenAiResponse> {
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
        throw fromHttpError(response.status, payload.error?.message, endpoint)
      }
      return payload
    } catch (error) {
      throw normalizeError(error, endpoint)
    } finally {
      clearTimeout(timeout)
    }
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
  // 用户可能直接粘贴完整对话端点（以 /chat/completions 结尾），自动去掉避免拼接出双重路径
  const normalized = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
  return `${normalized}/chat/completions`
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

function fromHttpError(status: number, message?: string, endpoint?: string): GatewayError {
  const safeMessage = message?.slice(0, 300)
  const hint = endpoint ? `（接口：${endpoint}）` : ''
  if (status === 401 || status === 403) {
    return new GatewayError(
      'AuthError',
      `密钥无效或无权访问该模型（HTTP ${status}）。请检查 API Key 是否正确、是否有该模型的调用权限${hint}。${safeMessage ?? ''}`,
      status
    )
  }
  if (status === 404) {
    return new GatewayError(
      'ProviderError',
      `接口地址或模型不存在（HTTP 404）。请检查接口地址是否需要以 /v1 结尾、模型标识是否拼写正确${hint}。${safeMessage ?? ''}`,
      status
    )
  }
  if (status === 429) {
    return new GatewayError(
      'RateLimitError',
      `请求过于频繁或额度不足（HTTP 429），请稍后重试或检查账户余额${hint}。${safeMessage ?? ''}`,
      status
    )
  }
  if (status >= 500) {
    return new GatewayError(
      'NetworkError',
      `供应商服务暂时不可用（HTTP ${status}），通常是上游故障，请稍后重试${hint}。${safeMessage ?? ''}`,
      status
    )
  }
  return new GatewayError('ProviderError', `供应商返回 HTTP ${status}${hint}。${safeMessage ?? ''}`, status)
}

function normalizeError(error: unknown, endpoint?: string): GatewayError {
  if (error instanceof GatewayError) return error
  const host = (() => {
    if (!endpoint) return ''
    try {
      return new URL(endpoint).host
    } catch {
      return ''
    }
  })()
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new GatewayError('TimeoutError', `请求超过 60 秒仍未响应${host ? `（${host}）` : ''}，可能是网络不通或供应商过载`)
  }
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause
    const code = cause?.code ?? ''
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) {
      return new GatewayError('NetworkError', `无法解析接口域名${host ? `（${host}）` : ''}：请检查接口地址拼写、本机网络或代理设置`)
    }
    if (/ECONNREFUSED/.test(code)) {
      return new GatewayError('NetworkError', `连接被拒绝${host ? `（${host}）` : ''}：目标服务未开放或端口不正确`)
    }
    if (/ETIMEDOUT|ECONNRESET|EPIPE/.test(code)) {
      return new GatewayError('NetworkError', `网络连接中断或超时${host ? `（${host}）` : ''}：请检查本机网络、代理或防火墙`)
    }
    if (/CERT|TLS|SSL/i.test(code)) {
      return new GatewayError('NetworkError', `TLS 证书校验失败${host ? `（${host}）` : ''}：请检查系统时间与证书配置`)
    }
    return new GatewayError('NetworkError', `无法连接到接口地址${host ? `（${host}）` : ''}${code ? `：${code}` : ''}，请检查网络或代理设置`)
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
