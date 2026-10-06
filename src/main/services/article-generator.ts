import { buildMaterialContext, contextBudget, modelOutputTokens } from './material-context.js'
import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type {
  Article,
  GenerateArticlesInput,
  GenerateArticlesResult,
  Material,
  ReviseArticleInput,
  ReviseArticleResult,
  CreationRequest,
  CreationResult,
  SaveArticleInput,
  StreamEvent
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { callModelWithFallback } from '../gateway/stream-helper.js'
import type { UnifiedRequest } from '../gateway/types.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { contentCompletion, completionMessage } from './content-completion.js'

interface PreparedArticleRequest {
  maxTokens?: number
  input: GenerateArticlesInput | ReviseArticleInput
  article?: Article
  save: SaveArticleInput
  evidence?: import('../../shared/contracts.js').MaterialContext
  references?: Array<Omit<import('../../shared/contracts.js').CreateArtifactReferenceInput, 'targetId'>>
  messages: UnifiedRequest['messages']
}

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
    const selection = input.accountSelection
    const accountId = selection?.mode === 'none' ? undefined : selection?.mode === 'specific' ? selection.accountId : input.accountId ?? framework?.accountId
    const account = this.resolveAccount(accountId)
    const materials = this.resolveMaterials(input.materialIds)
    const outline = framework?.rawXml ?? `<手动框架>\n${escapeXml(manualOutline)}\n</手动框架>`
    const total = input.count
    const baseText = this.prompts.render('article.generate') + (account ? serializeAccountXml(account.fields, account.redlines) : '') + outline
    const evidence = buildMaterialContext(this.database, materials, outline, contextBudget(this.database, input.providerId, input.model, baseText))
    const requestId = this.database.workflow.createRequest('generate', {
      maxTokens: modelOutputTokens(this.database, input.providerId, input.model, 8000), evidence, references: this.referenceSnapshot(framework, account, materials),
      input, save: { frameworkId: framework?.id, accountId: account?.id, materialIds: materials.map(item => item.id), manualOutline: framework ? '' : outline, status: 'draft', source: 'generate', rawMarkdown: '' },
      messages: [{ role: 'system', content: this.prompts.render('article.generate') }, { role: 'user', content: [account ? serializeAccountXml(account.fields, account.redlines) : '<账号定位>未选择</账号定位>', outline, evidence.text].join('\n\n') }]
    } satisfies PreparedArticleRequest, '按框架写作', total)
    const work = Array.from({ length: total }, (_, index) => this.executePrepared(requestId, index + 1, total, onStream, signal))
    return { ...await collect(work), requestId }
  }

  async revise(input: ReviseArticleInput, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<ReviseArticleResult> {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('待修改成稿不存在')
    if (input.expectedVersionId && input.expectedVersionId !== article.currentVersionId) throw new Error('文章已有新版本，请重新加载后改稿')
    const instruction = input.instruction.trim()
    if (!instruction) throw new Error('请填写修改指令')
    const account = this.resolveAccount(article.accountId)
    const framework = input.alignFramework && article.frameworkId
      ? this.database.getFramework(article.frameworkId) : null
    if (input.alignFramework && article.frameworkId && !framework) throw new Error('关联框架已被删除，无法按框架对齐')
    const total = input.count
    if (input.revisionMode === 'new-version' && total !== 1) throw new Error('在当前文章生成版本时，只能生成一个结果')
    const evidence = this.database.workflow.getEvidence<import('../../shared/contracts.js').MaterialContext>(article.currentVersionId) ?? buildMaterialContext(this.database, this.resolveMaterials(article.materialIds), instruction)
    contextBudget(this.database, input.providerId, input.model, this.prompts.render('article.revise') + (input.baseMarkdown?.trim() || article.rawMarkdown) + instruction + (framework?.rawXml ?? '') + (account ? serializeAccountXml(account.fields, account.redlines) : '') + evidence.text)
    const requestId = this.database.workflow.createRequest('revise', {
      maxTokens: modelOutputTokens(this.database, input.providerId, input.model, 8000), evidence, references: this.referenceSnapshot(framework, account, this.resolveMaterials(article.materialIds)),
      input, article, save: { frameworkId: article.frameworkId, accountId: article.accountId, materialIds: article.materialIds, manualOutline: article.manualOutline, status: 'draft', source: 'revise', instruction, rawMarkdown: '' },
      messages: [{ role: 'system', content: this.prompts.render('article.revise') }, { role: 'user', content: [account ? serializeAccountXml(account.fields, account.redlines) : '<账号定位>未选择</账号定位>', `<原稿>\n${escapeXml(input.baseMarkdown?.trim() || article.rawMarkdown)}\n</原稿>`, `<修改指令>\n${escapeXml(instruction)}\n</修改指令>`, framework?.rawXml ?? '<框架>未要求对齐</框架>', evidence.text].join('\n\n') }]
    } satisfies PreparedArticleRequest, article.rawMarkdown.match(/^#\s+(.+)$/m)?.[1] ?? '改稿', total, article.id)
    const work = Array.from({ length: total }, (_, index) => this.executePrepared(requestId, index + 1, total, onStream, signal))
    return { ...await collect(work), requestId }
  }

  listRequests(): CreationRequest[] { return this.database.workflow.listCreationRequests() }

  async retry(requestId: string, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<GenerateArticlesResult> {
    const request = this.database.workflow.getCreationRequest(requestId)
    if (!request) throw new Error('生成请求不存在')
    if (request.articleId && !this.database.getArticle(request.articleId)) throw new Error('原文章已删除，无法重试')
    const pending = request.results.filter(item => item.status === 'failed' || item.status === 'pending')
    if (!pending.length) throw new Error('没有需要补生成的候选')
    const work = pending.map(item => this.executePrepared(requestId, item.index, request.results.length, onStream, signal))
    return { ...await collect(work, pending.map(item => item.index)), requestId }
  }

  recover(requestId: string, index: number, markdown: string): Article {
    const result = this.database.workflow.getCreationRequest(requestId)?.results.find(item => item.index === index)
    if (!result || result.status === 'running') throw new Error('没有可恢复的内容')
    if (!markdown.trim()) throw new Error('请输入正文后再保存')
    const snapshot = this.database.workflow.getRequestInput<PreparedArticleRequest>(requestId)
    // 人工确认只另存，绝不将部分生成结果写回原稿。
    return this.database.atomic(() => {
      const article = this.database.saveArticle({ ...snapshot.save, rawMarkdown: markdown, source: 'manual' })
      if (snapshot.evidence) this.database.workflow.saveEvidence(article.currentVersionId, snapshot.evidence)
      for (const reference of snapshot.references ?? []) this.database.createArtifactReference({ ...reference, targetId: article.id })
      const original = snapshot.article
      if (original && this.database.getArticle(original.id)) this.database.createArtifactReference({ sourceType: 'article', sourceId: original.id, sourceVersionId: original.currentVersionId, sourceStatusSnapshot: original.status, targetType: 'article', targetId: article.id })
      return this.database.getArticle(article.id)!
    })
  }

  async continueResult(requestId: string, index: number, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<GenerateArticlesResult> {
    const result = this.database.workflow.getCreationRequest(requestId)?.results.find(item => item.index === index)
    if (!result?.content || result.completion === 'blocked') throw new Error('该结果无法续写，请调整要求后重新生成')
    const snapshot = this.database.workflow.getRequestInput<PreparedArticleRequest>(requestId)
    const continued: PreparedArticleRequest = { ...snapshot, input: { ...snapshot.input, ...('articleId' in snapshot.input ? { revisionMode: 'new-candidates' as const } : {}), count: 1 }, messages: [...snapshot.messages, { role: 'assistant', content: result.content }, { role: 'user', content: '请补完上述未完成内容，输出一份完整的 Markdown 文章（包括原标题和已有正文），不要重复段落。不要仅输出新增部分。' }] }
    contextBudget(this.database, continued.input.providerId, continued.input.model, continued.messages.map(message => message.content).join(''))
    const nextId = this.database.workflow.createRequest('articleId' in snapshot.input ? 'revise' : 'generate', continued, '续写 · ' + (this.database.workflow.getCreationRequest(requestId)?.title ?? ''), 1, snapshot.article?.id)
    return { ...await collect([this.executePrepared(nextId, 1, 1, onStream, signal)]), requestId: nextId }
  }

  private async executePrepared(requestId: string, index: number, total: number, onStream?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<Article> {
    const prepared = this.database.workflow.getRequestInput<PreparedArticleRequest>(requestId)
    const previous = this.database.workflow.getCreationRequest(requestId)?.results.find(item => item.index === index)
    if (previous?.status === 'succeeded' && previous.articleId) {
      const article = this.database.getArticle(previous.articleId)
      if (!article) throw new Error('已生成结果被删除')
      return article
    }
    if (previous?.status === 'running') throw new Error('该候选正在生成，请等待完成')
    let state: CreationResult = { index, status: 'running', content: '', message: '' }
    this.database.workflow.saveCreationResult(requestId, state)
    onStream?.({ phase: 'start', index: index - 1, total })
    let lastPersisted = 0
    try {
      const response = await callModelWithFallback(this.gateway, {
        providerId: prepared.input.providerId, model: prepared.input.model, maxTokens: prepared.maxTokens ?? 8000,
        temperature: prepared.article ? 0.45 : 0.7, jsonMode: false, signal,
        messages: [...prepared.messages, { role: 'user', content: `<${prepared.article ? '改稿' : '写作'}任务>第 ${index} 个独立${prepared.article ? '改稿' : '成稿'}候选。</${prepared.article ? '改稿' : '写作'}任务>` }]
      }, { signal, onDelta: delta => {
        state.content += delta
        onStream?.({ phase: 'delta', index: index - 1, total, delta })
        if (Date.now() - lastPersisted > 700) { this.database.workflow.saveCreationResult(requestId, state); lastPersisted = Date.now() }
      }, onRetry: () => { state.content = ''; this.database.workflow.saveCreationResult(requestId, state); onStream?.({ phase: 'start', index: index - 1, total }) } })
      state.content = response.content
      state.completion = contentCompletion(response.content, response.finishReason)
      if (state.completion !== 'complete') throw new Error(completionMessage[state.completion])
      const markdown = normalizeMarkdown(response.content)
      const original = prepared.article
      const revise = 'revisionMode' in prepared.input ? prepared.input : undefined
      const current = original ? this.database.getArticle(original.id) : null
      if (original && !current) throw new Error('原文章已删除，生成内容已保留')
      const unchanged = current?.currentVersionId === original?.currentVersionId && (original ? this.database.workflow.getDraft(original.id)?.revision ?? 0 : 0) === (revise?.draftRevision ?? 0)
      const targetId = revise?.revisionMode === 'new-version' && unchanged ? original?.id : undefined
      const article = this.database.atomic(() => {
        const article = this.database.saveArticle({ ...prepared.save, id: targetId, rawMarkdown: markdown, providerId: response.providerId, model: response.model,
          expectedVersionId: targetId ? original?.currentVersionId : undefined, draftRevision: targetId ? revise?.draftRevision : undefined })
        if (prepared.evidence) this.database.workflow.saveEvidence(article.currentVersionId, prepared.evidence)
        for (const reference of prepared.references ?? []) this.database.createArtifactReference({ ...reference, targetId: article.id })
        if (original && !targetId) this.database.createArtifactReference({ sourceType: 'article', sourceId: original.id, sourceVersionId: original.currentVersionId, sourceStatusSnapshot: original.status, targetType: 'article', targetId: article.id })
        state = { ...state, status: 'succeeded', articleId: article.id, message: revise?.revisionMode === 'new-version' && !targetId ? '原文章或工作草稿已变化，已安全另存为备选稿，请比较后采纳' : '' }
        this.database.workflow.saveCreationResult(requestId, state)
        return this.database.getArticle(article.id)!
      })
      onStream?.({ phase: 'complete', index: index - 1, total })
      return article
    } catch (error) {
      onStream?.({ phase: 'error', index: index - 1, total, message: error instanceof Error ? error.message : '生成失败' })
      this.database.workflow.saveCreationResult(requestId, { ...state, status: 'failed', completion: state.completion ?? (state.content ? 'interrupted' : 'invalid'), message: error instanceof Error ? error.message : '生成失败' })
      throw error
    }
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

  private referenceSnapshot(framework: ReturnType<AppDatabase['getFramework']>, account: ReturnType<AppDatabase['getAccount']>, materials: Material[]): NonNullable<PreparedArticleRequest['references']> {
    const references: NonNullable<PreparedArticleRequest['references']> = []
    if (framework) references.push({ sourceType: 'framework', sourceId: framework.id, sourceVersionId: framework.currentVersionId, sourceStatusSnapshot: framework.status, targetType: 'article' })
    if (account) references.push({ sourceType: 'account-profile', sourceId: account.id, sourceVersionId: account.currentVersionId, sourceStatusSnapshot: account.status, targetType: 'article' })
    for (const material of materials) references.push({ sourceType: 'material', sourceId: material.id, sourceVersionId: material.id, sourceStatusSnapshot: 'locked', targetType: 'article' })
    return references
  }

}

function normalizeMarkdown(content: string): string {
  const fenced = content.trim().match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i)?.[1]
  const markdown = (fenced ?? content).trim()
  if (!markdown) throw new Error('模型未返回可用成稿')
  if (!/^#\s+\S/.test(markdown)) throw new Error('模型结果不是以一级标题开始的 Markdown 成稿，请重试或更换模型')
  return markdown
}

async function collect<T>(work: Array<Promise<T>>, indices?: number[]): Promise<{ articles: T[]; failed: Array<{ index: number; message: string }> }> {
  const settled = await Promise.allSettled(work)
  const articles: T[] = []
  const failed: Array<{ index: number; message: string }> = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') articles.push(result.value)
    else failed.push({ index: indices?.[index] ?? index + 1, message: result.reason instanceof Error ? result.reason.message.slice(0, 300) : '生成失败，请重试' })
  })
  return { articles, failed }
}
