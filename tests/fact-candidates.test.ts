import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { extractFactCandidates } from '../src/shared/fact-candidates.js'

describe('事实核对线索', () => {
  it('定位正文数字，不把标题和普通列表编号当作事实', () => {
    const text = '# 2026 年计划\n\n2025 年收入为 120 万元。\n\n1. 方案介绍\n'
    const items = extractFactCandidates(text)
    expect(items.map(item => item.token)).toEqual(['2026 年', '2025 年', '120 万元'])
    for (const item of items) expect(text.slice(item.start, item.end)).toBe(item.token)
  })
  it('人工确认属于具体版本，恢复旧版本或修改正文不会沿用其他版本的确认', () => {
    const db = new AppDatabase(':memory:')
    const article = db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 标题\n\n共有 10 人。' })
    db.workflow.setFactConfirmation(article.currentVersionId, '7:10 人', true)
    expect(db.workflow.factConfirmations(article.currentVersionId)).toEqual(['7:10 人'])
    const next = db.saveArticle({ id: article.id, materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: '# 标题\n\n共有 20 人。' })
    expect(db.workflow.factConfirmations(next.currentVersionId)).toEqual([])
    db.workflow.setFactConfirmation(article.currentVersionId, '7:10 人', false)
    expect(db.workflow.factConfirmations(article.currentVersionId)).toEqual([])
    db.close()
  })
})
