import DOMPurify from 'dompurify'

// P2-7: 缓存 Intl.DateTimeFormat 实例并指定 timeZone，避免每次调用新建 + 跨时区不一致
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

const secondDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value))
}

/** 同名作品要靠时间分辨时用这一份（精确到秒） */
export function formatTimedDate(value: string): string {
  return secondDateFormatter.format(new Date(value))
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
//
// 注意：section 与 leaf 属性是「预览保真」的必要条件。
// 排版产物的组件容器用 <section>（微信过滤 div，但 section 可用），
// 文字用 <span leaf=""> 包裹（微信正文渲染依赖）。
// 若白名单缺这两项，预览会比实际发布结果「少东西」——
// 那比不预览更糟：用户以为预览就是最终效果。
const sanitizeConfig = {
  ALLOWED_TAGS: [
    'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'blockquote', 'br', 'hr',
    'ul', 'ol', 'li',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark',
    'a', 'img',
    'pre', 'code',
    // 组件容器与参考链接区都靠 section 承载
    'section',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'target', 'rel', 'leaf'],
  ALLOW_DATA_ATTR: false
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, sanitizeConfig) as unknown as string
}

/** 从 Markdown 原文中提取一级标题作为展示标题 */
export function markdownTitle(markdown: string, fallback = '未命名文章'): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || markdown.split('\n').find(Boolean)?.slice(0, 70) || fallback
}
