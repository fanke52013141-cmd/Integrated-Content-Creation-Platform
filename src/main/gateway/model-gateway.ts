import type { AppDatabase } from '../database.js'
import type { KeyStore } from '../security/key-store.js'
import { extractTaggedBlock } from './extract-block.js'
import {
  GatewayError,
  isCancelledError,
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

interface OpenAiStreamChunk {
  model?: string
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

interface OpenAiImageResponse {
  model?: string
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string }
}

/** 非流式对话单次尝试超时 */
const CHAT_TIMEOUT_MS = 60_000
/** 图片生成单次尝试超时（出图普遍偏慢） */
const IMAGE_TIMEOUT_MS = 180_000
/** 流式请求空闲超时：超过该时长没有收到任何新数据即判定中断 */
const STREAM_IDLE_TIMEOUT_MS = 60_000
/** 流式请求总时长上限（长文生成兜底，避免无限挂起） */
const STREAM_TOTAL_TIMEOUT_MS = 10 * 60_000

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

export interface ChatOptions {
  signal?: AbortSignal
}

export interface ChatStreamOptions extends ChatOptions {
  /** 流式中断重试前回调：上层应清空已收到的半截预览 */
  onRetry?: () => void
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
      const result = await this.requestJsonOnce<OpenAiResponse>(endpoint, apiKey, {
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

  async chat(request: UnifiedRequest, options?: ChatOptions): Promise<UnifiedResponse> {
    const provider = this.database.getProvider(request.providerId)
    if (!provider || !provider.enabled) {
      throw new GatewayError('ProviderConfigError', '供应商不存在或已停用')
    }
    if (!provider.capabilities.chat) {
      throw new GatewayError('ProviderConfigError', '该供应商未启用文本对话能力')
    }

    const selectedModel = resolveModel(provider.models, request.model)
    const model = selectedModel.modelId
    const apiKey = this.keyStore.read(provider.id)
    const endpoint = buildChatEndpoint(provider.baseUrl)
    const jsonModeSimulated = Boolean(request.jsonMode && !provider.capabilities.jsonMode)
    const startedAt = performance.now()

    try {
      const result = await this.requestJsonWithRetry<OpenAiResponse>(endpoint, apiKey, {
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.4,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        ...(request.jsonMode && !jsonModeSimulated
          ? { response_format: { type: 'json_object' } }
          : {})
      }, options?.signal, CHAT_TIMEOUT_MS)

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
      const normalized = normalizeError(error, endpoint, options?.signal)
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

  /**
   * 流式对话：通过 SSE（Server-Sent Events）逐 token 推送增量内容。
   * onDelta 在每收到一段文本时被调用；方法完成后返回与 chat() 相同的 UnifiedResponse。
   * 流式过程中断（空闲超时 / 网络抖动）会自动整段重试一次，重试前回调 onRetry 通知上层清空半截内容。
   */
  async chatStream(
    request: UnifiedRequest,
    onDelta: (delta: string) => void,
    options?: ChatStreamOptions
  ): Promise<UnifiedResponse> {
    const provider = this.database.getProvider(request.providerId)
    if (!provider || !provider.enabled) {
      throw new GatewayError('ProviderConfigError', '供应商不存在或已停用')
    }
    if (!provider.capabilities.chat) {
      throw new GatewayError('ProviderConfigError', '该供应商未启用文本对话能力')
    }

    const selectedModel = resolveModel(provider.models, request.model)
    const model = selectedModel.modelId
    const apiKey = this.keyStore.read(provider.id)
    const endpoint = buildChatEndpoint(provider.baseUrl)
    const jsonModeSimulated = Boolean(request.jsonMode && !provider.capabilities.jsonMode)
    const startedAt = performance.now()

    const body = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.4,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.jsonMode && !jsonModeSimulated
        ? { response_format: { type: 'json_object' } }
        : {})
    }

    try {
      let result: Awaited<ReturnType<ModelGateway['requestStreamOnce']>> | undefined
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          result = await this.requestStreamOnce(endpoint, apiKey, body, onDelta, options?.signal)
          break
        } catch (error) {
          const normalized = normalizeError(error, endpoint, options?.signal)
          if (isCancelledError(normalized) || !shouldRetry(normalized) || attempt === 2) throw normalized
          options?.onRetry?.()
        }
      }
      if (!result) throw new GatewayError('NetworkError', '模型请求失败')

      const latencyMs = Math.round(performance.now() - startedAt)
      if (!result.content) throw new GatewayError('ParseError', '模型返回了空内容，请确认该模型的回复是否放在额外字段中')

      const extraction = request.extractBlock
        ? extractTaggedBlock(result.content, request.extractBlock)
        : { matched: false, value: undefined }

      this.database.recordModelCall({
        providerId: provider.id,
        model: result.responseModel ?? model,
        latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        success: true
      })

      return {
        providerId: provider.id,
        model: result.responseModel ?? model,
        content: result.content,
        extracted: extraction.value,
        extractionMatched: extraction.matched,
        finishReason: result.finishReason,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs,
        jsonModeSimulated
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt)
      const normalized = normalizeError(error, endpoint, options?.signal)
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

  /**
   * 图片生成：调用 OpenAI 兼容的 /images/generations 接口，返回 base64 图像数据。
   */
  async generateImage(input: {
    providerId: string
    model: string
    prompt: string
    size?: string
    signal?: AbortSignal
  }): Promise<{ base64: string; model: string; providerId: string; latencyMs: number }> {
    const provider = this.database.getProvider(input.providerId)
    if (!provider || !provider.enabled) {
      throw new GatewayError('ProviderConfigError', '供应商不存在或已停用')
    }
    if (!provider.capabilities.image) {
      throw new GatewayError('ProviderConfigError', '该供应商未启用图片生成能力，请先在「模型网关」中勾选')
    }
    const apiKey = this.keyStore.read(provider.id)
    const endpoint = buildImageEndpoint(provider.baseUrl)
    const startedAt = performance.now()

    try {
      const payload = await this.requestJsonWithRetry<OpenAiImageResponse>(endpoint, apiKey, {
        model: input.model,
        prompt: input.prompt,
        n: 1,
        response_format: 'b64_json',
        ...(input.size ? { size: input.size } : {})
      }, input.signal, IMAGE_TIMEOUT_MS)

      const item = payload.data?.[0]
      let base64 = item?.b64_json
      if (!base64 && item?.url) {
        // 部分供应商只返回临时 URL，这里下载转 base64
        const imageResponse = await fetch(item.url, { signal: input.signal })
        if (!imageResponse.ok) throw new GatewayError('NetworkError', `下载生成图片失败（HTTP ${imageResponse.status}）`)
        const buffer = Buffer.from(await imageResponse.arrayBuffer())
        base64 = buffer.toString('base64')
      }
      if (!base64) throw new GatewayError('ParseError', '图片接口未返回图像数据，请检查模型是否支持生图')

      const latencyMs = Math.round(performance.now() - startedAt)
      this.database.recordModelCall({ providerId: provider.id, model: input.model, latencyMs, success: true })
      return { base64, model: payload.model ?? input.model, providerId: provider.id, latencyMs }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt)
      const normalized = normalizeError(error, endpoint, input.signal)
      this.database.recordModelCall({
        providerId: provider.id,
        model: input.model,
        latencyMs,
        success: false,
        errorKind: normalized.kind,
        errorMessage: normalized.message
      })
      throw normalized
    }
  }

  private async requestJsonWithRetry<T>(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = CHAT_TIMEOUT_MS
  ): Promise<T> {
    let lastError: GatewayError | undefined

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.requestJsonOnce<T>(endpoint, apiKey, body, signal, timeoutMs)
      } catch (error) {
        lastError = normalizeError(error, endpoint, signal)
        if (isCancelledError(lastError) || !shouldRetry(lastError) || attempt === 3) throw lastError
        await wait(attempt === 1 ? 500 : 1_500)
      }
    }

    throw lastError ?? new GatewayError('NetworkError', '模型请求失败')
  }

  private async requestJsonOnce<T>(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = CHAT_TIMEOUT_MS
  ): Promise<T> {
    const { signal: combined, cleanup } = combineSignals(signal, timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: combined
      })

      const text = await response.text()
      if (!response.ok) {
        let errorMessage: string | undefined
        try { errorMessage = (JSON.parse(text) as OpenAiResponse).error?.message } catch { /* ignore */ }
        throw fromHttpError(response.status, errorMessage, endpoint)
      }
      try {
        return JSON.parse(text) as T
      } catch {
        throw new GatewayError('ParseError', `供应商返回了无法解析的响应（HTTP ${response.status}）`, response.status)
      }
    } catch (error) {
      throw toGatewayError(error, endpoint, signal)
    } finally {
      cleanup()
    }
  }

  /**
   * 流式请求：发送 stream:true，通过 ReadableStream reader 逐行读取 SSE 数据。
   * 每个 `data: {json}` 行解析为 OpenAiStreamChunk，提取 delta.content 调用 onDelta。
   * 超时策略为「空闲超时」：每收到一段数据就重置计时器，只有持续无输出才中断，
   * 避免长文生成被固定的总时长上限掐断。
   */
  private async requestStreamOnce(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<{
    content: string
    finishReason?: string
    promptTokens?: number
    completionTokens?: number
    responseModel?: string
  }> {
    const controller = new AbortController()
    let abortReason: 'idle' | 'total' | '' = ''
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        abortReason = 'idle'
        controller.abort()
      }, STREAM_IDLE_TIMEOUT_MS)
    }
    const totalTimer = setTimeout(() => {
      abortReason = 'total'
      controller.abort()
    }, STREAM_TOTAL_TIMEOUT_MS)
    const onExternalAbort = (): void => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onExternalAbort)
    }
    resetIdle()

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

      if (!response.ok) {
        const text = await response.text()
        let errorMessage: string | undefined
        try { errorMessage = (JSON.parse(text) as OpenAiResponse).error?.message } catch { /* ignore */ }
        throw fromHttpError(response.status, errorMessage, endpoint)
      }

      if (!response.body) {
        throw new GatewayError('ParseError', '供应商未返回流式响应体')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      let finishReason: string | undefined
      let promptTokens: number | undefined
      let completionTokens: number | undefined
      let responseModel: string | undefined

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdle()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const parsed = parseSseLine(line)
          if (!parsed) continue
          const delta = extractReplyText(parsed.choices?.[0]?.delta)
          if (delta) {
            content += delta
            onDelta(delta)
          }
          if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason
          if (parsed.model) responseModel = parsed.model
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens
            completionTokens = parsed.usage.completion_tokens
          }
        }
      }

      // 处理缓冲区中可能残留的最后一行
      const tail = parseSseLine(buffer)
      if (tail) {
        const delta = extractReplyText(tail.choices?.[0]?.delta)
        if (delta) { content += delta; onDelta(delta) }
        if (tail.choices?.[0]?.finish_reason) finishReason = tail.choices[0].finish_reason
      }

      return { content, finishReason, promptTokens, completionTokens, responseModel }
    } catch (error) {
      throw toStreamError(error, endpoint, signal, abortReason)
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      clearTimeout(totalTimer)
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }
}

