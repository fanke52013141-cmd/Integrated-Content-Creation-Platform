import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import mammoth from 'mammoth'
import type {
  ContentImportCommitInput,
  ContentImportFormat,
  ContentImportKind,
  ContentImportPreview,
  ContentImportPreviewItem,
  ContentImportResult,
  ContentImportSource,
  FrameworkSection,
  HotItem,
  LocalFileResult,
  PickedImportFile,
  PublishFormDraft,
  ReviewSeverity,
  VisualPack
} from '../../shared/contracts.js'
import { createAccountFields } from '../../shared/domain.js'
import { articleBlocks, type PictureBrief } from '../../shared/visual-studio.js'
import type { AppDatabase } from '../database.js'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_CONTENT_CHARS = 1_000_000
const MAX_ITEMS = 500
const PREVIEW_TTL_MS = 15 * 60 * 1000

export interface ParsedImportItem {
  title: string
  fields?: Record<string, string>
  sections?: FrameworkSection[]
  rawMarkdown?: string
  hotItem?: HotItem
  reviewProblems?: Array<{ position: string; severity: ReviewSeverity; issue: string; suggestion: string }>
  visualPlan?: { cover: VisualPack['cover']; inlineImages: VisualPack['inlineImages']; releaseImages: VisualPack['releaseImages'] }
  layout?: { title: string; html: string; plainText: string }
  prompt?: { key: string; content: string; note: string; modelBinding?: import('../../shared/contracts.js').PromptModelBinding | null }
  warnings: string[]
  /** 同来源已存在的条目；导入时可选择新建版本 */
  existing?: { artifactId: string; title: string; versionId?: string }
  externalId?: string
}

export interface ParsedImportBatch {
  kind: ContentImportKind
  source: ContentImportSource
  items: ParsedImportItem[]
  errors: string[]
  warnings: string[]
}

interface CachedPreview {
  batch: ParsedImportBatch
  expiresAt: number
}

const KIND_FORMATS: Record<ContentImportKind, ContentImportFormat[]> = {
  account: ['markdown', 'json', 'text'],
  'hot-item': ['json', 'csv', 'text'],
  topic: ['markdown', 'json', 'csv', 'text'],
  framework: ['markdown', 'json', 'text'],
  article: ['markdown', 'json', 'docx', 'html', 'text'],
  review: ['markdown', 'json', 'csv', 'text'],
  'visual-plan': ['json'],
  layout: ['html', 'json'],
  'publish-form': ['json'],
  prompt: ['json']
}

const FORMAT_BY_EXT: Record<string, ContentImportFormat> = {
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.csv': 'csv',
  '.docx': 'docx',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text'
}

const VERSIONABLE = new Set<ContentImportKind>(['account', 'topic', 'framework', 'article'])
const ARTIFACT_TYPE: Record<ContentImportKind, string> = {
  account: 'account',
  'hot-item': 'hot-favorite',
  topic: 'topic',
  framework: 'framework',
  article: 'article',
  review: 'review-task',
  'visual-plan': 'visual-pack',
  layout: 'layout',
  'publish-form': 'publish-form',
  prompt: 'prompt'
}

const KIND_LABEL: Record<ContentImportKind, string> = {
  account: '账号定位',
  'hot-item': '热点',
  topic: '选题',
  framework: '框架',
  article: '文章',
  review: '评审',
  'visual-plan': '配图方案',
  layout: '排版稿',
  'publish-form': '交付信息',
  prompt: '提示词'
}

function formatForFile(filePath: string): ContentImportFormat {
  const format = FORMAT_BY_EXT[extname(filePath).toLowerCase()]
  if (!format) throw new Error(`不支持的文件类型：${extname(filePath) || '未知'}。支持 ${KIND_FORMATS.topic.join(' / ')} 等格式`)
  return format
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
}

function itemTitle(value: string, fallback: string): string {
  return value.trim().replace(/^#+\s*/, '').slice(0, 200) || fallback
}

/** 保守的 HTML → Markdown：只提取结构，不保留脚本/样式/事件属性。 */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|tr)>/gi, '\n\n')
    .replace(/<h([1-6])[^>]*>/gi, (_match, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<strong[^>]*>|<b[^>]*>/gi, '**')
    .replace(/<\/strong>|<\/b>/gi, '**')
    .replace(/<em[^>]*>|<i[^>]*>/gi, '*')
    .replace(/<\/em>|<\/i>/gi, '*')
    .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `[${label.replace(/<[^>]+>/g, '')}](${href})`)
    .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, (_m, alt: string, src: string) => `![${alt}](${src})`)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  text = normalizeText(text)
  return text
}

/** DOCX → HTML → Markdown。mammoth 的类型声明只暴露 extractRawText，运行时支持 convertToHtml。 */
export async function docxToMarkdown(buffer: Buffer): Promise<{ markdown: string; messages: number }> {
  const parser = mammoth as unknown as { convertToHtml(input: { buffer: Buffer }): Promise<{ value: string; messages?: Array<{ message: string }> }> }
  const result = await parser.convertToHtml({ buffer })
  return { markdown: htmlToMarkdown(result.value), messages: result.messages?.length ?? 0 }
}

