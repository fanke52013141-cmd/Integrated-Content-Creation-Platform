import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  CircleUserRound,
  FileText,
  Flame,
  Image,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Newspaper,
  Palette,
  PenLine,
  Settings2,
  Sparkles,
  Sun,
  WandSparkles,
  Send
} from 'lucide-react'
import type { AccountProfileSummary, ProviderSummary } from '../../../shared/contracts'

export type RouteId = 'accounts' | 'hotspots' | 'topics' | 'frameworks' | 'articles' | 'visuals' | 'reviews' | 'layouts' | 'publishing' | 'materials' | 'providers' | 'prompts'

interface LayoutProps {
  route: RouteId
  theme: 'light' | 'dark'
  providers: ProviderSummary[]
  accounts: AccountProfileSummary[]
  currentAccount?: AccountProfileSummary
  /** 全局生成任务提示文案（如「正在生成选题…」），为空时不显示 */
  generationLabel?: string
  children: React.ReactNode
  onNavigate(route: RouteId, params?: Record<string, string>): void
  onToggleTheme(): void
  onSwitchAccount(id: string): void
}

interface NavItem {
  id: RouteId
  label: string
  icon: typeof CircleUserRound
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: '准备',
    items: [
      { id: 'accounts', label: '账号定位', icon: CircleUserRound },
      { id: 'hotspots', label: '热点洞察', icon: Flame }
    ]
  },
  {
    title: '创作',
    items: [
      { id: 'topics', label: '选题生成', icon: Sparkles },
      { id: 'frameworks', label: '内容框架', icon: WandSparkles },
      { id: 'articles', label: '文章创作', icon: PenLine }
    ]
  },
  {
    title: '辅助',
    items: [
      { id: 'materials', label: '素材库', icon: Newspaper },
      { id: 'visuals', label: '智能配图', icon: Image },
      { id: 'reviews', label: '内容评审', icon: FileText },
      { id: 'layouts', label: '文章排版', icon: Palette }
    ]
  },
  {
    title: '发布',
    items: [
      { id: 'publishing', label: '发布管理', icon: Send }
    ]
  }
]

const routeBreadcrumbs: Record<RouteId, { group: string; label: string }> = {
  accounts: { group: '准备', label: '账号定位' },
  hotspots: { group: '准备', label: '热点洞察' },
  topics: { group: '创作', label: '选题生成' },
  frameworks: { group: '创作', label: '内容框架' },
  articles: { group: '创作', label: '文章创作' },
  visuals: { group: '辅助', label: '智能配图' },
  reviews: { group: '辅助', label: '内容评审' },
  layouts: { group: '辅助', label: '文章排版' },
  materials: { group: '辅助', label: '素材库' },
  publishing: { group: '发布', label: '发布管理' },
  providers: { group: '系统', label: '模型网关' },
  prompts: { group: '系统', label: '提示词' }
}

export function Layout({
  route,
  theme,
  providers,
  accounts,
  currentAccount,
  generationLabel,
  children,
  onNavigate,
  onToggleTheme,
  onSwitchAccount
}: LayoutProps): React.JSX.Element {
  const usableProviders = providers.filter((item) => item.enabled && item.hasApiKey)
  const crumb = routeBreadcrumbs[route]
  const gatewayReady = usableProviders.length > 0
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!accountMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [accountMenuOpen])

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">跳到主内容</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => onNavigate('accounts')}>
          <span className="brand-mark"><img src="assets/ui/heartflow-brand.png" alt="" /></span>
          <span>
            <strong>心流</strong>
          </span>
        </button>

        <nav className="navigation" aria-label="主导航">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <span className="nav-group-title">{group.title}</span>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${route === item.id ? 'active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                  >
                    <span className="nav-icon"><Icon size={16} /></span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-system">
          <button
            className={`nav-item ${route === 'providers' ? 'active' : ''}`}
            onClick={() => onNavigate('providers')}
          >
            <span className="nav-icon"><Settings2 size={16} /></span>
            <span>模型网关</span>
            {usableProviders.length > 0 && (
              <span className="gateway-status-dot ready" />
            )}
          </button>
          <button
            className={`nav-item ${route === 'prompts' ? 'active' : ''}`}
            onClick={() => onNavigate('prompts')}
          >
            <span className="nav-icon"><Braces size={16} /></span>
            <span>提示词</span>
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <nav className="breadcrumb" aria-label="面包屑">
              <span className="breadcrumb-item">{crumb.group}</span>
              <ChevronRight size={13} className="breadcrumb-sep" />
              <span className="breadcrumb-item current">{crumb.label}</span>
            </nav>
            {generationLabel && (
              <span className="generation-chip" role="status">
                <LoaderCircle size={13} className="spin" />
                {generationLabel}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {!gatewayReady && route !== 'providers' && (
              <button
                className="gateway-alert"
                onClick={() => onNavigate('providers', { returnTo: route })}
                title="模型网关尚未配置，智能生成功能暂不可用。点击去配置"
                aria-label="模型网关未配置，点击去配置"
              >
                <AlertTriangle size={15} />
              </button>
            )}
            <button className="theme-toggle" onClick={onToggleTheme} aria-label="切换主题">
              <span className={theme === 'light' ? 'active' : ''}><Sun size={14} /></span>
              <span className={theme === 'dark' ? 'active' : ''}><Moon size={14} /></span>
            </button>
            <div className="account-menu" ref={accountMenuRef}>
              <button
                className={`account-chip ${accountMenuOpen ? 'open' : ''}`}
                onClick={() => {
                  if (accounts.length) setAccountMenuOpen((open) => !open)
                  else onNavigate('accounts')
                }}
                title={accounts.length ? '切换当前账号' : '创建第一个账号'}
              >
                <span className="avatar">
                  {currentAccount?.name.slice(0, 1) || <CircleUserRound size={16} />}
                </span>
                <span>
                  <small>当前账号</small>
                  <strong>{currentAccount?.name || '尚未创建'}</strong>
                </span>
                {currentAccount?.status === 'locked' && <LockKeyhole size={13} />}
              </button>
              {accountMenuOpen && accounts.length > 0 && (
                <div className="account-menu-popover" role="menu">
                  <div className="account-menu-head">切换账号</div>
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      className={`account-menu-item ${account.isCurrent ? 'selected' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false)
                        if (!account.isCurrent) onSwitchAccount(account.id)
                      }}
                    >
                      <span className="avatar">{account.name.slice(0, 1)}</span>
                      <span className="account-menu-item-main">
                        <strong>{account.name}</strong>
                        <small>{account.domain || account.intro || '未填写领域'}</small>
                      </span>
                      {account.status === 'locked' && <LockKeyhole size={12} className="account-menu-lock" />}
                      {account.isCurrent && <Check size={14} className="account-menu-check" />}
                    </button>
                  ))}
                  <button
                    className="account-menu-item manage"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false)
                      onNavigate('accounts')
                    }}
                  >
                    <span className="avatar"><CircleUserRound size={14} /></span>
                    <span className="account-menu-item-main">
                      <strong>管理账号</strong>
                      <small>新建、编辑与切换定位</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </section>
    </div>
  )
}
