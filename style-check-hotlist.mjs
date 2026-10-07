/**
 * 样式核验：打包版（release/win-unpacked/心流.exe，即 启动优化版.cmd 运行的目标）
 * 暗色模式下热点榜单的序号渲染。断言 .hot-item-list 无原生列表序号。
 */
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts/walkthrough')
await mkdir(artifactDir, { recursive: true })
const userDataDir = join(tmpdir(), `moliu-style-check-${Date.now()}`)

const app = await electron.launch({
  executablePath: resolve('release/win-unpacked/心流.exe'),
  args: [],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '创作台', exact: true }).waitFor()
  await page.getByRole('button', { name: '热点洞察' }).click()
  const list = page.locator('.hot-item-list')
  await list.waitFor({ timeout: 60_000 })
  await list.locator('li').first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(800)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(400)

  const check = await page.evaluate(() => {
    const ol = document.querySelector('.hot-item-list')
    const style = getComputedStyle(ol)
    const rank = ol.querySelector('.hot-rank')
    return {
      listStyleType: style.listStyleType,
      rowCount: ol.querySelectorAll('li').length,
      rankText: rank?.textContent?.trim(),
      rankColor: rank ? getComputedStyle(rank).color : '',
      markerAccessibleName: ol.querySelector('li')?.textContent?.slice(0, 24)
    }
  })
  console.log('打包版热榜核验：', JSON.stringify(check, null, 1))
  if (check.listStyleType !== 'none') throw new Error(`原生序号未隐藏：list-style-type=${check.listStyleType}`)
  await page.screenshot({ path: join(artifactDir, 'ui-hotspots-dark-packaged.png'), fullPage: false, animations: 'disabled' })
  console.log('截图：artifacts/walkthrough/ui-hotspots-dark-packaged.png')
} finally {
  await app.close().catch(() => {})
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}
