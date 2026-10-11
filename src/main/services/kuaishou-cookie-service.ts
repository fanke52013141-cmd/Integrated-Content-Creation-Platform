import { BrowserWindow } from 'electron'
import type { KeyStore } from '../security/key-store.js'

export interface KuaishouCredential {
  cookie: string
  userAgent: string
  savedAt: string
}

/** 固定 UA：快手反爬会把 did 设备 Cookie 与 UA 绑定，抓取时必须复用同一 UA */
const KUAISHOU_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const KUAISHOU_HOME_URL = 'https://www.kuaishou.com/?isHome=1'
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const COOKIE_WAIT_MS = 6_000

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * 快手热榜的访问凭证：快手反爬要求请求携带 did 等设备 Cookie 且 UA 一致，
 * 否则只返回 63 字节的拒绝 JSON。设备 Cookie 无需真实登录——用隐藏窗口
 * 访问一次快手首页即可拿到；拿到后加密保存（7 天有效），过期自动重引导。
 */
export class KuaishouCookieService {
  private cached?: KuaishouCredential
  private bootstrapPromise?: Promise<KuaishouCredential>

  constructor(private readonly keyStore: KeyStore) {}

  async ensureCredential(forceRefresh = false): Promise<KuaishouCredential> {
    if (!forceRefresh) {
      if (this.cached) return this.cached
      const stored = this.readStored()
      if (stored) {
        this.cached = stored
        return stored
      }
    }
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrap().finally(() => {
        this.bootstrapPromise = undefined
      })
    }
    this.cached = await this.bootstrapPromise
    return this.cached
  }

  /** 抓取失败时丢弃缓存，下次强制重新引导 */
  invalidate(): void {
    this.cached = undefined
  }

  private readStored(): KuaishouCredential | undefined {
    try {
      const raw = this.keyStore.readKuaishouSession()
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as KuaishouCredential
      if (!parsed.cookie?.includes('did') || !parsed.userAgent) return undefined
      if (Date.now() - Date.parse(parsed.savedAt) > SESSION_MAX_AGE_MS) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  private async bootstrap(): Promise<KuaishouCredential> {
    // 注意：不能用自定义 partition——实测快手反爬会对隔离分区的请求返回空壳页
    // （默认会话首次访问即可拿到完整页与 did 设备 Cookie）；也不用
    // session.setUserAgent，避免影响应用其他窗口的请求 UA。
    const win = new BrowserWindow({ show: false, width: 1280, height: 800 })
    try {
      await win.loadURL(KUAISHOU_HOME_URL, { userAgent: KUAISHOU_UA })
      await delay(COOKIE_WAIT_MS)
      const cookies = await win.webContents.session.cookies.get({ domain: 'kuaishou.com' })
      const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ')
      if (!cookie.includes('did')) {
        throw new Error('快手设备 Cookie 引导失败（未取得 did），请检查网络或稍后重试')
      }
      const credential: KuaishouCredential = {
        cookie,
        userAgent: KUAISHOU_UA,
        savedAt: new Date().toISOString()
      }
      this.keyStore.saveKuaishouSession(JSON.stringify(credential))
      return credential
    } finally {
      win.destroy()
    }
  }
}