/** RFC 4180 风格 CSV 解析（引号、逗号、换行）。 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const text = input.replace(/^\uFEFF/, '')
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++ } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(field); field = ''; continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    if (char !== '\r') field += char
  }
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export function markdownTopicItems(markdown: string): ParsedImportItem[] {
  const lines = normalizeText(markdown)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
  return lines.slice(0, MAX_ITEMS).map((line) => ({
    title: itemTitle(line, '未命名选题'),
    fields: { 选题主题: itemTitle(line, '未命名选题'), 备注: '' },
    warnings: []
  }))
}

function normalizeFields(value: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue
    if (typeof raw === 'object') continue
    const name = key.trim()
    if (!name) continue
    fields[name] = String(raw).trim()
  }
  return fields
}

export function parseTopicJson(content: string): ParsedImportItem[] {
  const parsed = JSON.parse(content) as unknown
  const roots = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { topics?: unknown }).topics)
      ? (parsed as { topics: unknown[] }).topics
      : [parsed]
  const items: ParsedImportItem[] = []
  for (const root of roots.slice(0, MAX_ITEMS)) {
    if (typeof root === 'string' && root.trim()) {
      const title = itemTitle(root, '未命名选题')
      items.push({ title, fields: { 选题主题: title, 备注: '' }, warnings: [] })
      continue
    }
    if (!root || typeof root !== 'object') continue
    const record = root as Record<string, unknown>
    const nested = record.fields && typeof record.fields === 'object' ? record.fields as Record<string, unknown> : {}
    const fields = { ...normalizeFields(record), ...normalizeFields(nested) }
    for (const key of ['title', 'seedKeyword', 'id', 'status', 'createdAt', 'updatedAt', 'versions', 'references']) delete fields[key]
    const title = String(record.title ?? record.seedKeyword ?? fields['选题主题'] ?? Object.values(fields)[0] ?? '').trim()
    if (!title) continue
    if (!fields['选题主题']) fields['选题主题'] = title
    items.push({ title: itemTitle(title, '未命名选题'), fields, warnings: [] })
  }
  return items
}

export function parseTopicCsv(content: string): ParsedImportItem[] {
  const rows = parseCsv(content)
  if (!rows.length) return []
  const header = rows[0].map((cell) => cell.trim())
  const hasHeader = header.some((cell) => /标题|主题|观点|价值|备注/.test(cell))
  const dataRows = hasHeader ? rows.slice(1) : rows
  const columns = hasHeader
    ? header
    : rows[0].length > 1 ? ['选题主题', '备注'] : ['选题主题']
  return dataRows.slice(0, MAX_ITEMS).map((cells) => {
    const fields: Record<string, string> = {}
    columns.forEach((name, index) => {
      const key = name || `字段 ${index + 1}`
      const value = cells[index]?.trim() ?? ''
      if (value) fields[key] = value
    })
    const title = fields['选题主题'] || fields['标题'] || fields['主题'] || cells[0] || ''
    if (!fields['选题主题'] && title) fields['选题主题'] = title
    return { title: itemTitle(title, '未命名选题'), fields, warnings: [] }
  }).filter((item) => item.title)
}

export function parseFrameworkJson(content: string): ParsedImportItem[] {
  const parsed = JSON.parse(content) as unknown
  const roots = Array.isArray(parsed) ? parsed : [parsed]
  const items: ParsedImportItem[] = []
  for (const root of roots.slice(0, MAX_ITEMS)) {
    if (!root || typeof root !== 'object') continue
    const record = root as Record<string, unknown>
    const title = String(record.title ?? record.manualTopic ?? record.topic ?? '').trim()
    const sectionsRaw = record.sections
    const sections: FrameworkSection[] = []
    if (Array.isArray(sectionsRaw)) {
      for (const section of sectionsRaw) {
        if (typeof section === 'string') sections.push({ name: section, content: '' })
        else if (section && typeof section === 'object') {
          const entry = section as Record<string, unknown>
          const name = String(entry.name ?? entry.title ?? entry.heading ?? '').trim()
          if (name) sections.push({ name, content: String(entry.content ?? entry.body ?? entry.text ?? '').trim() })
        }
      }
    }
    if (!sections.length) continue
    items.push({ title: itemTitle(title || sections[0].name, '未命名框架'), sections, warnings: [] })
  }
  return items
}

export function parseFrameworkMarkdown(content: string): ParsedImportItem[] {
  const lines = normalizeText(content).split('\n')
  let title = ''
  let current: FrameworkSection | undefined
  const sections: FrameworkSection[] = []
  const push = (): void => {
    if (current) { current.content = current.content.trim(); if (current.name) sections.push(current) }
    current = undefined
  }
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      const level = heading[1].length
      const name = heading[2].trim()
      if (level === 1 && !title) { title = name; continue }
      push()
      current = { name, content: '' }
      continue
    }
    if (current) current.content += `${line}\n`
    else if (!title && line.trim()) title = line.trim()
  }
  push()
  if (!sections.length) {
    const body = lines.filter((line) => line.trim() && line.trim() !== title).join('\n').trim()
    if (body) sections.push({ name: '正文', content: body })
  }
  return sections.length
    ? [{ title: itemTitle(title || sections[0].name, '未命名框架'), sections, warnings: [] }]
    : []
}

export function parseArticleJson(content: string): ParsedImportItem[] {
  const parsed = JSON.parse(content) as unknown
  const roots = Array.isArray(parsed) ? parsed : [parsed]
  const items: ParsedImportItem[] = []
  for (const root of roots.slice(0, MAX_ITEMS)) {
    if (!root || typeof root !== 'object') continue
    const record = root as Record<string, unknown>
    const markdown = normalizeText(String(record.markdown ?? record.rawMarkdown ?? record.content ?? record.body ?? ''))
    if (!markdown) continue
    const title = String(record.title ?? '').trim()
    items.push({
      title: itemTitle(title || markdown.match(/^#\s+(.+)$/m)?.[1] || '未命名文章', '未命名文章'),
      rawMarkdown: markdown.startsWith('#') || !title ? markdown : `# ${title}\n\n${markdown}`,
      warnings: []
    })
  }
  return items
}

export function parseArticleMarkdown(content: string): ParsedImportItem[] {
  const markdown = normalizeText(content)
  if (!markdown) return []
  return [{
    title: itemTitle(markdown.match(/^#\s+(.+)$/m)?.[1] || '', '未命名文章'),
    rawMarkdown: markdown,
    warnings: markdown.startsWith('#') ? [] : ['正文没有一级标题，导入后将使用“未命名文章”作为标题']
  }]
}

export function parseAccountContent(content: string, format: ContentImportFormat): ParsedImportItem[] {
  const fields: Record<string, string> = {}
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown
    const root = Array.isArray(parsed) ? parsed[0] : parsed
    if (!root || typeof root !== 'object') return []
    const record = root as Record<string, unknown>
    const nested = record.fields && typeof record.fields === 'object' ? record.fields as Record<string, unknown> : {}
    Object.assign(fields, normalizeFields(record), normalizeFields(nested))
    delete fields.fields
  } else {
    for (const line of normalizeText(content).split('\n')) {
      const match = line.match(/^\s*(?:[-*]\s*)?([^：:]{1,40})[：:]\s*(.+?)\s*$/)
      if (match) fields[match[1].trim()] = match[2].trim()
    }
    if (!Object.keys(fields).length) {
      const lines = normalizeText(content).split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).filter(Boolean)
      if (lines[0]) fields['账号名称'] = lines[0]
      if (lines[1]) fields['简介'] = lines.slice(1).join('\n')
    }
  }
  if (!fields['账号名称'] && fields.name) fields['账号名称'] = fields.name
  delete fields.name
  if (!fields['账号名称']) return []
  return [{ title: fields['账号名称'], fields, warnings: [] }]
}

function parseHotItemContent(content: string, format: ContentImportFormat): ParsedImportItem[] {
  const now = new Date().toISOString()
  const make = (raw: Record<string, string>, index: number): ParsedImportItem | null => {
    const title = (raw.title || raw['标题'] || '').trim()
    if (!title) return null
    const url = (raw.url || raw.sourceUrl || raw['链接'] || '').trim()
    const sourceTitle = (raw.sourceTitle || raw.sourceName || raw.source || raw['来源'] || '外部导入').trim()
    const hotItem: HotItem = {
      id: `manual-${createHash('sha256').update(`${title}|${url}|${index}`).digest('hex').slice(0, 16)}`,
      title,
      desc: (raw.desc || raw.summary || raw.snippet || raw['摘要'] || '').trim(),
      url,
      source: 'manual',
      sourceTitle,
      subtitle: (raw.subtitle || '').trim(),
      updateTime: (raw.updateTime || raw.publishedAt || now).trim(),
      hotValue: (raw.hotValue || raw['热度'] || '').trim() || undefined,
      rank: index + 1,
      rawJson: JSON.stringify(raw)
    }
    return { title, hotItem, warnings: url ? [] : ['没有链接，热点仍可作为灵感记录'] }
  }
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown
    const roots = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [parsed]
    return roots.slice(0, MAX_ITEMS).map((root, index) => {
      if (!root || typeof root !== 'object') return null
      const raw = Object.fromEntries(Object.entries(root as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]))
      return make(raw, index)
    }).filter((item): item is ParsedImportItem => Boolean(item))
  }
  if (format === 'csv') {
    const rows = parseCsv(content)
    if (!rows.length) return []
    const header = rows[0].map((cell) => cell.trim())
    const hasHeader = header.some((cell) => /标题|链接|来源|热度|摘要/.test(cell))
    const columns = hasHeader ? header : ['标题', '链接', '来源']
    return rows.slice(hasHeader ? 1 : 0).slice(0, MAX_ITEMS).map((cells, index) => {
      const raw: Record<string, string> = {}
      columns.forEach((name, cellIndex) => { if (name) raw[name] = cells[cellIndex]?.trim() ?? '' })
      return make(raw, index)
    }).filter((item): item is ParsedImportItem => Boolean(item))
  }
  return normalizeText(content).split('\n').map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean)
    .slice(0, MAX_ITEMS).map((line, index) => make({ title: line, '来源': '手动粘贴' }, index))
    .filter((item): item is ParsedImportItem => Boolean(item))
}

function severityOf(value: string): ReviewSeverity {
  const text = value.trim().toLowerCase()
  if (text === 'high' || text === '高' || text === '严重') return 'high'
  if (text === 'low' || text === '低' || text === '轻微') return 'low'
  return 'medium'
}

function parseReviewContent(content: string, format: ContentImportFormat): ParsedImportItem[] {
  const problems: Array<{ position: string; severity: ReviewSeverity; issue: string; suggestion: string }> = []
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown
    const roots = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { problems?: unknown }).problems)
        ? (parsed as { problems: unknown[] }).problems
        : [parsed]
    for (const root of roots) {
      if (!root || typeof root !== 'object') continue
      const row = root as Record<string, unknown>
      const issue = String(row.issue ?? row['问题'] ?? '').trim()
      if (!issue) continue
      problems.push({
        position: String(row.position ?? row['位置'] ?? '外部评审').trim() || '外部评审',
        severity: severityOf(String(row.severity ?? row['严重度'] ?? 'medium')),
        issue,
        suggestion: String(row.suggestion ?? row['建议'] ?? '').trim()
      })
    }
  } else if (format === 'csv') {
    const rows = parseCsv(content)
    if (!rows.length) return []
    const header = rows[0].map((cell) => cell.trim())
    const hasHeader = header.some((cell) => /问题|建议|位置|严重/.test(cell))
    const columns = hasHeader ? header : ['位置', '严重度', '问题', '建议']
    for (const cells of rows.slice(hasHeader ? 1 : 0)) {
      const raw: Record<string, string> = {}
      columns.forEach((name, index) => { raw[name] = cells[index]?.trim() ?? '' })
      const issue = (raw['问题'] || raw.issue || '').trim()
      if (!issue) continue
      problems.push({
        position: (raw['位置'] || '外部评审').trim(),
        severity: severityOf(raw['严重度'] || raw.severity || 'medium'),
        issue,
        suggestion: (raw['建议'] || raw.suggestion || '').trim()
      })
    }
  } else {
    for (const line of normalizeText(content).split('\n')) {
      const text = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()
      if (!text) continue
      const suggestion = text.match(/(?:建议|修改)[：:]\s*(.+)$/)?.[1]?.trim() ?? ''
      const issue = text.replace(/(?:建议|修改)[：:]\s*.+$/, '').replace(/^(?:问题|意见)[：:]\s*/, '').trim()
      if (issue) problems.push({ position: '外部评审', severity: 'medium', issue, suggestion })
    }
  }
  if (!problems.length) return []
  return [{ title: `外部评审 · ${problems.length} 条问题`, reviewProblems: problems, warnings: [] }]
}

