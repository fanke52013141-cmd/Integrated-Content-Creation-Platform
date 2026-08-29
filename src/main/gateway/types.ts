export type GatewayErrorKind =
  | 'AuthError'
  | 'RateLimitError'
  | 'TimeoutError'
  | 'NetworkError'
  | 'ProviderError'
  | 'ParseError'
  | 'ProviderConfigError'
  | 'ConflictError'
  | 'CancelledError'

export class GatewayError extends Error {
  constructor(
    public readonly kind: GatewayErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export function isCancelledError(error: unknown): error is GatewayError {
  return error instanceof GatewayError && error.kind === 'CancelledError'
}

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface BlockExtraction {
  tag: string
  occurrence?: 'first' | 'last' | 'all'
  includeTags?: boolean
}

export interface UnifiedRequest {
  providerId: string
  model?: string
  messages: UnifiedMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  extractBlock?: BlockExtraction
  /** 取消信号：触发后请求中止并抛出 CancelledError */
  signal?: AbortSignal
}

export interface UnifiedResponse {
  providerId: string
  model: string
  content: string
  extracted?: string | string[]
  extractionMatched: boolean
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  latencyMs: number
  jsonModeSimulated: boolean
}
