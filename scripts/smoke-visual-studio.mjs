import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==','base64')
const calls = { planning:0, prompts:0, image:0, edit:0, upload:0, vision:0 }
const server = createServer(async(req,res)=>{
  let raw='';for await(const chunk of req) raw+=chunk
  res.setHeader('Content-Type','application/json')
  if(req.url?.endsWith('/uploads/images')) {calls.upload++;res.end(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/reference.png`}));return}
  if(req.url?.endsWith('/images/edits')) {calls.edit++;assert.match(raw,/reference\.png/);assert.match(raw,/high/);assert.match(raw,/3072x1728|4032x1728/);res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));return}
  if(req.url?.endsWith('/images/generations')) {calls.image++;res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));return}
  const body=JSON.parse(raw),system=body.messages[0].content
  let content
  if(typeof body.messages[0].content!=='string') {calls.vision++;content='暖色纸感插画，米白背景，深棕线条，柔和光线，留白构图。'}
  else if(system.includes('先规划内容')){
    calls.planning++
    content=JSON.stringify({reasoning:'顶部图建立阅读氛围，正文图解释第一段。',pictures:[
      {kind:'cover',subject:'文章主视觉',purpose:'用于分享入口',blockIndex:0,ratio:'21:9',alt:'文章封面',priority:'required'},
      {kind:'header',subject:'正文开篇场景',purpose:'建立氛围',blockIndex:0,ratio:'16:9',alt:'开篇插画',priority:'required'},
      {kind:'inline',subject:'注意力分散的场景',purpose:'解释第一段',blockIndex:1,ratio:'16:9',alt:'注意力分散',priority:'required'}]})
  }else{
    calls.prompts++
    const data=JSON.parse(body.messages[1].content)
    content=JSON.stringify({pictures:data.pictures.map(p=>({id:p.id,prompt:`${p.subject}。暖色纸感插画，主体清晰，不含文字和水印。`}))})
  }
  res.end(JSON.stringify({model:'studio-smoke',choices:[{message:{content},finish_reason:'stop'}]}))
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const root=await mkdtemp(join(tmpdir(),'moliu-visual-studio-'))
let app
try{
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,MOLIU_USER_DATA_DIR:root}})
  let page=await app.firstWindow()
  page.setDefaultTimeout(12000)
  await page.waitForLoadState('domcontentloaded')
  const rendererErrors=[];page.on('pageerror',e=>rendererErrors.push(e.message))
  const ids=await page.evaluate(async port=>{
    const provider=await window.moliu.providers.save({displayName:'配图验收模型',protocol:'openai-compatible',baseUrl:`http://127.0.0.1:${port}/v1`,defaultModel:'studio-smoke',enabled:true,isRelay:false,capabilities:{chat:true,jsonMode:true,streaming:false,vision:true,image:true},models:[{modelId:'studio-smoke',displayName:'配图验收模型',reasoningVariants:[],isDefault:true,enabled:true,pricePerImage:0.01}],apiKey:'local-test'})
    const account=await window.moliu.accounts.save({status:'draft',source:'manual',fields:[{id:crypto.randomUUID(),name:'账号名称',value:'配图验收账号',isDefault:true}],wizardAnswers:[]})
    const article=await window.moliu.articles.save({accountId:account.id,materialIds:[],manualOutline:'',status:'draft',source:'manual',rawMarkdown:'# 配图验收文章\n\n第一段说明注意力分散的问题。\n\n## 调整方式\n\n第二段给出具体方法。'})
    return{providerId:provider.id,accountId:account.id,articleId:article.id,markdown:article.rawMarkdown}
  },server.address().port)
  await page.reload();await page.getByRole('button',{name:'智能配图',exact:true}).click()
  await page.getByRole('button',{name:'创建配图风格',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('风格名称',{exact:true}).fill('暖色纸感')
  await dialog.getByLabel('风格描述',{exact:true}).fill('温暖、简洁的公众号插画')
  await dialog.getByRole('button',{name:'按描述生成风格样图',exact:true}).click()
  await dialog.locator('.studio-reference').waitFor()
  await dialog.getByRole('button',{name:'AI 提取风格描述',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.studio-dialog textarea') && [...document.querySelectorAll('.studio-dialog textarea')].some(el=>el.value.includes('米白背景')))
  await dialog.getByRole('button',{name:'保存风格版本',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'2. 风格与提示词',exact:true}).click()
  await page.getByLabel('当前公众号的默认配图风格',{exact:true}).selectOption({label:'暖色纸感'})
  await page.getByRole('button',{name:'1. 确认内容方案',exact:true}).click()
  await page.getByRole('button',{name:'AI 生成配图方案',exact:true}).click()
  await page.locator('.studio-picture').nth(2).waitFor()
  assert.equal(await page.locator('.studio-picture').count(),3)
  assert.match(await page.getByLabel('本篇配图风格',{exact:false}).innerText(),/暖色纸感/)
  // Persisted editable plan passes the same strict IPC boundary used by real users.
  await page.getByRole('button',{name:'1. 确认内容方案',exact:true}).click()
  await page.locator('.studio-picture').nth(2).getByLabel('图注（留空则隐藏）').fill('正文图注验收')
  await page.getByRole('button',{name:'保存方案修改',exact:true}).click()
  await page.getByRole('button',{name:'2. 风格与提示词',exact:true}).click()
  await page.getByRole('button',{name:'生成／更新提示词',exact:true}).click()
  await page.waitForFunction(()=>[...document.querySelectorAll('.studio-picture textarea')].some(el=>el.value.includes('不含文字和水印')))
  await page.getByLabel('出图质量',{exact:true}).selectOption('high')
  await page.getByLabel('生图分辨率',{exact:true}).selectOption('2k')
  await page.locator('.studio-picture').first().getByRole('button',{name:'生成本图／样图',exact:true}).click()
  await page.locator('.studio-picture').first().getByRole('button',{name:'采用此图',exact:true}).click()
  await page.getByRole('button',{name:'生成剩余图片／更新旧图',exact:true}).click()
  await page.getByRole('button',{name:'开始生成',exact:true}).click()
  await page.locator('.studio-picture').nth(2).getByRole('button',{name:'采用此图',exact:true}).waitFor()
  for(const index of [1,2]){
    await page.locator('.studio-picture').nth(index).getByRole('button',{name:'采用此图',exact:true}).click()
    await page.locator('.studio-picture').nth(index).getByRole('button',{name:'已采用',exact:true}).waitFor()
  }
  await page.getByRole('button',{name:'预览并应用文章',exact:true}).click()
  const preview=page.getByRole('dialog')
  await preview.getByRole('heading',{name:'配图应用预览'}).waitFor()
  assert.equal(await preview.locator('.studio-article-preview img').count(),2)
  await preview.getByRole('button',{name:'确认应用并保存版本',exact:true}).click()
  await preview.waitFor({state:'hidden'})
  const result=await page.evaluate(async id=>({article:await window.moliu.articles.get(id),form:await window.moliu.publishing.getForm(id)}),ids.articleId)
  assert.equal((result.article.rawMarkdown.match(/moliu-asset/g)??[]).length,2)
  assert.ok(result.form.coverAssetId)
  assert.equal(calls.edit,3);assert.equal(calls.upload,3);assert.equal(calls.vision,1)
  await page.getByRole('button',{name:'撤销本次应用',exact:true}).click()
  await page.getByText('已撤销本次配图，文章保留历史版本',{exact:true}).waitFor()
  const undone=await page.evaluate(id=>window.moliu.articles.get(id),ids.articleId)
  assert.equal(undone.rawMarkdown,ids.markdown)
  // Unsaved edits survive switching away from the workbench.
  await page.getByRole('button',{name:'1. 确认内容方案',exact:true}).click()
  await page.locator('.studio-picture').first().getByLabel('图注（留空则隐藏）').fill('未保存的图注')
  await page.getByRole('button',{name:'原有方案与图片',exact:true}).click()
  await page.getByRole('button',{name:'内容配图工作台',exact:true}).click()
  await page.getByText('已恢复本地未保存的方案修改，请保存后继续',{exact:true}).waitFor()
  assert.equal(await page.locator('.studio-picture').first().getByLabel('图注（留空则隐藏）').inputValue(),'未保存的图注')
  await page.getByRole('button',{name:'保存方案修改',exact:true}).click()
  await page.evaluate(()=>{for(const el of document.querySelectorAll('*')) if(el.scrollTop) el.scrollTop=0})
  await page.locator('.studio-picture').first().getByLabel('图注（留空则隐藏）').fill('跨重启自动草稿')
  await page.getByText('编辑已自动暂存到本机，可在重启后恢复',{exact:true}).waitFor()
  await app.evaluate(({BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows())win.destroy()}).catch(()=>undefined)
  await app.close().catch(()=>undefined)
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,MOLIU_USER_DATA_DIR:root}})
  page=await app.firstWindow();page.setDefaultTimeout(12000);await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button',{name:'智能配图',exact:true}).click()
  await page.getByText('已恢复本地未保存的方案修改，请保存后继续',{exact:true}).waitFor()
  assert.equal(await page.locator('.studio-picture').first().getByLabel('图注（留空则隐藏）').inputValue(),'跨重启自动草稿')
  await page.getByRole('button',{name:'保存方案修改',exact:true}).click()
  await page.getByRole('button',{name:'3. 生成与选图',exact:true}).click()
  await mkdir(resolve('artifacts'),{recursive:true})
  await page.screenshot({path:resolve('artifacts/visual-studio.png'),fullPage:true})
  await page.setViewportSize({width:900,height:900})
  await page.screenshot({path:resolve('artifacts/visual-studio-narrow.png'),fullPage:true})
  assert.deepEqual(rendererErrors,[])
  console.log('Visual studio smoke passed: style sample + vision + default binding, AI plan, prompt editing, actual reference upload and image edit requests, batch, adoption, preview/application, cover binding, undo and draft recovery.')
}catch(error){
  if(app){const page=await app.firstWindow();console.error((await page.locator('body').innerText()).slice(-10000));await mkdir(resolve('artifacts'),{recursive:true});await page.screenshot({path:resolve('artifacts/visual-studio-failure.png'),fullPage:true})}
  throw error
}finally{
  if(app)await app.close()
  await new Promise(done=>server.close(done))
  assert.ok(root.startsWith(join(tmpdir(),'moliu-visual-studio-')))
  await rm(root,{recursive:true,force:true})
}
