import { createAccountFields } from '../src/shared/domain.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import { VisualStudioService } from '../src/main/services/visual-studio-service.js'
import { VisualAssetService } from '../src/main/services/visual-asset-service.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { PictureBrief, VisualPlan, VisualStyleInput } from '../src/shared/visual-studio.js'
import { articleBlocks } from '../src/shared/visual-studio.js'

const resources: Array<{ db: AppDatabase; dir: string }> = []
afterEach(() => resources.splice(0).forEach(({ db,dir }) => { db.close(); rmSync(dir,{recursive:true,force:true}) }))
function setup() {
  const dir = mkdtempSync(join(tmpdir(),'moliu-visual-studio-')), db = new AppDatabase(join(dir,'test.db'))
  resources.push({db,dir})
  const article = db.saveArticle({materialIds:[],manualOutline:'',status:'draft',source:'manual',rawMarkdown:'# 测试文章\n\n第一段内容\n\n第二段内容'})
  let payload: unknown = {reasoning:'短文无需正文图',pictures:[]}
  const chat = vi.fn(async () => ({content:JSON.stringify(payload),providerId:'p',model:'m',latencyMs:1,extractionMatched:false,jsonModeSimulated:false}))
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oKAAAAAASUVORK5CYII='
  const gateway = {chat,uploadImage:vi.fn(async()=> 'https://image.example/reference.png'),generateImage:vi.fn(async()=>({base64:png,providerId:'p',model:'m',latencyMs:1})),editImage:vi.fn(async()=>({base64:png,providerId:'p',model:'m',latencyMs:1}))} as unknown as ModelGateway
  const assets = new VisualAssetService(db,gateway,join(dir,'images')), service = new VisualStudioService(db,gateway,assets,join(dir,'images'))
  const plan = async () => service.plan({articleId:article.id,providerId:'p',model:'m',count:'auto',density:'minimal',cover:false,header:false,maxInline:8})
  const styleInput: VisualStyleInput = {name:'纸感',description:'柔和纸张质感',medium:'插画',colors:'暖色',composition:'简洁',avoid:'水印',references:[]}
  function addPicture(plan: VisualPlan, kind: PictureBrief['kind'] = 'inline',slot = plan.nextSlot) {
    return service.savePlan({...plan,pictures:[...plan.pictures,{id:crypto.randomUUID(),kind,slot,subject:'测试主题',purpose:'说明内容',ratio:'16:9',alt:'主题说明',caption:'',anchor:{block:'第一段内容',occurrence:0,placement:'after'},priority:'required',prompt:'一个清晰的画面',promptLocked:false}]})
  }
  const asset = (p:VisualPlan,picture:PictureBrief) => db.saveVisualAsset({packId:p.id,kind:picture.kind==='header'?'inline':picture.kind,slot:picture.slot,prompt:'候选图',fileName:`${crypto.randomUUID()}.png`,source:'imported'})
  return {db,dir,article,service,gateway,chat,plan,styleInput,addPicture,asset,setPayload:(value:unknown)=>{payload=value},png}
}

