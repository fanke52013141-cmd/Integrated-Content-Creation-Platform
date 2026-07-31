import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ensureMockBridge } from './mock-bridge'
import { App } from './App'
import './styles.css'
import './refresh.css'

// Inject demo bridge when not running inside Electron (browser preview only)
ensureMockBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)
