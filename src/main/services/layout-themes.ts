/**
 * 排版主题注册表：纯静态、无 DB 依赖。
 * 约束（微信兼容）：
 * - 选择器全部作用域在 .mly-body 下；
 * - 只用微信白名单内的 CSS 属性（margin/padding/color/font/border/background/line-height/text-align 等）；
 * - 禁用伪元素与 media query（微信会剥掉）；
 * - 代码高亮使用内置 hljs 色板（juice 会把类样式内联进 span）。
 */

/**
 * 文章类型与主题元信息的类型定义放在共享契约里，
 * 主进程与渲染层引用同一份，避免两处漂移。
 */
import type { ArticleGenre, LayoutThemeInfo } from '../../shared/contracts.js'

export type { ArticleGenre, LayoutThemeInfo }

/** 文章类型的中文名与一句话说明。用于界面分组与推荐 */
export const ARTICLE_GENRES: Array<{ id: ArticleGenre; label: string; hint: string }> = [
  { id: 'tutorial', label: '教程 / 攻略', hint: '步骤清晰、代码与列表多' },
  { id: 'analysis', label: '深度分析', hint: '长文、观点鲜明、需要目录' },
  { id: 'professional', label: '专业 / 科技', hint: '克制、理性、信息密度高' },
  { id: 'narrative', label: '叙事 / 随笔', hint: '阅读体验优先、氛围感' },
  { id: 'listicle', label: '清单 / 盘点', hint: '条目式、轻快' }
]

export interface LayoutThemeDef extends LayoutThemeInfo {
  css: string
}

/**
 * 代码高亮色板（浅底深字，公众号白底安全）
 *
 * 注意：这里只保留 hljs-* 色板规则。代码块的容器样式（背景、圆角、内边距）
 * 已由 article-layout-service 的 renderCodeBlock 用内联 style 直接生成，
 * 不再依赖 pre / code 标签——<pre> 不在微信白名单内，会导致代码块散架。
 * 颜色类名仍需保留：juice 靠它把高亮色转成内联 style。
 */
const HLJS_CSS = `
.mly-body .hljs-keyword, .mly-body .hljs-selector-tag, .mly-body .hljs-literal { color: #c678dd; }
.mly-body .hljs-string, .mly-body .hljs-attr { color: #98c379; }
.mly-body .hljs-number, .mly-body .hljs-symbol { color: #d19a66; }
.mly-body .hljs-title, .mly-body .hljs-name { color: #61afef; }
.mly-body .hljs-comment, .mly-body .hljs-quote { color: #5c6370; font-style: italic; }
.mly-body .hljs-built_in, .mly-body .hljs-type { color: #e5c07b; }`

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
const SERIF_STACK = "Georgia, 'Songti SC', 'Noto Serif SC', SimSun, serif"

