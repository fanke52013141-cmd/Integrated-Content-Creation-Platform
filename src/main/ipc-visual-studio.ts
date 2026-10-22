import { ipcMain } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import type { AppDatabase } from './database.js'
import type { ModelGateway } from './gateway/model-gateway.js'
import type { VisualAssetService } from './services/visual-asset-service.js'
import { VisualStudioService } from './services/visual-studio-service.js'
import { beginGenerationChild, endGenerationChild } from './services/generation-registry.js'

const id = z.string().uuid()
const text = z.string().max(3000)
const reference = z.object({ id, fileName: z.string().max(200), url: z.string().max(400) }).strict()
export const visualStyleInputSchema = z.object({ id: id.optional(), expectedVersionId: id.optional(), name: z.string().trim().min(1).max(100), description: text, colors: text, medium: text, composition: text, avoid: text, references: z.array(reference).max(1) }).strict()
const style = visualStyleInputSchema.extend({ id, versionId: id, version: z.number().int().positive(), archived: z.boolean(), createdAt: z.string() })
const picture = z.object({ id, kind: z.enum(['cover','header','inline','release']), slot: z.number().int().min(0).max(1000), subject: z.string().trim().min(1).max(2000), purpose: text, ratio: z.enum(['21:9','16:9','4:3','3:4','1:1']), alt: z.string().max(500), caption: z.string().max(500), priority: z.enum(['required','optional']), anchor: z.object({ versionId: id.optional(), block: z.string().max(200000), occurrence: z.number().int().min(0), placement: z.enum(['before','after','top']) }).strict(), prompt: z.string().max(6000), promptLocked: z.boolean(), style: style.optional(), selectedAssetId: id.optional() }).strict()
const plan = z.object({ id, articleId: id, articleVersionId: id, sourceMarkdown: z.string().max(500000), revision: z.number().int().positive(), nextSlot: z.number().int().min(0).max(1001), title: text, reasoning: text, pictures: z.array(picture).max(12), style: style.optional(), promptsStale: z.boolean(), createdAt: z.string() }).strict()
const target = z.object({ providerId: id, model: z.string().trim().min(1).max(160) })
const planRevision = { planId: id, expectedRevision: z.number().int().positive() }

export function registerVisualStudioIpc(database: AppDatabase, gateway: ModelGateway, assets: VisualAssetService, dataPath: string): void {
  const service = new VisualStudioService(database, gateway, assets, join(dataPath, 'images'))
  const handle = (name: string, action: (raw: unknown) => unknown) => { ipcMain.handle(`visual-studio:${name}`, (_event, raw: unknown) => action(raw)) }
  const run = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = beginGenerationChild('visuals')
    try { return await operation(controller.signal) } finally { endGenerationChild('visuals', controller) }
  }
  handle('styles', () => database.visualStudio.styles())
  handle('save-style', raw => database.atomic(() => database.visualStudio.saveStyle(visualStyleInputSchema.parse(raw))))
  handle('archive-style', raw => { const input = z.object({ id, archived: z.boolean() }).parse(raw); database.visualStudio.archive(input.id, input.archived) })
  handle('style-history', raw => database.visualStudio.history(id.parse(raw)))
  handle('import-reference', raw => service.importReference(z.instanceof(ArrayBuffer).parse(raw)))
  handle('reference-from-asset', raw => service.referenceFromAsset(id.parse(raw)))
  handle('analyze-reference', raw => { const input = target.extend({ referenceId: id }).parse(raw); return run(signal => service.analyzeReference(input, signal)) })
  handle('sample-style', raw => { const input = target.extend({ style: visualStyleInputSchema }).parse(raw); return run(signal => service.sampleStyle(input, signal)) })
  handle('default-style', raw => database.visualStudio.defaultStyle(id.parse(raw)))
  handle('bind-style', raw => { const input = z.object({ accountId: id, styleId: id.nullable() }).parse(raw); database.visualStudio.bind(input.accountId,input.styleId) })
  handle('plans', raw => database.visualStudio.plans(id.parse(raw)))
  handle('plan', raw => {
    const input = target.extend({ articleId: id, count: z.union([z.literal('auto'),z.number().int().min(0).max(8)]), density: z.enum(['minimal','standard','rich']), cover: z.boolean(), header: z.boolean(), maxInline: z.number().int().min(0).max(8) }).parse(raw)
    if (input.count !== 'auto' && input.count > input.maxInline) throw new Error('指定数量不能超过正文图上限')
    return run(signal => service.plan(input, signal))
  })
  handle('save-plan', raw => service.savePlan(plan.parse(raw)))
  handle('prompts', raw => { const input = target.extend(planRevision).parse(raw); return run(signal => service.prompts(input, signal)) })
  handle('generate', raw => { const input = target.extend({ ...planRevision, pictureId: id, referenceMode: z.enum(['image','text']) }).parse(raw); return run(signal => service.generate(input, signal)) })
  handle('select', raw => service.select(z.object({ ...planRevision, pictureId: id, assetId: id }).parse(raw)))
  handle('preview', raw => service.preview(id.parse(raw)))
  handle('apply', raw => service.apply(z.object({ ...planRevision, baseVersionId: id }).parse(raw)))
  handle('undo', raw => service.undo(z.object({ planId: id, expectedVersionId: id }).parse(raw)))
}
