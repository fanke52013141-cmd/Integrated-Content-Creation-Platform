import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { VisualStudioService } from '../src/main/services/visual-studio-service.js'
import { VisualStudioQueue } from '../src/main/services/visual-studio-queue.js'
import type { VisualAssetService } from '../src/main/services/visual-asset-service.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { VisualPlan, PictureBrief, GeneratePictureInput } from '../src/shared/visual-studio.js'
import { pictureSignature } from '../src/shared/visual-studio.js'
import { GatewayError } from '../src/main/gateway/types.js'

const dbs: AppDatabase[]=[]
afterEach(()=>{dbs.splice(0).forEach(db=>db.close())})
function setup() {
  const db=new AppDatabase(':memory:');dbs.push(db)
  const article=db.saveArticle({materialIds:[],manualOutline:'',status:'draft',source:'manual',rawMarkdown:'# 标题\n\n第一段\n\n第二段'})
  const pack=db.saveVisualPack({articleId:article.id,articleVersionId:article.currentVersionId,articleStatusSnapshot:'draft',cover:{visual:'',prompt:'',overlayText:''},inlineImages:[],releaseImages:[],rawXml:'<visual-studio/>'})
  const pictures: PictureBrief[]=[0,1].map(slot=>({id:crypto.randomUUID(),kind:'inline',slot,subject:`主题${slot}`,purpose:'解释',ratio:'16:9',alt:'说明',caption:'',anchor:{block:slot?'第二段':'第一段',occurrence:0,placement:'after'},priority:'required',prompt:`提示词${slot}`,promptLocked:false,promptStale:false}))
  const plan=db.visualStudio.create({id:pack.id,articleId:article.id,articleVersionId:article.currentVersionId,sourceMarkdown:article.rawMarkdown,revision:1,nextSlot:2,title:'标题',reasoning:'正文图',pictures,promptsStale:false,createdAt:new Date().toISOString()})
  const saveAsset=(input:{packId:string;slot?:number;kind:'inline'|'cover'|'release';prompt:string})=>db.saveVisualAsset({...input,slot:input.slot??0,fileName:`${crypto.randomUUID()}.png`,source:'generated',providerId:'p',model:'m'})
  const generate=vi.fn(async (input)=>saveAsset(input))
  const resumePendingTasks=vi.fn(async()=>0)
  const assets={generate,edit:generate,resumePendingTasks} as unknown as VisualAssetService
  const chat=vi.fn(async()=>({content:JSON.stringify({pictures:[]})}))
  const service=new VisualStudioService(db,{chat} as unknown as ModelGateway,assets,'.')
  const queue=new VisualStudioQueue(db,service,assets)
  const input=(picture=plan.pictures[0],p=plan):GeneratePictureInput=>({planId:p.id,pictureId:picture.id,expectedRevision:p.revision,providerId:'p',model:'m',referenceMode:'text'})
  return {db,plan,article,service,queue,assets,generate,resumePendingTasks,saveAsset,input,chat}
}

