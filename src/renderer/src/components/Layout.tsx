import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  FolderArchive,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Flame,
  House,
  Image,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Newspaper,
  PenLine,
  Send,
  Settings2,
  Sparkles,
  Sun,
  WandSparkles,
  FileText,
  Palette,
  ListChecks
} from 'lucide-react'
import type { AccountProfileSummary, ProviderSummary } from '../../../shared/contracts'
import {
  HOME_STAGE,
  RESOURCE_ROUTES,
  ROUTE_GROUPS,
  ROUTE_LABELS,
  WORKBAR_STAGES,
  buildSidebarGroups,
  type NavGroupTitle,
  type RouteId
} from '../../../shared/creation-flow'
import { WorkBar } from './WorkContext'
import { useActiveWork } from '../active-work'

/**
 * 侧边栏图标表：仅提供视觉，不参与顺序 —— 顺序统一由 shared/creation-flow 决定。
 * 新增页面时在此登记图标即可，不必改导航结构。
 */
const NAV_ICONS: Partial<Record<RouteId, typeof CircleUserRound>> = {
  home: House,
  accounts: CircleUserRound,
  hotspots: Flame,
  topics: Sparkles,
  frameworks: WandSparkles,
  articles: PenLine,
  reviews: FileText,
  visuals: Image,
  layouts: Palette,
  publishing: Send,
  materials: Newspaper
}

/** 总览入口 */
const homeNavItem = { id: HOME_STAGE.id as RouteId, label: HOME_STAGE.sidebarLabel, icon: NAV_ICONS.home! }

/** 侧边栏分组：完全由 creation-flow 派生，顺序与顶部流水线严格一致 */
const sidebarGroups = buildSidebarGroups()

const resourceItems = RESOURCE_ROUTES.map((id) => ({
  id,
  label: ROUTE_LABELS[id],
  icon: NAV_ICONS[id] ?? Newspaper
}))

/** 系统组在侧边栏底部独立渲染，与创作链路分隔 */
const SYSTEM_ITEMS: RouteId[] = ['data', 'providers', 'prompts']

/**
 * 创作链路较长（9 步），默认展开会把它顶到视口之外，
 * 资源与系统区必须保证随时可达，因此只有创作组可折叠，且**会自动展开**。
 *
 * 折叠状态由组件自己维护（不落盘、不进 URL）：
 * 用户的选择属于临时的界面偏好，不该污染导航数据本身。
 */
const COLLAPSIBLE_GROUPS = new Set<NavGroupTitle>(['创作'])

export type { RouteId }

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
  onShowTasks(): void
}

interface NavItem {
  id: RouteId
  label: string
  icon: typeof CircleUserRound
}

const routeBreadcrumbs = (route: RouteId): { group: string; label: string } => ({
  group: ROUTE_GROUPS[route] ?? '',
  label: ROUTE_LABELS[route] ?? route
})