function resolveModel(models: Array<{ enabled: boolean; modelId: string; isDefault: boolean }>, requested?: string): { modelId: string } {
  const selected = requested?.trim()
    ? models.find((model) => model.enabled && model.modelId === requested.trim())
    : models.find((model) => model.enabled && model.isDefault)
  if (!selected) {
    throw new GatewayError(
      'ProviderConfigError',
      requested ? '所选模型不存在或已停用' : '该供应商没有可用的默认模型'
    )
  }
  return selected
}

/**
 * 将外部取消信号与内部超时合并为一个 signal。
 * 返回 cleanup 用于移除监听与清掉计时器。
 */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort)
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
}

function toGatewayError(error: unknown, endpoint: string, externalSignal?: AbortSignal): GatewayError {
  if (externalSignal?.aborted) return new GatewayError('CancelledError', '已取消本次请求')
  if (error instanceof GatewayError) return error
  return normalizeError(error, endpoint)
}

function toStreamError(
  error: unknown,
  endpoint: string,
  externalSignal: AbortSignal | undefined,
  abortReason: 'idle' | 'total' | ''
): GatewayError {
  if (externalSignal?.aborted) return new GatewayError('CancelledError', '已取消本次生成')
  if (abortReason === 'idle') {
    return new GatewayError('TimeoutError', `流式响应已 ${STREAM_IDLE_TIMEOUT_MS / 1000} 秒没有新内容，连接可能中断，请重试`)
  }
  if (abortReason === 'total') {
    return new GatewayError('TimeoutError', `本次生成总时长超过 ${STREAM_TOTAL_TIMEOUT_MS / 60_000} 分钟被中止，请换用更快的模型或减少生成数量`)
  }
  if (error instanceof GatewayError) return error
  return normalizeError(error, endpoint)
}

