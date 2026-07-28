export type GatewayErrorKind =
  | 'AuthError'
  | 'RateLimitError'
  | 'TimeoutError'
  | 'NetworkError'
  | 'ProviderError'
  | 'ParseError'
  | 'ProviderConfigError'

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
