// R3v2：内容评审（勾选角色+真实多角色 AI）→ 智能配图向导（四步）→ 排版 → 发布
import { startApp, userDataPath, copyUserData, waitText } from './lib.mjs'

copyUserData(userDataPath('round2'), userDataPath('round3'))
const ctx = await startApp({ round: 'round3', userDataDir: userDataPath('round3') })
const { page, shot, nav, step, finish } = ctx

await step('内容评审：勾选 3 个角色', async () => {
  await nav('内容评审')
  await page.waitForTimeout(1200)
  await shot('reviews-initial')
  for (const role of ['结构编辑', '标题与开头', '事实核查']) {
    await page.locator('label', { hasText: role }).first().click()
    await page.waitForTimeout(200)
  }
  await shot('reviews-roles-checked')
})

await step('开始评审（真实 AI 多角色流式）', async () => {
  await page.getByRole('button', { name: '开始评审' }).click()
  await page.waitForTimeout(8000)
  await shot('reviews-streaming')
  await waitText(page, '评审完成|个问题|条意见|评审记录', 300_000)
  await page.waitForTimeout(3000)
  await shot('reviews-done')
})

await step('评审角色对话框查看', async () => {
  await page.getByRole('button', { name: '评审角色' }).click()
  await page.waitForTimeout(600)
  await shot('reviews-role-dialog')
  await page.locator('button[aria-label="关闭"]').first().click()
  await page.waitForTimeout(400)
})

await step('手动加问题弹窗', async () => {
  await page.getByRole('button', { name: '手动加问题' }).first().click()
  await page.waitForTimeout(600)
  await shot('reviews-manual-problem-dialog')
  const textarea = page.locator('.modal-body textarea, textarea').first()
  if (await textarea.count()) await textarea.fill('结尾缺少行动引导，建议补充关注引导语。')
  await page.getByRole('button', { name: /保存|添加/ }).last().click()
  await page.waitForTimeout(800)
  await shot('reviews-manual-problem-added')
})

await step('智能配图：AI 生成配图方案（真实 AI）', async () => {
  await nav('智能配图')
  await page.waitForTimeout(1200)
  await shot('visuals-step1')
  await page.getByRole('button', { name: 'AI 生成配图方案' }).click()
  await page.waitForTimeout(30_000)
  await shot('visuals-plan-generated')
})

await step('智能配图：查看风格与提示词（第 2 步）', async () => {
  await page.getByRole('button', { name: /2.*风格与提示词|风格与提示词/ }).first().click()
  await page.waitForTimeout(2000)
  await shot('visuals-step2-style')
})

await step('智能配图：第 3 步无生图模型的引导', async () => {
  const step3 = page.locator('button', { hasText: '生成与选图' }).first()
  await step3.click()
  await page.waitForTimeout(1500)
  await shot('visuals-step3-no-image-model')
})

await step('文章排版：先看完整组件样稿预览（未生成前）', async () => {
  await nav('文章排版')
  await page.waitForTimeout(1200)
  const sample = page.getByRole('button', { name: /预览完整组件样稿/ })
  if (await sample.count()) {
    await sample.click()
    await page.waitForTimeout(2500)
    await shot('layouts-sample-preview')
    const back = page.getByRole('button', { name: '返回文章预览' })
    if (await back.count()) { await back.click(); await page.waitForTimeout(800) }
  } else {
    console.log('    (样稿预览按钮不存在，跳过)')
  }
})

await step('文章排版：生成公众号排版稿并检查预览', async () => {
  await page.getByRole('button', { name: '生成排版稿' }).click()
  await waitText(page, '排版稿已生成|排版稿就绪', 60_000)
  await page.waitForTimeout(1500)
  await shot('layouts-generated')
})

await step('排版：复制 HTML 源码', async () => {
  await page.getByRole('button', { name: '复制 HTML 源码' }).click()
  await page.waitForTimeout(800)
  await shot('layouts-copy-html')
})

await step('发布管理：预检与无配置状态', async () => {
  await nav('发布管理')
  await page.waitForTimeout(1200)
  await shot('publishing-initial')
})

await step('发布管理：未配置时「测试当前配置」的报错体验', async () => {
  const testBtn = page.getByRole('button', { name: '测试当前配置' })
  if (await testBtn.count()) {
    await testBtn.click()
    await page.waitForTimeout(1500)
    await shot('publishing-test-config-unconfigured')
  }
})

await step('发布管理：公众号交付步骤面板', async () => {
  const stepBtn = page.locator('button[aria-label="公众号交付步骤"]')
  if (await stepBtn.count()) {
    await stepBtn.first().click()
    await page.waitForTimeout(800)
    await shot('publishing-steps')
    await page.locator('button[aria-label="关闭"]').first().click().catch(() => {})
  }
})

await finish()
