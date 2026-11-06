/**
 * 微信正文渲染测量（阶段四"质量闭环"的共享层）。
 *
 * 放在 shared 而非 electron 服务里：文档构造与测量脚本是纯函数/纯字符串，
 * 不依赖 electron，可在 vitest 单测，也可被脚本工具复用；
 * 真正的执行（隐藏 BrowserWindow 单例）在 src/main/services/layout-render-check.ts。
 *
 * 测量目标（对齐官方 verify-article-structure-spec 的两个核心渲染检测）：
 * 1. render-overflow      —— 内容横向溢出（固定宽度/大 margin 在窄屏被截断）
 * 2. render-line-overlap  —— 实际渲染行高小于字号（多行叠字）
 * 静态校验器（layout-validator）查"写法"，这里查"真实渲染"，两层互补。
 */

/** 模拟微信正文容器（#js_content 的近似）的元素 id。预览与渲染测量共用一份 */
export const MOCK_CONTAINER_ID = 'mly-wx-base'

/**
 * 微信正文基础样式近似模拟（与 preview-document 共用，保证预览与测量同环境）。
 * 内联样式优先级高于这里，所以合规产物不受影响，漏写重置的位置会暴露。
 */
export const WECHAT_BASE_MOCK_CSS = `
#${MOCK_CONTAINER_ID} { font-size: 17px; line-height: 1.75; letter-spacing: 0.5px; color: #333; word-break: break-word; }
#${MOCK_CONTAINER_ID} p { margin: 0 0 1em; }
#${MOCK_CONTAINER_ID} section { margin: 0; }
#${MOCK_CONTAINER_ID} h1, #${MOCK_CONTAINER_ID} h2, #${MOCK_CONTAINER_ID} h3 { margin: 0.8em 0 0.5em; }
#${MOCK_CONTAINER_ID} ul, #${MOCK_CONTAINER_ID} ol { margin: 0 0 1em; }`

export interface LayoutRenderIssue {
  rule: 'render-overflow' | 'render-line-overlap'
  message: string
  hint?: string
}

/**
 * 测量脚本：在真实浏览器里执行，返回问题清单（JSON 可序列化）。
 * 以字符串形式携带——Electron 侧用 executeJavaScript 执行，
 * headless Chrome 验证脚本与单测复用同一份来源。
 */
export const MEASURE_SCRIPT = `(() => {
  const issues = []
  const MAX_PER_RULE = 5
  const container = document.getElementById(${JSON.stringify(MOCK_CONTAINER_ID)})
  if (!container) return issues
  // 溢出往往发生在"固定宽子元素的父级"（子元素自身 scrollWidth == clientWidth），
  // 所以把容器自身也纳入扫描
  const all = [container, ...Array.from(container.querySelectorAll('*'))]
  // 溢出：scrollWidth 超出 clientWidth 且未开启横向滚动（可滚动容器是官方豁免）
  let overflowCount = 0
  for (const el of all) {
    if (overflowCount >= MAX_PER_RULE) break
    const overflowX = getComputedStyle(el).overflowX
    if (overflowX === 'auto' || overflowX === 'scroll') continue
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      issues.push({
        rule: 'render-overflow',
        message: '内容横向溢出：内容宽 ' + el.scrollWidth + 'px 超出容器 ' + el.clientWidth + 'px（<' + el.tagName.toLowerCase() + '>），窄屏会被截断',
        hint: '固定宽度改 max-width:100% + margin:0 auto 居中；表格确认已用 word-break 换行'
      })
      overflowCount += 1
    }
  }
  // 叠字：computed 行高 < computed 字号，且元素直接携带 ≥10 字文本（多行概率高）
  let overlapCount = 0
  for (const el of all) {
    if (overlapCount >= MAX_PER_RULE) break
    let ownText = ''
    for (const node of el.childNodes) {
      if (node.nodeType === 3) ownText += node.textContent ?? ''
    }
    if (ownText.trim().length < 10) continue
    const style = getComputedStyle(el)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const fontSize = Number.parseFloat(style.fontSize)
    if (Number.isFinite(lineHeight) && Number.isFinite(fontSize) && fontSize > 0 && lineHeight < fontSize) {
      issues.push({
        rule: 'render-line-overlap',
        message: '实际渲染行高 ' + Math.round(lineHeight) + 'px 小于字号 ' + Math.round(fontSize) + 'px，多行文字会叠字（<' + el.tagName.toLowerCase() + '>）',
        hint: '调大 line-height（无单位数字建议 ≥ 1.5）'
      })
      overlapCount += 1
    }
  }
  return issues
})()`

/** 构造测量文档：375px 手机宽度 + 微信基础样式模拟 + 待检排版稿 */
export function buildRenderCheckDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:375px}body{overflow-wrap:anywhere}${WECHAT_BASE_MOCK_CSS}</style></head><body><div id="${MOCK_CONTAINER_ID}">${html}</div></body></html>`
}
