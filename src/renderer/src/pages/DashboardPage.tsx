import {
  ArrowRight,
  Bot,
  Check,
  CircleUserRound,
  Database,
  KeyRound,
  Layers3,
  LockKeyhole,
  Sparkles
} from 'lucide-react'
import type { AccountProfileSummary, ProviderSummary } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import { formatDate } from '../lib'

interface DashboardPageProps {
  providers: ProviderSummary[]
  accounts: AccountProfileSummary[]
  currentAccount?: AccountProfileSummary
  onNavigate(route: RouteId): void
}

export function DashboardPage({
  providers,
  accounts,
  currentAccount,
  onNavigate
}: DashboardPageProps): React.JSX.Element {
  const usableProviders = providers.filter((item) => item.enabled && item.hasApiKey)
  const completed = Number(usableProviders.length > 0) + Number(accounts.length > 0)

  return (
    <div className="page dashboard-page">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={14} /> FIRST WORKING SLICE</span>
          <h2>先把账号定位，做成可靠的创作基线。</h2>
          <p>
            模型调用、密钥、本地数据与版本记录都收进同一个闭环。
            当前版本专注一件事：让每次创作都有清晰、一致、可追溯的账号方向。
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => onNavigate('accounts')}>
              {accounts.length ? '管理账号定位' : '创建第一个账号'}
              <ArrowRight size={16} />
            </button>
            <button className="button secondary" onClick={() => onNavigate('providers')}>
              配置模型网关
            </button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <span className="orbit-core"><Bot size={30} /></span>
          <span className="orbit-node node-a"><KeyRound size={17} /></span>
          <span className="orbit-node node-b"><Database size={17} /></span>
          <span className="orbit-node node-c"><CircleUserRound size={17} /></span>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span className="metric-icon purple"><Layers3 size={18} /></span>
          <div><small>首期完成度</small><strong>{completed} / 2</strong></div>
          <span className="metric-note">网关 + 账号</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><KeyRound size={18} /></span>
          <div><small>可用供应商</small><strong>{usableProviders.length}</strong></div>
          <span className="metric-note">密钥已加密</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon teal"><CircleUserRound size={18} /></span>
          <div><small>账号定位</small><strong>{accounts.length}</strong></div>
          <span className="metric-note">
            {accounts.filter((item) => item.status === 'locked').length} 个已锁定
          </span>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel setup-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">QUICK START</span>
              <h3>完成首次设置</h3>
            </div>
            <span className="progress-label">{completed * 50}%</span>
          </div>
          <div className="progress-track"><span style={{ width: `${completed * 50}%` }} /></div>
          <div className="setup-list">
            <button className="setup-item" onClick={() => onNavigate('providers')}>
              <span className={`setup-check ${usableProviders.length ? 'done' : ''}`}>
                {usableProviders.length ? <Check size={16} /> : '1'}
              </span>
              <span>
                <strong>连接一个模型供应商</strong>
                <small>API Key 仅在本机加密保存</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <button className="setup-item" onClick={() => onNavigate('accounts')}>
              <span className={`setup-check ${accounts.length ? 'done' : ''}`}>
                {accounts.length ? <Check size={16} /> : '2'}
              </span>
              <span>
                <strong>生成并锁定账号定位</strong>
                <small>回答七个问题，得到八项创作基线</small>
              </span>
              <ArrowRight size={16} />
            </button>
          </div>
        </article>

        <article className="panel current-account-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">CURRENT PROFILE</span>
              <h3>当前账号</h3>
            </div>
            {currentAccount?.status === 'locked' && (
              <span className="badge success"><LockKeyhole size={12} />已锁定</span>
            )}
          </div>
          {currentAccount ? (
            <div className="profile-spotlight">
              <span className="profile-avatar">{currentAccount.name.slice(0, 1)}</span>
              <div>
                <h4>{currentAccount.name}</h4>
                <p>{currentAccount.intro || '还没有填写账号简介'}</p>
                <div className="profile-meta">
                  <span>{currentAccount.domain || '未填写领域'}</span>
                  <span>v{currentAccount.versionCount}</span>
                  <span>{formatDate(currentAccount.updatedAt)} 更新</span>
                </div>
              </div>
              <button className="button ghost compact" onClick={() => onNavigate('accounts')}>
                打开
              </button>
            </div>
          ) : (
            <div className="mini-empty">
              <span><CircleUserRound size={25} /></span>
              <div>
                <strong>还没有账号定位</strong>
                <p>创建后，这里会显示当前创作基线。</p>
              </div>
            </div>
          )}
        </article>
      </section>
    </div>
  )
}
