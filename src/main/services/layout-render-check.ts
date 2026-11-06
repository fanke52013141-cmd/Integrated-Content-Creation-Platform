import { BrowserWindow } from 'electron'
import { buildRenderCheckDocument, MEASURE_SCRIPT } from '../../shared/render-measure.js'
import type { LayoutRenderIssue } from '../../shared/render-measure.js'

/**
 * 渲染级排版检测（阶段四）：在真实浏览器环境里测量排版稿。
 *
 * 为什么不用 puppeteer：Electron 自带 Chromium，隐藏 BrowserWindow 即可，
 * 不给安装包增加几百 MB 依赖。静态校验器（layout-validator）查"写法"，
 * 这里查"真实渲染"——溢出、叠字这类静态正则测不出的问题。
 *
 * 窗口策略：模块级单例复用（连续校验不新增进程/内存膨胀），
 * 只挂在"推送草稿箱前"与"手动渲染检测"两个时机调用，不挂在预览上。
 */

let measureWindow: BrowserWindow | null = null

async function ensureMeasureWindow(): Promise<BrowserWindow> {
  if (measureWindow && !measureWindow.isDestroyed()) return measureWindow
  measureWindow = new BrowserWindow({
    show: false,
    width: 375,
    height: 800,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  })
  await measureWindow.loadURL('about:blank')
  return measureWindow
}

/** 应用退出时销毁测量窗口（ipc.ts 的 will-quit 钩子调用） */
export function disposeLayoutRenderChecker(): void {
  if (measureWindow && !measureWindow.isDestroyed()) measureWindow.destroy()
  measureWindow = null
}

export async function checkLayoutRendering(html: string): Promise<LayoutRenderIssue[]> {
  const window = await ensureMeasureWindow()
  // document.write 写入测量文档（排版稿可到 1MB，data: URL 导航有长度风险，write 更稳）
  await window.webContents.executeJavaScript(
    `(() => { document.open(); document.write(${JSON.stringify(buildRenderCheckDocument(html))}); document.close(); })()`
  )
  // 等两帧：布局与图片占位稳定后再测量（不等待外网图片，避免外网慢拖住推送）
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const issues = await window.webContents.executeJavaScript(MEASURE_SCRIPT)
  return Array.isArray(issues) ? issues as LayoutRenderIssue[] : []
}