function parseVisualPlanContent(content: string): ParsedImportItem[] {
  const parsed = JSON.parse(content) as unknown
  const root = Array.isArray(parsed) ? parsed[0] : parsed
  if (!root || typeof root !== 'object') return []
  const record = root as Record<string, unknown>
  const payload = record.visualPlan && typeof record.visualPlan === 'object'
    ? record.visualPlan as Record<string, unknown>
    : record
  const cover = payload.cover && typeof payload.cover === 'object'
    ? payload.cover as VisualPack['cover']
    : { visual: '外部封面方案', prompt: String(payload.coverPrompt ?? ''), overlayText: String(payload.overlayText ?? '') }
  const inlineImages = Array.isArray(payload.inlineImages) ? payload.inlineImages as VisualPack['inlineImages'] : []
  const releaseImages = Array.isArray(payload.releaseImages) ? payload.releaseImages as VisualPack['releaseImages'] : []
  if (!cover.prompt && !inlineImages.length && !releaseImages.length) return []
  return [{
    title: '外部配图方案',
    visualPlan: { cover, inlineImages, releaseImages },
    warnings: inlineImages.length ? [] : ['方案没有文内图，仍可先保存封面']
  }]
}

function parsePublishFormContent(content: string): ParsedImportItem[] {
  const parsed = JSON.parse(content) as unknown
  const root = Array.isArray(parsed) ? parsed[0] : parsed
  if (!root || typeof root !== 'object') return []
  const record = root as Record<string, unknown>
  const fields = normalizeFields(record)
  delete fields.articleId
  delete fields.layoutId
  if (!fields.author && !fields.digest && !fields.contentSourceUrl) return []
  return [{ title: fields.title || '外部交付信息', fields, warnings: [] }]
}

