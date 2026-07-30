import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const outputDir = process.env.MOLIU_CAPTURE_DIR
  ? resolve(process.env.MOLIU_CAPTURE_DIR)
  : resolve('artifacts', 'ui-baseline')
const userDataDir = resolve(tmpdir(), `moliu-ui-baseline-${Date.now()}`)
const executablePath = resolve('node_modules/electron/dist/electron.exe')

await mkdir(outputDir, { recursive: true })

const application = await electron.launch({
  executablePath,
  args: ['.'],
  env: {
    ...process.env,
    MOLIU_USER_DATA_DIR: userDataDir
  }
})

const routes = [
  'dashboard',
  'accounts',
  'hotspots',
  'topics',
  'frameworks',
  'articles',
  'materials',
  'visuals',
  'reviews',
  'layouts',
  'publishing',
  'providers'
]

async function visit(window, route, prepareHotspot = true) {
  await window.evaluate((nextRoute) => {
    window.location.hash = `#/${nextRoute}`
  }, route)
  await window.waitForTimeout(route === 'hotspots' ? 1_500 : 450)
  if (route === 'hotspots' && prepareHotspot) {
    const zhihu = window.locator('.hotspot-source-rail > div > button').nth(1)
    await zhihu.waitFor({ timeout: 90_000 })
    await zhihu.click()
    await window.locator('.hotspot-feed > ol').waitFor({ timeout: 90_000 })
  }
}

async function capture(window, name) {
  await window.screenshot({
    path: resolve(outputDir, `${name}.png`),
    animations: 'disabled',
    timeout: 90_000
  })
}

try {
  const window = await application.firstWindow()
  await window.setViewportSize({ width: 1440, height: 900 })
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('heading', { name: '开始创作' }).waitFor()

  for (const [index, route] of routes.entries()) {
    await visit(window, route)
    await capture(window, `${String(index + 1).padStart(2, '0')}-${route}`)
  }

  await visit(window, 'providers')
  await window.getByRole('button', { name: '素材搜索' }).click()
  await capture(window, '13-provider-search')

  await visit(window, 'hotspots', false)
  await window.getByRole('button', { name: '平台设置' }).click()
  await window.getByRole('heading', { name: '管理热榜平台' }).waitFor()
  await capture(window, '14-hotspot-platforms')
  await window.keyboard.press('Escape')

  await visit(window, 'accounts')
  await window.getByRole('button', { name: '开始定位' }).click()
  await window.getByText('建立账号基线').waitFor()
  await capture(window, '15-account-wizard')

  await visit(window, 'materials')
  await window.getByRole('button', { name: '添加文字素材' }).click()
  await window.getByRole('heading', { name: '添加文字素材' }).waitFor()
  await capture(window, '16-material-dialog')
  await window.keyboard.press('Escape')

  await visit(window, 'topics')
  const topicSchemaButton = window.getByRole('button', { name: '配置选题字段' })
  if (await topicSchemaButton.count()) {
    await topicSchemaButton.first().click()
    await window.getByRole('heading', { name: '配置选题字段' }).waitFor()
    await capture(window, '17-topic-schema-dialog')
    await window.keyboard.press('Escape')
  }

  await visit(window, 'frameworks')
  const frameworkTemplateButton = window.getByRole('button', { name: '编辑框架模板' })
  if (await frameworkTemplateButton.count()) {
    await frameworkTemplateButton.first().click()
    const templateHeading = window.getByRole('heading', { name: /框架模板/ })
    if (await templateHeading.count()) {
      await templateHeading.first().waitFor()
      await capture(window, '18-framework-template-dialog')
      await window.keyboard.press('Escape')
    }
  }

  await visit(window, 'reviews')
  const roleButton = window.getByRole('button', { name: '评审角色' })
  if (await roleButton.count()) {
    await roleButton.first().click()
    await window.getByRole('heading', { name: '新建评审角色' }).waitFor()
    await capture(window, '19-review-role-dialog')
    await window.keyboard.press('Escape')
  }

  await visit(window, 'dashboard')
  await window.getByRole('button', { name: '切换主题' }).click()
  await capture(window, '20-dashboard-dark')

  await visit(window, 'accounts')
  await capture(window, '21-accounts-dark')
} finally {
  await application.close()
}

console.log(`Captured UI baseline to ${outputDir}`)
