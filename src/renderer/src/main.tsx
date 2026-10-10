import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ensureMockBridge } from './mock-bridge'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/layouts.css'
import './styles/pages.css'
import './styles/home.css'
import './styles/articles.css'
import './styles/data.css'
import './styles/prompts.css'
import './styles/accounts.css'
import './styles/hotspots.css'
import './styles/topics.css'
import './styles/frameworks.css'
import './styles/reviews.css'
import './styles/visuals.css'
import './styles/layout-workspace.css'
import './styles/publishing.css'
import './styles/materials.css'
import './styles/providers.css'
import './styles/dialogs.css'

// Inject demo bridge when not running inside Electron (browser preview only)
ensureMockBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </StrictMode>
)
