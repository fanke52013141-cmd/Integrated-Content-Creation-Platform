import {
  Braces,
  ChevronRight,
  CircleUserRound,
  FileText,
  Flame,
  Image,
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
  currentAccount?: AccountProfileSummary
  children: React.ReactNode
  onNavigate(route: RouteId): void
  onToggleTheme(): void
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
  currentAccount,
  children,
  onNavigate,
  onToggleTheme
}: LayoutProps): React.JSX.Element {
  const usableProviders = providers.filter((item) => item.enabled && item.hasApiKey)
  const crumb = routeBreadcrumbs[route]

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
          </div>
          <div className="topbar-actions">
            <button className="theme-toggle" onClick={onToggleTheme} aria-label="切换主题">
              <span className={theme === 'light' ? 'active' : ''}><Sun size={14} /></span>
              <span className={theme === 'dark' ? 'active' : ''}><Moon size={14} /></span>
            </button>
            <button className="account-chip" onClick={() => onNavigate('accounts')}>
              <span className="avatar">
                {currentAccount?.name.slice(0, 1) || <CircleUserRound size={16} />}
              </span>
              <span>
                <small>当前账号</small>
                <strong>{currentAccount?.name || '尚未创建'}</strong>
              </span>
              {currentAccount?.status === 'locked' && <LockKeyhole size={13} />}
            </button>
          </div>
        </header>

        {!usableProviders.length && route !== 'providers' && route !== 'materials' && (
          <button className="gateway-banner" onClick={() => onNavigate('providers')}>
            <span><LockKeyhole size={15} />模型网关尚未配置，智能生成功能暂不可用</span>
            <strong>去配置 <ChevronRight size={14} /></strong>
          </button>
        )}

        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </section>
    </div>
  )
}