/** 外部排版稿 HTML 消毒：保留结构与内联样式，移除脚本/事件/外链样式。 */
export function sanitizeLayoutHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|title|iframe|object|embed|form|meta|link|base)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|title|iframe|object|embed|form|meta|link|base)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim()
}

function textFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLayoutContent(content: string, format: ContentImportFormat): ParsedImportItem[] {
  let title = ''
  let html = content
  if (format === 'json') {
    const parsed = JSON.parse(content) as unknown
    const root = Array.isArray(parsed) ? parsed[0] : parsed
    if (!root || typeof root !== 'object') return []
    const record = root as Record<string, unknown>
    title = String(record.title ?? '').trim()
    html = String(record.html ?? record.content ?? '').trim()
  } else {
    title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ''
    if (!title) title = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
  }
  const sanitized = sanitizeLayoutHtml(html)
  const plainText = textFromHtml(sanitized)
  if (!plainText) return []
  if (!title) title = plainText.slice(0, 50)
  return [{
    title: title.slice(0, 120),
    layout: { title: title.slice(0, 120), html: sanitized, plainText },
    warnings: sanitized.length !== html.length ? ['已移除脚本/外链样式/事件属性'] : []
  }]
}

function parsePromptContent(content: string): ParsedImportItem[] {
  const parsed = JSON.parse(content) as unknown
  const roots = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { prompts?: unknown }).prompts)
      ? (parsed as { prompts: unknown[] }).prompts
      : [parsed]
  const items: ParsedImportItem[] = []
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    const record = root as Record<string, unknown>
    const key = String(record.key ?? record.id ?? '').trim()
    const text = String(record.content ?? record.prompt ?? record.template ?? '').trim()
    if (!key || !text) continue
    const binding = record.modelBinding
    if (binding !== undefined && binding !== null && (typeof binding !== 'object' || typeof (binding as Record<string,unknown>).providerId !== 'string' || typeof (binding as Record<string,unknown>).modelId !== 'string')) throw new Error('modelBinding 必须包含 providerId 和 modelId')
    items.push({
      title: String(record.title ?? key).trim(),
      prompt: { key, content: text, note: String(record.note ?? '外部导入').slice(0, 200), modelBinding: binding as import('../../shared/contracts.js').PromptModelBinding | null | undefined },
      warnings: []
    })
  }
  return items
}

export function detectPasteFormat(kind: ContentImportKind, content: string): ContentImportFormat {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (kind === 'visual-plan' || kind === 'publish-form' || kind === 'prompt') return 'json'
  if (kind === 'layout') return trimmed.startsWith('<') ? 'html' : 'json'
  if (kind === 'topic' || kind === 'hot-item' || kind === 'review') {
    const firstLines = trimmed.split('\n').slice(0, 2)
    if (firstLines.length === 2 && firstLines[0].includes(',') && firstLines[1].includes(',')) return 'csv'
  }
  return 'markdown'
}

