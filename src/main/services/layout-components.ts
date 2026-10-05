/**
 * 版式组件：把 Markdown 语法映射为适合公众号的版式块。
 *
 * 设计原则（三条，都是从踩坑里总结的）：
 *
 * 1. **语法要 AI 可确定性生成**。不用需要嵌套或参数的复杂语法，
 *    避免模型写出半个语法导致渲染失败。
 *
 * 2. **降级友好**。组件解析失败时必须退回基础 Markdown 渲染，
 *    而不是抛错——一篇文章因为一个符号渲染不出来是灾难。
 *
 * 3. **不用虚线框做强调**。四周虚线框笨重抢戏，只留给"待补素材"占位。
 *    强调一律用左竖条或药丸标签。
 *
 * 实现说明：用「占位段落」而非自定义 HTML 标签。
 * markdown-it 配置了 html:false，自定义标签会被转义成文本；
 * 而段落占位（带唯一 id 的 <p>）走的是正常渲染路径，替换时按 id 精确回填。
 *
 * 语法约定：
 *   ::: tip 提示内容      → 提示块（tip / warn / key / note）
 *   ::: lead 引言内容      → 引言卡
 *   [[toc]]              → 目录（按二三级标题自动生成）
 *   ---（独立成段）      → 装饰分割线
 */

/** 组件语法说明。展示给用户，让"能用什么"是可发现的 */
export const LAYOUT_COMPONENT_SYNTAX: Array<{ syntax: string; result: string }> = [
  { syntax: '::: lead 引言内容', result: '引言卡（开篇核心判断）' },
  { syntax: '::: tip 提示内容', result: '提示块，标签为「提示」' },
  { syntax: '::: warn 注意内容', result: '提示块，标签为「注意」' },
  { syntax: '::: key 重点内容', result: '提示块，标签为「重点」' },
  { syntax: '[[toc]]', result: '目录（自动汇总二三级标题）' },
  { syntax: '---', result: '装饰分割线' }
]

const CALLOUT_LABELS: Record<string, string> = {
  tip: '提示',
  warn: '注意',
  key: '重点',
  note: '旁注'
}

/** 占位段落的前缀。用 improbable 字符串避免与用户内容冲突 */
const SLOT_PREFIX = 'mly-slot-'

/**
 * 预处理Markdown：把组件语法转成占位段落。
 *
 * 用逐行扫描而非正则：多行块的正则容易因非贪婪匹配产生歧义，
 * 而组件语法是「开标签行 → 内容若干行 →闭标签行」的结构，扫描更直观也更好维护。
 *
 * @returns 转换后的 Markdown 与需要回填的组件内容
 */
export function transformComponents(markdown: string): {
  markdown: string
  slots: Map<string, { kind: 'lead' | 'callout'; label?: string; body: string }>
} {
  const slots = new Map<string, { kind: 'lead' | 'callout'; label?: string; body: string }>()
  const lines = markdown.split(/\r?\n/)
  const out: string[] = []
  let counter = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    // 目录占位
    if (/^\[\[toc\]\]$/i.test(trimmed)) {
      const id = `${SLOT_PREFIX}${counter++}`
      slots.set(id, { kind: 'callout', label: '__TOC__', body: '' })
      out.push('', id, '')
      continue
    }

    // 组件开标签行。两种写法都要支持：
    //   ::: tip 同行内容      （单行块）
    //   ::: tip               （多行块，内容在下一行直到 :::）
    const openMatch = trimmed.match(/^:::[ \t]*(tip|warn|key|note|lead)(?:[ \t]+(.*))?$/i)
    if (!openMatch) {
      out.push(line)
      continue
    }

    const type = openMatch[1].toLowerCase()
    const inline = (openMatch[2] ?? '').trim()
    const bodyLines: string[] = []
    let closed = false

    if (inline) {
      // 单行块：::: tip 内容。仍需确认后面有闭标签，否则退回普通文本
      let j = i + 1
      for (; j < lines.length; j += 1) {
        if (lines[j].trim() === ':::') { closed = true; i = j; break }
      }
      if (!closed) { out.push(line); continue }
      bodyLines.push(inline)
    } else {
      // 多行块：收集到闭标签为止
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === ':::') { closed = true; i = j; break }
        bodyLines.push(lines[j])
      }
      if (!closed) { out.push(line); continue }
    }

    const body = bodyLines.join('\n').trim()
    // 空内容视为未使用语法，不生成空块
    if (!body) continue

    const id = `${SLOT_PREFIX}${counter++}`
    if (type === 'lead') {
      slots.set(id, { kind: 'lead', body })
    } else {
      slots.set(id, { kind: 'callout', label: CALLOUT_LABELS[type] ?? '提示', body })
    }
    out.push('', id, '')
  }

  return { markdown: out.join('\n'), slots }
}

