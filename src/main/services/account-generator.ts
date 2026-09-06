import { z } from 'zod'
import { createAccountFields, serializeWizardXml } from '../../shared/domain.js'
import type {
  GenerateAccountInput,
  GenerateAccountResult
} from '../../shared/contracts.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { GatewayError } from '../gateway/types.js'

const accountSchema = z.object({
  账号名称: z.string(),
  简介: z.string(),
  领域: z.string(),
  目标受众: z.string(),
  写作风格: z.string(),
  IP人设: z.string(),
  差异化定位: z.string(),
  价值主张: z.string()
})

export class AccountGenerator {
  constructor(
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(input: GenerateAccountInput): Promise<GenerateAccountResult> {
    if (input.answers.length !== 7) {
      throw new Error('账号定位向导必须包含 7 个问题')
    }

    const response = await this.gateway.chat({
      providerId: input.providerId,
      model: input.model,
      temperature: 0.35,
      maxTokens: 1_200,
      jsonMode: true,
      messages: [
        {
          role: 'system',
          content: this.prompts.render('account.generate')
        },
        {
          role: 'user',
          content: serializeWizardXml(input.answers, input.extraContext)
        }
      ]
    })

    const parsed = parseAccountJson(response.content)
    return {
      fields: createAccountFields(parsed).map((field) => ({ ...field, source: 'ai' as const })),
      providerId: response.providerId,
      model: response.model,
      rawContent: response.content,
      latencyMs: response.latencyMs
    }
  }
}

export function parseAccountJson(content: string): z.infer<typeof accountSchema> {
  const candidates = [
    content.trim(),
    extractCodeFence(content),
    extractJsonObject(content)
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(candidate) as unknown
      const normalized = unwrapAccountObject(raw)
      const result = accountSchema.safeParse(normalized)
      if (result.success) return result.data
    } catch {
      // Try the next extraction strategy.
    }
  }

  throw new GatewayError(
    'ParseError',
    '模型结果未能解析为账号定位八字段，请调整模型或重试'
  )
}

function unwrapAccountObject(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    '账号定位' in value &&
    (value as Record<string, unknown>).账号定位
  ) {
    return (value as Record<string, unknown>).账号定位
  }
  return value
}

function extractCodeFence(content: string): string | undefined {
  return content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  return start >= 0 && end > start ? content.slice(start, end + 1) : undefined
}