function parseBatch(kind: ContentImportKind, format: ContentImportFormat, content: string, source: ContentImportSource): ParsedImportBatch {
  try {
    let items: ParsedImportItem[] = []
    if (kind === 'account') {
      items = parseAccountContent(content, format)
    } else if (kind === 'hot-item') {
      items = parseHotItemContent(content, format)
    } else if (kind === 'topic') {
      if (format === 'json') items = parseTopicJson(content)
      else if (format === 'csv') items = parseTopicCsv(content)
      else items = markdownTopicItems(content)
    } else if (kind === 'framework') {
      if (format === 'json') items = parseFrameworkJson(content)
      else items = parseFrameworkMarkdown(content)
    } else if (kind === 'article') {
      if (format === 'json') items = parseArticleJson(content)
      else items = parseArticleMarkdown(content)
    } else if (kind === 'review') {
      items = parseReviewContent(content, format)
    } else if (kind === 'visual-plan') {
      items = parseVisualPlanContent(content)
    } else if (kind === 'layout') {
      items = parseLayoutContent(content, format)
    } else if (kind === 'prompt') {
      items = parsePromptContent(content)
    } else {
      items = parsePublishFormContent(content)
    }
    const errors: string[] = []
    if (!items.length) errors.push(`没有解析到可导入的${KIND_LABEL[kind]}内容`)
    if (items.length > MAX_ITEMS) errors.push(`单次最多导入 ${MAX_ITEMS} 条，请拆分后再试`)
    return { kind, source, items: items.slice(0, MAX_ITEMS), errors, warnings: [] }
  } catch (error) {
    return {
      kind,
      source,
      items: [],
      errors: [`解析${KIND_LABEL[kind]}失败：${error instanceof Error ? error.message : '内容格式不正确'}`],
      warnings: []
    }
  }
}

export class ContentImportService {
  private previews = new Map<string, CachedPreview>()
  /** 只允许预览用户刚通过主进程文件框选中的路径，避免 renderer 借导入接口读任意文件。 */
  private pickedFiles = new Set<string>()

  constructor(private readonly database: AppDatabase) {}

  private cleanup(): void {
    const now = Date.now()
    for (const [token, preview] of this.previews) if (preview.expiresAt <= now) this.previews.delete(token)
  }

