import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

await mkdir('.stitch', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:5177/?ui-fixtures=1#/layouts', { waitUntil: 'networkidle' })
  await page.locator('.layouts-page').waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: resolve('.stitch/layouts-current.png'), animations: 'disabled', fullPage: false })
  await page.evaluate(() => document.querySelectorAll('script, link[rel="modulepreload"]').forEach((element) => element.remove()))
  await writeFile(resolve('.stitch/raw-layouts.html'), await page.content(), 'utf8')
  console.log('Captured runtime DOM and screenshot for Stitch')
} finally {
  await browser.close()
}
