import { CheckCircle2, Check, LoaderCircle, Trash2, X } from 'lucide-react'
import { ModalBase } from './ModalBase'

export interface WeiboDialogProps {
  open: boolean
  configured: boolean
  updatedAt?: string
  cookie: string
  saving: boolean
  onClose(): void
  onCookieChange(value: string): void
  onSave(): void
  onClear(): void
}

export function WeiboDialog({
  open,
  configured,
  updatedAt,
  cookie,
  saving,
  onClose,
  onCookieChange,
  onSave,
  onClear
}: WeiboDialogProps): React.JSX.Element | null {
  if (!open) return null
  return (
    <ModalBase open={open} onClose={onClose} titleId="weibo-login-title" bare className="source-manager-dialog weibo-login-dialog">
      <header>
        <div>
          <span className="eyebrow">WEIBO SESSION</span>
          <h2 id="weibo-login-title">配置微博登录态</h2>
          <p>
            微博热榜接口对匿名访问风控（403/432），需携带登录 Cookie。
            {configured
              ? ' 已配置，可直接刷新榜单。'
              : ' 请在浏览器登录微博后，复制下方 Cookie 填入保存。'}
          </p>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="weibo-login-body">
        {configured && updatedAt && (
          <div className="weibo-login-status">
            <CheckCircle2 size={15} />
            <span>已配置 · 保存于 {formatDateTime(updatedAt)}</span>
          </div>
        )}
        <label className="field">
          <span>微博 Cookie</span>
          <textarea
            className="weibo-cookie-input"
            name="weiboCookie"
            autoComplete="off"
            spellCheck={false}
            rows={6}
            value={cookie}
            onChange={(event) => onCookieChange(event.target.value)}
            placeholder="例如：SUB=_2A1x...; SCF=...; SUBP=..."
          />
          <small>获取方式：浏览器登录 weibo.com → F12 → Application → Cookies → 复制完整 Cookie。值涉及登录身份，仅在本机加密保存。</small>
        </label>
      </div>
      <footer>
        {configured && (
          <button className="button ghost compact" onClick={onClear}>
            <Trash2 size={14} />清除登录态
          </button>
        )}
        <span />
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button primary" disabled={saving} onClick={onSave}>
          {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          {saving ? '保存中' : '保存并刷新'}
        </button>
      </footer>
    </ModalBase>
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
