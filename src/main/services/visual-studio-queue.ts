import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../database.js'
import type { VisualAssetService } from './visual-asset-service.js'
import type { VisualStudioService } from './visual-studio-service.js'
import type { GeneratePictureInput, VisualImageJob } from '../../shared/visual-studio.js'
import type { GenerationEvent } from '../../shared/contracts.js'
import { pictureSignature } from '../../shared/visual-studio.js'
import { beginGenerationChild, endGenerationChild } from './generation-registry.js'

/** The database owns the queue. Closing a page never owns or cancels a job. */
export class VisualStudioQueue {
  private ready = false
  private draining = false
  private recovering = false
  private controllers = new Map<string, AbortController>()
  constructor(private readonly database: AppDatabase, private readonly service: VisualStudioService, private readonly assets: VisualAssetService, private readonly onEvent?: (event: GenerationEvent) => void) {}
  private get store() { return this.database.visualStudio }
  private emit(job: VisualImageJob, status: GenerationEvent['status'], outcome?: GenerationEvent['outcome'], message?: string) { this.onEvent?.({id:job.id,domain:'visuals',status,outcome,message,at:new Date().toISOString()}) }
  async initialize(): Promise<void> {
    if (this.recovering) return
    this.recovering = true
    try {
      for (const job of this.store.jobs().filter(j => j.status === 'running')) {
        this.store.saveJob({ ...job, status: job.remoteTaskId ? 'recovering' : 'unknown', error: job.remoteTaskId ? '正在续查供应商任务' : '上次提交被中断，尚未确认供应商是否收到，请核对后处理' })
      }
      // Existing image_tasks perform the actual provider polling and asset persistence.
      await this.assets.resumePendingTasks()
      this.reconcile()
    } finally { this.ready = true; this.recovering = false; void this.drain() }
  }
  private reconcile(): void {
    for (const job of this.store.jobs().filter(j => j.status === 'recovering' || (j.status === 'unknown' && j.remoteTaskId))) {
      const task = job.remoteTaskId ? this.database.getImageTask(job.remoteTaskId) : null
      if (task?.status === 'completed' && task.assetId && this.database.getVisualAsset(task.assetId)) {
        this.store.stampAsset(task.assetId,job.signature)
        this.store.saveJob({ ...job, status: 'completed', assetId: task.assetId, error: undefined })
        this.database.finishGenerationTask(job.id,'succeeded','续查恢复图片')
        this.emit(job,'done','succeeded','已续查恢复配图')
      } else if (task?.status === 'completed') {
        // The provider says it completed, but the local asset disappeared or could not be persisted.
        // Do not leave this job endlessly recovering, and never silently submit a paid replacement.
        this.store.saveJob({ ...job, status: 'unknown', error: '供应商任务已完成，但本地图片尚未恢复；请先核对供应商结果，勿直接重复提交' })
        this.database.finishGenerationTask(job.id,'interrupted','供应商已完成，本地图片待恢复')
        this.emit(job,'failed','interrupted','供应商已完成，但本地图片待恢复，请勿直接重复提交')
      } else if (!task || task.status === 'failed') {
        this.store.saveJob({ ...job, status: 'unknown', error: task?.error ?? '任务结果尚未确认，请在供应商后台核对' })
        this.database.finishGenerationTask(job.id,'interrupted','供应商结果待核对')
        this.emit(job,'failed','interrupted','供应商结果待核对，请勿直接重复提交')
      } else {
        // The lookup finished without a definitive result, for example because
        // the network was unavailable. Make another lookup accessible to users.
        this.store.saveJob({ ...job, status: 'unknown', error: '暂时无法确认供应商结果，可再查一次，不会重新生图' })
        this.database.finishGenerationTask(job.id,'interrupted','供应商结果待核对')
        this.emit(job,'failed','interrupted','供应商结果待核对，可再次续查')
      }
    }
  }
  enqueue(input: GeneratePictureInput): VisualImageJob {
    const plan = this.store.plan(input.planId), picture = plan.pictures.find(p => p.id === input.pictureId)
    if (plan.revision !== input.expectedRevision || !picture) throw new Error('方案已更新，请重新读取')
    if (!picture.prompt.trim() || (picture.promptStale ?? plan.promptsStale)) throw new Error('请先更新本图提示词')
    const signature = pictureSignature(plan,picture)
    const live = this.store.jobs(plan.id).find(j => j.pictureId === picture.id && ['queued','running','recovering','unknown','paused'].includes(j.status))
    if (live) {
      if (live.signature !== signature || (['providerId','model','quality','resolution','referenceMode'] as const).some(key=>live.input[key]!==input[key])) throw new Error('本图还有旧方案任务，请先停止或处理旧任务')
      return live
    }
    const now = new Date().toISOString()
    const job: VisualImageJob = { id: randomUUID(),planId:plan.id,pictureId:picture.id,signature,input,status:'queued',createdAt:now,updatedAt:now }
    this.database.atomic(() => {
      this.store.saveJob(job)
      this.database.beginGenerationTask({ id:job.id,domain:'visuals',label:`配图：${picture.subject.slice(0,60)}` })
    })
    void this.drain()
    return job
  }
  async control(id: string, action: 'pause' | 'resume' | 'retry' | 'check-result' | 'confirm-not-submitted'): Promise<void> {
    const job = this.store.job(id)
    if (action === 'pause') {
      if (!['queued','running','recovering'].includes(job.status)) throw new Error('当前任务不可暂停')
      this.store.saveJob({ ...job,status:job.status==='running'&&!job.remoteTaskId?'unknown':'paused',error:job.status==='running'&&!job.remoteTaskId?'提交期间被中止，请核对供应商是否收到':'已暂停，继续时优先续查已提交任务' })
      this.controllers.get(id)?.abort()
      this.database.finishGenerationTask(id,'cancelled','用户暂停')
      this.emit(job,'done','cancelled','配图任务已暂停')
      return
    }
    if (this.controllers.has(id)) throw new Error('正在停止任务，请稍后继续')
    if (action === 'confirm-not-submitted' && job.status !== 'unknown') throw new Error('仅结果待核对的任务需要人工确认')
    if (action === 'check-result') {
      if (!job.remoteTaskId) throw new Error('此任务没有供应商任务标识，请到供应商后台核对')
      this.database.recheckImageTask(job.remoteTaskId)
      this.store.saveJob({...job,status:'recovering',error:'正在续查已知任务，不重新生图'})
      await this.initialize();return
    }
    if (job.status === 'unknown' && action !== 'confirm-not-submitted') throw new Error('请先核对供应商结果，确认没有可用图片后再提交')
    if (action === 'retry' && job.status !== 'failed') throw new Error('只能重试明确失败的任务')
    if (action === 'resume' && !['paused','recovering'].includes(job.status)) throw new Error('当前任务不可继续')
    if (action !== 'confirm-not-submitted' && job.remoteTaskId) {
      this.store.saveJob({ ...job,status:'recovering',error:'正在续查已提交任务' })
      await this.initialize()
      return
    }
    const plan = this.store.plan(job.planId), picture = plan.pictures.find(p => p.id === job.pictureId)
    if (!picture || pictureSignature(plan,picture) !== job.signature) throw new Error('本图方案已修改，请使用更新后的方案重新生成')
    this.store.saveJob({ ...job,status:'queued',remoteTaskId:undefined,error:undefined,input:{...job.input,expectedRevision:plan.revision} })
    this.database.resumeGenerationTask(id)
    void this.drain()
  }
  private async drain(): Promise<void> {
    if (!this.ready || this.draining) return
    this.draining = true
    try {
      for (;;) {
        const job = this.store.jobs().find(j => j.status === 'queued')
        if (!job) break
        const controller = beginGenerationChild('visuals')
        this.controllers.set(job.id,controller)
        try {
          const plan = this.store.plan(job.planId), picture = plan.pictures.find(p => p.id === job.pictureId)
          if (!picture || job.signature !== pictureSignature(plan,picture)) throw new Error('方案已修改，此任务已停止，请重新生成')
          this.store.saveJob({ ...job,status:'running' })
          this.database.resumeGenerationTask(job.id)
          this.emit(job,'started')
          const asset = await this.service.generate({ ...job.input,expectedRevision:plan.revision },controller.signal,remoteTaskId => {
            const latest = this.store.job(job.id)
            this.store.saveJob({ ...latest,remoteTaskId })
          })
          this.store.saveJob({ ...this.store.job(job.id),status:'completed',assetId:asset.id,error:undefined })
          this.database.workflow.saveTaskResults(job.id,plan.articleId,[asset.id])
          this.database.finishGenerationTask(job.id,'succeeded','图片已生成')
          this.emit(job,'done','succeeded','配图已生成，可返回工作台选图')
        } catch (error) {
          const latest = this.store.job(job.id)
          if (latest.status !== 'paused') {
            // With a known remote task (or a cancelled submission), an error is not proof of non-delivery.
            const uncertain = error && typeof error === 'object' && 'kind' in error && ['NetworkError','TimeoutError','CancelledError'].includes(String(error.kind))
            const status = latest.remoteTaskId || controller.signal.aborted || uncertain ? 'unknown' : 'failed'
            const message = error instanceof Error ? error.message : String(error)
            this.store.saveJob({ ...latest,status,error:message })
            this.database.finishGenerationTask(job.id,status === 'unknown' ? 'interrupted' : 'failed',message)
            this.emit(job,'failed',status === 'unknown' ? 'interrupted' : 'failed',message)
          }
        } finally { this.controllers.delete(job.id); endGenerationChild('visuals',controller) }
      }
    } catch (error) { console.error('[visual-queue]',error) }
    finally { this.draining = false }
  }
}
