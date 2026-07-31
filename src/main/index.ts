import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { AppDatabase } from './database.js'
import { ModelGateway } from './gateway/model-gateway.js'
import { registerIpc } from './ipc.js'
import { KeyStore } from './security/key-store.js'
import { AccountGenerator } from './services/account-generator.js'
import { EmbeddedHotService } from './services/embedded-hot-service.js'
import { HotspotFilter } from './services/hotspot-filter.js'
import { HotspotService } from './services/hotspot-service.js'
import { TopicGenerator } from './services/topic-generator.js'
import { MaterialSearchService } from './services/material-search-service.js'
import { FrameworkGenerator } from './services/framework-generator.js'
import { ArticleGenerator } from './services/article-generator.js'
import { ReviewService } from './services/review-service.js'
import { VisualPackGenerator } from './services/visual-pack-generator.js'
import { ArticleLayoutService } from './services/article-layout-service.js'
import { WechatPublishService } from './services/wechat-publish-service.js'

let database: AppDatabase | undefined
let embeddedHotService: EmbeddedHotService | undefined

if (process.env.MOLIU_USER_DATA_DIR) {
  app.setPath('userData', process.env.MOLIU_USER_DATA_DIR)
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#f5f5f7',
    title: '心流',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[did-fail-load]', errorCode, errorDescription)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone]', JSON.stringify(details))
  })
  window.once('ready-to-show', () => window.show())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(() => {
    try {
      const dataPath = app.getPath('userData')
      database = new AppDatabase(join(dataPath, 'moliu.db'))
      const keyStore = new KeyStore(database)
      const gateway = new ModelGateway(database, keyStore)
      const accountGenerator = new AccountGenerator(gateway)
      embeddedHotService = new EmbeddedHotService()
      const hotspotService = new HotspotService(embeddedHotService, database)
      const hotspotFilter = new HotspotFilter(database, gateway)
      const topicGenerator = new TopicGenerator(database, gateway)
      const materialSearchService = new MaterialSearchService(
        database,
        keyStore,
        process.env.MOLIU_DOUBAO_SEARCH_ENDPOINT || undefined
      )
      const frameworkGenerator = new FrameworkGenerator(database, gateway)
      const articleGenerator = new ArticleGenerator(database, gateway)
      const reviewService = new ReviewService(database, gateway, articleGenerator)
      const visualPackGenerator = new VisualPackGenerator(database, gateway)
      const articleLayoutService = new ArticleLayoutService(database)
      const wechatPublishService = new WechatPublishService(database, keyStore, process.env.MOLIU_WECHAT_API_BASE || 'https://api.weixin.qq.com')
      registerIpc({
        database,
        keyStore,
        gateway,
        accountGenerator,
        hotspotFilter,
        hotspotService,
        topicGenerator,
        materialSearchService,
        frameworkGenerator,
        articleGenerator,
        reviewService,
        visualPackGenerator,
        articleLayoutService,
        wechatPublishService,
        dataPath
      })
      createWindow()
    } catch (initError) {
      console.error('[main] initialization failed:', initError)
    }
    void embeddedHotService?.start().catch((error) => {
      console.error('Embedded DailyHotApi failed to start:', error)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((readyError) => {
    console.error('[main] app.whenReady failed:', readyError)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void embeddedHotService?.stop()
  embeddedHotService = undefined
  database?.close()
  database = undefined
})
