import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import { ArticleLayoutService } from '../src/main/services/article-layout-service.js'
import { WechatPublishService } from '../src/main/services/wechat-publish-service.js'
import { WorkspaceService } from '../src/main/services/workspace-service.js'
import { OperationGate } from '../src/main/services/operation-gate.js'
import { generationOutcome } from '../src/main/services/generation-outcome.js'
import { localAssetNames, replaceLocalAssets } from '../src/main/services/local-assets.js'
import type { KeyStore } from '../src/main/security/key-store.js'
import type { VisualAssetService } from '../src/main/services/visual-asset-service.js'

vi.mock('electron', () => ({ dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } }))
const databases: AppDatabase[] = []
function database(path = ':memory:'): AppDatabase { const db = new AppDatabase(path); databases.push(db); return db }
function article(db: AppDatabase, markdown = '# 测试文章\n\n正文内容') { return db.saveArticle({ rawMarkdown: markdown, source: 'manual', status: 'draft', materialIds: [], manualOutline: '' }) }
function publisher(db: AppDatabase) {
  db.saveWechatPublishChannel({ appId: 'wx-account-A', enabled: true }, Buffer.from('secret'))
  return new WechatPublishService(db, { readWechatPublishSecret: () => 'secret' } as unknown as KeyStore, { readAssetFile: async () => Buffer.from('image') } as unknown as VisualAssetService)
}
afterEach(() => { for (const db of databases.splice(0)) { try { db.close() } catch {} } vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('工作草稿与版本保护', () => {
  it('跨重启保留正文，提交只清除对应修订', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'moliu-draft-')), 'moliu.db')
    const db = database(path); const saved = article(db)
    db.workflow.saveDraft({ articleId: saved.id, baseVersionId: saved.currentVersionId, content: '# 尚未保存', expectedRevision: 0 })
    db.close(); databases.pop()
    const reopened = database(path)
    expect(reopened.workflow.getDraft(saved.id)?.content).toBe('# 尚未保存')
    expect(reopened.commitWorkDraft(saved.id, 1).versionCount).toBe(2)
    expect(reopened.workflow.getDraft(saved.id)).toBeNull()
  })
  it('拒绝陈旧草稿修订、其他文章版本以及覆盖新版本', () => {
    const db = database(); const saved = article(db); const other = article(db)
    const input = { articleId: saved.id, baseVersionId: saved.currentVersionId, content: '本地修改', expectedRevision: 0 }
    db.workflow.saveDraft(input)
    expect(() => db.workflow.saveDraft(input)).toThrow('另一处更新')
    expect(() => db.workflow.saveDraft({ ...input, baseVersionId: other.currentVersionId })).toThrow('不属于')
    db.saveArticle({ ...saved, rawMarkdown: '外部新版本', source: 'manual' })
    expect(() => db.commitWorkDraft(saved.id, 1)).toThrow('已有新版本')
    expect(db.workflow.getDraft(saved.id)?.content).toBe('本地修改')
  })
  it('脏稿阻止下游排版，摘要分页不返回版本历史', () => {
    const db = database(); const saved = article(db)
    db.workflow.saveDraft({ articleId: saved.id, baseVersionId: saved.currentVersionId, content: '修改正文' })
    expect(() => new ArticleLayoutService(db).create({ articleId: saved.id, platform: 'wechat' })).toThrow()
    article(db, '# 第二篇'); article(db, '# 第三篇')
    const first = db.workflow.listSummaries({ limit: 1, offset: 0 })
    const second = db.workflow.listSummaries({ limit: 1, offset: 1 })
    expect(first.total).toBe(3); expect(first.items[0].id).not.toBe(second.items[0].id)
    expect(first.items[0]).not.toHaveProperty('versions')
    expect(db.workflow.listSummaries({ dirtyOnly: true }).items[0].id).toBe(saved.id)
  })
})

