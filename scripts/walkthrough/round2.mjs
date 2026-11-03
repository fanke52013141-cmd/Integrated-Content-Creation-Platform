// R2：热点洞察（真实抓取+AI 智能筛选）→ 选题生成（真实 AI）→ 内容框架 → 文章创作
import { startApp, userDataPath, copyUserData, waitText } from './lib.mjs'

copyUserData(userDataPath('base'), userDataPath('round2'))
const ctx = await startApp({ round: 'round2', userDataDir: userDataPath('round2') })
const { page, shot, nav, step, finish } = ctx

await step('热点洞察：实时热榜加载', async () => {
  await nav('热点洞察')
  await page.waitForTimeout(6000)
  await shot('hotspots-wall')
})

await step('收藏 3 条热点', async () => {
  const buttons = page.locator('button[aria-label="收藏"]')
  await buttons.first().waitFor({ state: 'visible', timeout: 20_000 })
  const n = Math.min(3, await buttons.count())
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click()
    await page.waitForTimeout(500)
  }
  if (n < 3) throw new Error(`只找到 ${n} 条可收藏热点`)
  await shot('hotspots-favorited')
})

await step('AI 智能筛选（真实模型流式调用）', async () => {
  await page.getByRole('button', { name: '智能筛选', exact: true }).first().click()
  await page.waitForTimeout(600)
  await shot('hotspots-filter-dialog')
  await page.getByRole('button', { name: '开始筛选' }).click()
  await page.locator('h3', { hasText: '筛选结果' }).first().waitFor({ state: 'visible', timeout: 180_000 })
  await page.waitForTimeout(4000)
  await shot('hotspots-filter-results')
})

await step('采纳全部高契合热点', async () => {
  const adopt = page.getByRole('button', { name: '采纳全部高契合' })
  if (await adopt.count()) {
    await adopt.click()
    await page.waitForTimeout(1500)
  } else {
    console.log('    (没有高契合项，跳过)')
  }
  await shot('hotspots-adopted')
})

await step('从热点收藏「去生成选题」带关键词进入选题页', async () => {
  const banner = page.getByRole('button', { name: '去生成选题' })
  if (await banner.count()) {
    await banner.first().click()
  } else {
    await page.getByRole('tab', { name: /收藏夹/ }).click()
    await page.waitForTimeout(500)
    await page.locator('button.primary', { hasText: '生成选题' }).first().click()
  }
  await page.waitForTimeout(1200)
  await shot('topics-from-hotspot')
})

await step('选题生成：以账号定位 + 主题生成 3 条（真实 AI）', async () => {
  let textarea = page.locator('textarea[placeholder*="热点关键词"]')
  if (!(await textarea.isVisible().catch(() => false))) {
    await nav('选题生成')
  }
  textarea = page.locator('textarea[placeholder*="热点关键词"]')
  await textarea.fill('AI 对普通上班族的真实影响：哪些工作会被改变，如何提前准备')
  await page.getByRole('button', { name: /生成 \d+ 条选题/ }).click()
  await waitText(page, '选题草稿', 300_000)
  await page.waitForTimeout(5000)
  await shot('topics-generated')
})

await step('选题卡：锁定选题 → 一键「生成框架→」', async () => {
  const lock = page.locator('button[aria-label="锁定选题"]').first()
  await lock.waitFor({ state: 'visible', timeout: 20_000 })
  await lock.click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '生成框架→' }).first().click()
  await page.waitForTimeout(1500)
  await shot('frameworks-from-topic')
})

await step('内容框架：生成 1 个框架（真实 AI）', async () => {
  await page.getByRole('button', { name: '生成框架', exact: true }).click()
  await page.waitForTimeout(5000)
  await shot('frameworks-streaming')
  await waitText(page, '已生成', 300_000)
  await page.waitForTimeout(4000)
  await shot('frameworks-generated')
})

await step('锁定框架 → 「写文章→」进入文章创作', async () => {
  const lock = page.locator('button[aria-label="锁定"]').first()
  if (await lock.count()) {
    await lock.click()
    await page.waitForTimeout(800)
  }
  await page.getByRole('button', { name: '写文章→' }).first().click()
  await page.waitForTimeout(1500)
  await shot('articles-from-framework')
})

await step('文章创作：按框架扩写成稿（真实 AI 流式）', async () => {
  // 若未自动打开 composer，则手动打开
  const composerVisible = await page.locator('textarea[name="manualOutline"]').isVisible().catch(() => false)
  if (!composerVisible) {
    await page.getByRole('button', { name: '新建草稿' }).click()
    await page.waitForTimeout(800)
  }
  await shot('articles-composer')
  const gen = page.getByRole('button', { name: /生成成稿|生成文章|生成/ }).last()
  await gen.click()
  await page.waitForTimeout(15000)
  await shot('articles-streaming')
  await waitText(page, '已生成', 420_000)
  await page.waitForTimeout(3000)
  await shot('articles-generated')
})

await step('编辑正文并保存为新版本', async () => {
  const editor = page.locator('.article-editor textarea, .rich-editor textarea, textarea').first()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\n> 编辑验证：本段由走查脚本追加，用于验证手动编辑与新版本保存。')
  await page.waitForTimeout(500)
  await shot('articles-edited')
  await page.getByRole('button', { name: /保存/ }).first().click()
  await waitText(page, '已保存', 30_000)
  await page.waitForTimeout(1000)
  await shot('articles-version-saved')
})

await finish()
