import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  MessageCircleMore,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Zap
} from 'lucide-react'
import type { WeiboSessionStatus } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { PageHeader } from '../components/PageHeader'
import { useConfirm } from '../components/useConfirm'
import { errorMessage, formatFullDate } from '../lib'

export function PlatformsPage({ onNavigate, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [weibo, setWeibo] = useState<WeiboSessionStatus>({ configured: false })
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState('')

  const refreshWeibo = useCallback(async (): Promise<void> => {
    try {
      setWeibo(await window.moliu.hotspots.getWeiboStatus())
      setError('')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refreshWeibo() }, [refreshWeibo])

  async function loginWeibo(): Promise<void> {
    setLoggingIn(true)
    setError('')
    try {
      const status = await window.moliu.hotspots.weiboLogin()
      setWeibo(status)
      showToast({ type: 'success', message: '微博授权成功，热点页可直接刷新微博榜单' })
    } catch (reason) {
      const message = errorMessage(reason)
      setError(message)
      showToast({ type: 'error', message })
    } finally {
      setLoggingIn(false)
    }
  }

  async function clearWeibo(): Promise<void> {
    if (!(await confirm({
      title: '清除微博授权？',
      message: '清除后微博热点将暂不可用，其他平台不受影响。下次使用需重新授权。',
      danger: true,
      confirmLabel: '清除授权'
    }))) return
    try {
      await window.moliu.hotspots.clearWeiboCookie()
      setWeibo({ configured: false })
      showToast({ type: 'success', message: '已清除微博授权' })
    } catch (reason) {
      showToast({ type: 'error', message: errorMessage(reason) })
    }
  }

  return (
    <div className="page platforms-page">
      <PageHeader
        title="平台授权"
        description="统一管理热点与发布所需的平台登录态；所有凭据只在本机加密保存"
        actions={<button className="button secondary" disabled={loading || loggingIn} onClick={() => void refreshWeibo()}><RefreshCw size={16} className={loading ? 'spin' : ''} />刷新状态</button>}
      />

      <section className="platform-overview">
        <div><span className="platform-overview-icon"><KeyRound size={18} /></span><strong>1</strong><small>需要授权的热点平台</small></div>
        <div><span className="platform-overview-icon success"><CheckCircle2 size={18} /></span><strong>{weibo.configured ? 1 : 0}</strong><small>已授权平台</small></div>
        <div><span className="platform-overview-icon"><Zap size={18} /></span><strong>自动</strong><small>快手设备凭证</small></div>
      </section>

      {error && <p className="inline-alert danger" role="alert"><AlertCircle size={16} />{error}</p>}

      <section className="platform-card-grid">
        <article className={`platform-card ${weibo.configured ? 'authorized' : ''}`}>
          <header>
            <span className="platform-logo weibo"><MessageCircleMore size={22} /></span>
            <div><h2>微博</h2><p>热点洞察 · 微博热榜</p></div>
            <span className={`badge ${weibo.configured ? 'success' : 'warning'}`}>{weibo.configured ? '已授权' : '未授权'}</span>
          </header>
          <div className="platform-card-body">
            {weibo.configured ? (
              <p className="platform-status"><CheckCircle2 size={16} />授权已保存{weibo.updatedAt ? ` · ${formatFullDate(weibo.updatedAt)}` : ''}</p>
            ) : (
              <p>微博热榜需要登录态。打开官方授权窗口，扫码或手机号登录后会自动获取并加密保存 Cookie。</p>
            )}
            <div className="platform-security"><ShieldCheck size={15} /><span>凭据由系统安全存储保护，不会写入项目文件。</span></div>
          </div>
          <footer>
            {weibo.configured && <button className="button ghost compact" disabled={loggingIn} onClick={() => void clearWeibo()}><Trash2 size={15} />清除授权</button>}
            <button className="button primary" disabled={loggingIn} onClick={() => void loginWeibo()}>
              {loggingIn ? <LoaderCircle size={16} className="spin" /> : <MessageCircleMore size={16} />}
              {loggingIn ? '等待微博登录…' : weibo.configured ? '重新授权' : '微博授权'}
            </button>
          </footer>
        </article>

        <article className="platform-card authorized">
          <header>
            <span className="platform-logo kuaishou"><Zap size={22} /></span>
            <div><h2>快手</h2><p>热点洞察 · 快手热榜</p></div>
            <span className="badge success">自动维护</span>
          </header>
          <div className="platform-card-body">
            <p>快手需要设备 Cookie 与请求头匹配。应用会在首次访问时自动获取，无需手动登录。</p>
            <div className="platform-security"><ShieldCheck size={15} /><span>设备凭证有效期 7 天，过期后自动重新获取。</span></div>
          </div>
          <footer><button className="button secondary" onClick={() => onNavigate('hotspots')}>去热点页验证</button></footer>
        </article>

        <article className="platform-card">
          <header>
            <span className="platform-logo wechat"><Send size={22} /></span>
            <div><h2>微信公众号</h2><p>发布管理 · 草稿箱推送</p></div>
            <span className="badge neutral">发布凭证</span>
          </header>
          <div className="platform-card-body">
            <p>公众号使用 AppID 与 AppSecret 调用官方接口，不属于扫码登录。凭证在发布管理中配置。</p>
            <div className="platform-security"><ShieldCheck size={15} /><span>仅用于素材上传与草稿箱推送，不会自动正式发布。</span></div>
          </div>
          <footer><button className="button secondary" onClick={() => onNavigate('publishing')}>去发布管理配置</button></footer>
        </article>
      </section>

      <section className="platform-help">
        <ShieldCheck size={20} />
        <div><strong>为什么只有微博需要授权？</strong><p>其余热点平台大多使用公开接口；微博接口要求登录 Cookie，快手使用设备凭证。平台接口不可用时，仍可手动添加热点继续创作。</p></div>
      </section>
      {ConfirmPortal}
    </div>
  )
}