export function Layout({
  route,
  theme,
  providers,
  accounts,
  currentAccount,
  generationLabel,
  children,
  onNavigate: navigate,
  onToggleTheme,
  onSwitchAccount,
  onShowTasks
}: LayoutProps): React.JSX.Element {
  const { work } = useActiveWork()
  const onNavigate = (next: RouteId, params?: Record<string, string>): void => {
    // 成稿之后的阶段默认携带当前作品；阶段集合来自 creation-flow 单一事实来源，不再手写副本
    const carriesWork = WORKBAR_STAGES.some((stage) => stage.id === next)
    navigate(next, params ?? (carriesWork && work ? { articleId: work.articleId } : undefined))
  }

  const usableProviders = providers.filter((item) => item.enabled && item.hasApiKey)
  const crumb = routeBreadcrumbs(route)
  const gatewayReady = usableProviders.length > 0
  // 只有真正通过连通性验证才显示绿色，避免用"配置已保存"冒充"已连通"
  const gatewayState = usableProviders.length === 0 ? undefined
    : usableProviders.some((item) => item.verification.verified)
      ? { state: 'ready', label: '模型网关已验证连通' }
      : usableProviders.some((item) => item.verification.lastTestStatus === 'failure')
        ? { state: 'failed', label: '模型网关最近一次验证失败' }
        : { state: 'unverified', label: '模型网关已配置，尚未验证连通' }
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)

  /** 创作组默认展开（9 步是主链路，收起会让主导航失去意义） */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())

  // 路由落在被折叠的组内时自动展开——否则用户点了别处的入口后，
  // 侧边栏会看不到自己当前所在的位置。
  useEffect(() => {
    const owning = sidebarGroups.find((group) => group.items.some((stage) => stage.id === route))
    if (!owning || !COLLAPSIBLE_GROUPS.has(owning.title)) return
    setCollapsedGroups((current) => {
      if (!current.has(owning.title)) return current
      const next = new Set(current)
      next.delete(owning.title)
      return next
    })
  }, [route])

  const toggleGroup = (title: NavGroupTitle): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  useEffect(() => {
    if (!accountMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [accountMenuOpen])

  useEffect(() => {
    if (!accountMenuOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setAccountMenuOpen(false)
      accountTriggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [accountMenuOpen])

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">跳到主内容</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => onNavigate('home')} aria-label="返回创作台">
          <span className="brand-mark"><img src="assets/ui/heartflow-brand.png" alt="" /></span>
          <span>
            <strong>心流</strong>
          </span>
        </button>

        <nav className="navigation" aria-label="主导航">
          <div className="nav-group">
            <span className="nav-group-title">{HOME_STAGE.group}</span>
            <button
              className={`nav-item ${route === homeNavItem.id ? 'active' : ''}`}
              onClick={() => onNavigate(homeNavItem.id)}
              aria-current={route === homeNavItem.id ? 'page' : undefined}
            >
              <span className="nav-icon">{(() => { const Icon = homeNavItem.icon; return <Icon size={16} /> })()}</span>
              <span>{homeNavItem.label}</span>
            </button>
          </div>

          {/* 创作主链路：顺序与顶部流水线一致。
              2026-10-06：分组标题改为可折叠按钮，长链路默认收起其余始终可达。 */}
          {sidebarGroups.map((group) => {
            const collapsible = COLLAPSIBLE_GROUPS.has(group.title)
            const collapsed = collapsedGroups.has(group.title)
            const groupActive = group.items.some((stage) => stage.id === route)
            return (
              <div className={`nav-group nav-group-flow ${collapsed ? 'collapsed' : ''}`} key={group.title}>
                {collapsible ? (
                  <button
                    type="button"
                    className="nav-group-toggle"
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroup(group.title)}
                  >
                    <ChevronDown size={13} className="nav-group-caret" />
                    <span>{group.title}</span>
                    <small>{group.items.length}</small>
                  </button>
                ) : (
                  <span className="nav-group-title">{group.title}</span>
                )}
                {!collapsed && group.items.map((stage) => {
                const Icon = NAV_ICONS[stage.id] ?? CircleUserRound
                return (
                  <button
                    key={stage.id}
                    className={`nav-item ${route === stage.id ? 'active' : ''}`}
                    onClick={() => onNavigate(stage.id)}
                    aria-current={route === stage.id ? 'page' : undefined}
                  >
                    <span className="nav-icon"><Icon size={16} /></span>
                    <span>{stage.sidebarLabel}</span>
                    {stage.optional && <span className="nav-item-hint">可选</span>}
                  </button>
                )
                })}
                {/* 收起时用当前阶段名作为入口标签，避免"创作"二字下面什么都没有 */}
                {collapsed && groupActive && (
                  <span className="nav-group-current">
                    {group.items.find((stage) => stage.id === route)?.sidebarLabel}
                  </span>
                )}
              </div>
            )
          })}

          {/* 资源区：素材库是输入来源而非创作阶段，单独分区避免与主链路混读 */}
          {resourceItems.length > 0 && (
            <div className="nav-group nav-group-resources">
              <span className="nav-group-title">资源</span>
              {resourceItems.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${route === item.id ? 'active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                    aria-current={route === item.id ? 'page' : undefined}
                  >
                    <span className="nav-icon"><Icon size={16} /></span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </nav>

        {/* 系统：与「创作」「资源」并列的第三组（2026-10-06）。
              网关状态点留在「AI 服务」行内——它是该行的状态，不是组的状态。 */}
        <div className="sidebar-system">
          <span className="nav-group-title">系统</span>
          <button className={`nav-item ${route === 'data' ? 'active' : ''}`} onClick={() => onNavigate('data')}><span className="nav-icon"><FolderArchive size={16} /></span><span>数据与备份</span></button>
          <button
            className={`nav-item ${route === 'providers' ? 'active' : ''}`}
            onClick={() => onNavigate('providers')}
          >
            <span className="nav-icon"><Settings2 size={16} /></span>
            <span>AI 服务</span>
            {gatewayState && (
              <span className={`gateway-status-dot ${gatewayState.state}`} title={gatewayState.label} aria-label={gatewayState.label} />
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
            <button className="icon-button task-center-button" onClick={onShowTasks} aria-label="任务中心" title="任务中心"><ListChecks size={15} /></button>
            <button className="theme-toggle" onClick={onToggleTheme} aria-label="切换主题">
              <span className={theme === 'light' ? 'active' : ''}><Sun size={14} /></span>
              <span className={theme === 'dark' ? 'active' : ''}><Moon size={14} /></span>
            </button>
            <div className="account-menu" ref={accountMenuRef}>
              <button
                ref={accountTriggerRef}
                className={`account-chip ${accountMenuOpen ? 'open' : ''}`}
                onClick={() => {
                  if (accounts.length) setAccountMenuOpen((open) => !open)
                  else onNavigate('accounts')
                }}
                title={accounts.length ? '切换当前账号' : '创建第一个账号'}
                aria-haspopup={accounts.length ? 'dialog' : undefined}
                aria-expanded={accounts.length ? accountMenuOpen : undefined}
                aria-controls={accounts.length ? 'account-switcher' : undefined}
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
                <div className="account-menu-popover" id="account-switcher" role="dialog" aria-label="切换当前账号">
                  <div className="account-menu-head">切换账号</div>
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      className={`account-menu-item ${account.isCurrent ? 'selected' : ''}`}
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

        <WorkBar accounts={accounts} onNavigate={onNavigate} />
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </section>
    </div>
  )
}
