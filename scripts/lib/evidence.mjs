import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 证据截图统一入口。截图只是留证、不是断言，但整套冒烟是顺序跑在一台机器上的，
 * 负载高时 Playwright 的 page.screenshot 会偶发 30s/90s 超时，把本来通过的功能误判成失败。
 * 这里固定关掉动画并给足超时，失败后退避重试；重试用尽仍然抛错，证据不会静默丢失。
 */
export async function capture(page, options = {}, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.screenshot({ animations: 'disabled', timeout: 90_000, fullPage: false, ...options })
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 5_000)
    }
  }
  console.error(`截图重试 ${attempts} 次仍失败: ${options.path}`)
  throw lastError
}
