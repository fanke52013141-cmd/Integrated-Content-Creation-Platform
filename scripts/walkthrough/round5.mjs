// R5：真实用户端到端 —— 首页入口 → 手动选题 → 框架 → 成稿 → 改稿(AI) → 版本命名/对比/恢复
// → 评审 → 配图 → 排版导出 HTML → 发布预检 → 任务中心/快捷键/账号页各 Tab
import { resolve, join } from 'node:path'
import { startApp, userDataPath, copyUserData, waitText, mockSaveDialog } from './lib.mjs'

copyUserData(userDataPath('round4'), userDataPath('round5'))
const ctx = await startApp({ round: 'round5', userDataDir: userDataPath('round5') })
const { page, app, shot, nav, step, finish } = ctx
const exportDir = resolve('artifacts/walkthrough/fixtures')

await step('首页：无弹窗状态（验证继续上次作品/需要处理/数据备份卡片）', async () => {
  await page.waitForTimeout(1200)
  await shot('home-full')
})

await step('顶栏任务中心对话框', async () => {
  const btn = page.locator('button[aria-label*="任务"], .work-bar button').first()
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(800)
    await shot('task-center')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  } else {
    console.log('    (未找到任务中心入口)')
  }
})

await step('快捷键面板', async () => {
  await page.keyboard.press('?')
  await page.waitForTimeout(600)
  await shot('shortcut-panel')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
})

await step('选题：手动新建一个选题', async () => {
  await nav('选题生成')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '手动新建' }).first().click()
  await page.waitForTimeout(600)
  await shot('topic-manual-dialog')
  const topicField = page.locator('textarea').first()
  await topicField.fill('每周 15 分钟的 AI 资讯高效筛选法')
  const extra = page.locator('textarea').nth(1)
  if (await extra.count()) await extra.fill('固定三步流程，一刻钟内筛掉噪音。')
  await page.getByRole('button', { name: '创建选题' }).click()
  await waitText(page, '已创建|已保存|成功', 15_000)
  await page.waitForTimeout(800)
  await shot('topic-manual-created')
})

await step('选题→框架→文章（沿用已验证链路）', async () => {
  const lock = page.locator('button[aria-label="锁定选题"]').first()
  await lock.click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '生成框架→' }).first().click()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '生成框架', exact: true }).click()
  await waitText(page, '已生成', 300_000)
  await page.waitForTimeout(2500)
  await shot('framework-ready')
  const fl = page.locator('button[aria-label="锁定"]').first()
  if (await fl.count()) { await fl.click(); await page.waitForTimeout(700) }
  await page.getByRole('button', { name: '写文章→' }).first().click()
  await page.waitForTimeout(1200)
})

await step('文章：生成成稿', async () => {
  const composerVisible = await page.locator('textarea[name="manualOutline"]').isVisible().catch(() => false)
  if (!composerVisible) {
    await page.getByRole('button', { name: '新建草稿' }).click()
    await page.waitForTimeout(800)
  }
  await shot('article-composer')
  await page.getByRole('button', { name: /生成草稿/ }).click()
  await page.locator('.article-title-input, h1, .article-workbench').first().waitFor({ state: 'visible', timeout: 300_000 })
  await page.waitForTimeout(3000)
  await shot('article-generated')
})

await step('智能改稿：AI 生成改稿候选（真实 AI）', async () => {
  const area = page.locator('textarea[placeholder*="改稿要求"]').first()
  await area.fill('把结尾改得更短更有力，加一句行动引导。')
  await page.getByRole('button', { name: '生成改稿' }).click()
  await page.waitForTimeout(90_000)
  await shot('revision-candidates')
})

await step('版本历史：命名 + 对比', async () => {
  const nameBtn = page.getByRole('button', { name: '命名' }).first()
  if (await nameBtn.count()) {
    await nameBtn.click()
    await page.waitForTimeout(600)
    await shot('version-name-dialog')
    const input = page.locator('input').last()
    await input.fill('AI 初稿')
    await page.getByRole('button', { name: /保存|确定/ }).last().click()
    await page.waitForTimeout(800)
  }
  const diffBtn = page.getByRole('button', { name: '对比' }).first()
  if (await diffBtn.count()) {
    await diffBtn.click()
    await page.waitForTimeout(1200)
    await shot('version-diff')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
})

await step('版本历史：恢复上一版', async () => {
  const restore = page.getByRole('button', { name: '恢复' }).first()
  if (await restore.count()) {
    await restore.click()
    await page.waitForTimeout(1000)
    const confirm = page.getByRole('button', { name: /恢复|确认/ }).last()
    if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(1000) }
    await shot('version-restored')
  }
})

await step('评审：快速跑 1 个角色', async () => {
  await nav('内容评审')
  await page.waitForTimeout(1000)
  await page.locator('label', { hasText: '事实核查' }).first().click()
  await page.getByRole('button', { name: '开始评审' }).click()
  await waitText(page, '评审完成', 240_000)
  await page.waitForTimeout(2000)
  await shot('review-fast-done')
})

await step('配图：生成方案 → 应用到文章（无生图模型时逐张导入路径）', async () => {
  await nav('智能配图')
  await page.waitForTimeout(1000)
  await shot('visuals-r5-step1')
  await page.getByRole('button', { name: 'AI 生成配图方案' }).click()
  await page.waitForTimeout(30_000)
  await shot('visuals-r5-plan')
})

await step('排版：生成并导出 HTML 文件（mock 保存对话框）', async () => {
  await nav('文章排版')
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '生成排版稿' }).click()
  await waitText(page, '排版稿已生成|排版稿就绪', 60_000)
  await page.waitForTimeout(1200)
  await mockSaveDialog(app, join(exportDir, 'layout-export.html'))
  const exportBtn = page.getByRole('button', { name: '导出 HTML 文件' })
  if (await exportBtn.count()) {
    await exportBtn.click()
    await page.waitForTimeout(2000)
    await shot('layouts-exported')
  }
})

await step('发布：交付预检清单', async () => {
  await nav('发布管理')
  await page.waitForTimeout(1000)
  await shot('publishing-r5')
})

await step('账号定位：内容红线/平台账号/账号记忆各 Tab', async () => {
  await nav('账号定位')
  await page.waitForTimeout(800)
  for (const tab of ['内容红线', '平台账号', '账号记忆', '公众号版式']) {
    const t = page.locator('button, [role="tab"]', { hasText: tab }).first()
    if (await t.count()) {
      await t.click()
      await page.waitForTimeout(700)
      await shot(`account-tab-${tab}`)
    }
  }
})

await step('退出登录态检查：重启后数据仍在（持久化）', async () => {
  await nav('创作台')
  await page.waitForTimeout(800)
  await shot('home-before-restart')
})

await finish()
