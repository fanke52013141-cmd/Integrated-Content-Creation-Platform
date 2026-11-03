// 探针：验证配图方案生成（blockIndex 容错后应成功）
import { startApp, userDataPath } from './lib.mjs'

const ctx = await startApp({ round: 'round6b-plan', userDataDir: userDataPath('round6') })
const { page, shot, nav, finish } = ctx

await nav('智能配图')
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'AI 生成配图方案' }).click()
await page.waitForTimeout(50_000)
await shot('plan-retry-result')
const errCount = await page.locator('text=输入校验失败').count()
const step3Enabled = await page.locator('button', { hasText: '3. 生成与选图' }).first().isEnabled().catch(() => false)
console.log('错误横幅:', errCount, '| 第3步可用(方案已生成):', step3Enabled)
await finish()
