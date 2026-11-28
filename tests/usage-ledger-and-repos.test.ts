import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'

function withTempDb(fn: (db: AppDatabase) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'moliu-ledger-'))
  const db = new AppDatabase(join(dir, 'moliu.db'))
  try {
    fn(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('批次 D：模型用量与成本账本 + 仓储拆出回归', () => {
  it('getUsageLedger 按模型与创作环节准确汇总 Token、均耗时、费用与成功率', () => {
    withTempDb((db) => {
      const provider = db.saveProvider({
        displayName: 'DeepSeek 主力',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        enabled: true,
        isRelay: false,
        capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false },
        models: [{ modelId: 'deepseek-chat', displayName: 'DeepSeek Chat', kind: 'text', reasoningVariants: [], isDefault: true, enabled: true }]
      })

      db.recordModelCall({
        providerId: provider.id,
        model: 'deepseek-chat',
        latencyMs: 1200,
        promptTokens: 3000,
        completionTokens: 1500,
        success: true
      })
      db.recordModelCall({
        providerId: provider.id,
        model: 'deepseek-chat',
        latencyMs: 2400,
        promptTokens: 5000,
        completionTokens: 2500,
        success: true
      })
      db.recordModelCall({
        providerId: provider.id,
        model: 'gpt-image-1',
        latencyMs: 4000,
        success: false,
        errorKind: 'timeout',
        costUsd: 0.04
      })

      db.beginGenerationTask({ id: 'task-1', domain: 'articles', label: '生成长文' })
      db.finishGenerationTask('task-1', 'succeeded', '完成')
      db.beginGenerationTask({ id: 'task-2', domain: 'layouts', label: '排版自检' })
      db.finishGenerationTask('task-2', 'failed', '模型超时')

      const ledger = db.getUsageLedger(7)
      expect(ledger.days).toBe(7)
      expect(ledger.totals.calls).toBe(3)
      expect(ledger.totals.successCalls).toBe(2)
      expect(ledger.totals.failedCalls).toBe(1)
      expect(ledger.totals.promptTokens).toBe(8000)
      expect(ledger.totals.completionTokens).toBe(4000)
      expect(ledger.totals.totalTokens).toBe(12000)
      expect(ledger.totals.recordedCostUsd).toBeCloseTo(0.04, 5)

      expect(ledger.byModel).toHaveLength(2)
      const ds = ledger.byModel.find((item) => item.model === 'deepseek-chat')
      expect(ds?.providerName).toBe('DeepSeek 主力')
      expect(ds?.calls).toBe(2)
      expect(ds?.avgLatencyMs).toBe(1800)

      expect(ledger.byStage.find((item) => item.domain === 'articles')?.completedTasks).toBe(1)
      expect(ledger.byStage.find((item) => item.domain === 'layouts')?.failedTasks).toBe(1)
      expect(ledger.daily.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('AccountRepository 与 PublishingRepository 门面委托行为与原实现完全一致', () => {
    withTempDb((db) => {
      const account = db.saveAccount({
        fields: [
          { id: 'f1', name: '账号名称', value: '实战主号', isDefault: true },
          { id: 'f2', name: '领域', value: 'AI 工具', isDefault: true }
        ],
        wizardAnswers: [],
        status: 'draft',
        source: 'manual'
      })
      expect(db.listAccounts()).toHaveLength(1)
      const redline = db.addAccountRedline({ profileId: account.id, kind: 'dont', content: '绝对第一' })
      expect(db.listAccountRedlines(account.id)).toHaveLength(1)
      db.removeAccountRedline(redline.id)
      expect(db.listAccountRedlines(account.id)).toHaveLength(0)

      const channel = db.getWechatPublishChannel()
      expect(channel.id).toBe('wechat-official')
      const updated = db.saveWechatPublishChannel({ appId: 'wx-test-app', enabled: true }, Buffer.from('secret'))
      expect(updated.appId).toBe('wx-test-app')
      expect(updated.hasAppSecret).toBe(true)
      expect(Buffer.from(db.getEncryptedWechatPublishSecret()!).toString('utf8')).toBe('secret')
    })
  })
})
