import MarkdownIt from 'markdown-it'
import juice from 'juice'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import cssLang from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdownLang from 'highlight.js/lib/languages/markdown'
import type { CreateArticleLayoutInput, CreateArticleLayoutResult, LayoutPlatform } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import { buildCustomThemeCss, getLayoutTheme, listLayoutThemes } from './layout-themes.js'
import { validateWechatLayout } from './layout-validator.js'
import { decorateDivider, injectToc, renderSlots, stripCustomTags, transformComponents } from './layout-components.js'
import { annotateWideTables, markNumericCells } from './layout-table.js'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('java', java)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('css', cssLang)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdownLang)

/**
 * 把源码里的行首空格转为全角空格，避免 HTML 源码缩进被原样渲染。
 *
 * 为什么需要：代码块不用 white-space:pre（会渲染出大段空白），
 * 缩进只能靠字符本身承载，而普通空格在 HTML 源码里会被忽略/折叠。
 */
function toFullWidthIndent(line: string): string {
  return line.replace(/^( +)/, (_m, spaces: string) => '　'.repeat(spaces.length))
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (code: string, lang: string): string => highlightToWechat(code, lang)
})

/** 高亮或转义代码内容（不含外层容器） */
function highlightToWechat(code: string, lang: string | undefined): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      // 高亮失败回退到纯转义
    }
  }
  return md.utils.escapeHtml(code).split('\n').map(toFullWidthIndent).join('\n')
}

// markdown-it 默认用 <pre><code> 包裹代码块，但 <pre> 不在微信标签白名单内，
// 发出去会整块散架（连同内部的 section 一起被丢弃）。
// 因此接管 fence 渲染，直接输出 section 结构，不经过 <pre>。
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info?.trim().split(/\s+/)[0]
  const body = highlightToWechat(token.content, lang)
  const bodyHtml = body
    .split('\n')
    .map((line) => `<p style="margin:0;font-family:'SF Mono',Consolas,Monaco,monospace;font-size:13px;line-height:1.6;color:#e2e8f0;">${line || ' '}</p>`)
    .join('')
  return `<section style="margin:0 0 20px;border-radius:8px;overflow:hidden;background:#1e293b;">`
    + '<section style="padding:9px 14px;background:#0f172a;font-size:12px;color:#64748b;font-family:Consolas,Monaco,monospace;">'
    + (lang ? escapeHtml(lang) : '')
    + '</section>'
    + `<section style="padding:11px 14px;">${bodyHtml}</section>`
    + '</section>'
}

export class ArticleLayoutService {
  constructor(private readonly database: AppDatabase) {}

  create(input: CreateArticleLayoutInput): CreateArticleLayoutResult {
    // 远端提交新增：排版前必须已保存，避免排的是旧版本却以为是新的
    this.database.workflow.assertSaved(input.articleId)
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    const rendered = renderLayoutMarkdown(article.rawMarkdown, input.platform, input.themeId, input.customCss)
    // 生成时即校验，但不阻断：用户仍需要看到排版稿才能判断效果。
    // 硬拦截放在推送前（那一步失败会丢失工作成果），此处只把问题带出去供界面提示。
    const violations = input.platform === 'wechat'
      ? validateWechatLayout({ html: rendered.html, title: rendered.title })
      : []
    const saved = this.database.saveArticleLayout({
      articleId: article.id,
      articleVersionId: article.currentVersionId,
      articleStatusSnapshot: article.status,
      platform: input.platform,
      ...rendered
    })
    // 校验结果随返回对象带出，供渲染层在界面上提示；不影响保存
    return { ...saved, violations }
  }
}

/**
 * 排版渲染管线（微信兼容）：
 * markdown → 组件语法转换 → markdown-it 语义 HTML → 主题 CSS → juice 全内联。
 * 微信后台会过滤 class 与 <style>，只有内联 style 能存活；
 * wechat 平台的正文外链会转为「文本 + 上标序号 + 文末参考链接」。
 */
