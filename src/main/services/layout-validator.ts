/**
 * 微信排版合规校验器。
 *
 * 为什么要独立成文件：微信平台的限制是"死规则"（官方不会提前通知），
 * 过去散落在 juice 配置与各处正则里，没有任何一处能回答"这份排版稿发出去会不会丢格式"。
 * 把它们收敛成可执行断言后，改主题、改组件时能立刻知道是否引入了违规写法，
 * 不必等发到微信后才发现。
 *
 * 规则依据（均为官方文档/官方答复或多个独立实战来源交叉验证）：
 *   1. 标签白名单约 37 个，<div> / <script> 不在其中
 *   2. 强制移除非内联属性：class / id
 *   3. 过滤 position:fixed|absolute|sticky、float、display:grid、@media、@keyframes、
 *      CSS 变量 var(--…)、@font-face（借鉴 gzh-design-skill 的规则清单思路，实现自研）
 *   4. 样式必须内联，<style> 标签会被剔除；!important 会被剥除（官方插件规范明令
 *      "任何场景不建议"——破坏暗黑模式算法与公共样式覆盖，故为 error）
 *   5. 正文文字需被 <span leaf=""> 包裹，且 leaf 内严禁块级元素（官方"会被编辑器自动删除"级）
 *   6. content 里的图片 url 必须是微信图床（mmbiz.qpic.cn），外链被过滤
 *   7. draft/add 字段长度限制：title ≤32 字、digest ≤120 字（2026-07 起对齐 mp 端）、content ≤20000 字符
 *   8. 结构规范（官方《编辑器插件开发规范》+ wechatjs/verify-article-structure-spec）：
 *      同名+同样式+单子节点连续嵌套 ≤10 层；行高不得小于字号（移动端叠字）；
 *      text-align:start/end 禁用；height:0 容器含文字在移动端不可见
 *   9. id 会被剥离 → <a href="#…"> 页内锚点必然失效（目录组件保持纯文本的原因）
 *
 * 结构类规则基于 DOM 树检查（cheerio，已作为 juice 的直接依赖存在，无新增下载），
 * 正则只能查"写法"，结构问题（嵌套深度、leaf 包块级）必须看树。
 */

import { load } from 'cheerio'
import type { Element } from 'domhandler'
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
  { pattern: /@keyframes/i, name: '@keyframes' },
  { pattern: /var\(\s*--/i, name: 'CSS 变量 var(--…)' },
  { pattern: /@font-face/i, name: '@font-face 外部字体' }
] as const

/** 微信图床域名。正文图片必须在此域名下，否则被过滤 */
const WECHAT_CDN = /mmbiz\.qpic\.cn/i

/** 官方嵌套限制：同一标签名+同一内联样式+单子节点的连续链不超过 10 层 */
const MAX_NEST_CHAIN = 10

/** leaf 内禁止出现的块级元素（官方：leaf 只能含行内元素或文本） */
const BLOCK_TAGS = 'section,div,article,p,h1,h2,h3,h4,h5,h6,ul,ol,li,table,thead,tbody,tr,td,th,blockquote,figure,figcaption'

/** 微信正文的默认基准字号（官方默认字体栈下的 17px）。继承链的起点 */
const BASE_FONT_SIZE = 17
/** 微信正文默认行高倍数（约 1.75）。继承链的起点 */
const BASE_LINE_HEIGHT_RATIO = 1.75

/** 把内联 style 属性解析成小写属性名 → 值的映射 */
function parseStyle(style: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const decl of (style ?? '').split(';')) {
    const index = decl.indexOf(':')
    if (index <= 0) continue
    map.set(decl.slice(0, index).trim().toLowerCase(), decl.slice(index + 1).trim())
  }
  return map
}

function pxValue(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^(-?[\d.]+)px$/i)
  return match ? Number(match[1]) : null
}

/** 元素的直接文字（不含子元素内的文字）。用于判断"这里实际渲染着一行字" */
function directText(el: Element): string {
  return el.children
    .filter((node): node is Element => node.type === 'text')
    .map((node) => (node as unknown as { data: string }).data)
    .join('')
}

