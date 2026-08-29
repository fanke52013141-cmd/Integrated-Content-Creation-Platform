import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts/ui')
await mkdir(artifactDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-ui-shots-${Date.now()}`)

const application = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})

const window = await application.firstWindow()
window.on('pageerror', (error) => console.error(`pageerror: ${error.message}`))
await window.waitForLoadState('domcontentloaded')
await window.waitForTimeout(1_500)

const routes = [
  ['账号定位', 'accounts'],
  ['热点洞察', 'hotspots'],
  ['选题生成', 'topics'],
  ['内容框架', 'frameworks'],
  ['文章创作', 'articles'],
  ['素材库', 'materials'],
  ['智能配图', 'visuals'],
  ['内容评审', 'reviews'],
  ['文章排版', 'layouts'],
  ['发布管理', 'publishing'],
  ['模型网关', 'providers'],
  ['提示词', 'prompts']
]

for (const [label, id] of routes) {
  const nav = window.locator('.nav-item', { hasText: label }).first()
  await nav.click()
  await window.waitForTimeout(900)
  await window.screenshot({ path: resolve(artifactDir, `${id}.png`) })
  console.log(`shot: ${id}`)
}

// 暗色主题抽检三个页面
const darkRoutes = [['账号定位', 'accounts-dark'], ['文章创作', 'articles-dark'], ['发布管理', 'publishing-dark']]
await window.locator('.theme-toggle').click()
for (const [label, id] of darkRoutes) {
  const nav = window.locator('.nav-item', { hasText: label }).first()
  await nav.click()
  await window.waitForTimeout(700)
  await window.screenshot({ path: resolve(artifactDir, `${id}.png`) })
  console.log(`shot: ${id}`)
}

await application.close()
