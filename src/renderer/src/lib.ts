import DOMPurify from 'dompurify'

// P2-7: 缓存 Intl.DateTimeFormat 实例并指定 timeZone，避免每次调用新建 + 跨时区不一致
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value))
}

export function formatFullDate(value: string): string {
  return fullDateFormatter.format(new Date(value))
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '')
}

// P0-2: 校验外链 URL 协议白名单，防止 javascript:/data: 等协议注入
export function isSafeUrl(value: string | undefined | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// P0-1: HTML 白名单 sanitize，仅允许排版用到的标签与 inline style
const sanitizeConfig = {
  ALLOWED_TAGS: [
    'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'blockquote', 'br', 'hr',
    'ul', 'ol', 'li',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark',
    'a', 'img',
    'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'target', 'rel'],
  ALLOW_DATA_ATTR: false
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, sanitizeConfig) as unknown as string
}
