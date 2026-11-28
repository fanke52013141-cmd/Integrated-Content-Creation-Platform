import type {
  GenerateTitlesDigestInput,
  GenerateTitlesDigestResult,
  TitleCandidate
} from '../../shared/contracts.js'
import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { GatewayError } from '../gateway/types.js'
import { contextBudget, modelOutputTokens } from './material-context.js'

/**
 * 标题工坊与公众号摘要生成服务（单轮高质量 system content）。
 * 支持消费未保存的编辑器草稿（baseMarkdown），确保用户改完正文即可即时出标题和摘要。
 */
export class TitleDigestService {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(input: GenerateTitlesDigestInput, signal?: AbortSignal): Promise<GenerateTitlesDigestResult> {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    const markdown = (input.baseMarkdown?.trim() || article.rawMarkdown).trim()
    if (!markdown) throw new Error('文章正文为空，无法生成标题与摘要')

    const account = article.accountId ? this.database.getAccount(article.accountId) : null
    const accountXml = account
      ? serializeAccountXml(account.fields, account.redlines, { memories: account.memories, memoryLimit: 6 })
      : '<账号定位>通用创作</账号定位>'
    const systemPrompt = this.prompts.render('article.titles-digest')
    const budget = contextBudget(this.database, input.providerId, input.model, systemPrompt + accountXml, 1800)
    const clippedBody = markdown.length > budget ? `${markdown.slice(0, budget)}\n\n（后文因长度限制略）` : markdown

    const response = await this.gateway.chat({
      providerId: input.providerId,
      model: input.model,
      temperature: 0.75,
      // 推理型模型（如 GLM-5.3-flash）会消耗思考 token，预留 6000 输出上限防止正文被截断
      maxTokens: modelOutputTokens(this.database, input.providerId, input.model, 6000),
      jsonMode: true,
      signal,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [accountXml, `<文章正文>\n${escapeXml(clippedBody)}\n</文章正文>`].join('\n\n')
        }
      ]
    }, { signal })

    const parsed = parseTitlesDigestJson(response.content)
    return {
      ...parsed,
      providerId: response.providerId,
      model: response.model,
      latencyMs: response.latencyMs
    }
  }
}

export function parseTitlesDigestJson(content: string): { titles: TitleCandidate[]; digest: string } {
  const candidates = [
    content.trim(),
    content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    extractJsonObject(content)
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const record = parsed as Record<string, unknown>
      const rawTitles = Array.isArray(record.titles) ? record.titles : []
      const titles: TitleCandidate[] = []
      const seen = new Set<string>()
      for (const item of rawTitles) {
        if (typeof item === 'string') {
          const text = cleanTitle(item)
          if (text && !seen.has(text)) {
            seen.add(text)
            titles.push({ text, style: '候选', reason: '' })
          }
          continue
        }
        if (!item || typeof item !== 'object') continue
        const entry = item as Record<string, unknown>
        const text = cleanTitle(String(entry.text ?? entry.title ?? ''))
        if (!text || seen.has(text)) continue
        seen.add(text)
        titles.push({
          text,
          style: String(entry.style ?? '候选').trim().slice(0, 20) || '候选',
          reason: String(entry.reason ?? '').trim().slice(0, 120)
        })
      }
      const digest = String(record.digest ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (titles.length || digest) {
        return { titles: titles.slice(0, 10), digest }
      }
    } catch {
      // Try next extraction strategy.
    }
  }
  throw new GatewayError('ParseError', '模型未返回可识别的标题与摘要 JSON，请重试或更换模型')
}

function cleanTitle(raw: string): string {
  return raw.replace(/^#+\s*/, '').replace(/^["'“”《》]+|["'“”《》]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  return start >= 0 && end > start ? content.slice(start, end + 1) : undefined
}