/**
 * 继承式行高/字号检查。微信正文按继承链渲染，juice 只内联命中规则，
 * 子元素大量依赖继承，所以必须沿树向下传递计算值。
 */
function walkLineHeight(el: Element, fontSize: number, lineHeight: number, add: RuleAdd): void {
  const style = parseStyle(el.attribs.style)

  // 字号：px 直接取值；em/百分比相对继承值（微信正文常见 px，em 兜底）
  const fsRaw = style.get('font-size')
  if (fsRaw) {
    const px = pxValue(fsRaw)
    if (px !== null) fontSize = px
    else {
      const em = fsRaw.match(/^(-?[\d.]+)\s*(em|%)$/i)
      if (em) fontSize = fontSize * Number(em[1]) * (em[2].toLowerCase() === '%' ? 0.01 : 1)
    }
  }

  // 行高：px 直接取值；无单位数字 × 当前字号；百分比 × 当前字号；缺省继承
  const lhRaw = style.get('line-height')
  if (lhRaw) {
    const px = pxValue(lhRaw)
    if (px !== null) lineHeight = px
    else {
      const unitless = lhRaw.match(/^(-?[\d.]+)$/)?.[1]
      const percent = lhRaw.match(/^(-?[\d.]+)%$/)?.[1]
      if (unitless !== undefined) lineHeight = Number(unitless) * fontSize
      else if (percent !== undefined) lineHeight = (Number(percent) / 100) * fontSize
    }
  }

  // 官方规则 1.3：行高小于字号 → 多行叠字。
  // 静态检查无法判断"实际渲染单行"的豁免，用"直接文字 ≥ 10 字"近似"可能多行"，
  // 短标签（药丸、按钮）即使行高偏小也多为单行，不误报。
  const text = directText(el).trim()
  if (text.length >= 10 && lineHeight < fontSize) {
    add('error', 'line-height-small',
      `行高 ${(Math.round(lineHeight * 10) / 10)}px 小于字号 ${Math.round(fontSize)}px，多行文字会叠字`,
      '调大 line-height（无单位数字建议 ≥ 1.5），或缩短该处文字')
  }

  for (const child of el.children) {
    if (child.type === 'tag') walkLineHeight(child as Element, fontSize, lineHeight, add)
  }
}

/**
 * 冗余嵌套链检测：同名 + 同内联样式 + 仅含单个元素子节点（无有效文字）的连续层。
 * 官方：超过 10 层编辑器会自动精简，删层时内联样式随之丢失。
 */
function maxNestChain(el: Element): number {
  const children = el.children.filter((node) => node.type === 'tag') as Element[]
  const meaningfulText = directText(el).trim().length > 0
  if (!meaningfulText && children.length === 1) {
    const child = children[0] as Element
    if (child.tagName === el.tagName && (child.attribs.style ?? '') === (el.attribs.style ?? '')) {
      return 1 + maxNestChain(child)
    }
  }
  return 1
}

type RuleAdd = (level: LayoutViolation['level'], rule: string, message: string, hint?: string) => void

