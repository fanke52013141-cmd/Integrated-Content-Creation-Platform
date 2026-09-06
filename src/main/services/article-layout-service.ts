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
import type { CreateArticleLayoutInput, LayoutPlatform } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import { buildCustomThemeCss, getLayoutTheme, listLayoutThemes } from './layout-themes.js'

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

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (code: string, lang: string): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // 高亮失败回退到纯转义
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
  }
})

export class ArticleLayoutService {
  constructor(private readonly database: AppDatabase) {}

  create(input: CreateArticleLayoutInput) {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    const rendered = renderLayoutMarkdown(article.rawMarkdown, input.platform, input.themeId, input.customCss)
    return this.database.saveArticleLayout({
      articleId: article.id,
      articleVersionId: article.currentVersionId,
      articleStatusSnapshot: article.status,
      platform: input.platform,
      ...rendered
    })
  }
}

/**
 * 排版渲染管线（微信兼容）：
 * markdown → markdown-it 语义 HTML → 主题 CSS → juice 全内联。
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
  const title = (lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '') || '未命名文章').trim()
  const body = lines.filter((line) => !/^#\s+/.test(line)).join('\n')
  const resolvedThemeId = themeId || 'wechat-green'

  const plainText = platform === 'xiaohongshu'
    ? toXiaohongshu(title, stripMarkdown(body))
    : stripMarkdown(`${title}\n\n${body}`)

  if (platform === 'xiaohongshu') {
    return { title, html: `<article class="mly-body"><h1 class="mly-title">${escapeHtml(title)}</h1><p>${escapeHtml(plainText).replace(/\n/g, '<br>')}</p></article>`, plainText, themeId: resolvedThemeId }
  }

  let bodyHtml = md.render(body)
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

  const composed = `<style>${css}</style><article class="mly-body"><h1 class="mly-title">${escapeHtml(title)}</h1>${bodyHtml}${refsSection}</article>`
  const inlined = juice(composed, { inlinePseudoElements: false }).replace(/<style[\s\S]*?<\/style>/g, '')
  return { title, html: inlined, plainText, themeId: resolvedThemeId }
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
