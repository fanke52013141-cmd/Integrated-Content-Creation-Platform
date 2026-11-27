import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:5177/?ui-fixtures=1#/layouts', { waitUntil: 'networkidle' })
  await page.getByLabel('排版主题', { exact: true }).click()
  await page.locator('.select-popover').waitFor()
  const result = await page.locator('.select-popover').evaluate((popover) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left:r.left,right:r.right,width:r.width } }
    return {
      viewport: innerWidth,
      popover: { ...rect(popover), scrollWidth:popover.scrollWidth, clientWidth:popover.clientWidth },
      options:[...popover.querySelectorAll('.select-option')].map((el)=>({text:el.innerText, ...rect(el), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, hint:el.querySelector('.select-option-hint') ? rect(el.querySelector('.select-option-hint')) : null }))
    }
  })
  console.log(JSON.stringify(result,null,2))
} finally { await browser.close() }
