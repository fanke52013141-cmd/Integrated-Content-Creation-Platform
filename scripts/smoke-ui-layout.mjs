import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'

// Independent browser profile; never attaches to a user's open browser.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'src/renderer', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let browser
try {
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('UI test server did not start')), 15000)
    server.once('exit', code => { clearTimeout(timer); fail(new Error(`UI test server exited: ${code}`)) })
    server.stdout.on('data', chunk => { if (String(chunk).includes('5176')) { clearTimeout(timer); done() } })
  })
  browser = await chromium.launch({ ...(process.env.MOLIU_BROWSER_EXECUTABLE ? { executablePath: process.env.MOLIU_BROWSER_EXECUTABLE } : { channel: 'msedge' }), headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const evidence = resolve('artifacts/ui-layout-optimized')
  await mkdir(evidence, { recursive: true })
  for (const [width, height] of [[1440,900],[1180,720],[960,640]]) {
    await page.setViewportSize({ width, height })
    await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/articles')
    await page.locator('.article-markdown-editor').waitFor()
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow')
    if (width === 960) {
      assert.equal(await page.locator('.article-workbench > aside').count(), 0, 'Compact workspace does not put article library before editor')
      const toggle = page.getByRole('button', {name: /切换文章/})
      await toggle.click()
      const library = page.getByRole('dialog', {name: /文章库/})
      await library.waitFor()
      await library.getByRole('button', {name: /草稿/}).first().waitFor()
      await page.screenshot({animations: 'disabled', path:resolve(evidence,'article-library-960.png')})
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true, 'Drawer restores focus to switch button')
    }
    await page.screenshot({animations: 'disabled', path:resolve(evidence,`articles-${width}.png`)})
  }
  await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/articles')
  await page.locator('.article-markdown-editor').waitFor()
  const visualEdit = page.getByRole('button', {name:'可视化编辑'})
  assert.equal(await visualEdit.isEnabled(), true, 'Simple article can use visual editing')
  await visualEdit.click()
  const visualBody = page.getByRole('textbox', {name:'可视化正文'})
  await visualBody.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' #ordinary-text')
  await page.getByRole('button', {name:'源码编辑'}).click()
  assert.match(await page.locator('.article-markdown-editor').inputValue(), /\\#ordinary\\-text/, 'Typed Markdown punctuation remains plain text')
  await page.locator('.article-markdown-editor').fill('# 标题\n\n名称 | 数量\n--- | ---\n苹果 | 2')
  assert.equal(await visualEdit.isDisabled(), true, 'Tables cannot be converted by the basic editor')
  await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/articles')
  await page.locator('.fact-check-panel > summary').click()
  await page.getByText('没有识别到数字线索；仍请人工检查人物、观点和引用。').waitFor()
  await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/home')
  await page.getByRole('heading', {name:'作品管理'}).waitFor()
  await page.getByRole('searchbox', {name:'搜索作品'}).fill('一次清楚')
  await page.locator('.home-board-list').getByText('演示稿：一次清楚的创作流程').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.home-board-list article').length === 1)
  assert.equal(await page.locator('.home-board-list article').count(), 1, 'Board searches persisted summaries')
  for (const [route, name] of [['frameworks','编辑模板'],['materials','添加文字'],['articles','导入现成稿']]) {
    await page.goto(`http://127.0.0.1:5176/?ui-fixtures=1#/${route}`)
    await page.getByRole('button', {name, exact: false}).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    if (route === 'frameworks') {
      for (let index = 0; index < 8; index += 1) await dialog.getByRole('button', {name:'添加章节',exact:true}).click()
    }
    assert.equal(await dialog.locator('.modal-scroll-body').count(), 1, `${route}: independent scroll body`)
    await dialog.locator('.modal-scroll-body').evaluate(el => {el.scrollTop = el.scrollHeight})
    const geometry = await dialog.evaluate(el => {
      const body = el.querySelector('.modal-scroll-body').getBoundingClientRect()
      const foot = el.querySelector(':scope > footer').getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return {bodyBottom:body.bottom, footerTop:foot.top, footerBottom:foot.bottom, dialogBottom:box.bottom, viewport:innerHeight}
    })
    assert.ok(geometry.bodyBottom <= geometry.footerTop + 1, `${route}: body must end above actions`)
    assert.ok(geometry.footerBottom <= geometry.dialogBottom && geometry.dialogBottom <= geometry.viewport, `${route}: actions remain inside viewport`)
    await page.screenshot({animations: 'disabled', path:resolve(evidence,`${route}-dialog-bottom.png`)})
    await page.keyboard.press('Escape')
  }
  await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/articles')
  await page.locator('.article-history > summary').click()
  await page.locator('.article-history').getByRole('button', {name:'对比',exact:true}).first().click()
  const comparison = page.getByRole('dialog')
  assert.equal(await comparison.locator('.modal-scroll-body').count(), 1, 'Fragment-based version comparison uses scroll body')
  await page.screenshot({animations:'disabled',path:resolve(evidence,'version-comparison-960.png')})
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name:'任务中心',exact:true}).click()
  assert.equal(await page.getByRole('dialog').locator('.modal-scroll-body').count(), 1)
  await page.keyboard.press('Escape')
  await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/reviews')
  await page.getByRole('button', {name:'评审角色',exact:true}).click()
  const roleDialog = page.getByRole('dialog')
  await roleDialog.getByRole('button', {name:'评审角色模型',exact:true}).waitFor()
  assert.equal(await roleDialog.locator('.modal-scroll-body').count(), 1)
  await roleDialog.locator('.modal-scroll-body').evaluate(el=>{el.scrollTop=el.scrollHeight})
  await page.screenshot({animations:'disabled',path:resolve(evidence,'review-role-model-960.png')})
  await page.keyboard.press('Escape')
  await page.goto('http://127.0.0.1:5176/?ui-fixtures=1#/prompts')
  await page.getByRole('button', {name:'提示词默认模型',exact:true}).waitFor()
  await page.screenshot({animations: 'disabled', path:resolve(evidence,'prompts-960.png')})
  // Browser fixtures only: add a distinct model to verify prompt routing and manual override.
  await page.evaluate(async () => {
    const boot = await window.moliu.app.bootstrap()
    const provider = boot.providers[0]
    provider.models.push({...provider.models[0], id:'binding-test', modelId:'binding-test', displayName:'提示词绑定测试模型', isDefault:false})
    const original = window.moliu.prompts.list
    window.moliu.prompts.list = async () => (await original()).map(def => def.key === 'article.generate' ? {...def, modelBinding:{providerId:provider.id,modelId:'binding-test'}} : def)
  })
  await page.getByRole('button', {name:'文章创作',exact:true}).click()
  await page.getByRole('button', {name:'新建草稿',exact:true}).click()
  const composer = page.getByRole('dialog', {name:'新建草稿',exact:true})
  const model = composer.getByRole('button', {name:'模型',exact:true})
  await model.getByText('提示词绑定测试模型', {exact:true}).waitFor()
  await model.click()
  const popoverGeometry = await page.locator('.select-popover').evaluate(el => {
    const r = el.getBoundingClientRect()
    return {left:r.left,right:r.right,bottom:r.bottom,width:r.width,viewport:innerWidth,height:innerHeight}
  })
  assert.ok(popoverGeometry.left >= 0 && popoverGeometry.right <= popoverGeometry.viewport && popoverGeometry.bottom <= popoverGeometry.height, 'Model dropdown stays within viewport')
  assert.ok(popoverGeometry.width < 400, 'Dropdown does not stretch to viewport right edge')
  const listbox = page.getByRole('listbox')
  await listbox.waitFor()
  assert.equal(await listbox.evaluate(el => el === document.activeElement), true, 'Short listbox receives keyboard focus')
  await page.keyboard.press('Home')
  const firstActive = await listbox.getAttribute('aria-activedescendant')
  await page.keyboard.press('End')
  const lastActive = await listbox.getAttribute('aria-activedescendant')
  assert.notEqual(lastActive, firstActive, 'Home and End move the active option')
  await page.keyboard.press('Enter')
  await model.waitFor({state:'visible'})
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '模型')
  assert.equal(await model.evaluate(el => el === document.activeElement), true, 'Selecting with keyboard restores trigger focus')
  await model.click()
  await page.getByRole('option', {name:/演示模型/}).click()
  await model.getByText('演示模型', {exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.getByRole('button', {name:'提示词',exact:true}).click()
  await page.locator('.prompts-page').waitFor()
  assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 0, 'Switching page resets the main scroll position')
  const routes = ['home','accounts','hotspots','topics','frameworks','articles','reviews','visuals','layouts','publishing','materials','providers','prompts','data']
  for (const [width,height] of [[1440,900],[1180,720],[960,640]]) {
    await page.setViewportSize({width,height})
    for (const route of routes) {
      await page.goto(`http://127.0.0.1:5176/?ui-fixtures=1#/${route}`)
      await page.locator('#main').waitFor()
      await page.waitForTimeout(500)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `${route} at ${width}px must not overflow horizontally`)
      await page.screenshot({animations:'disabled',path:resolve(evidence,`${route}-${width}.png`)})
      if (['frameworks','articles','publishing','providers'].includes(route)) {
        await page.locator('#main').evaluate(el=>{el.style.scrollBehavior='auto';el.scrollTop=el.scrollHeight})
        await page.waitForTimeout(250)
        await page.screenshot({animations:'disabled',path:resolve(evidence,`${route}-${width}-bottom.png`)})
      }
    }
  }
  await page.goto('http://127.0.0.1:5176/#/home')
  const guide = page.getByRole('dialog', {name:'从哪里开始创作？'})
  await guide.waitFor()
  await guide.getByRole('button', {name:'直接写草稿'}).click()
  await page.getByRole('dialog', {name:'导入现成文章'}).getByRole('button', {name:'从空白稿开始写'}).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('moliu:first-creation-guide:v1')), 'done', 'First-creation choice persists')
  assert.deepEqual(errors, [])
  console.log('UI layout smoke passed: 14 routes × 3 sizes, article drawer/focus, scroll-frame dialogs, prompt model binding, manual override, dropdown boundaries and route scroll reset')
} finally {
  await browser?.close()
  server.kill()
}
