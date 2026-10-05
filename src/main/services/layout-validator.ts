/**
 * 微信排版合规校验器。
 *
 * 为什么要独立成文件：微信平台的限制是"死规则"（官方不会提前通知），
 * 过去散落在 juice 配置与各处正则里，没有任何一处能回答"这份排版稿发出去会不会丢格式"。
 * 把它们收敛成可执行断言后，改主题、改组件时能立刻知道是否引入了违规写法，
 * 不必等发到微信后才发现。
 *
 * 规则依据（均为官方答复或多个独立实战来源交叉验证）：
 *   1. 标签白名单约 37 个，<div> / <script> 不在其中
 *   2. 强制移除非内联属性：class / id
 *   3. 过滤 position:fixed|absolute|sticky、float、display:grid、@media、@keyframes
 *   4. 样式必须内联，<style> 标签会被剔除
 *   5. 正文文字需被 <span leaf=""> 包裹
 *   6. content 里的图片 url 必须是微信图床（mmbiz.qpic.cn），外链被过滤
 *   7. draft/add 字段长度限制：title ≤32 字、digest ≤128 字、content ≤20000 字符
 */

/**
 * 复用共享契约里的类型，保证主进程与渲染层对同一份结构达成一致。
 * 这里重新导出是为了让调用方（article-layout-service / wechat-publish-service）
 * 只需从本模块导入即可。
 */
export type { LayoutViolation } from '../../shared/contracts.js'
import type { LayoutViolation } from '../../shared/contracts.js'

export interface ValidateLayoutInput {
  html: string
  title: string
  digest?: string
}

/** 微信正文明确会过滤的标签 */
const FORBIDDEN_TAGS = ['div', 'script', 'style', 'iframe', 'object', 'embed', 'form', 'input'] as const

/** 微信会过滤的 CSS 声明。命中即可能整块样式失效 */
const FORBIDDEN_CSS = [
  { pattern: /position\s*:\s*(fixed|absolute|sticky)/i, name: 'position:fixed/absolute/sticky' },
  { pattern: /display\s*:\s*grid/i, name: 'display:grid' },
  { pattern: /float\s*:\s*(left|right)/i, name: 'float' },
  { pattern: /@media/i, name: '@media' },
  { pattern: /@keyframes/i, name: '@keyframes' }
] as const

/** 微信图床域名。正文图片必须在此域名下，否则被过滤 */
const WECHAT_CDN = /mmbiz\.qpic\.cn/i

/**
 * 微信强制给图片加 width:100%，小图会被拉伸变形。
 * 必须逐条声明判断而不能用子串匹配：max-width:100% 是正确写法，
 * 直接搜"width:100%" 会把它一起误伤。
 */
function hasFixedWidthImage(html: string): boolean {
  return html.match(/<img[^>]*>/gi)?.some((tag) => {
    const style = tag.match(/\bstyle="([^"]*)"/i)?.[1] ?? ''
    return style
      .split(';')
      // 每条声明去掉首尾空白与property 名，只看值是否恰为 100%
      .some((decl) => /^\s*width\s*:\s*100\s*%\s*$/i.test(decl))
  }) ?? false
}

