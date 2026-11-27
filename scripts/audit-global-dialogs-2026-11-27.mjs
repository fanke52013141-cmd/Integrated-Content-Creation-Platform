import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const OUT = resolve('artifacts', 'ui-audit-2026-11-27')
const root = await mkdtemp(join(tmpdir(), 'moliu-global-dialog-audit-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
const page = await app.firstWindow()
page.setDefaultTimeout(15_000)
const records = []
await page.waitForLoadState('domcontentloaded')
async function record(name, selector = '.modal-overlay [role="dialog"], .account-menu-popover') {
  await capture(page, { path: join(OUT, `${name}.png`), animations: 'disabled' })
  const result = await page.evaluate((selector) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height } }
    return [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width && r.height && s.display !== 'none' && s.visibility !== 'hidden' }).map(el => {
      const r = rect(el)
      return { rect:r, outOfBounds:r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 }
    })
  }, selector)
  records.push({ name, viewport:{width:await page.evaluate(()=>innerWidth),height:await page.evaluate(()=>innerHeight)}, overlays:result })
  console.log(`${result.some(item=>item.outOfBounds)?'WARN':'OK  '} ${name}`)
}
async function close() { await page.keyboard.press('Escape').catch(()=>{}); await page.waitForTimeout(150) }
try {
  await page.locator('.first-creation-modal').waitFor({ state:'visible',timeout:8000 })
  await record('global-first-guide-1440')
  await page.setViewportSize({width:960,height:760})
  await record('global-first-guide-960')
  await page.setViewportSize({width:1440,height:900})
  await close()
  await page.evaluate(() => localStorage.setItem('moliu:first-creation-guide:v1','done'))
  await page.evaluate(async () => {
    const account = await window.moliu.accounts.save({fields:[{id:crypto.randomUUID(),name:'账号名称',value:'审查账号',isDefault:true}],wizardAnswers:[],status:'locked',source:'manual'})
    await window.moliu.accounts.setCurrent(account.id)
    await window.moliu.articles.save({accountId:account.id,materialIds:[],manualOutline:'',status:'locked',source:'manual',rawMarkdown:'# 全局弹窗审查\n\n正文。'})
  })
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForTimeout(500)
  await page.keyboard.press('Shift+Slash')
  await page.locator('.shortcut-panel-dialog').waitFor({state:'visible',timeout:5000})
  await record('global-shortcuts-1440')
  await close()

  await page.locator('.account-chip').first().click()
  await page.locator('.account-menu-popover').waitFor({state:'visible',timeout:5000})
  await record('global-account-menu-1440','.account-menu-popover')
  await close()

  await page.evaluate(async () => {
    const [article] = await window.moliu.articles.list()
    await window.moliu.articles.save({id:article.id,materialIds:[],manualOutline:'',status:'locked',source:'manual',rawMarkdown:`${article.rawMarkdown}\n\n第二版补充内容。`})
    location.hash='#/articles'
  })
  await page.waitForTimeout(700)
  const compare = page.locator('.article-history-actions').getByRole('button',{name:'对比',exact:true}).first()
  if (await compare.count()) {
    await compare.click()
    await page.locator('.version-diff-dialog').waitFor({state:'visible',timeout:5000})
    await record('global-version-diff-1440')
    await close()
  } else records.push({name:'global-version-diff-1440',skipped:'当前版本只有一个，未显示对比入口'})

  await page.evaluate(async () => { await window.moliu.accounts.save({fields:[{id:crypto.randomUUID(),name:'账号名称',value:'待删除审查账号',isDefault:true}],wizardAnswers:[],status:'draft',source:'manual'}) })
  await page.evaluate(() => { location.hash='#/accounts' })
  await page.reload({waitUntil:'domcontentloaded'})
  await page.locator('.account-card').filter({hasText:'待删除审查账号'}).first().click()
  const remove = page.getByRole('button',{name:'删除账号'}).first()
  await remove.waitFor({state:'visible',timeout:5000}).catch(()=>{})
  if (await remove.count()) {
    await remove.click()
    await page.locator('.confirm-dialog').waitFor({state:'visible',timeout:5000})
    await record('global-delete-confirm-1440')
    await close()
  }
  await writeFile(join(OUT,'global-dialogs.json'),JSON.stringify(records,null,2))
  console.log(`GLOBAL DIALOG AUDIT COMPLETE: ${records.length} records`)
} finally {
  await app.close().catch(()=>{})
  if (!root.startsWith(join(tmpdir(),'moliu-global-dialog-audit-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root,{recursive:true,force:true})
}