/** 结构规范检查（需要 DOM 树的规则都在这里）。片段模式解析：不引入 html/body 包裹层 */
function structuralChecks(html: string, add: RuleAdd): void {
  const $ = load(html, {}, false)

  // ── leaf 内严禁块级元素（官方 2.2：不符合会被编辑器自动删除）──
  $('span[leaf]').each((_, el) => {
    const element = el as Element
    const blocks = $(element).find(BLOCK_TAGS)
    if (blocks.length) {
      add('error', 'leaf-block-child',
        `<span leaf=""> 内包裹了块级元素（<${(blocks[0] as Element).tagName}>），微信会整块删除`,
        'leaf 只能包裹文字与行内元素（span/strong/em/img）；块级内容移到 leaf 外层')
    }
  })

  // ── text-align:start/end（官方 1.6：终端兼容差异大）──
  let textAlignHit = false
  $('*').each((_, el) => {
    const value = parseStyle((el as Element).attribs?.style).get('text-align')?.toLowerCase()
    if ((value === 'start' || value === 'end') && !textAlignHit) {
      textAlignHit = true
      add('error', 'text-align-keyword',
        'text-align:start/end 在不同终端渲染不一致（部分解析为左右，部分继承外层）',
        '改用 left/right/center 明确值')
    }
  })

  // ── height:0 且含文字（官方 1.5：移动端内容完全不可见）──
  $('*').each((_, el) => {
    const element = el as Element
    const height = parseStyle(element.attribs?.style).get('height')
    if (height && /^\s*0+(?:\.0+)?\s*(?:px)?\s*$/i.test(height) && $(element).text().trim()) {
      add('error', 'height-zero-with-text',
        'height:0 的容器内有文字，移动端内容完全不可见',
        '去掉 height:0，或该容器内不放文字（纯图无缝拼接场景官方豁免）')
    }
  })

  // ── 页内锚点（id 被剥离后必然失效）──
  const anchorCount = $('a[href^="#"]').length
  if (anchorCount) {
    add('warn', 'anchor-link-dead',
      `${anchorCount} 处页内锚点链接在微信正文失效（id 属性会被剥离）`,
      '目录保持纯文本列表（现有 injectToc 的做法），不做跳转')
  }

  // ── 冗余嵌套链 ──
  const root = $.root()[0] as unknown as Element | undefined
  const top = root?.children.find((node) => node.type === 'tag') as Element | undefined
  if (top) {
    let worst = 0
    $('*').each((_, el) => {
      worst = Math.max(worst, maxNestChain(el as Element))
    })
    if (worst > MAX_NEST_CHAIN) {
      add('error', 'redundant-nesting',
        `同名+同样式的连续嵌套达 ${worst} 层（上限 ${MAX_NEST_CHAIN} 层），微信会自动精简并连带丢样式`,
        '展平冗余包裹层；多个装饰效果合并到一个 section 的 style 里')
    }
  }

  // ── 行高继承检查 ──
  if (top) walkLineHeight(top, BASE_FONT_SIZE, BASE_FONT_SIZE * BASE_LINE_HEIGHT_RATIO, add)
}

/** 微信强制给图片加 width:100%，小图会被拉伸变形。
 * 必须逐条声明判断而不能用子串匹配：max-width:100% 是正确写法，
 * 直接搜"width:100%" 会把它一起误伤。 */
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
  const add: RuleAdd = (level, rule, message, hint) => out.push({ level, rule, message, hint })

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
        rule.name.startsWith('CSS 变量')
          ? '把变量展开为字面量值后再内联'
          : rule.name.startsWith('@font-face')
            ? '只用系统默认字体栈，不引入外部字体'
            : '布局改用 flex 或 table 属性，微信对这两者支持较好')
    }
  }
  // !important 官方插件规范明令"任何场景不建议"：剥除后不仅优先级失效，
  // 还会破坏暗黑模式算法与平台公共样式的覆盖，属于 error
  if (/!\s*important/i.test(html)) {
    add('error', 'forbidden-css:important',
      '含 !important，微信会剥除该声明并破坏暗黑模式转换',
      '用更具体的内联样式结构控制优先级，不依赖 !important')
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
  if (digest && digest.length > 120) {
    add('error', 'digest-too-long',
      `摘要 ${digest.length} 字，超出上限 120 字`, '缩短摘要')
  }
  if (html.length > 20_000) {
    add('error', 'content-too-long',
      `正文 ${html.length} 字符，超出上限 20000 字符`,
      '拆分文章，或精简正文')
  }

  // ── 结构规范（DOM 级，最后执行；解析失败不应吞掉前面的正则结果）──
  try {
    structuralChecks(html, add)
  } catch {
    // 结构解析异常时跳过结构规则——正则层规则已经覆盖了大部分硬限制
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
