import { escapeXml, serializeAccountXml } from '../../shared/domain.js'
import type {
  Framework,
  FrameworkSection,
  FrameworkTemplate,
  GenerateFrameworksInput,
  GenerateFrameworksResult,
  Material,
  Topic
} from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import type { PromptRegistry } from '../gateway/prompt-registry.js'
import { GatewayError } from '../gateway/types.js'

export class FrameworkGenerator {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry
  ) {}

  async generate(input: GenerateFrameworksInput): Promise<GenerateFrameworksResult> {
    const template = this.database.listFrameworkTemplates().find((item) => item.id === input.templateId)
    if (!template) throw new Error('所选框架模板不存在')

    const topic = input.topicId ? this.database.getTopic(input.topicId) : null
    if (input.topicId && !topic) throw new Error('所选选题不存在')
    const manualTopic = input.manualTopic?.trim() ?? ''
    if (!topic && !manualTopic) throw new Error('请选择一个选题，或填写框架主题')

    const account = input.accountId ? this.database.getAccount(input.accountId) : null
    if (input.accountId && !account) throw new Error('所选账号定位不存在')

    const requestedIds = [...new Set(input.materialIds)]
    const materials = this.database.listMaterials()
      .filter((material) => requestedIds.includes(material.id) && material.kind !== 'image')
    if (materials.length !== requestedIds.length) {
      throw new Error('部分素材不存在，或图片素材不能作为正文依据')
    }

    const work = Array.from({ length: input.count }, (_, index) => this.generateOne({
      template,
      topic,
      manualTopic,
      account,
      materials,
      input,
      index
    }))
    const settled = await Promise.allSettled(work)
    const frameworks: Framework[] = []
    const failed: Array<{ index: number; message: string }> = []
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') frameworks.push(result.value)
      else failed.push({ index: index + 1, message: readableError(result.reason) })
    })
    return { frameworks, failed }
  }

  private async generateOne(context: {
    template: FrameworkTemplate
    topic: Topic | null
    manualTopic: string
    account: ReturnType<AppDatabase['getAccount']>
    materials: Material[]
    input: GenerateFrameworksInput
    index: number
  }): Promise<Framework> {
    const response = await this.gateway.chat({
      providerId: context.input.providerId,
      model: context.input.model,
      temperature: 0.7,
      maxTokens: 3_500,
      jsonMode: false,
      messages: [
        {
          role: 'system',
          content: this.prompts.render('framework.generate', {
            '章节标签': context.template.sections.map((name) => `<${name}>`)
          })
        },
        {
          role: 'user',
          content: [
            serializeFrameworkTask(context.template, context.index),
            serializeFrameworkTopic(context.topic, context.manualTopic),
            context.account ? serializeAccountXml(context.account.fields) : '<账号定位>未选择</账号定位>',
            serializeFrameworkMaterials(context.materials)
          ].join('\n\n')
        }
      ]
    })
    const sections = parseFrameworkXml(response.content, context.template.sections)
    const framework = this.database.saveFramework({
      topicId: context.topic?.id,
      accountId: context.account?.id,
      materialIds: context.materials.map((material) => material.id),
      templateId: context.template.id,
      manualTopic: context.manualTopic,
      status: 'draft',
      sections,
      providerId: response.providerId,
      model: response.model
    })
    if (context.topic) this.database.createArtifactReference({
      sourceType: 'topic', sourceId: context.topic.id,
      sourceVersionId: context.topic.currentVersionId,
      sourceStatusSnapshot: context.topic.status,
      targetType: 'framework', targetId: framework.id
    })
    if (context.account) this.database.createArtifactReference({
      sourceType: 'account-profile', sourceId: context.account.id,
      sourceVersionId: context.account.currentVersionId,
      sourceStatusSnapshot: context.account.status,
      targetType: 'framework', targetId: framework.id
    })
    for (const material of context.materials) this.database.createArtifactReference({
      sourceType: 'material', sourceId: material.id, sourceVersionId: material.id,
      sourceStatusSnapshot: 'locked', targetType: 'framework', targetId: framework.id
    })
    return framework
  }
}

export function parseFrameworkXml(content: string, sectionNames: string[]): FrameworkSection[] {
  const framework = content.match(/<框架[^>]*>([\s\S]*?)<\/框架>/i)?.[1] ?? content
  const sections = sectionNames.map((name) => {
    const escaped = escapeRegExp(name)
    const matched = framework.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))
    return { name, content: decodeXml(matched?.[1]?.trim() ?? '') }
  })
  if (sections.some((section) => !section.content)) {
    throw new GatewayError('ParseError', '模型结果未按当前模板完整返回框架章节，请重试或更换模型')
  }
  return sections
}

function serializeFrameworkTask(template: FrameworkTemplate, index: number): string {
  return `<生成任务>第 ${index + 1} 个独立框架。模板名称：${escapeXml(template.name)}。章节顺序：${template.sections.map(escapeXml).join(' → ')}。</生成任务>`
}

function serializeFrameworkTopic(topic: Topic | null, manualTopic: string): string {
  if (!topic) return `<选题>\n主题：${escapeXml(manualTopic)}\n</选题>`
  const body = Object.entries(topic.fields)
    .map(([name, value]) => `${escapeXml(name)}：${escapeXml(value)}`)
    .join('\n')
  const extra = manualTopic ? `\n补充主题：${escapeXml(manualTopic)}` : ''
  return `<选题>\n${body}${extra}\n</选题>`
}

function serializeFrameworkMaterials(materials: Material[]): string {
  if (!materials.length) return '<素材>未选择；无需为凑素材而虚构事实。</素材>'
  const body = materials.map((material, index) => [
    `${index + 1}. 标题：${escapeXml(material.title)}`,
    `摘要：${escapeXml(material.summary)}`,
    material.sourceName ? `来源：${escapeXml(material.sourceName)}` : '',
    material.sourceUrl ? `链接：${escapeXml(material.sourceUrl)}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')
  return `<素材>\n${body}\n</素材>`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeXml(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'").replaceAll('&amp;', '&')
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : '生成失败，请重试'
}
