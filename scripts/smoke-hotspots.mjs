import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

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

const observed = { visibleOnWall: 0, discovered: 0 }
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '热点洞察' }).click()
  await window.getByRole('heading', { name: '热点雷达' }).waitFor()

  // F19：默认只展示精选信号源，其余平台要在「平台设置」里仍可发现与打开
  const sourceCards = window.locator('.hotspot-source-rail > div > button')
  await sourceCards.first().waitFor({ timeout: 20_000 })
  const railCount = await sourceCards.count()
  if (railCount < 5) throw new Error(`默认展示的信号源过少，received ${railCount}`)

  await window.getByRole('button', { name: '平台设置' }).click()
  const sourceManager = window.locator('.source-manager-dialog')
  await sourceManager.waitFor()
  const managedSources = sourceManager.locator('.source-manager-list article')
  const sourceCount = await managedSources.count()
  if (sourceCount < 40) {
    throw new Error(`Expected at least 40 discovered sources, received ${sourceCount}`)
  }
  if (railCount >= sourceCount) {
    throw new Error(`平台设置应列出全部信号源：rail ${railCount} / manager ${sourceCount}`)
  }
  await capture(window, {
    path: resolve(artifactDir, 'hotspot-platform-manager.png'),
    fullPage: false,
    animations: 'disabled',
    timeout: 90_000
  })
  const readRows = () => managedSources.evaluateAll((rows) => rows.map((row) => ({
    id: (Array.from(row.querySelector('.source-mark').classList).find((name) => name.startsWith('source-') && name !== 'source-mark') ?? '').slice('source-'.length),
    visible: row.querySelector('input[type="checkbox"]').checked
  })))
  const rowsBeforeDrag = await readRows()
  await managedSources.first().locator('input[type="checkbox"]').uncheck()
  // 拖拽要先在界面上真的换位，再谈有没有落库。Playwright 的原生拖拽模拟在整机负载高时偶发不落地，
  // 所以这里以"界面前后差异"为准并有限重试，而不是硬编码"第一条移到第二条之后"。
  let rowsAfterDrag = rowsBeforeDrag
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await managedSources.first().dragTo(managedSources.nth(1))
    rowsAfterDrag = await readRows()
    if (rowsAfterDrag[0]?.id === rowsBeforeDrag[1].id && rowsAfterDrag[1]?.id === rowsBeforeDrag[0].id) break
    if (attempt === 3) {
      throw new Error(`拖拽排序在界面上没有生效：${rowsBeforeDrag.slice(0, 2).map((row) => row.id).join(' → ')} 拖后 ${rowsAfterDrag.slice(0, 2).map((row) => row.id).join(' → ')}`)
    }
  }
  await sourceManager.getByRole('button', { name: '保存设置' }).click()
  if (await sourceCards.count() !== railCount - 1) {
    throw new Error('Hidden platform remained visible on the hotspot wall')
  }
  const visibleAfterSave = railCount - 1
  observed.visibleOnWall = visibleAfterSave
  observed.discovered = sourceCount
  // 拖拽与显隐必须按界面所见落库
  const persistedOrder = await window.evaluate(async () => {
    const data = await window.moliu.hotspots.bootstrap()
    return data.preferences
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((preference) => ({ id: preference.sourceId, hidden: preference.hidden }))
  })
  const expectedOrder = rowsAfterDrag.map((row) => ({ id: row.id, hidden: !row.visible }))
  observed.order = persistedOrder.slice(0, 3).map((row) => `${row.id}${row.hidden ? '·隐藏' : ''}`).join(' | ')
  if (!expectedOrder.every((row, index) => persistedOrder[index]?.id === row.id && persistedOrder[index]?.hidden === row.hidden)) {
    throw new Error(`平台顺序或显隐未按拖拽结果保存：期望 ${expectedOrder.slice(0, 3).map((row) => `${row.id}${row.hidden ? '·隐藏' : ''}`).join(' | ')}，实际 ${observed.order}`)
  }

  await window.locator('.hotspot-source-rail').getByRole('button', { name: '知乎', exact: true }).click()
  await window.locator('.hotspot-feed > ol').waitFor({ timeout: 90_000 })
  const readyCount = await window.locator('.hotspot-feed > ol').count()
  if (!readyCount) throw new Error('No embedded hotspot source loaded successfully')

  await capture(window, {
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
  const platformFilter = window.locator('.favorite-platform-filter')
  await platformFilter.getByRole('button').click()
  const optionLabels = (await window.getByRole('option').allInnerTexts()).map((label) => label.trim())
  const rowText = await favoriteRow.innerText()
  const matching = optionLabels.find((label) => label !== '全部平台' && rowText.includes(label))
  const other = optionLabels.find((label) => label !== '全部平台' && !rowText.includes(label))
  if (!matching) throw new Error(`无法确定该收藏所属平台，可选项：${optionLabels.join(' / ')}`)
  await window.getByRole('option', { name: matching, exact: true }).click()
  if (await window.locator('.favorite-row').count() !== 1) {
    throw new Error('Favorite platform filter hid the matching favorite')
  }
  if (other) {
    await platformFilter.getByRole('button').click()
    await window.getByRole('option', { name: other, exact: true }).click()
    if (await window.locator('.favorite-row').count() !== 0) {
      throw new Error(`平台筛选「${other}」仍留下了不属于该平台的收藏`)
    }
    await platformFilter.getByRole('button').click()
    await window.getByRole('option', { name: '全部平台', exact: true }).click()
    if (await window.locator('.favorite-row').count() !== 1) {
      throw new Error('切回全部平台后收藏夹没有恢复')
    }
  }
  await capture(window, {
    path: resolve(artifactDir, 'hotspot-favorites.png'),
    fullPage: false,
    animations: 'disabled',
    timeout: 90_000
  })
  console.log(`Embedded hotspot smoke passed: ${sourceCount} sources, ${readyCount} loaded so far, favorite locked`)
} catch (error) {
  // 先把真正的失败原因打出来：诊断截图本身也可能超时，绝不能盖掉原始错误
  console.error(error)
  const windows = application.windows()
  if (windows[0]) {
    try {
      await capture(windows[0], {
        path: resolve(artifactDir, 'embedded-hotspot-failure.png'),
        fullPage: false,
        animations: 'disabled',
        timeout: 90_000
      })
    } catch (screenshotError) {
      console.error(`诊断截图失败: ${screenshotError.message}`)
    }
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
  preferenceRow?.preference_count !== observed.discovered ||
  preferenceRow.hidden_count !== observed.discovered - observed.visibleOnWall
) {
  throw new Error(`Platform visibility or drag ordering was not persisted：${JSON.stringify({ preferenceRow, observed })}`)
}

const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) {
  throw new Error('Refusing to clean an unexpected smoke-test directory')
}
await rm(userDataDir, { recursive: true, force: true })
