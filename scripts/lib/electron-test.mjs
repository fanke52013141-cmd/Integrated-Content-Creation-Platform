import { _electron } from 'playwright-core'
import { resolve } from 'node:path'

/** Launch source smoke suites without showing or focusing desktop windows. */
export const electron = {
  launch(options) {
    if (process.env.MOLIU_SMOKE_BACKGROUND === '1') {
      if (process.env.MOLIU_EXECUTABLE) throw new Error('Background smoke currently supports the source checkout only')
      return _electron.launch({...options, args:[resolve('scripts/lib/electron-background.cjs'), ...(options.args ?? []).filter(arg=>arg!=='.')]})
    }
    return _electron.launch(options)
  }
}
