import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from './database.js'
import type { KeyStore } from './security/key-store.js'
import type { WechatPublishService } from './services/wechat-publish-service.js'

type RegisterHandler = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void
const id = z.string().uuid()
const channelSchema = z.object({ appId: z.string().trim().min(1).max(100), appSecret: z.string().trim().min(1).max(1000).optional(), enabled: z.boolean() })
const draftSchema = z.object({ articleId: id, layoutId: id, thumbMediaId: z.string().trim().max(200).optional(), coverAssetId: id.optional(), author: z.string().trim().max(100).optional(), digest: z.string().trim().max(120).optional(), contentSourceUrl: z.string().trim().url().refine(value => /^https?:\/\//i.test(value), '原文链接仅支持 HTTP 或 HTTPS').optional(), appId: z.string().max(100).optional() })

export function registerPublishingIpc(handle: RegisterHandler, database: AppDatabase, keyStore: KeyStore, service: WechatPublishService): void {
  handle('publishing:wechat:get', () => database.getWechatPublishChannel())
  handle('publishing:wechat:save', async (_event, raw: unknown) => service.configure(async () => {
    const input = channelSchema.parse(raw)
    if (input.enabled) await service.test(input)
    const channel = database.saveWechatPublishChannel(input, input.appSecret ? keyStore.encrypt(input.appSecret) : undefined)
    if (input.enabled) database.workflow.recordVerification('success')
    return { ...channel, ...database.workflow.getVerification() }
  }))
  handle('publishing:wechat:test', (_event, raw?: unknown) => service.configure(() => service.test(raw === undefined ? undefined : channelSchema.parse(raw))))
  handle('publishing:list', () => database.listPublications())
  handle('publishing:wechat:push-draft', (_event, raw: unknown) => service.pushDraft(draftSchema.parse(raw)))
  handle('publishing:preflight', (_event, raw: unknown) => service.preflight(draftSchema.parse(raw)))
  handle('publishing:resolve-unknown', (_event, raw: unknown) => service.resolveUnknown(z.object({ id, decision: z.enum(['received', 'not-received', 'unresolved']), note: z.string().trim().min(1).max(2000), expectedUpdatedAt: z.string().max(100), remoteId: z.string().trim().min(1).max(200).optional() }).parse(raw)))
  handle('publishing:retry', (_event, publicationId: string) => service.retry(id.parse(publicationId)))
  handle('publishing:form:get', (_event, articleId: string) => database.workflow.getForm(id.parse(articleId)))
  handle('publishing:form:save', (_event, raw: unknown) => database.workflow.saveForm(z.object({
    articleId: id, layoutId: z.string().max(100), appId: z.string().max(100), coverAssetId: z.string().max(100), thumbMediaId: z.string().max(200),
    author: z.string().max(100), digest: z.string().max(120), contentSourceUrl: z.string().max(2000)
  }).parse(raw)))
  handle('publishing:wechat:upload-cover', (_event, raw: unknown) => service.uploadAsset(z.object({ assetId: id }).parse(raw).assetId))
  handle('publishing:update', (_event, raw: unknown) => {
    const input = z.object({ id, status: z.literal('published'), publishedUrl: z.string().url().refine(value => /^https?:\/\//i.test(value), '仅支持网页链接') }).parse(raw)
    return database.markPublicationPublished(input.id, input.publishedUrl)
  })
  handle('publishing:retro', (_event, raw: unknown) => {
    const input = z.object({ id, goal: z.string().trim().max(2000), result: z.string().trim().max(2000), lesson: z.string().trim().max(2000), metrics: z.object({ reads: z.number().int().nonnegative().max(1e12).optional(), shares: z.number().int().nonnegative().max(1e12).optional(), followers: z.number().int().nonnegative().max(1e12).optional(), conversions: z.number().int().nonnegative().max(1e12).optional(), cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional() }).parse(raw)
    return database.savePublicationRetro(input.id, input)
  })
}