describe('内容配图工作台',()=>{
  it('自动规划允许零正文图，并严格验证数量、角色和有效位置',async()=>{
    const s=setup(), plan=await s.plan()
    expect(plan.pictures).toHaveLength(0)
    expect(s.db.getArticle(s.article.id)?.currentVersionId).toBe(s.article.currentVersionId)
    s.setPayload({reasoning:'错误位置',pictures:[{kind:'inline',subject:'场景',purpose:'解释',blockIndex:99,ratio:'16:9',alt:'说明',priority:'required'}]})
    await expect(s.plan()).rejects.toThrow('位置无效')
    await expect(s.service.plan({articleId:s.article.id,providerId:'p',model:'m',count:0,density:'standard',cover:false,header:false,maxInline:8})).rejects.toThrow('数量')
  })
  it('风格版本不可变，默认绑定使用新版，历史方案保留快照，支持归档和重启',async()=>{
    const s=setup(), account=s.db.saveAccount({status:'draft',source:'manual',fields:createAccountFields({账号名称:'测试账号'}),wizardAnswers:[]})
    s.db.saveArticle({...s.article,accountId:account.id,source:'manual'})
    const first=s.db.atomic(()=>s.db.visualStudio.saveStyle(s.styleInput))
    s.db.visualStudio.bind(account.id,first.id)
    const plan=await s.plan()
    const second=s.db.atomic(()=>s.db.visualStudio.saveStyle({...s.styleInput,id:first.id,expectedVersionId:first.versionId,name:'新版'}))
    expect(s.db.visualStudio.defaultStyle(account.id)?.versionId).toBe(second.versionId)
    expect(s.db.visualStudio.plan(plan.id).style?.versionId).toBe(first.versionId)
    expect(()=>s.db.visualStudio.saveStyle({...s.styleInput,id:first.id,expectedVersionId:first.versionId})).toThrow('新版本')
    s.db.visualStudio.archive(first.id,true)
    expect((await s.plan()).style).toBeUndefined()
    expect(s.db.visualStudio.history(first.id)).toHaveLength(2)
    const reopened=new AppDatabase(join(s.dir,'test.db'))
    try{expect(reopened.visualStudio.plan(plan.id).style?.versionId).toBe(first.versionId);expect(reopened.visualStudio.styles()[0].archived).toBe(true)}finally{reopened.close()}
  })
  it('增删和排序保留稳定标识，过期保存被拒绝，已删除槽位不复用',async()=>{
    const s=setup(), initial=await s.plan(), first=s.addPicture(initial)
    expect(()=>s.addPicture(initial)).toThrow('更新')
    const removed=s.service.savePlan({...first,pictures:[]})
    expect(()=>s.addPicture(removed,'inline',0)).toThrow('新的槽位')
    const second=s.addPicture(removed)
    expect(second.pictures[0].slot).toBeGreaterThan(first.pictures[0].slot)
  })
  it('更新提示词保留锁定项；仅编辑提示词和图注后仍可生成',async()=>{
    const s=setup();let p=s.addPicture(await s.plan())
    p=s.service.savePlan({...p,pictures:p.pictures.map(i=>({...i,promptLocked:true,prompt:'人工锁定的提示词'}))})
    s.setPayload({pictures:[]})
    p=await s.service.prompts({planId:p.id,expectedRevision:p.revision,providerId:'p',model:'m'})
    expect(p.pictures[0].prompt).toBe('人工锁定的提示词')
    p=s.service.savePlan({...p,pictures:p.pictures.map(i=>({...i,prompt:'人工微调',caption:'图注'}))})
    expect(p.promptsStale).toBe(false)
    const result=await s.service.generate({planId:p.id,pictureId:p.pictures[0].id,expectedRevision:p.revision,providerId:'p',model:'m',referenceMode:'text'})
    expect(result.id).toBeTruthy();expect(s.gateway.generateImage).toHaveBeenCalledOnce()
  })
  it('本地风格参考图确实上传并传入图生图接口，文字模式显式跳过参考图',async()=>{
    const s=setup(), reference=await s.service.importReference(Uint8Array.from(Buffer.from(s.png,'base64')).buffer)
    const style=s.db.visualStudio.saveStyle({...s.styleInput,references:[reference]})
    let p=s.addPicture(await s.plan());p=s.service.savePlan({...p,style})
    s.setPayload({pictures:[{id:p.pictures[0].id,prompt:'新提示词'}]})
    p=await s.service.prompts({planId:p.id,expectedRevision:p.revision,providerId:'p',model:'m'})
    await s.service.generate({planId:p.id,pictureId:p.pictures[0].id,expectedRevision:p.revision,providerId:'p',model:'m',referenceMode:'image'})
    expect(s.gateway.uploadImage).toHaveBeenCalledOnce()
    expect(s.gateway.editImage).toHaveBeenCalledWith(expect.objectContaining({imageUrl:'https://image.example/reference.png',prompt:expect.stringContaining('纸感')}))
    await s.service.generate({planId:p.id,pictureId:p.pictures[0].id,expectedRevision:p.revision,providerId:'p',model:'m',referenceMode:'text'})
    expect(s.gateway.generateImage).toHaveBeenCalledOnce()
  })
  it('候选图必须属于图片项；预览不写文章，重复应用不重复插图，撤销恢复正文与封面表单',async()=>{
    const s=setup();let p=s.addPicture(await s.plan());p=s.addPicture(p,'cover',0)
    const inline=p.pictures[0],cover=p.pictures[1], a=s.asset(p,inline), b=s.asset(p,cover)
    expect(()=>s.service.select({planId:p.id,pictureId:inline.id,assetId:b.id,expectedRevision:p.revision})).toThrow('不属于')
    p=s.service.select({planId:p.id,pictureId:inline.id,assetId:a.id,expectedRevision:p.revision})
    p=s.service.select({planId:p.id,pictureId:cover.id,assetId:b.id,expectedRevision:p.revision})
    const preview=s.service.preview(p.id)
    expect(preview.conflicts).toEqual([]);expect(preview.inserted).toBe(1)
    expect(s.db.getArticle(s.article.id)?.rawMarkdown).toBe(s.article.rawMarkdown)
    const applied=s.service.apply({planId:p.id,expectedRevision:p.revision,baseVersionId:preview.baseVersionId})
    expect(s.db.workflow.getForm(s.article.id)?.coverAssetId).toBe(b.id)
    expect(()=>s.service.apply({planId:p.id,expectedRevision:p.revision,baseVersionId:preview.baseVersionId})).toThrow('变化')
    const again=s.service.apply({planId:p.id,expectedRevision:p.revision,baseVersionId:applied.currentVersionId})
    expect(again.rawMarkdown.match(/moliu-asset/g)).toHaveLength(1)
    const undone=s.service.undo({planId:p.id,expectedVersionId:again.currentVersionId})
    expect(undone.rawMarkdown).toBe(s.article.rawMarkdown);expect(s.db.workflow.getForm(s.article.id)).toBeNull()
  })
  it('文章改变导致锚点失效时阻止应用，用户暂存内容也不会被覆盖',async()=>{
    const s=setup();let p=s.addPicture(await s.plan());const picture=p.pictures[0],a=s.asset(p,picture)
    p=s.service.select({planId:p.id,pictureId:picture.id,assetId:a.id,expectedRevision:p.revision})
    const changed=s.db.saveArticle({...s.article,rawMarkdown:'# 新版本\n\n不同内容',source:'manual'})
    expect(s.service.preview(p.id).conflicts[0]).toContain('位置')
    expect(()=>s.service.apply({planId:p.id,expectedRevision:p.revision,baseVersionId:changed.currentVersionId})).toThrow('位置')
    s.db.workflow.saveDraft({articleId:changed.id,baseVersionId:changed.currentVersionId,content:'未保存的正文'})
    expect(()=>s.service.preview(p.id)).toThrow('暂存')
  })
  it('分段记录重复文本的出现序号',()=>{
    expect(articleBlocks('# 标题\n\n重复\n\n重复').map(b=>b.occurrence)).toEqual([0,0,1])
  })
  it('代码块内的空行不产生可插图段落，文章中的位置偏移准确',()=>{
    const markdown='# 标题\n\n```js\nfirst()\n\nsecond()\n```\n\n正文'
    const blocks=articleBlocks(markdown)
    expect(blocks).toHaveLength(3)
    expect(blocks[1].text).toBe('```js\nfirst()\n\nsecond()\n```')
    for(const block of blocks) expect(markdown.slice(block.start,block.end)).toBe(block.text)
  })
  it('有效规划清除模型内部位置索引，手动提示词编辑和风格样图可保存',async()=>{
    const s=setup()
    s.setPayload({reasoning:'说明正文',pictures:[{kind:'inline',subject:'内容',purpose:'解释',blockIndex:1,ratio:'16:9',alt:'说明',priority:'required'}]})
    const p=await s.plan()
    expect(p.pictures[0]).not.toHaveProperty('blockIndex')
    expect(p.pictures[0].anchor.block).toBe('第一段内容')
    const reference=await s.service.sampleStyle({providerId:'p',model:'m',style:s.styleInput})
    expect(s.db.visualStudio.reference(reference.id)?.fileName).toBe(reference.fileName)
    expect(s.gateway.generateImage).toHaveBeenCalledWith(expect.objectContaining({prompt:expect.stringContaining('书桌')}))
  })
  it('提示词生成期间方案被修改时拒绝覆盖新方案',async()=>{
    const s=setup(),p=s.addPicture(await s.plan())
    let resolve!: (value: unknown) => void
    s.chat.mockImplementationOnce(()=>new Promise(done=>{resolve=done}) as never)
    const pending=s.service.prompts({planId:p.id,expectedRevision:p.revision,providerId:'p',model:'m'})
    const next=s.service.savePlan({...p,pictures:p.pictures.map(i=>({...i,subject:'人工新主题'}))})
    resolve({content:JSON.stringify({pictures:[{id:p.pictures[0].id,prompt:'旧结果'}]})})
    await expect(pending).rejects.toThrow('更新')
    expect(s.db.visualStudio.plan(p.id)).toEqual(next)
  })
  it('参考图接口失败时向用户报告，绝不暗中切换为纯文字生图',async()=>{
    const s=setup(),reference=await s.service.importReference(Uint8Array.from(Buffer.from(s.png,'base64')).buffer)
    const style=s.db.visualStudio.saveStyle({...s.styleInput,references:[reference]})
    let p=s.addPicture(await s.plan());p=s.service.savePlan({...p,style})
    s.setPayload({pictures:[{id:p.pictures[0].id,prompt:'测试画面'}]})
    p=await s.service.prompts({planId:p.id,expectedRevision:p.revision,providerId:'p',model:'m'})
    vi.mocked(s.gateway.uploadImage).mockRejectedValueOnce(new Error('供应商不支持参考图上传'))
    await expect(s.service.generate({planId:p.id,pictureId:p.pictures[0].id,expectedRevision:p.revision,providerId:'p',model:'m',referenceMode:'image'})).rejects.toThrow('不支持')
    expect(s.gateway.generateImage).not.toHaveBeenCalled()
  })
})