function baseCss(accent: string, text: string, headingFont: string): string {
  return `
.mly-body { font-family: ${FONT_STACK}; font-size: 15px; color: ${text}; line-height: 1.85; letter-spacing: 0.3px; word-break: break-word; }
.mly-title { font-family: ${headingFont}; font-size: 22px; font-weight: 700; line-height: 1.45; color: ${text}; margin: 0 0 22px; }
.mly-body h2 { font-family: ${headingFont}; font-size: 18px; font-weight: 700; color: ${text}; margin: 32px 0 14px; padding-left: 10px; border-left: 4px solid ${accent}; line-height: 1.5; }
.mly-body h3 { font-family: ${headingFont}; font-size: 16px; font-weight: 700; color: ${text}; margin: 24px 0 10px; line-height: 1.5; }
.mly-body h4 { font-size: 15px; font-weight: 700; color: ${text}; margin: 18px 0 8px; }
.mly-body p { margin: 0 0 16px; font-size: 15px; line-height: 1.85; }
.mly-body strong { color: ${accent}; font-weight: 700; }
.mly-body em { font-style: normal; color: ${accent}; }
.mly-body a { color: ${accent}; text-decoration: none; border-bottom: 1px solid ${accent}; }
.mly-body ul, .mly-body ol { margin: 0 0 16px; padding-left: 22px; }
.mly-body li { margin: 6px 0; line-height: 1.8; }
.mly-body li::marker { color: ${accent}; }
.mly-body blockquote { margin: 18px 0; padding: 12px 16px; border-left: 4px solid ${accent}; background: #f7f8fa; color: #595959; font-size: 14px; border-radius: 0 6px 6px 0; }
.mly-body blockquote p { margin: 0 0 8px; font-size: 14px; }
.mly-body blockquote p:last-child { margin-bottom: 0; }
.mly-body code { font-family: 'SF Mono', Consolas, Menlo, monospace; font-size: 13px; background: #f2f3f5; color: #c7254e; padding: 2px 6px; border-radius: 4px; }
.mly-body table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13.5px; }
.mly-body th { background: ${accent}; color: #ffffff; font-weight: 600; padding: 9px 10px; border: 1px solid ${accent}; text-align: left; }
.mly-body td { padding: 8px 10px; border: 1px solid #e8e8e8; color: ${text}; }
.mly-body tr:nth-child(2n) td { background: #fafafa; }
.mly-body img { max-width: 100%; border-radius: 6px; margin: 6px auto; display: block; }
.mly-body hr { border: none; border-top: 1px solid #e8e8e8; margin: 28px 0; }
.mly-body sup { font-size: 11px; color: ${accent}; }
.mly-refs { margin-top: 30px; padding: 14px 16px; background: #f7f8fa; border-radius: 8px; font-size: 13px; color: #595959; }
.mly-refs h3 { font-size: 14px; margin: 0 0 8px; color: ${text}; }
.mly-refs p { margin: 4px 0; font-size: 13px; line-height: 1.7; word-break: break-all; }` + componentCss(accent, text)
}

/**
 * 版式组件样式。
 *
 * 用类名而非内联 style，好处是 juice 内联时会自动带上这里的声明，
 * 组件因此能跟随主题换色，不需要在渲染层为每个主题写一份。
 *
 * 视觉规范（来自实践检验，不是主观审美）：
 * - 主色只在锚点出现，不承担正文阅读；
 * - 强调用左竖条 / 药丸标签，不用四周虚线框（虚线框笨重抢戏，仅留给"待补素材"占位）；
 * - 约九成文字交给中性灰阶，彩色只做点缀。
 */
