import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import { ArticleLayoutService } from '../src/main/services/article-layout-service.js'
import { createAccountFields } from '../src/shared/domain.js'

const opened: AppDatabase[] = []
function open(path = ':memory:'): AppDatabase { const db = new AppDatabase(path); opened.push(db); return db }
function account(db: AppDatabase, name = '固定版式测试') {
  return db.saveAccount({ fields: createAccountFields({ 账号名称: name }), wizardAnswers: [], status: 'draft', source: 'manual' })
}
afterEach(() => { for (const db of opened.splice(0)) db.close() })

describe('账号版式草稿和启用', () => {
  it('保存草稿和预览不改变交付版本；启用仅影响对应账号平台的新稿', () => {
    const db = open()
    const a = account(db, '账号 A')
    const b = account(db, '账号 B')
    const article = db.saveArticle({ accountId: a.id, materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 文章标题\n\n## 小节\n\n正文。', source: 'manual' })
    const service = new ArticleLayoutService(db)
    const original = service.create({ articleId: article.id, platform: 'wechat' })
    const draft = db.saveAccountLayoutDraft({ accountId: a.id, platform: 'wechat', themeId: 'tech-blue', styleConfig: { bodyFontSize: 18, brandHeaderText: '固定开篇', brandFooterText: '账号落款' }, baseVersionId: null, expectedRevision: 0 })
    service.previewSample({ platform: 'wechat', themeId: draft.themeId, styleConfig: draft.styleConfig })
    service.previewArticle({ articleId: article.id, platform: 'wechat', themeId: draft.themeId, styleConfig: draft.styleConfig })
    expect(db.getAccountLayoutDefault(a.id, 'wechat')).toBeNull()
    expect(db.listAccountLayoutVersions(a.id, 'wechat')).toEqual([])
    expect(db.listArticleLayouts()).toHaveLength(1)
    const enabled = db.activateAccountLayoutDraft(a.id, 'wechat', draft.revision)
    const next = service.create({ articleId: article.id, platform: 'wechat' })
    expect(next.layoutVersionId).toBe(enabled.id)
    expect(next.html).toContain('固定开篇')
    expect(next.plainText).toContain('账号落款')
    expect(db.getArticleLayout(original.id)?.html).toBe(original.html)
    expect(original.html).not.toContain('固定开篇')
    expect(db.getAccountLayoutDefault(b.id, 'wechat')).toBeNull()
    expect(db.getAccountLayoutDefault(a.id, 'web')).toBeNull()
    expect(db.getAccountLayoutDraft(a.id, 'wechat')?.revision).toBeGreaterThan(draft.revision)
  })

  it('旧窗口的保存和启用均被拒绝，失败后保留草稿和完整版本历史', () => {
    const db = open()
    const a = account(db)
    const draft = db.saveAccountLayoutDraft({ accountId: a.id, platform: 'wechat', themeId: 'magazine', styleConfig: { bodyFontSize: 17 }, expectedRevision: 0, baseVersionId: null })
    expect(() => db.saveAccountLayoutDraft({ ...draft, expectedRevision: 0 })).toThrow('其他窗口')
    const competing = db.setAccountLayoutDefault({ accountId: a.id, platform: 'wechat', themeId: 'minimal', expectedVersionId: null })
    expect(() => db.activateAccountLayoutDraft(a.id, 'wechat', draft.revision)).toThrow('默认版式已更新')
    expect(db.listAccountLayoutVersions(a.id, 'wechat')).toHaveLength(1)
    expect(db.getAccountLayoutDraft(a.id, 'wechat')?.themeId).toBe('magazine')
    const rebased = db.saveAccountLayoutDraft({ ...draft, expectedRevision: draft.revision, baseVersionId: competing.id })
    const active = db.activateAccountLayoutDraft(a.id, 'wechat', rebased.revision)
    expect(active.versionNumber).toBe(2)
    expect(() => db.activateAccountLayoutDraft(a.id, 'wechat', rebased.revision)).toThrow('已更新或不存在')
    expect(() => db.saveAccountLayoutDraft({ ...draft, expectedRevision: rebased.revision })).toThrow('其他窗口')
    expect(() => db.setAccountLayoutDefault({ accountId: a.id, platform: 'wechat', themeId: 'warm-paper', expectedVersionId: competing.id })).toThrow('默认版式已更新')
    expect(db.listAccountLayoutVersions(a.id, 'wechat')).toHaveLength(2)
    expect(db.getAccountLayoutDefault(a.id, 'wechat')?.id).toBe(active.id)
  })

  it('拒绝跨账号的编辑基准，删除账号会清理其草稿', () => {
    const db = open()
    const a = account(db, 'A')
    const b = account(db, 'B')
    const version = db.setAccountLayoutDefault({ accountId: b.id, platform: 'wechat', themeId: 'minimal' })
    expect(() => db.saveAccountLayoutDraft({ accountId: a.id, platform: 'wechat', themeId: 'minimal', styleConfig: {}, expectedRevision: 0, baseVersionId: version.id })).toThrow('不属于')
    db.saveAccountLayoutDraft({ accountId: a.id, platform: 'wechat', themeId: 'wechat-green', styleConfig: {}, expectedRevision: 0, baseVersionId: null })
    db.removeAccount(a.id)
    expect(db.getAccountLayoutDraft(a.id, 'wechat')).toBeNull()
    expect(db.getAccountLayoutDefault(b.id, 'wechat')?.id).toBe(version.id)
  })

  it('草稿保留高级 CSS，单篇明确清空覆盖时不会偷偷沿用账号规则', () => {
    const db = open()
    const a = account(db)
    const version = db.setAccountLayoutDefault({ accountId: a.id, platform: 'wechat', themeId: 'minimal', customCss: '.mly-body p { color: #123456; }' })
    const draft = db.saveAccountLayoutDraft({ accountId: a.id, platform: 'wechat', themeId: version.themeId, styleConfig: { bodyFontSize: 17 }, customCss: version.customCss, baseVersionId: version.id, expectedRevision: 0 })
    expect(db.getAccountLayoutDraft(a.id, 'wechat')?.customCss).toBe(version.customCss)
    db.activateAccountLayoutDraft(a.id, 'wechat', draft.revision)
    const article = db.saveArticle({ accountId: a.id, materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 样稿\n\n正文。', source: 'manual' })
    const service = new ArticleLayoutService(db)
    expect(service.create({ articleId: article.id, platform: 'wechat' }).html).toContain('#123456')
    const exception = service.create({ articleId: article.id, platform: 'wechat', themeId: 'tech-blue', styleConfig: {}, customCss: '' })
    expect(exception.html).not.toContain('#123456')
    expect(exception.layoutVersionId).toBeUndefined()
    expect(db.getAccountLayoutDefault(a.id, 'wechat')?.customCss).toBe(version.customCss)
  })

  it('重启后恢复草稿和启用版本，并保留编辑 revision', () => {
    const folder = mkdtempSync(join(tmpdir(), 'moliu-layout-draft-'))
    const file = join(folder, 'moliu.db')
    let db = new AppDatabase(file)
    try {
      const a = account(db)
      const active = db.setAccountLayoutDefault({ accountId: a.id, platform: 'wechat', themeId: 'minimal' })
      const draft = db.saveAccountLayoutDraft({ accountId: a.id, platform: 'wechat', themeId: 'warm-paper', styleConfig: { brandFooterText: '未启用的署名' }, baseVersionId: active.id, expectedRevision: 0 })
      db.close()
      db = new AppDatabase(file)
      expect(db.getAccountLayoutDraft(a.id, 'wechat')).toEqual(draft)
      expect(db.getAccountLayoutDefault(a.id, 'wechat')?.id).toBe(active.id)
    } finally { db.close(); rmSync(folder, { recursive: true, force: true }) }
  })
})
