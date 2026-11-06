import { BrowserWindow } from 'electron'
import { MOCK_CONTAINER_ID, WECHAT_BASE_MOCK_CSS } from '../../shared/render-measure.js'

/**
 * 排版稿长图导出（阶段五）：把排版稿渲染为一张竖版 PNG。
 *
 * 用途：小红书等图片流渠道没有富文本正文，长图即排版产物；
 * 也适合朋友圈/收藏场景。宽度锁 375px（与预览一致），
 * 高度按内容自适应，上限 30000px（超长图在多数平台会被压缩或截断）。
 *
 * 高 DPI 归一：capturePage 按系统缩放输出位图（125%/150% 屏会得到
 * 1.25x/1.5x 像素宽），这里统一缩回逻辑 375 宽，保证不同机器导出尺寸一致。
 */
export async function renderLayoutLongImage(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    width: 375,
    height: 800,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  })
  try {
    await window.loadURL('about:blank')
    const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:375px;background:#fff}body{overflow-wrap:anywhere}${WECHAT_BASE_MOCK_CSS}</style></head><body><div id="${MOCK_CONTAINER_ID}">${html}</div></body></html>`
    await window.webContents.executeJavaScript(
      `(() => { document.open(); document.write(${JSON.stringify(doc)}); document.close(); })()`
    )
    const height = await window.webContents.executeJavaScript('Math.ceil(document.body.scrollHeight)') as number
    const capped = Math.min(Math.max(Number(height) || 200, 200), 30_000)
    window.setContentSize(375, capped)
    // rAF 在隐藏/后台窗口可能不触发（如 smoke 的 background 模式），带超时兜底避免永久挂起
    await window.webContents.executeJavaScript(
      'new Promise(resolve => { const done = () => resolve(true); requestAnimationFrame(() => requestAnimationFrame(done)); setTimeout(done, 800) })'
    )
    const image = await Promise.race([
      window.webContents.capturePage(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('长图截图超时')), 15_000))
    ])
    const size = image.getSize()
    const normalized = size.width > 375 ? image.resize({ width: 375 }) : image
    return normalized.toPNG()
  } finally {
    window.destroy()
  }
}