function componentCss(accent: string, text: string): string {
  return `
/* ── 引言卡：开头三行决定读者是否继续读，需要与正文有明确区隔 ── */
.mly-lead { margin: 0 0 24px; padding: 16px 20px; background: #f7f8fa; border-left: 4px solid ${accent}; border-radius: 0 8px 8px 0; }
.mly-lead p { margin: 0; font-size: 15px; line-height: 1.85; color: ${text}; }

/* ── 金句块：核心观点的视觉锚点，比普通引用更强调 ── */
.mly-quote { margin: 0 0 24px; padding: 16px 20px; background: #f7f8fa; border-left: 4px solid ${accent}; border-radius: 0 8px 8px 0; }
.mly-quote p { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.8; color: ${text}; }

/* ── 提示块：类型由小标签区分，内容用于补充说明而非强调 ── */
.mly-callout { margin: 0 0 24px; padding: 14px 18px; background: #f7f8fa; border-left: 4px solid ${accent}; border-radius: 0 8px 8px 0; }
.mly-callout-tag { display: inline-block; background: ${accent}; color: #ffffff; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 4px; margin: 0 0 8px; }
.mly-callout-body { margin: 0; font-size: 14px; line-height: 1.8; color: #595959; }

/* ── 目录：长文（>2000 字）的导航入口 ── */
.mly-toc { margin: 0 0 28px; padding: 14px 18px; background: #fafafa; border: 1px solid #ebebeb; border-radius: 8px; }
.mly-toc-title { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: ${text}; }
.mly-toc-item { margin: 0 0 6px; font-size: 13.5px; line-height: 1.7; color: #595959; }

/* ── 序号药丸：清单 / 步骤类内容的序号标记 ── */
.mly-step { margin: 0 0 18px; }
.mly-step-badge { display: inline-block; background: ${accent}; color: #ffffff; font-size: 13px; font-weight: 700; padding: 1px 9px; border-radius: 5px; margin-right: 8px; }
.mly-step-title { font-size: 15px; font-weight: 700; line-height: 1.6; color: ${text}; }

/* ── 分割线变体：带装饰的点线，替代默认 hr 的生硬 ── */
.mly-divider { margin: 30px 0; text-align: center; font-size: 13px; color: #bfbfbf; letter-spacing: 6px; }

/* ── 表格：微信里原生表格很窄，长文本会把整列撑爆 ──
   改进要点：
   1. word-break 让长内容在单元格内换行，而不是把表格撑出屏幕
   2. line-height 收紧，表格行高过高在手机上很占地
   3. 表头 nowrap 防止"项目名称"这类表头被拆成两行
   4. 用 border-collapse 而非 separate，避免微信里边框重叠变粗 */
.mly-body table { font-size: 13px; table-layout: auto; }
.mly-body th, .mly-body td { padding: 7px 8px; line-height: 1.6; word-break: break-word; overflow-wrap: break-word; }
.mly-body th { text-align: left; white-space: nowrap; }
/* 数字列右对齐更易读：纯数字（整数/小数/百分数）的单元格由脚本标记后应用 */
.mly-body td.mly-num { text-align: right; font-variant-numeric: tabular-nums; }

/* ── 宽表格提示：微信不支持滚动容器，只能用文字告诉读者可以滑动 ── */
.mly-table-hint { margin: -8px 0 20px; font-size: 12px; color: #8c8c8c; text-align: center; }`
}

function buildTheme(def: {
  id: string
  name: string
  description: string
  accent: string
  suitedFor: ArticleGenre[]
  personality: string
  headingFont?: string
  text?: string
  extra?: string
}): LayoutThemeDef {
  const headingFont = def.headingFont ?? FONT_STACK
  const text = def.text ?? '#2b2b2b'
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    accent: def.accent,
    suitedFor: def.suitedFor,
    personality: def.personality,
    css: baseCss(def.accent, text, headingFont) + (def.extra ?? '') + HLJS_CSS
  }
}

