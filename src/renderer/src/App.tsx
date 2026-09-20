import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate as useRouterNavigate, useSearchParams } from 'react-router-dom'
import type {
  AccountProfileSummary,
  AppBootstrap,
  GenerationDomain,
  GenerationEvent,
  ProviderSummary
} from '../../shared/contracts'
import { GENERATION_DOMAIN_LABELS } from '../../shared/contracts'
import { Layout, type RouteId } from './components/Layout'
import { DOMAIN_ROUTE, TaskCenterDialog } from './components/WorkContext'
import { ActiveWorkProvider, useOpenWork } from './active-work'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toast, type ToastItem, type ToastState } from './components/Toast'
import { useAutoAriaHidden } from './components/Icon'
import { useKeyboardShortcuts } from './components/useKeyboardShortcuts'
import { ShortcutPanel } from './components/ShortcutPanel'
import { errorMessage } from './lib'

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })))
const HotspotsPage = lazy(() => import('./pages/HotspotsPage').then(m => ({ default: m.HotspotsPage })))
const TopicsPage = lazy(() => import('./pages/TopicsPage').then(m => ({ default: m.TopicsPage })))
const MaterialsPage = lazy(() => import('./pages/MaterialsPage').then(m => ({ default: m.MaterialsPage })))
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then(m => ({ default: m.ProvidersPage })))
const FrameworksPage = lazy(() => import('./pages/FrameworksPage').then(m => ({ default: m.FrameworksPage })))
const ArticlesPage = lazy(() => import('./pages/ArticlesPage').then(m => ({ default: m.ArticlesPage })))
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then(m => ({ default: m.ReviewsPage })))
const VisualsPage = lazy(() => import('./pages/VisualsPage').then(m => ({ default: m.VisualsPage })))
const LayoutsPage = lazy(() => import('./pages/LayoutsPage').then(m => ({ default: m.LayoutsPage })))
const PublishingPage = lazy(() => import('./pages/PublishingPage').then(m => ({ default: m.PublishingPage })))
const PromptsPage = lazy(() => import('./pages/PromptsPage').then(m => ({ default: m.PromptsPage })))

const initialBootstrap: AppBootstrap = {
  providers: [],
  searchService: {
    id: 'doubao-custom',
    displayName: '豆包搜索 Custom 版',
    enabled: true,
    hasApiKey: false,
    updatedAt: ''
  },
  accounts: []
}

const ROUTE_IDS: RouteId[] = ['home', 'accounts', 'hotspots', 'topics', 'frameworks', 'articles', 'visuals', 'reviews', 'layouts', 'publishing', 'materials', 'providers', 'prompts']

const DOMAIN_LABELS = GENERATION_DOMAIN_LABELS
const DOMAIN_ROUTES: Record<string, RouteId> = DOMAIN_ROUTE