function buildChatEndpoint(baseUrl: string): string {
  return `${buildApiBase(baseUrl, '/chat/completions')}`
}

function buildImageEndpoint(baseUrl: string): string {
  return `${buildApiBase(baseUrl, '/images/generations')}`
}

function buildApiBase(baseUrl: string, path: string): string {
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
  return `${normalized}${path}`
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

function normalizeError(error: unknown, endpoint?: string, externalSignal?: AbortSignal): GatewayError {
  if (error instanceof GatewayError) return error
  if (externalSignal?.aborted) return new GatewayError('CancelledError', '已取消本次生成')
  const host = (() => {
    if (!endpoint) return ''
    try {
      return new URL(endpoint).host
    } catch {
      return ''
    }
  })()
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new GatewayError('TimeoutError', `请求超时${host ? `（${host}）` : ''}：供应商长时间未响应，请重试或换用更快的模型`)
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
    return new GatewayError('NetworkError', `无法连接到接口地址${host ? `（${host}）` : ''}${code ? `（${code}）` : ''}，请检查网络或代理设置`)
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

/**
 * 解析一行 SSE 数据。返回 null 表示跳过（空行、注释行、`data: [DONE]` 或 JSON 解析失败）。
 */
function parseSseLine(line: string): OpenAiStreamChunk | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data) as OpenAiStreamChunk
  } catch {
    return null
  }
}
