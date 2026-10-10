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
import { ALL_ROUTE_IDS } from '../../shared/creation-flow'
import { DOMAIN_ROUTE, TaskCenterDialog } from './components/WorkContext'
import { ActiveWorkProvider, useOpenWork } from './active-work'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toast, type ToastItem, type ToastState } from './components/Toast'
import { useAutoAriaHidden } from './components/Icon'
import { useKeyboardShortcuts } from './components/useKeyboardShortcuts'
import { ShortcutPanel } from './components/ShortcutPanel'
import { errorMessage } from './lib'

const DataPage = lazy(() => import('./pages/DataPage').then(m => ({ default: m.DataPage })))
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

// 合法路由来自 shared/creation-flow 的单一事实来源，不再手写第四份清单
const ROUTE_IDS: readonly string[] = ALL_ROUTE_IDS

const DOMAIN_LABELS = GENERATION_DOMAIN_LABELS
const DOMAIN_ROUTES: Record<string, RouteId> = DOMAIN_ROUTE

function AppShell(): React.JSX.Element {
  useAutoAriaHidden()
  const location = useLocation()
  const routerNavigate = useRouterNavigate()
  const route: RouteId = useMemo(() => {
    const pathname = location.pathname.replace(/^\//, '')
    return ROUTE_IDS.includes(pathname) ? (pathname as RouteId) : 'home'
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

  // 缺模型的报错高频出现，统一给「去配置」出口，不再让用户自己去侧栏找
  const MODEL_REQUIRED_PATTERN = /(请先配置|请选择)[^\n。]*(模型|AI 服务)|(没有|暂无|尚未)[^\n。]*可用模型|(请先在|请到)[^\n。]*「?AI\s*服务」?[^\n。]*配置|没有可用的文本模型/
  const toastTimers = useRef(new Map<number, number>())
  const removeToast = useCallback((id: number): void => {
    const timer = toastTimers.current.get(id)
    if (timer !== undefined) { window.clearTimeout(timer); toastTimers.current.delete(id) }
    setToasts((current) => current.filter((entry) => entry.id !== id))
  }, [])
  const showToast = useCallback((toast: ToastState): void => {
    const duration = toast.type === 'error' ? 8_000 : toast.type === 'warning' ? 6_000 : 4_500
    const item: ToastItem = { ...toast, id: Date.now() + Math.random() }
    if ((toast.type === 'error' || toast.type === 'warning') && !item.action && MODEL_REQUIRED_PATTERN.test(item.message)) {
      item.action = { label: '去配置', onClick: () => navigate('providers') }
    }
    // 同文案去重：保留原节点原地不动（避免 React 重建节点导致闪烁），
    // 只重置它的自动消失计时；没有重复才追加，最多同时 3 条
    setToasts((current) => {
      const existing = current.find((entry) => entry.message === item.message)
      if (existing) {
        const timer = toastTimers.current.get(existing.id)
        if (timer !== undefined) window.clearTimeout(timer)
        toastTimers.current.set(existing.id, window.setTimeout(() => removeToast(existing.id), duration))
        return current
      }
      toastTimers.current.set(item.id, window.setTimeout(() => removeToast(item.id), duration))
      return [...current.slice(-2), item]
    })
  }, [navigate, removeToast])

  const dismissToast = useCallback((id: number): void => {
    removeToast(id)
  }, [removeToast])

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
        showToast({ type: event.outcome === 'partial' ? 'warning' : event.outcome === 'cancelled' ? 'info' : 'success', message: event.message || `${label}生成完成，可查看结果` })
      }
      if (event.status === 'failed' && event.outcome !== 'cancelled' && !/已取消/.test(event.message ?? '')) {
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
        providers={data.providers}
        accounts={data.accounts}
        currentAccount={currentAccount}
        generationLabel={generationLabel}
        onNavigate={navigate}
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
          {route === 'data' && <DataPage showToast={showToast} />}
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
              focusTopicId={focusTopicId}
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
            <ArticlesPage dirtyOnly={searchParams.get('dirty') === '1'}
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
