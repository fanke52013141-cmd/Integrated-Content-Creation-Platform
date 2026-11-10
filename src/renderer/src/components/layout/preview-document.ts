import { MOCK_CONTAINER_ID, replaceAccentInHtml, WECHAT_BASE_MOCK_CSS } from '../../../../shared/render-measure'
import { sanitizeHtml } from '../../lib.js'

export interface LayoutPreviewOptions {
  /** 暗色预览：正文底色模拟微信暗黑模式的 #191919（近似模拟，微信实际以算法转换为准） */
  dark?: boolean
  /** 暗色模式下把正文里的强调色替换为安全变体（仅预览，正式排版稿不变） */
  accentOverride?: { from: string; to: string }
}

export function layoutPreviewDocument(html: string, options: LayoutPreviewOptions = {}): string {
  const bodyBackground = options.dark ? '#191919' : '#fff'
  const safeHtml = options.dark && options.accentOverride
    ? sanitizeHtml(replaceAccentInHtml(html, options.accentOverride.from, options.accentOverride.to))
    : sanitizeHtml(html)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: moliu-asset:; style-src 'unsafe-inline'; font-src data: https:;"><style>html,body{margin:0;padding:0;background:${bodyBackground}}body{overflow-wrap:anywhere}${WECHAT_BASE_MOCK_CSS}</style></head><body><div id="${MOCK_CONTAINER_ID}">${safeHtml}</div></body></html>`
}