export function renderLayoutMarkdown(
  markdown: string,
  platform: LayoutPlatform,
  themeId?: string,
  customCss?: string
): { title: string; html: string; plainText: string; themeId: string } {
  const lines = markdown.trim().split(/\r?\n/)
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line))
  const title = (titleIndex >= 0 ? lines[titleIndex].replace(/^#\s+/, '') : '未命名文章').trim()
  // 仅把第一处一级标题作为文章标题；正文里后续的一级标题仍是合法 Markdown，不能静默丢弃。
  const body = lines.filter((_line, index) => index !== titleIndex).join('\n')
  const resolvedThemeId = themeId || 'wechat-green'

  const plainText = platform === 'xiaohongshu'
    ? toXiaohongshu(title, stripMarkdown(body))
    : stripMarkdown(`${title}\n\n${body}`)

  if (platform === 'xiaohongshu') {
    return { title, html: `<article class="mly-body"><h1 class="mly-title">${escapeHtml(title)}</h1><p>${escapeHtml(plainText).replace(/\n/g, '<br>')}</p></article>`, plainText, themeId: resolvedThemeId }
  }

  // 组件语法先转为占位段落，渲染后再回填为组件 HTML。
  // 顺序很重要：目录注入必须在 markdown-it 之后（要看到渲染出的 h2/h3）。
  const { markdown: withSlots, slots } = platform === 'wechat'
    ? transformComponents(body)
    : { markdown: body, slots: new Map() }
  let bodyHtml = md.render(withSlots)
  if (platform === 'wechat') {
    // 组件内容重新走一遍 markdown-it，保留加粗、列表等行内格式
    bodyHtml = renderSlots(bodyHtml, slots, (inner) => md.render(inner))
    bodyHtml = injectToc(bodyHtml)
    bodyHtml = decorateDivider(bodyHtml)
    bodyHtml = stripCustomTags(bodyHtml)
  }
  const css = customCss?.trim()
    ? buildCustomThemeCss(customCss)
    : getLayoutTheme(resolvedThemeId).css

  const refs: Array<{ text: string; href: string }> = []
  if (platform === 'wechat') {
    bodyHtml = bodyHtml.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_match: string, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim() || href
      if (!href || href.startsWith('#')) return inner
      refs.push({ text, href })
      return `${text}<sup>[${refs.length}]</sup>`
    })
  }
  const refsSection = refs.length
    ? `<section class="mly-refs"><h3>参考链接</h3>${refs.map((ref, index) => `<p>[${index + 1}] ${escapeHtml(ref.text)}：${escapeHtml(ref.href)}</p>`).join('')}</section>`
    : ''

  // 数值列标记必须在 juice 之前完成：class 是 juice 解析 CSS 选择器的依据，
  // 等内联完再标记就找不到对应样式了（样式不会凭空出现）。
  // 宽表格提示是纯文本段落，放在 juice 之后即可。
  const bodyForInline = platform === 'wechat' ? markNumericCells(bodyHtml) : bodyHtml

  const composed = `<style>${css}</style><article class="mly-body"><h1 class="mly-title">${escapeHtml(title)}</h1>${bodyForInline}${refsSection}</article>`
  const inlined = juice(composed, { inlinePseudoElements: false }).replace(/<style[\s\S]*?<\/style>/g, '')
  return { title, html: finalizeWechatHtml(inlined, platform), plainText, themeId: resolvedThemeId }
}

/**
 * 微信兼容性后处理。样式已由 juice 内联完成，这里处理微信的两条硬规则：
 *
 * 1. 移除非内联属性：class / id 会被微信强制剔除，留着无用还让 HTML 体积膨胀。
 * 2. 文字必须被 <span leaf=""> 包裹：这是微信正文的渲染依赖，
 *    未包裹的文字节点在部分客户端会丢失继承样式。
 *
 * 小红书 / web 平台不做这两件事——只有微信有这个约束。
 */
function finalizeWechatHtml(html: string, platform: LayoutPlatform): string {
  if (platform !== 'wechat') return html

  // 数值列标记已在 juice 之前完成（见 renderLayoutMarkdown），
  // 这里只需处理纯文本类的宽表格提示。
  const withTableHints = annotateWideTables(html)

  const withoutAttrs = withTableHints
    // 剥掉 class 与 id。样式已内联，属性本身在微信侧必被过滤
    .replace(/\s+class="[^"]*"/gi, '')
    .replace(/\s+id="[^"]*"/gi, '')
    // 图片补自适应。微信会强制 width:100%，小图会被拉伸变形，
    // 显式声明 max-width + height:auto 让浏览器/微信按原比例显示
    .replace(/<img(?![^>]*\bstyle=)/gi, '<img style="max-width:100%;height:auto;"')

  return wrapTextNodes(withoutAttrs)
}

/**
 * 把纯文字节点用 <span leaf=""> 包裹。
 *
 * 用 [^<]+ 而非 .+?：后者会跨越 `</p><p>` 这类边界，把多个标签的内容
 * 混进同一个 span，破坏组件结构（如把「· · ·」和下一段文字包在一起）。
 */
function wrapTextNodes(html: string): string {
  return html.replace(
    />([^<]+)</g,
    (whole, text: string) => {
      // 纯空白无需包裹
      if (!text.trim()) return whole
      return `><span leaf="">${text}</span><`
    }
  )
}

/** 从 markdown 提取可读纯文本（图片转占位、链接保留文字、表格/代码合理降级） */
function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, '').trim())
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '[图：$1]')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1（$2）')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/\|/g, ' ').trim())
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toXiaohongshu(title: string, plain: string): string {
  return plain
    .split('\n')
    .map((line) => {
      if (line.startsWith('· ')) return `　 · ${line.slice(2)}`
      return line
    })
    .join('\n')
    .replace(/^(?!　)/m, `✨ ${title}\n\n`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export { listLayoutThemes }
