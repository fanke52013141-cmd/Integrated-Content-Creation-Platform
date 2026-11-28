import {
  DEFAULT_ACCOUNT_FIELD_NAMES,
  DEFAULT_TOPIC_SCHEMA_FIELD_NAMES,
  type AccountField,
  type AccountMemory,
  type AccountRedline,
  type AccountStyleSample,
  type ArtifactReference,
  type TopicSchemaField,
  type WizardAnswer
} from './contracts.js'

export const DEFAULT_ACCOUNT_MEMORY_LIMIT = 10
export const DEFAULT_STYLE_SAMPLE_CHAR_BUDGET = 3000

export interface SerializeAccountXmlOptions {
  memories?: AccountMemory[]
  samples?: AccountStyleSample[]
  memoryLimit?: number
  sampleCharBudget?: number
}

export function createAccountFields(values: Record<string, string>): AccountField[] {
  return DEFAULT_ACCOUNT_FIELD_NAMES.map((name) => ({
    id: crypto.randomUUID(),
    name,
    value: String(values[name] ?? '').trim(),
    isDefault: true
  }))
}

export function validateAccountFields(fields: AccountField[]): string[] {
  const errors: string[] = []
  const names = new Set<string>()

  for (const field of fields) {
    const name = field.name.trim()
    if (!name) {
      errors.push('字段名不能为空')
      continue
    }
    if (names.has(name)) errors.push(`字段名“${name}”重复`)
    names.add(name)
  }

  const accountName = fields.find((field) => field.name.trim() === '账号名称')
  if (!accountName?.value.trim()) errors.push('账号名称不能为空')

  return [...new Set(errors)]
}

/**
 * 账号上下文 XML：定位字段 + 偏好红线 + 可选历史复盘经验与标杆样文。
 * 红线（偏好维度）与定位一起全阶段强制注入，模型不得越过；
 * 复盘经验帮助避坑与复利；标杆样文按字符预算注入，仅学语感不复用事实。
 */
export function serializeAccountXml(
  fields: AccountField[],
  redlines: AccountRedline[] = [],
  options: SerializeAccountXmlOptions = {}
): string {
  const body = fields
    .map((field) => `${escapeXml(field.name.trim())}：${escapeXml(field.value.trim())}`)
    .join('\n')
  const kindLabels: Record<AccountRedline['kind'], string> = {
    do: '必须做到',
    dont: '禁止',
    compliance: '合规底线'
  }
  const redlineLines = redlines
    .map((redline) => `- [${kindLabels[redline.kind]}] ${escapeXml(redline.content)}`)
    .join('\n')
  const redlineBlock = redlineLines
    ? `\n偏好与红线（生成内容必须遵守，不得虚构与之冲突的信息）：\n${redlineLines}\n`
    : ''

  const memoryLimit = Math.max(0, options.memoryLimit ?? DEFAULT_ACCOUNT_MEMORY_LIMIT)
  const memoryLines = (options.memories ?? [])
    .slice(0, memoryLimit)
    .map((memory) => {
      const actionSuffix = memory.action.trim() ? `；行动建议：${escapeXml(memory.action.trim())}` : ''
      return `- [${escapeXml(memory.memoryDate)} · ${escapeXml(memory.source)}] ${escapeXml(memory.insight.trim())}${actionSuffix}`
    })
    .join('\n')
  const memoryBlock = memoryLines
    ? `\n历史复盘经验（请在选题、视角与表达中参考并规避已知问题）：\n${memoryLines}\n`
    : ''

  const sampleBudget = Math.max(0, options.sampleCharBudget ?? DEFAULT_STYLE_SAMPLE_CHAR_BUDGET)
  const enabledSamples = (options.samples ?? []).filter((sample) => sample.enabled && sample.excerpt.trim())
  const sampleChunks: string[] = []
  let usedChars = 0
  for (const sample of enabledSamples) {
    if (usedChars >= sampleBudget) break
    const remaining = sampleBudget - usedChars
    const rawExcerpt = sample.excerpt.trim()
    let excerpt = rawExcerpt
    if (rawExcerpt.length > remaining) {
      if (remaining < 120) break
      excerpt = `${rawExcerpt.slice(0, remaining - 1)}…`
    }
    usedChars += excerpt.length
    const noteLine = sample.note.trim() ? `\n参考重点：${escapeXml(sample.note.trim())}` : ''
    sampleChunks.push(
      `[样文 ${sampleChunks.length + 1} · ${escapeXml(sample.tag || '全文语感')}] ${escapeXml(sample.title.trim())}${noteLine}\n${escapeXml(excerpt)}`
    )
  }
  const sampleBlock = sampleChunks.length
    ? `\n标杆样文风格参考（仅用于学习语感、句式、段落节奏与表达习惯，严禁复用或编造样文中的事实、数据与案例）：\n${sampleChunks.join('\n\n')}\n`
    : ''

  return `<账号定位>\n${body}\n${redlineBlock}${memoryBlock}${sampleBlock}</账号定位>`
}

export function serializeWizardXml(answers: WizardAnswer[], extraContext = ''): string {
  const body = answers
    .map((item, index) => `${index + 1}. ${escapeXml(item.question)}\n回答：${escapeXml(item.answer || '未填写')}`)
    .join('\n\n')
  const extra = extraContext.trim()
    ? `\n\n补充说明：\n${escapeXml(extraContext.trim())}`
    : ''
  return `<账号定位向导>\n${body}${extra}\n</账号定位向导>`
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function referenceNeedsDraftWarning(reference: ArtifactReference): boolean {
  return reference.sourceStatusSnapshot === 'draft'
}

export function createDefaultTopicSchema(): TopicSchemaField[] {
  return DEFAULT_TOPIC_SCHEMA_FIELD_NAMES.map((name, index) => ({
    id: crypto.randomUUID(),
    name,
    required: name !== '备注',
    sortOrder: index
  }))
}

export function validateTopicSchema(fields: TopicSchemaField[]): string[] {
  const names = new Set<string>()
  const errors: string[] = []
  if (!fields.length) errors.push('至少保留一个选题字段')
  if (fields.length > 20) errors.push('选题字段最多 20 个')
  for (const field of fields) {
    const name = field.name.trim()
    if (!name) {
      errors.push('字段名不能为空')
      continue
    }
    if (name.length > 50) errors.push('字段名最多 50 个字符')
    if (names.has(name)) errors.push(`字段名“${name}”重复`)
    names.add(name)
  }
  return [...new Set(errors)]
}

/**
 * 外部链接白名单：只放行 http/https，其余协议（file:、javascript: 等）返回 null 由调用方提示。
 * 主进程与渲染层共用同一判断，避免各处各写一套。
 */
export function resolveExternalUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4_000) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
}
