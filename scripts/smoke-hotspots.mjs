import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const executablePath = process.env.MOLIU_EXECUTABLE
  ? resolve(process.env.MOLIU_EXECUTABLE)
  : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-hotspot-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })

const application = await electron.launch({
  executablePath,
  args: applicationArgs,
  env: {
    ...process.env,
    MOLIU_USER_DATA_DIR: userDataDir
  }
})

try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '热点洞察' }).click()
  await window.getByRole('heading', { name: '热点雷达' }).waitFor()

  const sourceCards = window.locator('.hotspot-source-rail > div > button')
  await sourceCards.nth(39).waitFor({ timeout: 20_000 })
  const sourceCount = await sourceCards.count()
  if (sourceCount < 40) {
    throw new Error(`Expected at least 40 discovered sources, received ${sourceCount}`)
  }

  await window.getByRole('button', { name: '平台设置' }).click()
  const sourceManager = window.locator('.source-manager-dialog')
  await sourceManager.waitFor()
  const managedSources = sourceManager.locator('.source-manager-list article')
  if (await managedSources.count() !== sourceCount) {
    throw new Error('Platform manager did not expose all discovered sources')
  }
  await window.screenshot({
    path: resolve(artifactDir, 'hotspot-platform-manager.png'),
    fullPage: false,
    animations: 'disabled',
    timeout: 90_000
  })
  await managedSources.first().locator('input[type="checkbox"]').uncheck()
  await managedSources.first().dragTo(managedSources.nth(1))
  await sourceManager.getByRole('button', { name: '保存设置' }).click()
  if (await sourceCards.count() !== sourceCount - 1) {
    throw new Error('Hidden platform remained visible on the hotspot wall')
  }

  await window.locator('.hotspot-source-rail').getByRole('button', { name: '知乎', exact: true }).click()
  await window.locator('.hotspot-feed > ol').waitFor({ timeout: 90_000 })
  const readyCount = await window.locator('.hotspot-feed > ol').count()
  if (!readyCount) throw new Error('No embedded hotspot source loaded successfully')

  await window.screenshot({
    path: resolve(artifactDir, 'embedded-hotspot-wall.png'),
    fullPage: false,
    animations: 'disabled',
    timeout: 90_000
  })

  const favoriteButton = window.locator('.hot-favorite-button:not(.active)').first()
  await favoriteButton.click()
  await window.getByText('已锁定源数据并加入收藏').waitFor()
  await window.getByRole('button', { name: /收藏夹 1/ }).click()
  const favoriteRow = window.locator('.favorite-row').first()
  await favoriteRow.waitFor()
  await favoriteRow.getByText('源快照已锁定').waitFor()
  const usedTag = favoriteRow.getByRole('button', { name: '已用' })
  await usedTag.click()
  await window.waitForTimeout(400)
  await usedTag.evaluate((element) => {
    if (!element.classList.contains('active')) throw new Error('Used tag did not persist in the UI')
  })
  const platformFilter = window.locator('.favorite-platform-filter select')
  await platformFilter.selectOption({ index: 1 })
  if (await window.locator('.favorite-row').count() !== 1) {
    throw new Error('Favorite platform filter hid the matching favorite')
  }
  await window.screenshot({
    path: resolve(artifactDir, 'hotspot-favorites.png'),
    fullPage: false,
    animations: 'disabled',
    timeout: 90_000
  })
  console.log(`Embedded hotspot smoke passed: ${sourceCount} sources, ${readyCount} loaded so far, favorite locked`)
} catch (error) {
  const windows = application.windows()
  if (windows[0]) {
    await windows[0].screenshot({
      path: resolve(artifactDir, 'embedded-hotspot-failure.png'),
      fullPage: false
    })
    console.error(`renderer:body: ${(await windows[0].locator('body').innerText()).slice(0, 2_000)}`)
  }
  throw error
} finally {
  await application.close()
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const favoriteRow = database.prepare(`
  SELECT f.title, COUNT(t.tag) AS tag_count
  FROM hot_favorites f
  LEFT JOIN hot_favorite_tags t ON t.favorite_id = f.id
  GROUP BY f.id
`).get()
const preferenceRow = database.prepare(`
  SELECT
    COUNT(*) AS preference_count,
    SUM(hidden) AS hidden_count,
    (SELECT source_id FROM hot_source_preferences ORDER BY sort_order ASC LIMIT 1) AS first_source
  FROM hot_source_preferences
`).get()
database.close()
if (!favoriteRow?.title || favoriteRow.tag_count !== 2) {
  throw new Error('Locked hotspot favorite or its tags were not persisted')
}
if (
  preferenceRow?.preference_count < 40 ||
  preferenceRow.hidden_count !== 1 ||
  preferenceRow.first_source !== 'zhihu'
) {
  throw new Error('Platform visibility or drag ordering was not persisted')
}

const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) {
  throw new Error('Refusing to clean an unexpected smoke-test directory')
}
await rm(userDataDir, { recursive: true, force: true })
