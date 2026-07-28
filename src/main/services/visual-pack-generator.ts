import { escapeXml } from '../../shared/domain.js'
import type { GenerateVisualPackInput, VisualPrompt } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'

export class VisualPackGenerator {
  constructor(private readonly database: AppDatabase, private readonly gateway: ModelGateway) {}

  async generate(input: GenerateVisualPackInput) {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    const response = await this.gateway.chat({
      providerId: input.providerId, model: input.model, temperature: .65, maxTokens: 4200, jsonMode: false,
      extractBlock: { tag: '配图方案', occurrence: 'last' },
      messages: [{ role: 'system', content: `你是中文内容视觉总监。根据文章输出一个 <配图方案> XML 块，不生成真实图片。必须有：\n<封面><主视觉>...</主视觉><封面文案>...</封面文案><提示词>...</提示词></封面>\n<文内配图>每项格式：<图><位置>...</位置><用途>...</用途><比例>...</比例><提示词>...</提示词><替代文本>...</替代文本></图></文内配图>\n<发布配图>每项同上，用途要说明渠道或发布场景。</发布配图>\n提示词应可直接粘贴到绘图工具：具体构图、主体、风格、光线、留白；不得杜撰文章外的事实或人物，不要出现商标、水印、文字乱码。` }, { role: 'user', content: `<文章版本 id="${article.currentVersionId}" 状态="${article.status}">\n${escapeXml(article.rawMarkdown)}\n</文章>\n请设计 1 张封面、${input.inlineCount} 张文内配图、3 张发布配图。` }]
    })
    const raw = typeof response.extracted === 'string' ? response.extracted : response.content
    const parsed = parsePack(raw)
    if (!parsed.cover.prompt || !parsed.inlineImages.length || !parsed.releaseImages.length) throw new Error('模型未按配图方案格式返回完整结果，请重试')
    return this.database.saveVisualPack({ articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: article.status, providerId: response.providerId, model: response.model, rawXml: raw, ...parsed })
  }
}

function text(xml:string, tag:string):string { return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '' }
function prompts(xml:string):VisualPrompt[] { return [...xml.matchAll(/<图>([\s\S]*?)<\/图>/g)].map(item => ({ location:text(item[1],'位置'), purpose:text(item[1],'用途'), ratio:text(item[1],'比例') || '1:1', prompt:text(item[1],'提示词'), alt:text(item[1],'替代文本') })).filter(item => item.prompt) }
function parsePack(raw:string) { const cover=text(raw,'封面'); return { cover:{ visual:text(cover,'主视觉'), overlayText:text(cover,'封面文案'), prompt:text(cover,'提示词') }, inlineImages:prompts(text(raw,'文内配图')), releaseImages:prompts(text(raw,'发布配图')) } }