function AppShell(): React.JSX.Element {
  useAutoAriaHidden()
  const location = useLocation()
  const routerNavigate = useRouterNavigate()
  const route: RouteId = useMemo(() => {
    const pathname = location.pathname.replace(/^\//, '')
    return (ROUTE_IDS as string[]).includes(pathname) ? (pathname as RouteId) : 'home'
  }, [location.pathname])

  const navigate = useCallback((next: RouteId, params?: Record<string, string>): void => {
    const search = params ? `?${new URLSearchParams(params).toString()}` : ''
    routerNavigate(`/${next}${search}`)
  }, [routerNavigate])
  const [searchParams] = useSearchParams()
  const focusArticleId = searchParams.get('articleId') ?? undefined
  const focusTopicId = searchParams.get('topicId') ?? undefined
  const focusFrameworkId = searchParams.get('frameworkId') ?? undefined
  const returnTo = searchParams.get('returnTo') ?? undefined
  const [data, setData] = useState<AppBootstrap>(initialBootstrap)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string>()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [shortcutPanelOpen, setShortcutPanelOpen] = useState(false)
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const openWork = useOpenWork()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // P1-8: 从 DOM 读取由 theme-init.js 预设的 data-theme，避免与初始 HTML 不一致
    const preset = document.documentElement.dataset.theme
    return preset === 'dark' ? 'dark' : 'light'
  })

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const bootstrap = await window.moliu.app.bootstrap()
      setData(bootstrap)
      setFatalError(undefined)
    } catch (error) {
      setFatalError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 带作品参数进入（从首页、任务中心或其他页面的「去某阶段」）→ 立即成为当前作品
  useEffect(() => {
    if (focusArticleId) void openWork(focusArticleId, route).catch(() => undefined)
  }, [focusArticleId, openWork])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('moliu:theme', theme)
  }, [theme])

  const showToast = useCallback((toast: ToastState): void => {
    const item: ToastItem = { ...toast, id: Date.now() + Math.random() }
    // 最多同时保留 3 条，错误常驻直到手动关闭
    setToasts((current) => [...current.slice(-2), item])
    if (toast.type !== 'error') {
      window.setTimeout(() => {
        setToasts((current) => current.filter((entry) => entry.id !== item.id))
      }, 4_500)
    }
  }, [])

  const dismissToast = useCallback((id: number): void => {
    setToasts((current) => current.filter((entry) => entry.id !== id))
  }, [])

  // 全局生成任务指示：订阅主进程生命周期事件，顶栏展示运行中任务，跨页面提醒完成/失败
  const routeRef = useRef(route)
  useEffect(() => { routeRef.current = route }, [route])
  const [runningDomains, setRunningDomains] = useState<GenerationDomain[]>([])
  useEffect(() => {
    let alive = true
    void window.moliu.generation.active()
      .then((domains) => { if (alive) setRunningDomains(domains) })
      .catch(() => undefined)
    const unsubscribe = window.moliu.generation.events((event: GenerationEvent) => {
      setRunningDomains((current) => {
        const next = current.filter((domain) => domain !== event.domain)
        if (event.status === 'started') next.push(event.domain)
        return next
      })
      const label = DOMAIN_LABELS[event.domain] ?? event.domain
      const onSamePage = DOMAIN_ROUTES[event.domain] === routeRef.current
      if (event.status === 'done' && !onSamePage) {
        showToast({ type: 'success', message: `${label}生成完成，可查看结果` })
      }
      if (event.status === 'failed' && !/已取消/.test(event.message ?? '')) {
        showToast({ type: 'error', message: `${label}生成失败：${(event.message ?? '未知错误').slice(0, 80)}` })
      }
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [showToast])
  const generationLabel = useMemo(() => {
    if (!runningDomains.length) return undefined
    if (runningDomains.length === 1) return `正在生成${DOMAIN_LABELS[runningDomains[0]] ?? runningDomains[0]}…`
    return `${runningDomains.length} 个生成任务进行中`
  }, [runningDomains])

  useKeyboardShortcuts({
    onNew: () => navigate('articles'),
    onSearch: () => navigate('materials'),
    onNavigate: (next) => navigate(next),
    onShowShortcuts: () => setShortcutPanelOpen(true)
  })

  const currentAccount = useMemo<AccountProfileSummary | undefined>(
    () => data.accounts.find((account) => account.isCurrent),
    [data.accounts]
  )

  const handleSwitchAccount = useCallback(async (id: string): Promise<void> => {
    try {
      await window.moliu.accounts.setCurrent(id)
      await refresh()
      const target = data.accounts.find((account) => account.id === id)
      showToast({ type: 'success', message: `已切换当前账号：${target?.name ?? id}` })
    } catch (error) {
      showToast({ type: 'error', message: `切换账号失败：${errorMessage(error)}` })
    }
  }, [refresh, showToast, data.accounts])

  if (loading) {
    return (
      <div className="boot-screen">
        <span className="boot-mark">墨</span>
        <span className="spinner" />
        <p>正在打开本地工作区</p>
      </div>
    )
  }

  if (fatalError) {
    return (
      <div className="boot-screen error-state">
        <span className="boot-mark">!</span>
        <h1>本地工作区加载失败</h1>
        <p>{fatalError}</p>
        <button className="button primary" onClick={() => void refresh()}>重试</button>
      </div>
    )
  }

  return (
    <>
      <Layout
        route={route}
        theme={theme}
        providers={data.providers}
        accounts={data.accounts}
        currentAccount={currentAccount}
        generationLabel={generationLabel}
        onNavigate={navigate}
        onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        onSwitchAccount={(id) => void handleSwitchAccount(id)}
        onShowTasks={() => setTaskCenterOpen(true)}
      >
        {/* 页面级错误边界：某一页渲染崩溃只停在这一页，不带走整个应用，也不丢已保存的作品 */}
        <ErrorBoundary key={route} onReset={() => navigate('home')}>
          <Suspense fallback={<PageFallback />}>
            {route === 'home' && (
              <HomePage
                accounts={data.accounts}
                providers={data.providers}
                onNavigate={navigate}
                onShowTasks={() => setTaskCenterOpen(true)}
                showToast={showToast}
              />
            )}
            {route === 'accounts' && (
            <AccountPage
              accounts={data.accounts}
              providers={data.providers}
              onRefresh={refresh}
              onNavigate={navigate}
              showToast={showToast}
            />
          )}
          {route === 'providers' && (
            <ProvidersPage
              providers={data.providers as ProviderSummary[]}
              searchService={data.searchService}
              onRefresh={refresh}
              onNavigate={navigate}
              returnTo={returnTo}
              showToast={showToast}
            />
          )}
          {route === 'hotspots' && (
            <HotspotsPage
              accounts={data.accounts}
              providers={data.providers}
              currentAccountId={currentAccount?.id}
              onNavigate={navigate}
              showToast={showToast}
            />
          )}
          {route === 'topics' && (
            <TopicsPage
              accounts={data.accounts}
              providers={data.providers}
              currentAccountId={currentAccount?.id}
              onNavigate={navigate}
              showToast={showToast}
            />
          )}
          {route === 'materials' && (
            <MaterialsPage
              searchService={data.searchService}
              onNavigate={navigate}
              focusArticleId={focusArticleId}
              returnTo={returnTo}
              showToast={showToast}
            />
          )}
          {route === 'frameworks' && (
            <FrameworksPage
              accounts={data.accounts}
              providers={data.providers}
              currentAccountId={currentAccount?.id}
              onNavigate={navigate}
              focusTopicId={focusTopicId}
              showToast={showToast}
            />
          )}
          {route === 'articles' && (
            <ArticlesPage
              accounts={data.accounts}
              providers={data.providers}
              currentAccountId={currentAccount?.id}
              onNavigate={navigate}
              focusFrameworkId={focusFrameworkId}
              focusArticleId={focusArticleId}
              importMode={searchParams.get('import') === '1'}
              showToast={showToast}
            />
          )}
          {route === 'reviews' && <ReviewsPage providers={data.providers} onNavigate={navigate} focusArticleId={focusArticleId} showToast={showToast} />}
          {route === 'visuals' && <VisualsPage providers={data.providers} onNavigate={navigate} focusArticleId={focusArticleId} showToast={showToast} />}
          {route === 'layouts' && <LayoutsPage onNavigate={navigate} focusArticleId={focusArticleId} showToast={showToast} />}
          {route === 'publishing' && <PublishingPage onNavigate={navigate} focusArticleId={focusArticleId} currentAccount={currentAccount} showToast={showToast} />}
          {route === 'prompts' && <PromptsPage showToast={showToast} />}
        </Suspense>
        </ErrorBoundary>
      </Layout>
      <TaskCenterDialog open={taskCenterOpen} onClose={() => setTaskCenterOpen(false)} onNavigate={navigate} />
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <ShortcutPanel open={shortcutPanelOpen} onClose={() => setShortcutPanelOpen(false)} />
    </>
  )
}

export function App(): React.JSX.Element {
  return (
    <ActiveWorkProvider>
      <AppShell />
    </ActiveWorkProvider>
  )
}

function PageFallback(): React.JSX.Element {
  return (
    <div className="page-suspense-fallback">
      <span className="spinner" />
    </div>
  )
}