/** 渲染后的 HTML 里，占位段落长这样 */
const SLOT_RE = new RegExp(`<p[^>]*>\\s*${SLOT_PREFIX}(\\d+)\\s*</p>`, 'g')

/**
 * 把占位段落替换为组件 HTML。
 * 组件内容需要重新走一遍 markdown-it 才能保留加粗、列表等格式。
 */
export function renderSlots(
  html: string,
  slots: Map<string, { kind: 'lead' | 'callout'; label?: string; body: string }>,
  renderInline: (markdown: string) => string
): string {
  if (!slots.size) return html
  return html.replace(SLOT_RE, (whole, rawIndex: string) => {
    const slot = slots.get(`${SLOT_PREFIX}${rawIndex}`)
    if (!slot) return whole

    if (slot.label === '__TOC__') {
      // 目录内容依赖全部标题，因此留到最终阶段注入
      return whole
    }

    const inner = renderInline(slot.body)
    return slot.kind === 'lead'
      ? `<section class="mly-lead">${inner}</section>`
      : `<section class="mly-callout"><p class="mly-callout-tag"><span leaf="">${slot.label}</span></p>${inner}</section>`
  })
}

/**
 * 目录注入：在 HTML 层面工作。
 * 微信不支持锚点跳转，但目录仍能起到"结构概览"的作用——
 * 告诉读者这篇文章分几部分、各叫什么，比能否跳转更有价值。
 */
export function injectToc(html: string): string {
  const re = new RegExp(`<p[^>]*>\\s*${SLOT_PREFIX}\\d+\\s*</p>`, 'g')
  if (!re.test(html)) return html

  // 抽取二、三级标题。h2 是主章节，h3 是子节，都值得进目录
  const entries: Array<{ level: number; text: string }> = []
  const headingRe = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/g
  let match: RegExpExecArray | null
  while ((match = headingRe.exec(html)) !== null) {
    const text = match[2].replace(/<[^>]+>/g, '').trim()
    if (text) entries.push({ level: Number(match[1]), text })
  }

  // 标题不足 3 个时目录价值不大，移除占位（降级友好）
  if (entries.length < 3) {
    return html.replace(new RegExp(`<p[^>]*>\\s*${SLOT_PREFIX}\\d+\\s*</p>`, 'g'), '')
  }

  const items = entries
    .map((entry) => {
      const indent = entry.level === 3 ? 'padding-left:16px;' : ''
      return `<p class="mly-toc-item" style="${indent}"><span leaf="">${escapeText(entry.text)}</span></p>`
    })
    .join('')

  const toc = `<section class="mly-toc"><p class="mly-toc-title"><span leaf="">本文目录</span></p>${items}</section>`
  return html.replace(new RegExp(`<p[^>]*>\\s*${SLOT_PREFIX}\\d+\\s*</p>`, 'g'), toc)
}

/** 装饰分割线：替代默认 hr 的生硬横线 */
export function decorateDivider(html: string): string {
  return html.replace(/<hr\s*\/?>/g, '<p class="mly-divider"><span leaf="">· · ·</span></p>')
}

/** 兜底：任何残留的自定义标签都不应出现在产物里 */
export function stripCustomTags(html: string): string {
  return html.replace(/<\/?mly-[a-z-]+>/gi, '')
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
