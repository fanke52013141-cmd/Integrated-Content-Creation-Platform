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
