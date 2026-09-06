/**
 * 排版主题注册表：纯静态、无 DB 依赖。
 * 约束（微信兼容）：
 * - 选择器全部作用域在 .mly-body 下；
 * - 只用微信白名单内的 CSS 属性（margin/padding/color/font/border/background/line-height/text-align 等）；
 * - 禁用伪元素与 media query（微信会剥掉）；
 * - 代码高亮使用内置 hljs 色板（juice 会把类样式内联进 span）。
 */

export interface LayoutThemeInfo {
  id: string
  name: string
  description: string
  accent: string
}

interface LayoutThemeDef extends LayoutThemeInfo {
  css: string
}

/** 代码高亮色板（浅底深字，公众号白底安全） */
const HLJS_CSS = `
.mly-body pre { background: #282c34; color: #abb2bf; border-radius: 6px; padding: 14px 16px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
.mly-body pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; }
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
.mly-refs p { margin: 4px 0; font-size: 13px; line-height: 1.7; word-break: break-all; }`
}

function buildTheme(def: { id: string; name: string; description: string; accent: string; headingFont?: string; text?: string; extra?: string }): LayoutThemeDef {
  const headingFont = def.headingFont ?? FONT_STACK
  const text = def.text ?? '#2b2b2b'
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    accent: def.accent,
    css: baseCss(def.accent, text, headingFont) + (def.extra ?? '') + HLJS_CSS
  }
}

export const LAYOUT_THEMES: LayoutThemeDef[] = [
  buildTheme({
    id: 'wechat-green',
    name: '微信经典',
    description: '品牌绿点缀，百搭安全',
    accent: '#07c160'
  }),
  buildTheme({
    id: 'magazine',
    name: '杂志衬线',
    description: '衬线标题，编辑部质感',
    accent: '#1a1a1a',
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

export function listLayoutThemes(): LayoutThemeInfo[] {
  return LAYOUT_THEMES.map(({ id, name, description, accent }) => ({ id, name, description, accent }))
}

/** 自定义主题：用户粘贴的 CSS 原样参与内联（建议选择器以 .mly-body 开头），叠加在基础样式之上 */
export function buildCustomThemeCss(customCss: string): string {
  return baseCss('#07c160', '#2b2b2b', FONT_STACK) + '\n' + customCss + HLJS_CSS
}
