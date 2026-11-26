import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-hotspot-status-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate(async () => {
    const bootstrap = await window.moliu.hotspots.bootstrap()
    const results = await window.moliu.hotspots.refresh()
    const weibo = await window.moliu.hotspots.getWeiboStatus()
    return {
      service: bootstrap.service,
      weibo,
      sources: results.map((item) => ({
        id: item.source.id,
        name: item.source.displayName,
        status: item.status,
        error: item.error ?? '',
        count: item.items.length
      }))
    }
  })
  await writeFile(resolve('artifacts/journey-2026-11-26/hotspot-status.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-hotspot-status-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
