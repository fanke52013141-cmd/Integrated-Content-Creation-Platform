import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type {
  Article,
  GenerateArticlesInput,
  GenerateArticlesResult,
  Material,
  ReviseArticleInput,
  ReviseArticleResult,
  StreamEvent
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { callModelWithFallback } from '../gateway/stream-helper.js'
import type { UnifiedRequest } from '../gateway/types.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'

export class ArticleGenerator {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(input: GenerateArticlesInput, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<GenerateArticlesResult> {
    const framework = input.frameworkId ? this.database.getFramework(input.frameworkId) : null
    if (input.frameworkId && !framework) throw new Error('所选内容框架不存在')
    const manualOutline = input.manualOutline?.trim() ?? ''
    if (!framework && !manualOutline) throw new Error('请选择内容框架，或粘贴一个手动框架')
    const account = this.resolveAccount(input.accountId ?? framework?.accountId)
    const materials = this.resolveMaterials(input.materialIds)
    const outline = framework?.rawXml ?? `<手动框架>\n${escapeXml(manualOutline)}\n</手动框架>`
    const total = input.count
    const work = Array.from({ length: total }, (_, index) => this.generateOne({
      input, framework, account, materials, outline, index, total, onStream, signal
    }))
    return collect(work)
  }

  async revise(input: ReviseArticleInput, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<ReviseArticleResult> {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('待修改成稿不存在')
    const instruction = input.instruction.trim()
    if (!instruction) throw new Error('请填写修改指令')
    const account = this.resolveAccount(article.accountId)
    const framework = input.alignFramework && article.frameworkId
      ? this.database.getFramework(article.frameworkId) : null
    if (input.alignFramework && article.frameworkId && !framework) throw new Error('关联框架已被删除，无法按框架对齐')
    const total = input.count
    const work = Array.from({ length: total }, (_, index) => this.reviseOne({
      input, article, account, framework, instruction, index, total, onStream, signal
    }))
    return collect(work)
  }

  private async generateOne(context: {
    input: GenerateArticlesInput
    framework: ReturnType<AppDatabase['getFramework']>
    account: ReturnType<AppDatabase['getAccount']>
    materials: Material[]
    outline: string
    index: number
    total: number
    onStream?: (event: StreamEvent) => void
    signal?: AbortSignal
  }): Promise<Article> {
    context.onStream?.({ phase: 'start', index: context.index, total: context.total })
    const request: UnifiedRequest = {
      providerId: context.input.providerId, model: context.input.model, temperature: 0.7,
      maxTokens: 8_000, jsonMode: false, signal: context.signal,
      messages: [
        { role: 'system', content: this.prompts.render('article.generate') },
        { role: 'user', content: [
          `<写作任务>第 ${context.index + 1} 个独立成稿候选，采用不同但不偏离框架的表达角度。</写作任务>`,
          context.account ? serializeAccountXml(context.account.fields) : '<账号定位>未选择</账号定位>',
          context.outline,
          serializeMaterials(context.materials)
        ].join('\n\n') }
      ]
    }
    const response = await callModelWithFallback(this.gateway, request, {
      signal: context.signal,
      onDelta: (delta) => context.onStream?.({ phase: 'delta', index: context.index, total: context.total, delta }),
      onRetry: () => context.onStream?.({ phase: 'start', index: context.index, total: context.total })
    })
    const article = this.database.saveArticle({
      frameworkId: context.framework?.id, accountId: context.account?.id,
      materialIds: context.materials.map((material) => material.id), manualOutline: context.framework ? '' : context.outline,
      status: 'draft', rawMarkdown: normalizeMarkdown(response.content), source: 'generate',
      providerId: response.providerId, model: response.model
    })
    this.createReferences(article.id, context.framework, context.account, context.materials)
    context.onStream?.({ phase: 'complete', index: context.index, total: context.total })
    return article
  }

  private async reviseOne(context: {
    input: ReviseArticleInput
    article: Article
    account: ReturnType<AppDatabase['getAccount']>
    framework: ReturnType<AppDatabase['getFramework']>
    instruction: string
    index: number
    total: number
    onStream?: (event: StreamEvent) => void
    signal?: AbortSignal
  }): Promise<Article> {
    context.onStream?.({ phase: 'start', index: context.index, total: context.total })
    const request: UnifiedRequest = {
      providerId: context.input.providerId, model: context.input.model, temperature: 0.45,
      maxTokens: 8_000, jsonMode: false, signal: context.signal,
      messages: [
        { role: 'system', content: this.prompts.render('article.revise') },
        { role: 'user', content: [
          `<改稿任务>第 ${context.index + 1} 个独立改稿候选。</改稿任务>`,
          context.account ? serializeAccountXml(context.account.fields) : '<账号定位>未选择</账号定位>',
          `<原稿>\n${escapeXml(context.article.rawMarkdown)}\n</原稿>`,
          `<修改指令>\n${escapeXml(context.instruction)}\n</修改指令>`,
          context.framework ? context.framework.rawXml : '<框架>未要求对齐</框架>'
        ].join('\n\n') }
      ]
    }
    const response = await callModelWithFallback(this.gateway, request, {
      signal: context.signal,
      onDelta: (delta) => context.onStream?.({ phase: 'delta', index: context.index, total: context.total, delta }),
      onRetry: () => context.onStream?.({ phase: 'start', index: context.index, total: context.total })
    })
    const targetId = context.input.count === 1 ? context.article.id : undefined
    const article = this.database.saveArticle({
      id: targetId, frameworkId: context.article.frameworkId, accountId: context.article.accountId,
      materialIds: context.article.materialIds, manualOutline: context.article.manualOutline,
      status: 'draft', rawMarkdown: normalizeMarkdown(response.content), source: 'revise', instruction: context.instruction,
      providerId: response.providerId, model: response.model
    })
    context.onStream?.({ phase: 'complete', index: context.index, total: context.total })
    if (targetId) return article
    this.database.createArtifactReference({
      sourceType: 'article', sourceId: context.article.id, sourceVersionId: context.article.currentVersionId,
      sourceStatusSnapshot: context.article.status, targetType: 'article', targetId: article.id
    })
    this.createReferences(
      article.id,
      context.framework,
      context.account,
      this.resolveMaterials(context.article.materialIds)
    )
    return article
  }

  private resolveAccount(id: string | undefined) {
    const account = id ? this.database.getAccount(id) : null
    if (id && !account) throw new Error('所选账号定位不存在')
    return account
  }

  private resolveMaterials(ids: string[]): Material[] {
    const requested = [...new Set(ids)]
    const materials = this.database.listMaterials().filter((material) => requested.includes(material.id) && material.kind !== 'image')
    if (materials.length !== requested.length) throw new Error('部分素材不存在，或图片素材不能作为正文依据')
    return materials
  }

  private createReferences(
    articleId: string,
    framework: ReturnType<AppDatabase['getFramework']>,
    account: ReturnType<AppDatabase['getAccount']>,
    materials: Material[]
  ): void {
    if (framework) this.database.createArtifactReference({
      sourceType: 'framework', sourceId: framework.id, sourceVersionId: framework.currentVersionId,
      sourceStatusSnapshot: framework.status, targetType: 'article', targetId: articleId
    })
    if (account) this.database.createArtifactReference({
      sourceType: 'account-profile', sourceId: account.id, sourceVersionId: account.currentVersionId,
      sourceStatusSnapshot: account.status, targetType: 'article', targetId: articleId
    })
    for (const material of materials) this.database.createArtifactReference({
      sourceType: 'material', sourceId: material.id, sourceVersionId: material.id,
      sourceStatusSnapshot: 'locked', targetType: 'article', targetId: articleId
    })
  }
}

function serializeMaterials(materials: Material[]): string {
  if (!materials.length) return '<素材>未选择；不要为补充细节而虚构事实。</素材>'
  return `<素材>\n${materials.map((material, index) => [
    `${index + 1}. 标题：${escapeXml(material.title)}`,
    `摘要：${escapeXml(material.summary)}`,
    material.sourceName ? `来源：${escapeXml(material.sourceName)}` : '',
    material.sourceUrl ? `链接：${escapeXml(material.sourceUrl)}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')}\n</素材>`
}

function normalizeMarkdown(content: string): string {
  const fenced = content.trim().match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i)?.[1]
  const markdown = (fenced ?? content).trim()
  if (!markdown) throw new Error('模型未返回可用成稿')
  if (!/^#\s+\S/m.test(markdown)) throw new Error('模型结果不是以一级标题开始的 Markdown 成稿，请重试或更换模型')
  return markdown
}

async function collect<T>(work: Array<Promise<T>>): Promise<{ articles: T[]; failed: Array<{ index: number; message: string }> }> {
  const settled = await Promise.allSettled(work)
  const articles: T[] = []
  const failed: Array<{ index: number; message: string }> = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') articles.push(result.value)
    else failed.push({ index: index + 1, message: result.reason instanceof Error ? result.reason.message.slice(0, 300) : '生成失败，请重试' })
  })
  return { articles, failed }
}
