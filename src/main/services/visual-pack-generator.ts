import { escapeXml } from '../../shared/domain.js'
import type { GenerateVisualPackInput, StreamEvent, VisualPrompt } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { callModelWithFallback } from '../gateway/stream-helper.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'

export class VisualPackGenerator {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(
    input: GenerateVisualPackInput,
    onStream?: (event: StreamEvent) => void,
    signal?: AbortSignal
  ) {
    this.database.workflow.assertSaved(input.articleId)
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')

    onStream?.({ phase: 'start', index: 0, total: 1 })
    const response = await callModelWithFallback(this.gateway, {
      providerId: input.providerId, model: input.model, temperature: .65, maxTokens: 4200, jsonMode: false,
      signal,
      extractBlock: { tag: '配图方案', occurrence: 'last' },
      messages: [{ role: 'system', content: this.prompts.render('visual.generate') }, { role: 'user', content: `<文章版本 id="${article.currentVersionId}" 状态="${article.status}">\n${escapeXml(article.rawMarkdown)}\n</文章>\n请设计 1 张封面、${input.inlineCount} 张文内配图、3 张发布配图。` }]
    }, {
      signal,
      onDelta: (delta) => onStream?.({ phase: 'delta', index: 0, total: 1, delta }),
      onRetry: () => onStream?.({ phase: 'start', index: 0, total: 1 })
    })

    try {
      const raw = typeof response.extracted === 'string' ? response.extracted : response.content
      const parsed = parsePack(raw)
      if (!parsed.cover.prompt || !parsed.inlineImages.length || !parsed.releaseImages.length) throw new Error('模型未按配图方案格式返回完整结果，请重试')
      return this.database.saveVisualPack({ articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: article.status, providerId: response.providerId, model: response.model, rawXml: raw, ...parsed })
    } finally {
      onStream?.({ phase: 'complete', index: 0, total: 1 })
    }
  }
}

function text(xml:string, tag:string):string { return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '' }
function prompts(xml:string):VisualPrompt[] { return [...xml.matchAll(/<图>([\s\S]*?)<\/图>/g)].map(item => ({ location:text(item[1],'位置'), purpose:text(item[1],'用途'), ratio:text(item[1],'比例') || '1:1', prompt:text(item[1],'提示词'), alt:text(item[1],'替代文本') })).filter(item => item.prompt) }
function parsePack(raw:string) { const cover=text(raw,'封面'); return { cover:{ visual:text(cover,'主视觉'), overlayText:text(cover,'封面文案'), prompt:text(cover,'提示词') }, inlineImages:prompts(text(raw,'文内配图')), releaseImages:prompts(text(raw,'发布配图')) } }
