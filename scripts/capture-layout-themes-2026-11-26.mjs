import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'

const outDir = resolve('artifacts/layout-themes-2026-11-26')
await mkdir(outDir, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'moliu-layout-theme-shots-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const themes = ['editorial', 'modern', 'forest', 'ink']
  const previews = await page.evaluate(async (ids) => {
    const result = {}
    for (const id of ids) result[id] = await window.moliu.layouts.previewSample({ platform: 'wechat', themeId: id })
    return result
  }, themes)
  for (const [id, preview] of Object.entries(previews)) {
    await writeFile(join(outDir, `${id}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f3f4f6;padding:18px;}article{max-width:375px;margin:0 auto;background:#fff;padding:22px 18px;box-sizing:border-box;}</style></head><body><article>${preview.html}</article></body></html>`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const id of themes) {
    const preview = previews[id]
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f3f4f6;padding:18px;}article{max-width:375px;margin:0 auto;background:#fff;padding:22px 18px;box-sizing:border-box;}</style></head><body><article>${preview.html}</article></body></html>`)
    await page.screenshot({ path: join(outDir, `${id}.png`), fullPage: true, animations: 'disabled' })
  }
  console.log('Layout theme previews saved to', outDir)
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-layout-theme-shots-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
