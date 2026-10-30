// Isolated browser fixtures: record each visible select and non-destructive dialog entry.
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const routes = ['home','accounts','hotspots','topics','frameworks','articles','reviews','visuals','layouts','publishing','materials','providers','prompts','data']
const output = resolve('artifacts/interaction-audit')
await mkdir(output, {recursive:true})
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','src/renderer','--host','127.0.0.1','--port','5177','--strictPort'], {stdio:['ignore','pipe','pipe'],windowsHide:true})
let browser
const records = []
try {
  await new Promise((done,fail) => {
    const timer = setTimeout(() => fail(new Error('Audit server did not start')),15000)
    server.once('exit', code => {clearTimeout(timer); fail(new Error(`Audit server exited: ${code}`))})
    server.stdout.on('data', data => {if (String(data).includes('5177')) {clearTimeout(timer);done()}})
  })
  browser = await chromium.launch({channel:'msedge',headless:true})
  const page = await browser.newPage({viewport:{width:1440,height:900}})
  const base = 'http://127.0.0.1:5177/?ui-fixtures=1#/'
  const entryPattern = /^(新建账号|导入|手动新建|编辑模板|配置选题字段|新建草稿|导入现成稿|评审角色|添加文字|创建配图风格|添加供应商|新建提示词|任务中心|关联热点|选择素材)/
  for (const route of routes) {
    await page.goto(base + route)
    await page.reload()
    await page.locator('#main').waitFor()
    await page.waitForTimeout(700)
    const controls = await page.locator('button:visible').evaluateAll((buttons, pattern) => buttons.map((b, index) => ({index,label:(b.getAttribute('aria-label') || b.innerText || b.title || '').trim(), select:b.classList.contains('select-trigger'), disabled:b.matches(':disabled')})).filter(b => !b.disabled && (b.select || new RegExp(pattern).test(b.label))), entryPattern.source)
    for (const [sequence, control] of controls.entries()) {
      await page.goto(base + route)
      // Hash-only navigation does not remount the app; reset any dialog opened
      // by the previous probe before resolving the original button index.
      await page.reload()
      await page.locator('#main').waitFor()
      await page.waitForTimeout(500)
      const button = page.locator('button:visible').nth(control.index)
      const name = `${route}-${String(sequence+1).padStart(2,'0')}`
      try {
        await button.scrollIntoViewIfNeeded()
        await button.click({timeout:3000})
        await page.waitForTimeout(250)
        const kind = await page.locator('.select-popover:visible').count() ? 'select' : await page.getByRole('dialog').count() ? 'dialog' : 'other'
        const geometry = await page.evaluate(() => {
          const overlay = document.querySelector('.select-popover') || document.querySelector('[role=dialog]')
          if (!overlay) return null
          const r = overlay.getBoundingClientRect()
          return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}
        })
        await page.screenshot({path:resolve(output,`${name}.png`),animations:'disabled'})
        records.push({route,label:control.label,kind,file:`${name}.png`,geometry})
        console.log(`${name}: ${control.label} [${kind}]`)
      } catch (error) {
        records.push({route,label:control.label,error:String(error.message).slice(0,250)})
        console.log(`${name}: FAILED ${control.label}`)
      }
    }
  }
} finally {
  await writeFile(resolve(output,'manifest.json'),JSON.stringify(records,null,2))
  await browser?.close()
  server.kill()
}