describe('交付确定性', () => {
  it('正文图片先上传再替换；封面缓存不会跨公众号复用', async () => {
    const db = database(); const saved = article(db, '# 图片文章\n\n![正文](moliu-asset://assets/inline.png)')
    const pack = db.saveVisualPack({ articleId: saved.id, articleVersionId: saved.currentVersionId, articleStatusSnapshot: saved.status, providerId: 'test', model: 'test', cover: { prompt: '封面', visual: '图片', overlayText: '' }, inlineImages: [], releaseImages: [], rawXml: '' })
    const cover = db.saveVisualAsset({ packId: pack.id, kind: 'cover', slot: 0, prompt: '封面', fileName: 'cover.png', source: 'imported' })
    const inline = db.saveVisualAsset({ packId: pack.id, kind: 'inline', slot: 0, prompt: '正文', fileName: 'inline.png', source: 'imported' })
    const layout = new ArticleLayoutService(db).create({ articleId: saved.id, platform: 'wechat' })
    const service = publisher(db); const bodies: any[] = []; let uploads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, input?: RequestInit) => {
      const path = String(url)
      if (path.includes('/token?')) return Response.json({ access_token: path.includes('wx-account-A') ? 'token-A' : 'token-B' })
      if (path.includes('/add_material?')) { uploads++; return Response.json({ media_id: path.includes('token-A') ? 'cover-A' : 'cover-B' }) }
      if (path.includes('/uploadimg?')) return Response.json({ url: 'https://mmbiz.qpic.cn/inline' })
      bodies.push(JSON.parse(String(input?.body))); return Response.json({ media_id: 'draft' })
    }))
    expect((await service.pushDraft({ articleId: saved.id, layoutId: layout.id, coverAssetId: cover.id })).status).toBe('draft')
    expect(bodies[0].articles[0].content).not.toContain('moliu-asset:')
    expect(bodies[0].articles[0].content).toContain('https://mmbiz.qpic.cn/inline')
    expect(db.workflow.getUpload(inline.id, 'wx-account-A', 'inline')).toBeTruthy()
    db.saveWechatPublishChannel({ appId: 'wx-account-B', enabled: true }, Buffer.from('secret-B'))
    expect((await service.uploadAsset(cover.id)).wechatMediaId).toBe('cover-B')
    expect(uploads).toBe(2)
    expect(db.workflow.getUpload(cover.id, 'wx-account-A', 'cover')).toBe('cover-A')
  })
  it('明确失败重试使用完整快照；网络中断记为待确认并禁止重试', async () => {
    const db = database(); const saved = article(db); const layout = new ArticleLayoutService(db).create({ articleId: saved.id, platform: 'wechat' }); const service = publisher(db)
    let reject = true; const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, input?: RequestInit) => {
      if (String(url).includes('/token?')) return Response.json({ access_token: 'token', expires_in: 7200 })
      bodies.push(JSON.parse(String(input?.body)))
      return Response.json(reject ? { errcode: 45009 } : { media_id: 'draft-1' })
    }))
    const failed = await service.pushDraft({ articleId: saved.id, layoutId: layout.id, thumbMediaId: 'cover', author: '作者', digest: '摘要', contentSourceUrl: 'https://example.com/article' })
    expect(failed.status).toBe('failed'); reject = false
    expect((await service.retry(failed.id)).status).toBe('draft')
    expect(bodies[1]).toEqual(bodies[0])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket reset') }))
    const unknown = await service.pushDraft({ articleId: saved.id, layoutId: layout.id, thumbMediaId: 'cover' })
    expect(unknown.status).toBe('unknown')
    await expect(service.retry(unknown.id)).rejects.toThrow('待确认')
  })
  it('目标公众号变更时拒绝旧交付，上传映射按 AppID 隔离', async () => {
    const db = database(); const saved = article(db); const layout = new ArticleLayoutService(db).create({ articleId: saved.id, platform: 'wechat' }); const service = publisher(db)
    const input = { articleId: saved.id, layoutId: layout.id, thumbMediaId: 'cover', appId: 'wx-account-A' }
    db.saveWechatPublishChannel({ appId: 'wx-account-B', enabled: true }, Buffer.from('new-secret'))
    expect((await service.preflight(input)).issues.join()).toContain('目标公众号已变化')
    await expect(service.pushDraft(input)).rejects.toThrow('目标公众号已变化')
  })
  it('连接保存与上传互斥，避免上传到其他公众号', async () => {
    const db = database(); const service = publisher(db)
    let release!: () => void
    const config = service.configure(() => new Promise<void>(resolve => { release = resolve }))
    await expect(service.uploadAsset('asset')).rejects.toThrow('正在保存')
    await expect(service.configure(async () => {})).rejects.toThrow('进行中')
    release(); await config
  })
})

