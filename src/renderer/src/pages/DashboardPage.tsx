import {
  ArrowRight,
  Check,
  CircleUserRound,
  ClipboardList,
  KeyRound,
  Layers3,
  Lightbulb,
  LockKeyhole,
  PenLine,
  Send,
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
  const workflow = [
    { label: '准备', icon: ClipboardList, done: accounts.length > 0 },
    { label: '选题', icon: Lightbulb, done: false },
    { label: '写作', icon: PenLine, done: false },
    { label: '优化', icon: Sparkles, done: false },
    { label: '发布', icon: Send, done: false }
  ]

  return (
    <div className="page dashboard-page">
      <section className="workflow-overview panel">
        <div className="workflow-welcome">
          <span className="eyebrow"><Sparkles size={14} /> 欢迎使用心流</span>
          <h2>开始创作</h2>
          <div className="workflow-actions">
            <button className="button primary" onClick={() => onNavigate('accounts')}>
              {accounts.length ? '管理账号定位' : '创建第一个账号'}
              <ArrowRight size={16} />
            </button>
            <button className="button secondary" onClick={() => onNavigate('providers')}>
              配置模型网关
            </button>
          </div>
        </div>
        <div className="workflow-pipeline">
          <span className="workflow-label">内容创作流程</span>
          <div className="workflow-steps">
            {workflow.map((step, index) => {
              const Icon = step.icon
              return (
                <div className={`workflow-step ${step.done ? 'done' : ''}`} key={step.label}>
                  <span className="workflow-step-icon"><Icon size={20} /></span>
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <strong>{step.label}</strong>
                  <em>{step.done ? '已完成' : '未开始'}</em>
                </div>
              )
            })}
          </div>
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
              </span>
              <ArrowRight size={16} />
            </button>
            <button className="setup-item" onClick={() => onNavigate('accounts')}>
              <span className={`setup-check ${accounts.length ? 'done' : ''}`}>
                {accounts.length ? <Check size={16} /> : '2'}
              </span>
              <span>
                <strong>生成并锁定账号定位</strong>
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
              </div>
              <button className="button secondary compact" onClick={() => onNavigate('accounts')}>去创建</button>
            </div>
          )}
          <div className="account-status-row">
            <span><KeyRound size={15} /><small>模型网关</small><strong>{usableProviders.length ? '已连接' : '未配置'}</strong></span>
            <span><CircleUserRound size={15} /><small>账号定位</small><strong>{accounts.length ? '已创建' : '未创建'}</strong></span>
            <span><PenLine size={15} /><small>最近创作</small><strong>暂无记录</strong></span>
          </div>
        </article>
      </section>
    </div>
  )
}
