import { _electron } from 'playwright-core'
import { resolve } from 'node:path'

/** Launch source smoke suites without showing or focusing desktop windows. */
export const electron = {
  async launch(options) {
    if (process.env.MOLIU_SMOKE_BACKGROUND === '1') {
      if (process.env.MOLIU_EXECUTABLE) throw new Error('Background smoke currently supports the source checkout only')
      const app = await _electron.launch({...options, args:[resolve('scripts/lib/electron-background.cjs'), ...(options.args ?? []).filter(arg=>arg!=='.')]})
      const firstWindow = app.firstWindow.bind(app)
      let prepared = false
      app.firstWindow = async (...args) => {
        const page = await firstWindow(...args)
        if (!prepared) {
          prepared = true
          await page.waitForLoadState('domcontentloaded')
          await page.evaluate(() => localStorage.setItem('moliu:first-creation-guide:v1', 'done'))
          await page.reload({waitUntil: 'domcontentloaded'})
        }
        return page
      }
      return app
    }
    return _electron.launch(options)
  }
}
