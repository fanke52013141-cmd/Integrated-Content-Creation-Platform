import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AccountProfileSummary,
  AppBootstrap,
  ProviderSummary
} from '../../shared/contracts'
import { Layout, type RouteId } from './components/Layout'
import { Toast, type ToastState } from './components/Toast'
import { errorMessage } from './lib'
import { AccountPage } from './pages/AccountPage'
import { DashboardPage } from './pages/DashboardPage'
import { HotspotsPage } from './pages/HotspotsPage'
import { TopicsPage } from './pages/TopicsPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { ProvidersPage } from './pages/ProvidersPage'
import { FrameworksPage } from './pages/FrameworksPage'
import { ArticlesPage } from './pages/ArticlesPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { VisualsPage } from './pages/VisualsPage'
import { LayoutsPage } from './pages/LayoutsPage'
import { PublishingPage } from './pages/PublishingPage'

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

export function App(): React.JSX.Element {
  const [route, setRoute] = useState<RouteId>('dashboard')
  const [data, setData] = useState<AppBootstrap>(initialBootstrap)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string>()
  const [toast, setToast] = useState<ToastState>()
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('moliu:theme') === 'dark' ? 'dark' : 'light'
  )

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('moliu:theme', theme)
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(undefined), 4_000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const currentAccount = useMemo<AccountProfileSummary | undefined>(
    () => data.accounts.find((account) => account.isCurrent),
    [data.accounts]
  )

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
        currentAccount={currentAccount}
        onNavigate={setRoute}
        onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
      >
        {route === 'dashboard' && (
          <DashboardPage
            providers={data.providers}
            accounts={data.accounts}
            currentAccount={currentAccount}
            onNavigate={setRoute}
          />
        )}
        {route === 'accounts' && (
          <AccountPage
            accounts={data.accounts}
            providers={data.providers}
            onRefresh={refresh}
            onNavigate={setRoute}
            showToast={setToast}
          />
        )}
        {route === 'providers' && (
          <ProvidersPage
            providers={data.providers as ProviderSummary[]}
            searchService={data.searchService}
            onRefresh={refresh}
            showToast={setToast}
          />
        )}
        {route === 'hotspots' && (
          <HotspotsPage
            accounts={data.accounts}
            providers={data.providers}
            currentAccountId={currentAccount?.id}
            onNavigate={setRoute}
            showToast={setToast}
          />
        )}
        {route === 'topics' && (
          <TopicsPage
            accounts={data.accounts}
            providers={data.providers}
            currentAccountId={currentAccount?.id}
            onNavigate={setRoute}
            showToast={setToast}
          />
        )}
        {route === 'materials' && (
          <MaterialsPage
            searchService={data.searchService}
            onNavigate={setRoute}
            showToast={setToast}
          />
        )}
        {route === 'frameworks' && (
          <FrameworksPage
            accounts={data.accounts}
            providers={data.providers}
            currentAccountId={currentAccount?.id}
            onNavigate={setRoute}
            showToast={setToast}
          />
        )}
        {route === 'articles' && (
          <ArticlesPage
            accounts={data.accounts}
            providers={data.providers}
            currentAccountId={currentAccount?.id}
            onNavigate={setRoute}
            showToast={setToast}
          />
        )}
        {route === 'reviews' && <ReviewsPage providers={data.providers} showToast={setToast} />}
        {route === 'visuals' && <VisualsPage providers={data.providers} showToast={setToast} />}
        {route === 'layouts' && <LayoutsPage showToast={setToast} />}
        {route === 'publishing' && <PublishingPage showToast={setToast} />}
      </Layout>
      <Toast toast={toast} onClose={() => setToast(undefined)} />
    </>
  )
}
