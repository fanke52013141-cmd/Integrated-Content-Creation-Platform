import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'

describe('搜索服务验证状态', () => {
  it('记录成功/失败，并在更换密钥后让旧结论失效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-search-state-'))
    const dbPath = join(dir, 'moliu.db')
    try {
      const db = new AppDatabase(dbPath)
      expect(db.getSearchService().lastTestStatus).toBeUndefined()

      db.recordSearchServiceTest('success')
      expect(db.getSearchService()).toMatchObject({ lastTestStatus: 'success' })
      expect(db.getSearchService().lastTestAt).toBeTruthy()

      db.recordSearchServiceTest('failure', '豆包搜索套餐额度不足')
      expect(db.getSearchService()).toMatchObject({
        lastTestStatus: 'failure',
        lastTestError: '豆包搜索套餐额度不足'
      })

      // 换密钥等于换配置：旧验证结论必须失效
      db.saveSearchService({ enabled: true }, Buffer.from('encrypted-key'))
      const after = db.getSearchService()
      expect(after.hasApiKey).toBe(true)
      expect(after.lastTestStatus).toBeUndefined()
      expect(after.lastTestError).toBeUndefined()
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
