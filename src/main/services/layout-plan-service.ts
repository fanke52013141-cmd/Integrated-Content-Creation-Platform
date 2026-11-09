import type {
  GenerateLayoutPlanInput,
  GenerateLayoutPlanResult,
  StreamEvent
} from '../../shared/contracts.js'
import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import { articleBlocks } from '../../shared/visual-studio.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import type { UnifiedRequest } from '../gateway/types.js'
import { extractArticleTitle } from './article-layout-service.js'
import { listLayoutThemes } from './layout-themes.js'
import { parseLayoutPlan } from './layout-plan-parser.js'
import { contextBudget, modelOutputTokens } from './material-context.js'

/**
 * 排版 AI（轻编排，PRD-排版AI §4.1）：根据成稿与配图资产产出 `<排版方案>`——
 * 配图插入点 + 推荐模板 + 封面位 + 导读/结尾互动语。
 * 渲染本身仍是确定性的 markdown-it + juice；本服务只负责「往哪插、加什么轻文案」的决策。
 */
export class LayoutPlanService {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(input: GenerateLayoutPlanInput, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<GenerateLayoutPlanResult> {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    this.database.workflow.assertSaved(input.articleId)

    const account = article.accountId ? this.database.getAccount(article.accountId) : null
    const themes = listLayoutThemes().map((theme) => ({ id: theme.id, name: theme.name }))

    // 候选图片池：本文章全部视觉包的已生成/导入资产，去掉已写进正文的那部分
    const assetOptions = this.collectAssetOptions(article.id, article.rawMarkdown)
    const paragraphCount = articleBlocks(extractArticleTitle(article.rawMarkdown).body).length
    if (!paragraphCount) throw new Error('正文为空，无法生成排版方案')

    const assetLines = assetOptions.length
      ? assetOptions.map((asset) => `文件名：${asset.fileName} ｜ 类型：${asset.kind === 'cover' ? '封面' : '正文图'} ｜ 说明：${asset.alt}`).join('\n')
      : '（无可用图片资产）'
    const themeLines = themes.map((theme) => `${theme.id}（${theme.name}）`).join('、')

    const systemPrompt = this.prompts.render('layout.plan')
    const userContent = [
      `<成稿>\n${escapeXml(article.rawMarkdown)}\n</成稿>`,
      `<配图资产>\n${assetLines}\n</配图资产>`,
      account ? `<账号定位>\n${escapeXml(serializeAccountXml(account.fields, account.redlines))}\n</账号定位>` : '',
      `<可用模板>\n${themeLines}\n</可用模板>`,
      input.userThemeId ? `<用户已选模板>\n${input.userThemeId}\n</用户已选模板>` : ''
    ].filter(Boolean).join('\n\n')

    contextBudget(this.database, input.providerId, input.model, systemPrompt + userContent, 2000)
    const request: UnifiedRequest = {
      providerId: input.providerId,
      model: input.model,
      temperature: 0.4,
      maxTokens: modelOutputTokens(this.database, input.providerId, input.model, 2000),
      jsonMode: false,
      signal,
      extractBlock: { tag: '排版方案', occurrence: 'last' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    }
    onStream?.({ phase: 'start', index: 0, total: 1 })
    const response = await this.gateway.chat(request)
    const raw = typeof response.extracted === 'string' ? response.extracted : Array.isArray(response.extracted) ? response.extracted.join('\n') : response.content
    if (!response.extractionMatched) {
      // 模型没按约定输出 <排版方案>：返回空方案走人工模式，不阻断排版本身
      onStream?.({ phase: 'complete', index: 0, total: 1 })
      return { plan: { insertions: [] }, extractionMatched: false, warnings: ['模型未按约定输出 <排版方案> 区块，已保留人工模式'], paragraphCount, assetOptions }
    }
    const { plan, warnings } = parseLayoutPlan(raw, { knownAssets: assetOptions, knownThemeIds: themes, paragraphCount })
    onStream?.({ phase: 'complete', index: 0, total: 1 })
    return { plan, extractionMatched: true, warnings, paragraphCount, assetOptions }
  }

  /** 收集文章可用图片资产：正文图优先，封面单独标注；已在正文 Markdown 里的不再重复推荐 */
  private collectAssetOptions(articleId: string, rawMarkdown: string): GenerateLayoutPlanResult['assetOptions'] {
    const options: GenerateLayoutPlanResult['assetOptions'] = []
    const seen = new Set<string>()
    for (const pack of this.database.listVisualPacks(articleId)) {
      for (const asset of this.database.listVisualAssets(pack.id)) {
        if (asset.kind === 'release' || seen.has(asset.fileName)) continue
        if (rawMarkdown.includes(asset.fileName)) continue
        seen.add(asset.fileName)
        const alt = asset.kind === 'cover' ? pack.cover.overlayText || pack.cover.prompt : pack.inlineImages[asset.slot]?.alt || asset.prompt
        options.push({ fileName: asset.fileName, kind: asset.kind, alt: alt.slice(0, 60) })
      }
    }
    return options
  }
}
