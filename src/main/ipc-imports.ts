import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import type { ContentImportService } from './services/content-import-service.js'

type RegisterHandler = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void

const kind = z.enum(['account', 'hot-item', 'topic', 'framework', 'article', 'review', 'visual-plan', 'layout', 'publish-form', 'prompt'])
const format = z.enum(['json', 'markdown', 'csv', 'docx', 'html', 'text'])
const id = z.string().uuid()
const associations = z.object({
  visualStudio: z.boolean().optional(),
  accountId: id.optional(),
  topicId: id.optional(),
  frameworkId: id.optional(),
  articleId: id.optional(),
  layoutId: id.optional()
}).optional()

export function registerImportsIpc(handle: RegisterHandler, service: ContentImportService): void {
  handle('imports:pick', (_event, raw: unknown) => service.pickFile(z.object({ kind }).parse(raw).kind))
  handle('imports:preview', (_event, raw: unknown) => {
    const input = z.object({
      kind,
      filePath: z.string().trim().min(1).max(4096).optional(),
      content: z.string().max(1_000_000).optional(),
      fileName: z.string().trim().max(255).optional(),
      format: format.optional()
    }).refine((value) => Boolean(value.filePath || value.content !== undefined), {
      message: '需要选择文件或粘贴内容'
    }).parse(raw)
    return service.preview(input)
  })
  handle('imports:commit', (_event, raw: unknown) => service.commit(z.object({
    token: z.string().trim().min(10).max(100),
    associations,
    mode: z.enum(['create', 'new-version']).optional(),
    mapping: z.record(z.string(), z.string().max(100)).optional()
  }).parse(raw)))
  handle('imports:export', (_event, raw: unknown) => service.export(z.object({
    kind,
    format: z.enum(['json', 'markdown']),
    ids: z.array(z.string().trim().min(1).max(100)).max(500).optional()
  }).parse(raw)))
}
