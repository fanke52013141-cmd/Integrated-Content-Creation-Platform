import {
  ChevronRight,
  CircleUserRound,
  FileText,
  Flame,
  Image,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  Newspaper,
  Palette,
  PenLine,
  Settings2,
  Sparkles,
  Sun,
  WandSparkles
} from 'lucide-react'
import type { AccountProfileSummary, ProviderSummary } from '../../../shared/contracts'

export type RouteId = 'dashboard' | 'accounts' | 'hotspots' | 'topics' | 'frameworks' | 'articles' | 'visuals' | 'reviews' | 'layouts' | 'publishing' | 'materials' | 'providers'

interface LayoutProps {
  route: RouteId
  theme: 'light' | 'dark'
  providers: ProviderSummary[]
  currentAccount?: AccountProfileSummary
  children: React.ReactNode
  onNavigate(route: RouteId): void
  onToggleTheme(): void
}

const navigationItems = [
  { id: 'dashboard' as const, label: '工作台', icon: LayoutDashboard },
  { id: 'accounts' as const, label: '账号定位', icon: CircleUserRound },
  { id: 'hotspots' as const, label: '热点洞察', icon: Flame },
  { id: 'topics' as const, label: '选题生成', icon: Sparkles },
  { id: 'frameworks' as const, label: '内容框架', icon: WandSparkles },
  { id: 'articles' as const, label: '文章创作', icon: PenLine },
  { id: 'materials' as const, label: '素材库', icon: Newspaper },
  { id: 'visuals' as const, label: '智能配图', icon: Image },
  { id: 'reviews' as const, label: '内容评审', icon: FileText },
  { id: 'layouts' as const, label: '文章排版', icon: Palette },
  { id: 'publishing' as const, label: '发布管理', icon: Newspaper }
]

export function Layout({
  route,
  theme,
  providers,
  currentAccount,
  children,
  onNavigate,
  onToggleTheme
}: LayoutProps): React.JSX.Element {
  const usableProviders = providers.filter((item) => item.enabled && item.hasApiKey)
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">跳到主内容</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => onNavigate('dashboard')}>
          <span className="brand-mark"><img src="assets/ui/heartflow-brand.png" alt="" /></span>
          <span>
            <strong>心流</strong>
          </span>
        </button>

        <nav className="navigation" aria-label="主导航">
          {navigationItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${route === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="nav-icon"><Icon size={17} /></span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-system">
          <button
            className={`nav-item ${route === 'providers' ? 'active' : ''}`}
            onClick={() => onNavigate('providers')}
          >
            <span className="nav-icon"><Settings2 size={17} /></span>
            <span>模型网关</span>
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-actions">
            <button className="theme-toggle" onClick={onToggleTheme} aria-label="切换主题">
              <span className={theme === 'light' ? 'active' : ''}><Sun size={15} /></span>
              <span className={theme === 'dark' ? 'active' : ''}><Moon size={15} /></span>
            </button>
            <button className="account-chip" onClick={() => onNavigate('accounts')}>
              <span className="avatar">
                {currentAccount?.name.slice(0, 1) || <CircleUserRound size={17} />}
              </span>
              <span>
                <small>当前账号</small>
                <strong>{currentAccount?.name || '尚未创建'}</strong>
              </span>
              {currentAccount?.status === 'locked' && <LockKeyhole size={14} />}
            </button>
          </div>
        </header>

        {!usableProviders.length && route !== 'providers' && route !== 'materials' && (
          <button className="gateway-banner" onClick={() => onNavigate('providers')}>
            <span><LockKeyhole size={16} />模型网关尚未配置，智能生成功能暂不可用</span>
            <strong>去配置 <ChevronRight size={15} /></strong>
          </button>
        )}

        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </section>
    </div>
  )
}
