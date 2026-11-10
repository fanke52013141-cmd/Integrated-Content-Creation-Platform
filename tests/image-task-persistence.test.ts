import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'

describe('image_tasks 持久化', () => {
  it('提交登记 → 进度 → 完成，重启后不再出现在待续查列表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-image-task-'))
    const dbPath = join(dir, 'moliu.db')
    try {
      const db = new AppDatabase(dbPath)
      db.createImageTask({
        id: 'tsk_1', providerId: 'provider-1', model: 'gpt-image-2-vip',
        packId: 'pack-1', kind: 'cover', slot: 0, prompt: '中文提示词',
        ratio: '21:9', quality: 'low', resolution: '1k'
      })

      const pending = db.listPendingImageTasks()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        id: 'tsk_1', providerId: 'provider-1', model: 'gpt-image-2-vip',
        packId: 'pack-1', kind: 'cover', slot: 0, ratio: '21:9', quality: 'low', resolution: '1k'
      })

      db.updateImageTaskProgress('tsk_1', 40)
      expect(db.listPendingImageTasks()[0].progress).toBe(40)

      db.completeImageTask('tsk_1', 'asset-1', 0.0048)
      expect(db.listPendingImageTasks()).toHaveLength(0)
      db.close()

      // 重启：完成的任务不会被再次续查
      const reopened = new AppDatabase(dbPath)
      expect(reopened.listPendingImageTasks()).toHaveLength(0)
      reopened.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('失败任务写回原因并从待续查列表移除', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-image-task-'))
    const dbPath = join(dir, 'moliu.db')
    try {
      const db = new AppDatabase(dbPath)
      db.createImageTask({
        id: 'tsk_2', providerId: 'provider-1', model: 'gpt-image-2-vip',
        packId: 'pack-1', kind: 'inline', slot: 2, prompt: 'p'
      })
      db.failImageTask('tsk_2', '生图任务失败：输入参数无效')
      expect(db.listPendingImageTasks()).toHaveLength(0)
      db.close()

      const reopened = new AppDatabase(dbPath)
      expect(reopened.listPendingImageTasks()).toHaveLength(0)
      reopened.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('候选图超期清理（PRD §7：30 天自动清理，可开关）', () => {
  it('只删未引用且未被选中的超期候选；被文章引用的保留', async () => {
    const { VisualAssetService } = await import('../src/main/services/visual-asset-service.js')
    const { mkdtempSync, writeFileSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const db = new AppDatabase(':memory:')
    const dir = mkdtempSync(join(tmpdir(), 'moliu-prune-'))
    const service = new VisualAssetService(db, {} as never, dir)
    try {
      const article = db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 文' })
      const pack = db.saveVisualPack({ kind: 'manual', articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: 'draft',
        cover: { visual: '', prompt: '', overlayText: '' }, inlineImages: [], releaseImages: [], rawXml: '' })
      db.saveVisualAsset({ packId: pack.id, kind: 'inline', slot: 0, prompt: '未引用', fileName: 'stale-a.png', source: 'generated' })
      db.saveVisualAsset({ packId: pack.id, kind: 'inline', slot: 1, prompt: '被引用', fileName: 'referenced.png', source: 'generated' })
      for (const name of ['stale-a.png', 'referenced.png']) writeFileSync(join(dir, name), 'png')
      // 文章正文引用 referenced.png
      db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 文\n\n![r](moliu-asset://assets/referenced.png)' })
      // days=0：全部视为超期
      const result = await service.pruneStaleCandidates(0)
      expect(result.removed).toBe(1)
      expect(existsSync(join(dir, 'stale-a.png'))).toBe(false)
      expect(existsSync(join(dir, 'referenced.png'))).toBe(true)
      expect(db.listVisualAssets().map(a => a.fileName)).toEqual(['referenced.png'])
    } finally { db.close() }
  })

  it('被方案选中的候选（selectedAssetId）不清理', async () => {
    const { VisualAssetService } = await import('../src/main/services/visual-asset-service.js')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const db = new AppDatabase(':memory:')
    const dir = mkdtempSync(join(tmpdir(), 'moliu-prune-2-'))
    const service = new VisualAssetService(db, {} as never, dir)
    try {
      const article = db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# T\n\n正文' })
      const pack = db.saveVisualPack({ kind: 'manual', articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: 'draft',
        cover: { visual: '', prompt: '', overlayText: '' }, inlineImages: [], releaseImages: [], rawXml: '' })
      const asset = db.saveVisualAsset({ packId: pack.id, kind: 'inline', slot: 0, prompt: '已选用', fileName: 'chosen.png', source: 'generated' })
      writeFileSync(join(dir, 'chosen.png'), 'png')
      const plan: import('../src/shared/visual-studio.js').VisualPlan = { id: pack.id, articleId: article.id, articleVersionId: article.currentVersionId, sourceMarkdown: article.rawMarkdown, revision: 1, nextSlot: 1, title: 'T', reasoning: '', pictures: [{ id: crypto.randomUUID(), kind: 'inline' as const, slot: 0, subject: '图', purpose: '', ratio: '16:9', alt: '', caption: '', anchor: { block: '', occurrence: 0, placement: 'after' as const }, priority: 'optional' as const, prompt: '', promptLocked: false, selectedAssetId: asset.id }], promptsStale: false, createdAt: new Date().toISOString() }
      db.visualStudio.create(plan)
      const result = await service.pruneStaleCandidates(0)
      expect(result.removed).toBe(0)
      expect(db.listVisualAssets().map(a => a.fileName)).toContain('chosen.png')
    } finally { db.close() }
  })
})