describe('备份、导出与任务状态', () => {
  it('恢复失败回退包含恢复前尚在 WAL 内的全部数据', () => {
    const root = mkdtempSync(join(tmpdir(), 'moliu-wal-')); const db = database(join(root, 'moliu.db'))
    article(db, '# 备份前'); const backup = join(root, 'old.db'); db.backupTo(backup)
    const latest = article(db, '# WAL 中新增')
    const original = (db as any).reopen.bind(db)
    vi.spyOn(db as any, 'reopen').mockImplementationOnce(() => { throw new Error('注入打开失败') }).mockImplementation(original)
    expect(() => db.restoreFrom(backup)).toThrow('自动回到')
    expect(db.getArticle(latest.id)?.rawMarkdown).toContain('WAL 中新增')
  })
  it('图片校验失败保留当前数据库和图片，清理暂存目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'moliu-images-')); mkdirSync(join(root, 'images'))
    writeFileSync(join(root, 'images', 'one.png'), '原始图片')
    const db = database(join(root, 'moliu.db')); const saved = article(db); const service = new WorkspaceService(db, root)
    const backup = await service.createBackup()
    writeFileSync(join(String(backup.path), 'images', 'one.png'), '损坏')
    await expect(service.restoreBackup({ bundleDir: String(backup.path) })).rejects.toThrow('校验不一致')
    expect(readFileSync(join(root, 'images', 'one.png'), 'utf8')).toBe('原始图片')
    expect(db.getArticle(saved.id)).toBeTruthy()
    expect(readdirSync(root).filter(name => name.startsWith('images-restore-'))).toEqual([])
  })
  it('同文章重复导出不覆盖已有文件', async () => {
    const root = mkdtempSync(join(tmpdir(), 'moliu-export-')); const db = database(); const saved = article(db); const service = new WorkspaceService(db, root)
    const input = { articleId: saved.id, format: 'markdown' as const, targetDir: root }
    const a = await service.exportArticle(input); const b = await service.exportArticle(input)
    expect(a.path).not.toBe(b.path); expect(readFileSync(String(a.path), 'utf8')).toBe(saved.rawMarkdown)
  })
  it('独占恢复拒绝活动操作，并在失败后释放门闩', async () => {
    const gate = new OperationGate(); let release!: () => void
    const active = gate.run(() => new Promise<void>(resolve => { release = resolve }))
    await expect(gate.run(() => {}, true)).rejects.toThrow('还有操作')
    release(); await active
    await expect(gate.run(() => { throw new Error('失败') }, true)).rejects.toThrow('失败')
    expect(await gate.run(() => 1, true)).toBe(1)
  })
  it('区分全部失败、部分失败、取消且保留结果', () => {
    expect(generationOutcome({ articles: [], failed: [{ message: '失败' }] }, false).status).toBe('failed')
    expect(generationOutcome({ articles: [{ id: 'a' }], failed: [{}] }, false).status).toBe('partial')
    expect(generationOutcome({ articles: [{ id: 'a' }] }, true)).toMatchObject({ status: 'cancelled', articleId: 'a', resultIds: ['a'] })
  })
  it('本地图片拒绝路径穿越，并要求完整替换映射', () => {
    expect(() => localAssetNames('moliu-asset://assets/%2e%2e%2fsecret.png')).toThrow()
    expect(() => replaceLocalAssets('<img src="moliu-asset://assets/a.png">', new Map())).toThrow()
    expect(replaceLocalAssets('<img src="moliu-asset://assets/a.png">', new Map([['a.png', 'https://mmbiz.qpic.cn/image']]))).not.toContain('moliu-asset:')
  })
})