  async pickFile(kind: ContentImportKind): Promise<PickedImportFile | null> {
    const { dialog } = await import('electron')
    const extensions = Array.from(new Set(KIND_FORMATS[kind].flatMap((format) => {
      if (format === 'markdown') return ['md', 'markdown']
      if (format === 'text') return ['txt']
      if (format === 'json') return ['json']
      if (format === 'csv') return ['csv']
      if (format === 'docx') return ['docx']
      return ['html', 'htm']
    })))
    const result = await dialog.showOpenDialog({
      title: `选择要导入的${KIND_LABEL[kind]}`,
      properties: ['openFile'],
      filters: [{ name: `${KIND_LABEL[kind]}文件`, extensions }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = resolve(result.filePaths[0])
    const info = await stat(filePath)
    if (info.size > MAX_FILE_BYTES) throw new Error('文件超过 15MB 上限，请拆分后再导入')
    this.pickedFiles.add(filePath)
    return { path: filePath, name: basename(filePath), size: info.size, format: formatForFile(filePath) }
  }

  async preview(input: { kind: ContentImportKind; filePath?: string; content?: string; fileName?: string; format?: ContentImportFormat }): Promise<ContentImportPreview> {
    this.cleanup()
    if (!KIND_FORMATS[input.kind]) throw new Error('不支持的导入类型')
    let content: string
    let format: ContentImportFormat
    let fileName = input.fileName
    let fileBuffer: Buffer | undefined
    if (input.filePath) {
      const filePath = resolve(input.filePath)
      if (!this.pickedFiles.has(filePath)) throw new Error('请先通过「选择文件」按钮选择文件')
      const info = await stat(filePath)
      if (info.size > MAX_FILE_BYTES) throw new Error('文件超过 15MB 上限，请拆分后再导入')
      fileBuffer = await readFile(input.filePath)
      format = input.format ?? formatForFile(input.filePath)
      fileName = basename(input.filePath)
      if (format !== 'docx') content = fileBuffer.toString('utf8')
      else content = ''
    } else {
      content = input.content ?? ''
      format = input.format ?? detectPasteFormat(input.kind, content)
      fileName = fileName ?? (input.content ? '粘贴内容' : undefined)
    }
    let docxWarning = ''
    if (format === 'docx') {
      if (!fileBuffer) throw new Error('DOCX 只支持从文件导入')
      const result = await docxToMarkdown(fileBuffer)
      content = result.markdown
      if (result.messages) docxWarning = `DOCX 有 ${result.messages} 条排版提示已在转换时忽略`
    }
    // 排版稿需要保留 HTML 结构；其余 HTML 导入转 Markdown。
    if (format === 'html' && input.kind !== 'layout') content = htmlToMarkdown(content)
    content = normalizeText(content)
    if (!content) throw new Error('文件内容为空')
    if (content.length > MAX_CONTENT_CHARS) throw new Error('内容超过 100 万字符，请拆分后再导入')
    const source: ContentImportSource = {
      tool: input.filePath ? '文件导入' : '手动粘贴',
      format,
      fileName,
      importedAt: new Date().toISOString()
    }
    const batch = parseBatch(input.kind, format, content, source)
    if (docxWarning) batch.warnings.push(docxWarning)
    for (const item of batch.items) {
      if (!item.externalId) {
        item.externalId = createHash('sha256')
          .update(JSON.stringify(item.fields ?? item.sections ?? item.rawMarkdown ?? item.hotItem ?? item.reviewProblems ?? item.visualPlan ?? item.layout ?? item.prompt ?? item.title))
          .digest('hex').slice(0, 32)
      }
      if (VERSIONABLE.has(batch.kind)) {
        const existing = this.database.findArtifactImport(ARTIFACT_TYPE[batch.kind], item.externalId)
        if (existing) item.existing = existing
      }
    }
    const sourceFields = [...new Set(batch.items.flatMap((item) => Object.keys(item.fields ?? {})))]
    const token = randomUUID()
    this.previews.set(token, { batch, expiresAt: Date.now() + PREVIEW_TTL_MS })
    return {
      token,
      kind: batch.kind,
      source: batch.source,
      errors: batch.errors,
      warnings: batch.warnings,
      sourceFields,
      items: batch.items.map((item, index): ContentImportPreviewItem => ({
        index,
        title: item.title,
        fields: item.fields,
        sections: item.sections,
        rawMarkdown: item.rawMarkdown,
        hotItem: item.hotItem,
        reviewProblems: item.reviewProblems,
        visualPlan: item.visualPlan,
        layout: item.layout,
        existing: item.existing,
        externalId: item.externalId,
        warnings: item.warnings
      }))
    }
  }

  async commit(input: ContentImportCommitInput): Promise<ContentImportResult> {
    this.cleanup()
    const cached = this.previews.get(input.token)
    if (!cached) throw new Error('导入预览已过期，请重新选择文件')
    const { batch } = cached
    const associations = input.associations ?? {}
    if (associations.accountId && !this.database.getAccount(associations.accountId)) throw new Error('关联的账号不存在')
    if (associations.topicId && !this.database.getTopic(associations.topicId)) throw new Error('关联的选题不存在')
    if (associations.frameworkId && !this.database.getFramework(associations.frameworkId)) throw new Error('关联的框架不存在')
    if (associations.articleId && !this.database.getArticle(associations.articleId)) throw new Error('关联的文章不存在')
    if (associations.layoutId && !this.database.getArticleLayout(associations.layoutId)) throw new Error('关联的排版稿不存在')
    const mapping = input.mapping
    const mapFields = (fields: Record<string, string> | undefined): Record<string, string> => {
      if (!fields || !mapping) return fields ?? {}
      const next: Record<string, string> = {}
      for (const [source, value] of Object.entries(fields)) {
        const target = mapping[source]
        if (target === '' || target === '不导入') continue
        next[(target ?? source).trim() || source] = value
      }
      return next
    }
    const existingId = (item: ParsedImportItem): string | undefined => input.mode === 'new-version' ? item.existing?.artifactId : undefined
    const created: ContentImportResult['created'] = []
    const failed: ContentImportResult['failed'] = []
    for (const [index, item] of batch.items.entries()) {
      try {
        const contentHash = createHash('sha256').update(item.rawMarkdown ?? JSON.stringify(item.fields ?? item.sections ?? item.hotItem ?? item.reviewProblems ?? item.visualPlan ?? {})).digest('hex')
        if (batch.kind === 'account') {
          const fields = { ...mapFields(item.fields) }
          if (!fields['账号名称']) fields['账号名称'] = item.title
          const baseFields = createAccountFields(fields)
          const known = new Set(baseFields.map((field) => field.name))
          for (const [name, value] of Object.entries(fields)) {
            if (!known.has(name)) baseFields.push({ id: crypto.randomUUID(), name, value, isDefault: false, source: 'user' })
          }
          const saved = this.database.saveAccount({
            id: existingId(item),
            fields: baseFields,
            wizardAnswers: [],
            status: 'draft',
            source: 'manual'
          })
          this.database.recordArtifactImport({
            artifactType: 'account', artifactId: saved.id, versionId: saved.currentVersionId,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: saved.id, title: saved.name, versionId: saved.currentVersionId })
        } else if (batch.kind === 'hot-item') {
          if (!item.hotItem) throw new Error('没有可导入的热点')
          const result = this.database.addHotFavorite({
            hotItem: item.hotItem,
            accountId: associations.accountId,
            tags: ['待选题']
          })
          this.database.recordArtifactImport({
            artifactType: 'hot-favorite', artifactId: result.favorite.id,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: result.favorite.id, title: item.hotItem.title })
        } else if (batch.kind === 'topic') {
          const fields = { ...mapFields(item.fields) }
          if (!fields['选题主题']) fields['选题主题'] = item.title
          const saved = this.database.saveTopic({
            id: existingId(item),
            seedKeyword: (fields['选题主题'] || item.title).slice(0, 300),
            accountIds: associations.accountId ? [associations.accountId] : [],
            relatedHotIds: [],
            status: 'draft',
            source: 'manual',
            fields
          })
          this.database.recordArtifactImport({
            artifactType: 'topic', artifactId: saved.id, versionId: saved.currentVersionId,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: saved.id, title: item.title, versionId: saved.currentVersionId })
        } else if (batch.kind === 'framework') {
          const sections = item.sections ?? []
          if (!sections.length) throw new Error('没有可导入的章节')
          const saved = this.database.saveFramework({
            id: existingId(item),
            topicId: associations.topicId,
            accountId: associations.accountId,
            materialIds: [],
            manualTopic: item.title,
            status: 'draft',
            sections
          })
          this.database.recordArtifactImport({
            artifactType: 'framework', artifactId: saved.id, versionId: saved.currentVersionId,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: saved.id, title: item.title, versionId: saved.currentVersionId })
        } else if (batch.kind === 'article') {
          if (!item.rawMarkdown) throw new Error('没有可导入的正文')
          const saved = this.database.saveArticle({
            id: existingId(item),
            frameworkId: associations.frameworkId,
            accountId: associations.accountId,
            materialIds: [],
            manualOutline: '',
            status: 'draft',
            rawMarkdown: item.rawMarkdown,
            source: 'manual'
          })
          this.database.recordArtifactImport({
            artifactType: 'article', artifactId: saved.id, versionId: saved.currentVersionId,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: saved.id, title: item.title, versionId: saved.currentVersionId })
        } else if (batch.kind === 'review') {
          if (!associations.articleId) throw new Error('导入评审前请先选择一篇文章')
          const article = this.database.getArticle(associations.articleId)
          if (!article) throw new Error('目标文章不存在')
          const problems = item.reviewProblems ?? []
          if (!problems.length) throw new Error('没有可导入的评审问题')
          const task = this.database.createReviewTask({
            articleId: article.id,
            articleVersionId: article.currentVersionId,
            articleVersionNumber: article.versionCount,
            roleIds: []
          })
          this.database.addReviewOpinion({
            taskId: task.id,
            roleName: '外部评审',
            dimensions: [],
            overallSuggestion: '',
            rawXml: '',
            extractionMatched: true,
            problems: problems.map((problem) => ({
              position: problem.position,
              severity: problem.severity,
              issue: problem.issue,
              suggestion: problem.suggestion,
              adopted: false,
              isManual: true
            }))
          })
          this.database.finishReviewTask(task.id, 'completed', [])
          this.database.recordArtifactImport({
            artifactType: 'review-task', artifactId: task.id,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: task.id, title: item.title })
        } else if (batch.kind === 'visual-plan') {
          if (!associations.articleId) throw new Error('导入配图方案前请先选择一篇文章')
          if (!item.visualPlan) throw new Error('没有可导入的配图方案')
          const visualPlan = item.visualPlan
          const article = this.database.getArticle(associations.articleId)
          if (!article) throw new Error('目标文章不存在')
          const studioPictures: PictureBrief[] = []
          if (associations.visualStudio) {
            this.database.workflow.assertSaved(article.id)
            const blocks = articleBlocks(article.rawMarkdown)
            const source = item.visualPlan
            const add = (kind: PictureBrief['kind'], visual: { prompt: string; ratio?: string; location?: string; purpose?: string; alt?: string; visual?: string; overlayText?: string }): void => {
              if (typeof visual.prompt !== 'string' || visual.prompt.length > 6000) throw new Error('每张图需要有效提示词，最多6000字')
              const ratio = visual.ratio || (kind === 'cover' ? '21:9' : '16:9')
              if (!['21:9','16:9','4:3','3:4','1:1'].includes(ratio)) throw new Error(`当前工作台不支持比例 ${ratio}，请修改比例或从“原有方案与图片”导入`)
              const location = visual.location?.trim() || ''
              const matches = blocks.filter(block => block.text === location && !/```|~~~/.test(block.text))
              const block = matches.length === 1 ? matches[0] : undefined
              const subject = (visual.visual || visual.purpose || location || (kind === 'cover' ? '外部封面' : '外部配图')).slice(0,2000)
              studioPictures.push({id:randomUUID(),kind,slot:studioPictures.length,subject,purpose:(visual.purpose||'外部导入，待人工确认').slice(0,1500),ratio,alt:(visual.alt||'').slice(0,500),caption:(visual.overlayText||'').slice(0,500),priority:kind==='cover'?'required':'optional',prompt:visual.prompt,promptLocked:Boolean(visual.prompt.trim()),promptStale:!visual.prompt.trim(),anchor:kind==='cover'?{block:'',occurrence:0,placement:'top'}:{versionId:article.currentVersionId,block:block?.text||`未确认外部位置：${location || subject}`,occurrence:block?.occurrence||0,placement:'after'}})
            }
            if (source.cover.prompt?.trim()) add('cover',source.cover)
            source.inlineImages.forEach(image=>add('inline',image))
            source.releaseImages.forEach(image=>add('release',image))
            if (!studioPictures.length || studioPictures.length > 12) throw new Error('工作台方案需包含1至12张图片')
          }
          const saved = this.database.atomic(() => {
            const pack = this.database.saveVisualPack({
              kind: 'manual',
              articleId: article.id,
              articleVersionId: article.currentVersionId,
              articleStatusSnapshot: article.status,
              cover: visualPlan.cover,
              inlineImages: visualPlan.inlineImages,
              releaseImages: visualPlan.releaseImages,
              rawXml: associations.visualStudio ? '<visual-studio/>' : ''
            })
            if (associations.visualStudio) this.database.visualStudio.create({id:pack.id,articleId:article.id,articleVersionId:article.currentVersionId,sourceMarkdown:article.rawMarkdown,revision:1,nextSlot:studioPictures.length,title:article.rawMarkdown.match(/^#\s+(.+)$/m)?.[1] || item.title,reasoning:'外部导入方案。提示词已保留；未精确匹配的正文插图位置需要人工确认后才能应用。',pictures:studioPictures,promptsStale:studioPictures.some(p=>p.promptStale),createdAt:new Date().toISOString()})
            return pack
          })
          this.database.recordArtifactImport({
            artifactType: 'visual-pack', artifactId: saved.id, versionId: saved.articleVersionId,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: saved.id, title: item.title, versionId: saved.articleVersionId })
        } else if (batch.kind === 'layout') {
          if (!associations.articleId) throw new Error('导入排版稿前请先选择一篇文章')
          if (!item.layout) throw new Error('没有可导入的排版稿')
          const article = this.database.getArticle(associations.articleId)
          if (!article) throw new Error('目标文章不存在')
          const saved = this.database.saveArticleLayout({
            articleId: article.id,
            articleVersionId: article.currentVersionId,
            articleStatusSnapshot: article.status,
            platform: 'wechat',
            title: item.layout.title,
            html: item.layout.html,
            plainText: item.layout.plainText,
            themeId: undefined
          })
          this.database.recordArtifactImport({
            artifactType: 'layout', artifactId: saved.id, versionId: article.currentVersionId,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: saved.id, title: item.title, versionId: article.currentVersionId })
        } else if (batch.kind === 'prompt') {
          if (!item.prompt) throw new Error('没有可导入的提示词')
          const defs = this.database.listPromptDefs()
          if (!defs.some((def) => def.key === item.prompt?.key)) throw new Error(`提示词 ${item.prompt.key} 不存在，请先在页面中创建对应定义`)
          const version = this.database.updatePrompt(item.prompt.key, item.prompt.content, item.prompt.note, item.prompt.modelBinding)
          this.database.recordArtifactImport({
            artifactType: 'prompt', artifactId: item.prompt.key,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: item.prompt.key, title: `${item.prompt.key} · v${version}` })
        } else {
          if (!associations.articleId || !associations.layoutId) throw new Error('导入交付信息前请先选择文章和排版稿')
          const article = this.database.getArticle(associations.articleId)
          const layout = this.database.getArticleLayout(associations.layoutId)
          if (!article || !layout || layout.articleId !== article.id) throw new Error('排版稿不属于当前文章')
          const fields = mapFields(item.fields)
          const form: PublishFormDraft = {
            articleId: article.id,
            layoutId: layout.id,
            appId: fields.appId || this.database.getWechatPublishChannel().appId,
            coverAssetId: fields.coverAssetId || '',
            thumbMediaId: fields.thumbMediaId || '',
            author: fields.author || '',
            digest: fields.digest || '',
            contentSourceUrl: fields.contentSourceUrl || '',
            importSource: batch.source
          }
          this.database.workflow.saveForm(form)
          this.database.recordArtifactImport({
            artifactType: 'publish-form', artifactId: article.id,
            tool: batch.source.tool, format: batch.source.format, fileName: batch.source.fileName, externalId: item.externalId,
            contentHash, source: { title: item.title }
          })
          created.push({ id: article.id, title: layout.title })
        }
      } catch (error) {
        failed.push({ index, message: error instanceof Error ? error.message : '导入失败' })
      }
    }
    this.previews.delete(input.token)
    return { created, failed, source: batch.source }
  }

  async export(input: { kind: ContentImportKind; format: 'json' | 'markdown'; ids?: string[] }): Promise<LocalFileResult> {
    const ids = input.ids ? new Set(input.ids) : undefined
    let fileName: string
    let content: string
    if (input.kind === 'topic') {
      const topics = this.database.listTopics().filter((topic) => !ids || ids.has(topic.id))
      if (!topics.length) throw new Error('没有可导出的选题')
      fileName = '心流选题'
      content = input.format === 'json'
        ? JSON.stringify({ schemaVersion: 1, kind: 'topic', exportedAt: new Date().toISOString(), topics: topics.map((topic) => ({ id: topic.id, title: topic.fields['选题主题'] || topic.seedKeyword, seedKeyword: topic.seedKeyword, status: topic.status, fields: topic.fields })) }, null, 2)
        : topics.map((topic) => `- ${topic.fields['选题主题'] || topic.seedKeyword}${topic.fields['核心观点'] ? `：${topic.fields['核心观点']}` : ''}`).join('\n')
    } else if (input.kind === 'framework') {
      const frameworks = this.database.listFrameworks().filter((framework) => !ids || ids.has(framework.id))
      if (!frameworks.length) throw new Error('没有可导出的框架')
      fileName = '心流框架'
      content = input.format === 'json'
        ? JSON.stringify({ schemaVersion: 1, kind: 'framework', exportedAt: new Date().toISOString(), frameworks: frameworks.map((framework) => ({ id: framework.id, title: framework.manualTopic, sections: framework.sections })) }, null, 2)
        : frameworks.map((framework) => `# ${framework.manualTopic}\n\n${framework.sections.map((section) => `## ${section.name}\n\n${section.content}`).join('\n\n')}`).join('\n\n---\n\n')
    } else if (input.kind === 'article') {
      const articles = this.database.listArticles().filter((article) => !ids || ids.has(article.id))
      if (!articles.length) throw new Error('没有可导出的文章')
      fileName = '心流文章'
      content = input.format === 'json'
        ? JSON.stringify({ schemaVersion: 1, kind: 'article', exportedAt: new Date().toISOString(), articles: articles.map((article) => ({ id: article.id, title: article.rawMarkdown.match(/^#\s+(.+)$/m)?.[1] ?? '未命名文章', markdown: article.rawMarkdown })) }, null, 2)
        : articles.map((article) => article.rawMarkdown).join('\n\n---\n\n')
    } else if (input.kind === 'prompt') {
      const defs = this.database.listPromptDefs().filter((def) => !ids || ids.has(def.key))
      if (!defs.length) throw new Error('没有可导出的提示词')
      fileName = '心流提示词'
      content = JSON.stringify({ schemaVersion: 1, kind: 'prompt', exportedAt: new Date().toISOString(), prompts: defs.map((def) => ({ key: def.key, title: def.title, content: def.activeContent, version: def.activeVersion, modelBinding: def.modelBinding })) }, null, 2)
    } else {
      throw new Error(`暂不支持导出${KIND_LABEL[input.kind]}`)
    }
    const { dialog } = await import('electron')
    const result = await dialog.showSaveDialog({
      title: `导出${KIND_LABEL[input.kind]}`,
      defaultPath: `${fileName}.${input.format === 'json' ? 'json' : 'md'}`,
      filters: [{ name: input.format === 'json' ? 'JSON' : 'Markdown', extensions: [input.format === 'json' ? 'json' : 'md'] }]
    })
    if (result.canceled || !result.filePath) return { path: null }
    await writeFile(result.filePath, content, 'utf8')
    return { path: result.filePath }
  }
}
