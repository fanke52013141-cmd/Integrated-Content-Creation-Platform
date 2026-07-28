import {
  Bot,
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

const activeNavigation = [
  { id: 'dashboard' as const, label: '流水线总览', icon: LayoutDashboard, number: '00' },
  { id: 'accounts' as const, label: '账号定位', icon: CircleUserRound, number: '01' },
  { id: 'hotspots' as const, label: '热点洞察', icon: Flame, number: '02' },
  { id: 'topics' as const, label: '选题生成', icon: Sparkles, number: '03' },
  { id: 'frameworks' as const, label: '内容框架', icon: WandSparkles, number: '04' },
  { id: 'articles' as const, label: '文章创作', icon: PenLine, number: '05' },
  { id: 'visuals' as const, label: '智能配图', icon: Image, number: '07' },
  { id: 'reviews' as const, label: '内容评审', icon: FileText, number: '08' },
  { id: 'layouts' as const, label: '文章排版', icon: Palette, number: '09' },
  { id: 'publishing' as const, label: '发布管理', icon: Newspaper, number: '10' },
  { id: 'materials' as const, label: '素材库', icon: Newspaper, number: '06' }
]

const routeMeta: Record<RouteId, { title: string; eyebrow: string }> = {
  dashboard: { title: '创作工作台', eyebrow: '本地创作流水线' },
  accounts: { title: '账号定位', eyebrow: '定义内容的长期基线' },
  hotspots: { title: '热点洞察', eyebrow: '聚合今天的内容信号' },
  topics: { title: '选题生成', eyebrow: '把内容信号变成可执行方向' },
  frameworks: { title: '内容框架', eyebrow: '用结构化提纲推进文章创作' },
  articles: { title: '文章创作', eyebrow: '从框架写成稿，再持续打磨' },
  visuals: { title: '智能配图', eyebrow: '把文章转成可复用的视觉提示词资产' },
  layouts: { title: '文章排版', eyebrow: '生成适配不同平台的发布内容' },
  publishing: { title: '发布管理', eyebrow: '推送草稿并记录最终发布状态' },
  reviews: { title: '内容评审', eyebrow: '用多个专业视角审阅成稿' },
  materials: { title: '素材库', eyebrow: '搜集并沉淀可引用的创作资料' },
  providers: { title: '模型网关', eyebrow: '连接你的 AI 服务' }
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
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => onNavigate('dashboard')}>
          <span className="brand-mark"><Bot size={22} /></span>
          <span>
            <strong>墨流</strong>
            <small>AI CONTENT STUDIO</small>
          </span>
        </button>

        <nav className="navigation" aria-label="主导航">
          <p className="nav-group-title">当前版本</p>
          {activeNavigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${route === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="nav-icon"><Icon size={17} /></span>
                <span>{item.label}</span>
                <small>{item.number}</small>
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
            <ChevronRight size={15} />
          </button>
          <div className={`gateway-status ${usableProviders.length ? 'online' : ''}`}>
            <span className="status-dot" />
            <div>
              <strong>{usableProviders.length ? '网关可用' : '尚未配置'}</strong>
              <small>
                {usableProviders.length
                  ? `${usableProviders.length} 个供应商已就绪`
                  : '配置后启用 AI 生成'}
              </small>
            </div>
          </div>
        </div>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div>
            <p>{routeMeta[route].eyebrow}</p>
            <h1>{routeMeta[route].title}</h1>
          </div>
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
            <span><LockKeyhole size={16} />模型网关尚未配置，AI 生成功能暂不可用</span>
            <strong>去配置 <ChevronRight size={15} /></strong>
          </button>
        )}

        <main className="content">{children}</main>
      </section>
    </div>
  )
}