export function validateWechatLayout(input: ValidateLayoutInput): LayoutViolation[] {
  const { html, title, digest } = input
  const out: LayoutViolation[] = []
  const add = (level: LayoutViolation['level'], rule: string, message: string, hint?: string) =>
    out.push({ level, rule, message, hint })

  // ── 标签白名单 ──
  for (const tag of FORBIDDEN_TAGS) {
    // 用 new RegExp 而非模板字面量：需要拼接变量，同时避免转义歧义
    if (new RegExp('<' + tag + '[\\s>]', 'i').test(html)) {
      add('error', `forbidden-tag:${tag}`,
        `含<${tag}> 标签，微信会直接过滤`,
        tag === 'style' ? '样式必须内联，交给 juice 处理' : `改用 <section> / <span> 替代 <${tag}>`)
    }
  }

  // ── 非内联属性 ──
  const classMatch = html.match(/\sclass="[^"]*"/i)
  if (classMatch) {
    add('warn', 'non-inline-attr:class',
      '含 class 属性，微信会强制移除',
      '样式已内联，class 无作用；可从产物中剥除以减小体积')
  }
  if (/\sid="[^"]*"/i.test(html)) {
    add('warn', 'non-inline-attr:id', '含 id 属性，微信会强制移除', '锚点功能在微信正文不可用')
  }

  // ── CSS 声明 ──
  for (const rule of FORBIDDEN_CSS) {
    if (rule.pattern.test(html)) {
      add('error', `forbidden-css:${rule.name}`,
        `含 ${rule.name}，微信会过滤该声明`,
        '布局改用 flex 或 table 属性，微信对这两者支持较好')
    }
  }
  if (html.includes('white-space:pre')) {
    add('error', 'forbidden-css:white-space-pre',
      'white-space:pre 会渲染出大段空白',
      '代码块改为每行一个 <p style="margin:0">，缩进用全角空格')
  }

  // ── span leaf 包裹 ──
  // 只在有可见文字时提示；纯图/纯分割线场景不强求
  const hasVisibleText = />[^<>]*[\u4e00-\u9fa5a-zA-Z0-9][^<>]*</.test(html)
  if (hasVisibleText && !/<span leaf="">/.test(html)) {
    add('warn', 'span-leaf-missing',
      '文字未被 <span leaf=""> 包裹，部分客户端会丢失继承样式',
      '调用 finalizeWechatHtml 的 wrapTextNodes 处理')
  }

  // ── 图片 ──
  const imgTags = html.match(/<img[^>]*>/gi) ?? []
  for (const tag of imgTags) {
    const src = tag.match(/\bsrc="([^"]*)"/i)?.[1] ?? ''
    // 占位与本机协议在生成阶段正常，推送阶段会被替换为微信图床，故仅在明显外链时报错
    if (/^https?:\/\//i.test(src) && !WECHAT_CDN.test(src)) {
      add('error', 'image-not-wechat-cdn',
        `图片域名非微信图床，微信会过滤：${truncate(src, 48)}`,
        '推送前需调用 media/uploadimg 上传并替换为 mmbiz.qpic.cn 地址')
    }
  }
  if (hasFixedWidthImage(html)) {
    add('warn', 'image-fixed-width',
      '图片被设为 width:100%，小图会被拉伸变形',
      '改用 max-width:100%;height:auto')
  }

  // ── 字段长度（draft/add 服务端硬限制，超限会返回错误码）──
  if (!title.trim()) {
    add('error', 'title-empty', '标题为空，微信不接受空标题')
  } else if (title.length > 32) {
    add('error', 'title-too-long',
      `标题 ${title.length} 字，超出上限 32 字`,
      '缩短标题，或用副标题承载补充信息')
  }
  if (digest && digest.length > 128) {
    add('error', 'digest-too-long',
      `摘要 ${digest.length} 字，超出上限 128 字`, '缩短摘要')
  }
  if (html.length > 20_000) {
    add('error', 'content-too-long',
      `正文 ${html.length} 字符，超出上限 20000 字符`,
      '拆分文章，或精简正文')
  }

  return out
}

/** 便捷判断：是否存在必须处理的错误 */
export function hasBlockingViolation(violations: LayoutViolation[]): boolean {
  return violations.some((violation) => violation.level === 'error')
}

/** 格式化为一行摘要，便于在 toast / 日志里直接展示 */
export function formatViolations(violations: LayoutViolation[]): string {
  if (!violations.length) return '排版稿符合微信平台要求'
  const errors = violations.filter((violation) => violation.level === 'error')
  const warns = violations.filter((violation) => violation.level === 'warn')
  const parts: string[] = []
  if (errors.length) parts.push(`${errors.length} 个问题：${errors.map((violation) => violation.message).join('；')}`)
  if (warns.length) parts.push(`${warns.length} 个提醒：${warns.map((violation) => violation.message).join('；')}`)
  return parts.join('。')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
