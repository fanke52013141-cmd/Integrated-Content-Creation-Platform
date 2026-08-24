import { BrowserWindow, session, type Session } from 'electron'
import type { WeiboSessionStatus } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { KeyStore } from '../security/key-store.js'

const LOGIN_URL = 'https://passport.weibo.com/sso/signin?entry=weibo&display=default&url=https://weibo.com'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 1_500

/**
 * 弹出微博官方登录窗口（默认二维码登录，也可切换手机号等方式）。
 * 登录成功后自动从会话中提取 Cookie 并加密保存，用户无需手动复制。
 */
export class WeiboLoginService {
  private loginWindow?: BrowserWindow
  private pending?: Promise<WeiboSessionStatus>

  constructor(
    private readonly keyStore: KeyStore,
    private readonly database: AppDatabase
  ) {}

  isActive(): boolean {
    return Boolean(this.loginWindow && !this.loginWindow.isDestroyed())
  }

  login(): Promise<WeiboSessionStatus> {
    if (this.pending) return this.pending
    this.pending = new Promise<WeiboSessionStatus>((resolve, reject) => {
      void this.openLoginWindow(resolve, reject)
    }).finally(() => {
      this.pending = undefined
      this.loginWindow = undefined
    })
    return this.pending
  }

  private async openLoginWindow(
    resolve: (status: WeiboSessionStatus) => void,
    reject: (error: Error) => void
  ): Promise<void> {
    let settled = false
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      if (timeout) clearTimeout(timeout)
      const window = this.loginWindow
      this.loginWindow = undefined
      if (window && !window.isDestroyed()) {
        window.removeAllListeners('closed')
        window.close()
      }
      settle()
    }

    try {
      const loginSession = session.fromPartition('persist:weibo-login')
      const window = new BrowserWindow({
        width: 460,
        height: 620,
        title: '微博登录',
        parent: BrowserWindow.getAllWindows()[0],
        modal: false,
        show: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          session: loginSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      this.loginWindow = window
      window.once('ready-to-show', () => window.show())
      window.setMenu(null)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

      window.once('closed', () => {
        finish(() => reject(new Error('已取消微博登录')))
      })

      pollTimer = setInterval(() => {
        void (async () => {
          try {
            const cookie = await readLoginCookie(loginSession)
            if (!cookie) return
            this.keyStore.saveWeiboCookie(cookie)
            const meta = this.database.getWeiboSessionMeta()
            finish(() => resolve({ configured: true, updatedAt: meta?.updatedAt }))
          } catch {
            // 单次轮询失败直接忽略，等待下一轮。
          }
        })()
      }, POLL_INTERVAL_MS)

      timeout = setTimeout(() => {
        finish(() => reject(new Error('微博登录超时未完成，请重试')))
      }, LOGIN_TIMEOUT_MS)

      await window.loadURL(LOGIN_URL)
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('无法打开微博登录窗口')))
    }
  }
}

async function readLoginCookie(loginSession: Session): Promise<string | undefined> {
  const [domainCookies, urlCookies] = await Promise.all([
    loginSession.cookies.get({ domain: '.weibo.com' }),
    loginSession.cookies.get({ url: 'https://weibo.com' })
  ])
  const merged = new Map(
    [...domainCookies, ...urlCookies].map((cookie) => [`${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`, cookie])
  )
  const cookies = [...merged.values()]
  // SUB 是微博登录态的核心 Cookie；未登录时不会存在。
  if (!cookies.some((cookie) => cookie.name === 'SUB')) return undefined
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}
