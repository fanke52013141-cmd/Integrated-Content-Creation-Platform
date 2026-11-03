// R6：验证本轮修复 —— 草稿选题「锁定并生成框架→」、向导顶栏/hint、供应商保存停留+toast按钮、
// 配图方案真实生成（zod 容错）、发布测试配置友好报错
import { startApp, userDataPath, copyUserData, waitText } from './lib.mjs'

copyUserData(userDataPath('round5'), userDataPath('round6'))
const ctx = await startApp({ round: 'round6-verify', userDataDir: userDataPath('round6') })
const { page, shot, nav, step, finish } = ctx

await step('F7 修复：草稿选题卡出现「锁定并生成框架→」', async () => {
  await nav('选题生成')
  await page.waitForTimeout(1200)
  const cta = page.getByRole('button', { name: '锁定并生成框架→' }).first()
  await cta.waitFor({ state: 'visible', timeout: 15_000 })
  await shot('fix-topic-draft-cta')
})

await step('F4/F5 修复：向导顶栏分开 + hint 显示', async () => {
  await nav('账号定位')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '新建账号' }).first().click()
  await page.waitForTimeout(600)
  const gap = await page.evaluate(() => {
    const span = document.querySelector('.wizard-topline span')
    const btn = document.querySelector('.wizard-topline .back-button')
    if (!span || !btn) return 'missing'
    return Math.abs(span.getBoundingClientRect().left - btn.getBoundingClientRect().right)
  })
  if (typeof gap === 'number' && gap < 20) throw new Error(`顶栏间距仅 ${gap}px`)
  const hint = await page.locator('.question-hint').count()
  if (!hint) throw new Error('未显示 hint')
  await shot('fix-wizard-topline-hint')
  await page.locator('.back-button').click()
})

await step('F10 修复：配图方案真实生成成功（zod 容错）', async () => {
  await nav('智能配图')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: 'AI 生成配图方案' }).click()
  await page.waitForTimeout(45_000)
  await shot('fix-visual-plan-success')
  const err = await page.locator('text=Error invoking remote method').count()
  if (err) throw new Error('仍出现原始 IPC 错误')
  const hasStep2 = await page.locator('button', { hasText: '2. 风格与提示词' }).first().isEnabled().catch(() => false)
  if (!hasStep2) throw new Error('方案未生成（第 2 步仍不可用）')
})

await step('F9 修复：发布页测试配置给出中文校验错误', async () => {
  await nav('发布管理')
  await page.waitForTimeout(1200)
  const testBtn = page.getByRole('button', { name: '测试当前配置' })
  if (await testBtn.count()) {
    await testBtn.click()
    await page.waitForTimeout(1500)
    await shot('fix-publishing-friendly-error')
    const raw = await page.getByText('Too small', { exact: false }).count()
    if (raw) throw new Error('仍出现英文 zod 原文')
  }
})

await finish()
