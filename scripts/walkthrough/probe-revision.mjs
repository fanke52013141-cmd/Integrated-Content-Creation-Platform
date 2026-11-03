// 探针：验证智能改稿真实链路（fill 要求 → 生成改稿 → 候选出现）
import { startApp, userDataPath, waitText } from './lib.mjs'

const ctx = await startApp({ round: 'probe-revision', userDataDir: userDataPath('round5') })
const { page, shot, nav, step, finish } = ctx

await step('选择文章并填写改稿要求', async () => {
  await nav('文章创作')
  await page.waitForTimeout(1500)
  const area = page.locator('textarea[placeholder*="输入改稿要求"]').first()
  await area.scrollIntoViewIfNeeded()
  await area.click()
  await area.fill('把结尾改得更短更有力，并加一句行动引导。')
  await page.waitForTimeout(500)
  await shot('revision-filled')
})

await step('生成改稿（真实 AI）', async () => {
  const btn = page.getByRole('button', { name: /生成改稿/ }).first()
  await btn.click()
  await page.waitForTimeout(60_000)
  await shot('revision-result')
  await waitText(page, '候选|改稿|新版本', 240_000)
  await page.waitForTimeout(2000)
  await shot('revision-final')
})

await finish()
