// 探针：抓取智能筛选失败时的 toast 错误文本
import { startApp, userDataPath, waitText } from './lib.mjs'

const ctx = await startApp({ round: 'probe-filter', userDataDir: userDataPath('round2') })
const { page, shot, nav, finish } = ctx

const toasts = []
page.on('console', (m) => { if (m.type() === 'error') toasts.push('[console] ' + m.text().slice(0, 300)) })

await nav('热点洞察')
await page.waitForTimeout(5000)
await page.getByRole('button', { name: '智能筛选', exact: true }).first().click()
await page.waitForTimeout(600)
// 监听 toast 容器文本变化
await page.evaluate(() => {
  const seen = []
  const root = document.body
  const obs = new MutationObserver(() => {
    root.querySelectorAll('.toast, [class*="toast"]').forEach((el) => {
      const t = el.textContent?.trim()
      if (t && !seen.includes(t)) { seen.push(t) }
    })
  })
  obs.observe(root, { subtree: true, childList: true, attributes: true })
  window.__seenToasts = seen
})

await page.getByRole('button', { name: '开始筛选' }).click()
console.log('已点击开始筛选，等待 150s 观察…')
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(10_000)
  const seen = await page.evaluate(() => window.__seenToasts ?? [])
  console.log(`t+${(i + 1) * 10}s toasts:`, JSON.stringify(seen))
  if (seen.some(t => /失败|错误|不可用|超时|error/i.test(t))) break
}
await shot('probe-filter-state')
await finish()
