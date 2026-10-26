import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { electron } from './lib/electron-test.mjs'

const root=await mkdtemp(resolve(tmpdir(),'moliu-import-bindings-'))
const app=await electron.launch({executablePath:resolve(process.env.MOLIU_EXECUTABLE||'node_modules/electron/dist/electron.exe'),args:process.env.MOLIU_EXECUTABLE?[]:['.'],env:{...process.env,MOLIU_USER_DATA_DIR:root}})
try {
  const page=await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(()=>!!window.moliu)
  const result=await page.evaluate(async()=> {
    const api=window.moliu
    const provider=await api.providers.save({displayName:'隔离模型路由测试',protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',defaultModel:'test-model',enabled:true,isRelay:false,capabilities:{chat:true,jsonMode:true,streaming:false,vision:false,image:false},models:[{modelId:'test-model',displayName:'隔离测试模型',enabled:true,isDefault:true,reasoningVariants:[]}],apiKey:'isolated-test-key'})
    const prompt=(await api.prompts.list()).find(p=>p.key==='article.generate')
    const binding={providerId:provider.id,modelId:'test-model'}
    const boundVersion=await api.prompts.update({key:prompt.key,content:prompt.activeContent,modelBinding:binding})
    await api.prompts.update({key:prompt.key,content:prompt.activeContent,modelBinding:null})
    await api.prompts.restore({key:prompt.key,version:boundVersion})
    const active=(await api.prompts.list()).find(p=>p.key===prompt.key)
    const article=await api.articles.save({materialIds:[],manualOutline:'',status:'draft',source:'manual',rawMarkdown:'# 外部方案 IPC 验收\n\n可精确匹配的正文。\n\n最后一段。'})
    const preview=await api.imports.preview({kind:'visual-plan',format:'json',content:JSON.stringify({cover:{visual:'封面',prompt:'external cover prompt',overlayText:''},inlineImages:[{location:'可精确匹配的正文。',purpose:'说明',ratio:'16:9',prompt:'external inline prompt',alt:'说明图'},{location:'第二段',purpose:'待定位',ratio:'4:3',prompt:'external unresolved prompt',alt:''}],releaseImages:[]})})
    const imported=await api.imports.commit({token:preview.token,associations:{articleId:article.id,visualStudio:true}})
    const plans=await api.visuals.studio.plans(article.id)
    return {binding:active.modelBinding,expected:binding,imported,plan:plans[0],articleId:article.id}
  })
  assert.deepEqual(result.binding,result.expected,'Historical prompt restore must restore the model route')
  assert.equal(result.imported.failed.length,0)
  assert.equal(result.imported.created.length,1)
  assert.equal(result.plan.pictures.length,3)
  assert.ok(result.plan.pictures.every(p=>p.promptLocked))
  assert.equal(result.plan.pictures[1].anchor.block,'可精确匹配的正文。')
  assert.ok(result.plan.pictures[2].anchor.block.startsWith('未确认外部位置：'))
  await page.reload()
  await page.evaluate(()=>{location.hash='/articles'})
  await page.getByRole('button',{name:'新建草稿',exact:true}).click()
  await page.getByRole('dialog',{name:'新建草稿',exact:true}).getByRole('button',{name:'模型',exact:true}).getByText('隔离测试模型',{exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await page.reload()
  const persisted=await page.evaluate(async id=>({plans:await window.moliu.visuals.studio.plans(id),binding:(await window.moliu.prompts.list()).find(p=>p.key==='article.generate').modelBinding}),result.articleId)
  assert.equal(persisted.plans[0].id,result.plan.id)
  assert.deepEqual(persisted.binding,result.expected)
  console.log('Import/binding Electron smoke passed: production IPC, prompt version restore, rendered default model, external studio plan with locked prompts and unresolved anchors, reload persistence; no external model calls')
} finally {
  await app.close()
  if(root.startsWith(resolve(tmpdir())+sep)&&root.includes('moliu-import-bindings-'))await rm(root,{recursive:true,force:true})
}