describe('配图可靠性和增量更新',()=>{
  it('修改一张图片只让该图提示词失效，其他图片仍可生成',async()=>{
    const s=setup()
    const next=s.service.savePlan({...s.plan,pictures:s.plan.pictures.map((p,i)=>i? p:{...p,subject:'新主题'})})
    expect(next.pictures.map(p=>p.promptStale)).toEqual([true,false])
    await expect(s.service.generate(s.input(next.pictures[0],next))).rejects.toThrow('本图')
    await expect(s.service.generate(s.input(next.pictures[1],next))).resolves.toHaveProperty('id')
  })
  it('旧候选图必须更新或明确确认沿用；再次修改后旧确认失效',async()=>{
    const s=setup(),p=s.plan.pictures[0]
    const asset=await s.service.generate(s.input())
    let next=s.service.savePlan({...s.plan,pictures:s.plan.pictures.map(i=>i.id===p.id?{...i,prompt:'新的人工提示词'}:i)})
    expect(s.service.assetStates(next.id).find(a=>a.assetId===asset.id)?.status).toBe('outdated')
    expect(()=>s.service.select({planId:next.id,pictureId:p.id,assetId:asset.id,expectedRevision:next.revision})).toThrow('旧')
    next=s.service.select({planId:next.id,pictureId:p.id,assetId:asset.id,expectedRevision:next.revision,allowOutdated:true})
    expect(s.service.preview(next.id).conflicts.some(c=>c.includes('更新或确认'))).toBe(false)
    next=s.service.savePlan({...next,pictures:next.pictures.map(i=>i.id===p.id?{...i,prompt:'再次修改提示词'}:i)})
    expect(s.service.preview(next.id).conflicts.some(c=>c.includes('更新或确认'))).toBe(true)
  })
  it('草稿独立于正式方案，比较版本防覆盖，清空后保留单调递增版本',()=>{
    const s=setup(),draft=s.db.visualStudio.saveDraft({...s.plan,pictures:s.plan.pictures.map(p=>({...p,caption:'草稿图注'}))},0)
    expect(s.db.visualStudio.plan(s.plan.id)).toEqual(s.plan)
    expect(()=>s.db.visualStudio.saveDraft(s.plan,0)).toThrow('其他窗口')
    const next=s.service.savePlan(draft.plan!,draft.revision)
    expect(s.db.visualStudio.draft(s.plan.id)?.plan).toBeNull()
    expect(s.db.visualStudio.draft(s.plan.id)?.revision).toBe(2)
    expect(()=>s.db.visualStudio.saveDraft(next,0)).toThrow('其他窗口')
    expect(s.db.visualStudio.saveDraft(next,2).revision).toBe(3)
  })
  it('读取旧草稿时保留差异，拒绝覆盖新的正式方案',()=>{
    const s=setup(),draft=s.db.visualStudio.saveDraft(s.plan,0)
    s.service.savePlan({...s.plan,pictures:s.plan.pictures.map(p=>({...p,caption:'另一个窗口'}))})
    expect(()=>s.service.savePlan(draft.plan!,draft.revision)).toThrow('更新')
    expect(s.db.visualStudio.draft(s.plan.id)?.plan).toEqual(s.plan)
  })
  it('持久队列可由新实例恢复，重复点击不会重复提交',async()=>{
    const s=setup()
    const first=s.queue.enqueue(s.input()),same=s.queue.enqueue(s.input())
    s.queue.enqueue(s.input(s.plan.pictures[1]))
    expect(same.id).toBe(first.id);expect(s.generate).not.toHaveBeenCalled()
    const restored=new VisualStudioQueue(s.db,s.service,s.assets)
    await restored.initialize()
    await vi.waitFor(()=>expect(s.db.visualStudio.jobs().every(j=>j.status==='completed')).toBe(true))
    expect(s.generate).toHaveBeenCalledTimes(2)
    expect(s.db.listGenerationTasks().filter(j=>j.status==='succeeded')).toHaveLength(2)
  })
  it('续查已有远端任务只取回结果，不发起新的生图',async()=>{
    const s=setup(),job=s.queue.enqueue(s.input())
    s.db.createImageTask({id:'remote-1',providerId:'p',model:'m',packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'})
    s.db.visualStudio.saveJob({...job,status:'running',remoteTaskId:'remote-1'})
    s.resumePendingTasks.mockImplementationOnce(async()=>{const asset=s.saveAsset({packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'});s.db.completeImageTask('remote-1',asset.id);return 1})
    await s.queue.initialize()
    expect(s.db.visualStudio.job(job.id).status).toBe('completed')
    expect(s.generate).not.toHaveBeenCalled()
    expect(s.service.assetStates(s.plan.id)[0].status).toBe('current')
  })
  it('供应商已完成但本地资产缺失时转为待核对，不会永远停在恢复中',async()=>{
    const s=setup(),job=s.queue.enqueue(s.input())
    s.db.createImageTask({id:'remote-missing-asset',providerId:'p',model:'m',packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'})
    s.db.completeImageTask('remote-missing-asset','missing-asset')
    s.db.visualStudio.saveJob({...job,status:'running',remoteTaskId:'remote-missing-asset'})
    await s.queue.initialize()
    expect(s.db.visualStudio.job(job.id)).toMatchObject({status:'unknown',error:expect.stringContaining('本地图片尚未恢复')})
    expect(s.generate).not.toHaveBeenCalled()
  })
  it('续查暂时不可用时允许再次查询原任务，不自动重新生图',async()=>{
    const s=setup(),job=s.queue.enqueue(s.input())
    s.db.createImageTask({id:'remote-pending',providerId:'p',model:'m',packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'})
    s.db.visualStudio.saveJob({...job,status:'running',remoteTaskId:'remote-pending'})
    await s.queue.initialize()
    expect(s.db.visualStudio.job(job.id)).toMatchObject({status:'unknown',error:expect.stringContaining('再查一次')})
    expect(s.db.getImageTask('remote-pending')?.status).toBe('pending')
    s.resumePendingTasks.mockImplementationOnce(async()=>{const asset=s.saveAsset({packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'});s.db.completeImageTask('remote-pending',asset.id);return 1})
    await s.queue.control(job.id,'check-result')
    expect(s.db.visualStudio.job(job.id).status).toBe('completed')
    expect(s.generate).not.toHaveBeenCalled()
  })
  it('提交结果不明时不会自动重发，人工确认之后才允许重新提交',async()=>{
    const s=setup(),job=s.queue.enqueue(s.input())
    s.db.visualStudio.saveJob({...job,status:'running'})
    await s.queue.initialize()
    expect(s.db.visualStudio.job(job.id).status).toBe('unknown');expect(s.generate).not.toHaveBeenCalled()
    await expect(s.queue.control(job.id,'retry')).rejects.toThrow('核对')
    await s.queue.control(job.id,'confirm-not-submitted')
    await vi.waitFor(()=>expect(s.db.visualStudio.job(job.id).status).toBe('completed'))
    expect(s.generate).toHaveBeenCalledOnce()
  })
  it('网络错误没有任务标识也视为结果未知，队列不自动增加费用',async()=>{
    const s=setup()
    s.generate.mockRejectedValueOnce(new GatewayError('NetworkError','返回丢失'))
    const job=s.queue.enqueue(s.input());await s.queue.initialize()
    await vi.waitFor(()=>expect(s.db.visualStudio.job(job.id).status).toBe('unknown'))
    expect(s.generate).toHaveBeenCalledOnce()
  })
  it('排队后修改内容会阻止旧任务生成，图注和位置调整不影响图片签名',async()=>{
    const s=setup(),job=s.queue.enqueue(s.input())
    const p=s.plan.pictures[0]
    expect(pictureSignature(s.plan,p)).toBe(pictureSignature(s.plan,{...p,caption:'新图注',anchor:{block:'第二段',occurrence:0,placement:'before'}}))
    s.service.savePlan({...s.plan,pictures:s.plan.pictures.map(i=>({...i,prompt:'新提示词'}))})
    await s.queue.initialize()
    await vi.waitFor(()=>expect(s.db.visualStudio.job(job.id).status).toBe('failed'))
    expect(s.generate).not.toHaveBeenCalled()
  })
  it('质量参数进入持久队列与生成调用',async()=>{
    const s=setup(),job=s.queue.enqueue({...s.input(),quality:'high',resolution:'2k'})
    await s.queue.initialize();await vi.waitFor(()=>expect(s.db.visualStudio.job(job.id).status).toBe('completed'))
    expect(s.generate).toHaveBeenCalledWith(expect.objectContaining({quality:'high',resolution:'2k'}),expect.any(AbortSignal),expect.any(Function))
  })
  it('结果未知仍可按原任务标识再次查询，不重新生图',async()=>{
    const s=setup(),job=s.queue.enqueue(s.input())
    s.db.createImageTask({id:'remote-check',providerId:'p',model:'m',packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'})
    s.db.failImageTask('remote-check','网络中断')
    s.db.visualStudio.saveJob({...job,status:'unknown',remoteTaskId:'remote-check'})
    s.resumePendingTasks.mockImplementationOnce(async()=>{expect(s.db.getImageTask('remote-check')?.status).toBe('pending');const asset=s.saveAsset({packId:s.plan.id,kind:'inline',slot:0,prompt:'提示词'});s.db.completeImageTask('remote-check',asset.id);return 1})
    await s.queue.control(job.id,'check-result')
    expect(s.db.visualStudio.job(job.id).status).toBe('completed')
    expect(s.generate).not.toHaveBeenCalled()
  })
})
