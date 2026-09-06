import {
  DEFAULT_ACCOUNT_FIELD_NAMES,
  DEFAULT_TOPIC_SCHEMA_FIELD_NAMES,
  type AccountField,
  type AccountRedline,
  type ArtifactReference,
  type TopicSchemaField,
  type WizardAnswer
} from './contracts.js'

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
 * 账号上下文 XML：定位字段 + 偏好红线。
 * 红线（偏好维度）与定位一起全阶段强制注入，模型不得越过。
 */
export function serializeAccountXml(fields: AccountField[], redlines: AccountRedline[] = []): string {
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
  return `<账号定位>\n${body}\n${redlineBlock}</账号定位>`
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