export const LAYOUT_THEMES: LayoutThemeDef[] = [
  buildTheme({
    id: 'wechat-green',
    name: '微信经典',
    description: '品牌绿点缀，百搭安全',
    accent: '#07c160',
    suitedFor: ['tutorial', 'listicle'],
    personality: '清晰友好，最不容易出错的选择'
  }),
  buildTheme({
    id: 'magazine',
    name: '杂志衬线',
    description: '衬线标题，编辑部质感',
    accent: '#1a1a1a',
    suitedFor: ['analysis', 'narrative'],
    personality: '端庄有分量，适合长文与观点内容',
    headingFont: SERIF_STACK,
    text: '#262626',
    extra: `
.mly-body h2 { border-left: none; border-bottom: 2px solid #1a1a1a; padding-left: 0; padding-bottom: 8px; }
.mly-body strong { color: #1a1a1a; text-decoration: underline; text-decoration-color: #c9a86a; text-underline-offset: 4px; }
.mly-body blockquote { background: transparent; border-left: 3px solid #c9a86a; font-family: ${SERIF_STACK}; }`
  }),
  buildTheme({
    id: 'tech-blue',
    name: '科技蓝',
    description: '冷色理性，适合科技与干货',
    accent: '#2b6cb0',
    suitedFor: ['tutorial', 'professional'],
    personality: '理性克制，代码与数据密集时最稳',
    text: '#2d3748',
    extra: `
.mly-body h2 { border-left: none; background: #ebf4ff; border-radius: 6px; padding: 8px 14px; }
.mly-body blockquote { background: #ebf4ff; border-left: 4px solid #2b6cb0; }`
  }),
  buildTheme({
    id: 'warm-paper',
    name: '暖纸',
    description: '米色暖调，适合生活与随笔',
    accent: '#b4632a',
    suitedFor: ['narrative', 'listicle'],
    personality: '温和亲近，适合讲故事和日常观察',
    text: '#3f3a34',
    extra: `
.mly-body { background: #fdfaf5; padding: 18px; border-radius: 10px; }
.mly-body h2 { border-left: none; color: #b4632a; padding-left: 0; }
.mly-body blockquote { background: #f6eee3; border-left: 4px solid #b4632a; color: #6b5d4f; }
.mly-body td { border-color: #eadfce; }
.mly-body tr:nth-child(2n) td { background: #faf3e9; }`
  }),
  buildTheme({
    id: 'minimal',
    name: '极简黑白',
    description: '去色相，靠字重与留白',
    accent: '#111111',
    suitedFor: ['professional', 'analysis'],
    personality: '克制到极致，适合严肃话题与高端品牌感',
    text: '#111111',
    extra: `
.mly-body h2 { border-left: none; padding-left: 0; letter-spacing: 0.05em; }
.mly-body strong { color: #111111; }
.mly-body a { color: #111111; border-bottom-color: #bbbbbb; }
.mly-body blockquote { background: #f5f5f5; border-left: 3px solid #111111; }`
  })
]

export const DEFAULT_LAYOUT_THEME_ID = 'wechat-green'

export function getLayoutTheme(id?: string): LayoutThemeDef {
  return LAYOUT_THEMES.find((theme) => theme.id === id) ?? LAYOUT_THEMES[0]
}

/** 面向界面的主题清单。含文章类型与视觉性格，供「按类型选主题」使用 */
export function listLayoutThemes(): LayoutThemeInfo[] {
  return LAYOUT_THEMES.map(({ id, name, description, accent, suitedFor, personality }) => ({
    id, name, description, accent, suitedFor, personality
  }))
}

/** 文章类型清单。渲染层据此渲染分组标签 */
export function listArticleGenres(): Array<{ id: ArticleGenre; label: string; hint: string }> {
  return ARTICLE_GENRES
}

/**
 * 按文章类型推荐主题。
 *
 * 命中规则：主题的 suitedFor 包含该类型则作为候选；候选中优先取注册顺序靠前者
 * （LAYOUT_THEMES 的顺序即推荐优先级，越靠前越"百搭安全"）。
 * 无匹配时回落到默认主题。
 */
export function recommendThemeForGenre(genre?: ArticleGenre): string {
  if (!genre) return DEFAULT_LAYOUT_THEME_ID
  return LAYOUT_THEMES.find((theme) => theme.suitedFor.includes(genre))?.id ?? DEFAULT_LAYOUT_THEME_ID
}

/** 某类型下所有适配主题的 id，供界面做「换一个」的候选列表 */
export function themesForGenre(genre?: ArticleGenre): string[] {
  if (!genre) return LAYOUT_THEMES.map((theme) => theme.id)
  const matched = LAYOUT_THEMES.filter((theme) => theme.suitedFor.includes(genre)).map((theme) => theme.id)
  return matched.length ? matched : [DEFAULT_LAYOUT_THEME_ID]
}

/** 自定义主题：用户粘贴的 CSS 原样参与内联（建议选择器以 .mly-body 开头），叠加在基础样式之上 */
export function buildCustomThemeCss(customCss: string): string {
  return baseCss('#07c160', '#2b2b2b', FONT_STACK) + '\n' + customCss + HLJS_CSS
}
