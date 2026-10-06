import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../src/main/database.js'
import { ArticleGenerator } from '../src/main/services/article-generator.js'
import { FileMaterialService } from '../src/main/services/file-material-service.js'
import { buildMaterialContext } from '../src/main/services/material-context.js'
import { WechatPublishService } from '../src/main/services/wechat-publish-service.js'
import { WorkspaceService } from '../src/main/services/workspace-service.js'
import { ReviewService } from '../src/main/services/review-service.js'
import { TopicGenerator } from '../src/main/services/topic-generator.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { KeyStore } from '../src/main/security/key-store.js'
import type { VisualAssetService } from '../src/main/services/visual-asset-service.js'
import { makePromptRegistryStub } from './helpers/prompt-registry-stub.js'

const dialog = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))
vi.mock('electron', () => ({ dialog }))
const databases: AppDatabase[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function database(path = ':memory:') { const db = new AppDatabase(path); databases.push(db); return db }
function provider(db: AppDatabase) {
  return db.saveProvider({ displayName: '测试', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'mock', enabled: true, isRelay: false,
    capabilities: { chat: true, streaming: false, jsonMode: false, vision: false, image: false },
    models: [{ modelId: 'mock', displayName: 'mock', reasoningVariants: [], isDefault: true, enabled: true }] }, Buffer.from('PRIVATE-CREDENTIAL-MARKER'), 'mock')
}
function article(db: AppDatabase, title = '原稿') { return db.saveArticle({ materialIds: [], manualOutline: '', status: 'draft', source: 'manual', rawMarkdown: `# ${title}\n\n正文` }) }
const response = (content: string, finishReason = 'stop') => ({ providerId: 'mock', model: 'mock', content, finishReason, latencyMs: 1 })

describe('A：配置与生成恢复', () => {
  it('验证与保存同一版本，改名称保留验证，改地址使验证失效，拒绝过期表单', () => {
    const db = database(), initial = provider(db)
    expect(initial.verification).toMatchObject({ verified: true, testedModel: 'mock' })
    const input = { ...initial, models: initial.models }
    const renamed = db.saveProvider({ ...input, displayName: '新名称', expectedUpdatedAt: initial.updatedAt })
    expect(renamed.verification.verified).toBe(true)
    expect(() => db.saveProvider({ ...input, expectedUpdatedAt: initial.updatedAt })).toThrow('已更新')
    const changed = db.saveProvider({ ...renamed, baseUrl: 'http://127.0.0.1:2/v1' })
    expect(changed.verification).toMatchObject({ verified: false, stale: true })
  })

  it('重试读取冻结指令和候选序号，原稿变化时另存而不覆盖', async () => {
    const db = database(), p = provider(db), original = article(db)
    const messages: string[] = []
    let fail = true
    const gateway = { chat: vi.fn(async request => { messages.push(request.messages.map((item: { content: string }) => item.content).join('\n')); if (fail) throw new Error('网络断开'); return { ...response('# 新候选\n\n已完成'), providerId: p.id } }) } as unknown as ModelGateway
    const generator = new ArticleGenerator(db, gateway, makePromptRegistryStub())
    const result = await generator.revise({ articleId: original.id, revisionMode: 'new-version', instruction: '冻结的原始指令', alignFramework: false, providerId: p.id, model: 'mock', count: 1, expectedVersionId: original.currentVersionId })
    const changed = db.saveArticle({ ...original, source: 'manual', rawMarkdown: '# 人工新版本\n\n人工内容' })
    fail = false
    const retry = await generator.retry(result.requestId!)
    expect(retry.failed).toEqual([])
    expect(retry.articles[0].id).not.toBe(original.id)
    expect(db.getArticle(original.id)?.currentVersionId).toBe(changed.currentVersionId)
    expect(messages[0]).toBe(messages[1])
    expect(retry.articles[0].references.some(ref => ref.sourceId === original.id)).toBe(true)
    expect(await generator.retry(result.requestId!).catch(error => error.message)).toMatch('没有需要')
  })

  it('旧于最近 50 条的运行中候选也能在重启后恢复为中断', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'moliu-creation-restart-')), 'moliu.db')
    const db = new AppDatabase(file)
    const old = db.workflow.createRequest('generate', {}, '旧任务', 1)
    db.workflow.saveCreationResult(old, { index: 1, status: 'running', content: '仍可恢复', message: '' })
    for (let i = 0; i < 55; i++) db.workflow.createRequest('generate', {}, `任务${i}`, 1)
    db.close()
    const reopened = database(file)
    expect(reopened.workflow.getCreationRequest(old)?.results[0]).toMatchObject({ status: 'failed', completion: 'interrupted', content: '仍可恢复' })
  })
})

describe('B：无 AI 图片与交付核对', () => {
  function setup() {
    const db = database(), original = article(db), pack = db.createManualVisualPack(original.id)
    const asset = db.saveVisualAsset({ packId: pack.id, kind: 'inline', slot: 0, prompt: '', fileName: 'local.png', source: 'imported' })
    const layout = db.saveArticleLayout({ articleId: original.id, articleVersionId: original.currentVersionId, articleStatusSnapshot: 'draft', platform: 'wechat', title: '原稿', html: `<p>正文</p><img src="${asset.url}" />`, plainText: '正文' })
    const service = new WechatPublishService(db, { readWechatPublishSecret: () => 'secret' } as KeyStore, { readAssetFile: async () => Buffer.from('png') } as unknown as VisualAssetService, 'http://wechat.test')
    return { db, original, pack, asset, layout, service }
  }
  it('手动配图不需要供应商；占位复制不联网且清除本地图片协议', async () => {
    const { db, pack, layout, service } = setup()
    expect(pack.kind).toBe('manual'); expect(pack.providerId).toBeUndefined(); expect(db.listProviders()).toHaveLength(0)
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const result = await service.prepareClipboard(layout.id, 'placeholders')
    expect(result.html).toContain('【图片 1'); expect(result.html).not.toContain('moliu-asset:'); expect(fetch).not.toHaveBeenCalled()
  })
  it('图文复制按公众号缓存上传结果，换公众号重新上传，过期排版禁止复制', async () => {
    const { db, original, layout, service } = setup()
    let uploads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/token?') ? { access_token: 'token', expires_in: 7200 } : { url: `https://mmbiz.qpic.cn/${++uploads}` }), { status: 200 })))
    db.saveWechatPublishChannel({ appId: 'account-one', enabled: true }, Buffer.from('encrypted'))
    expect((await service.prepareClipboard(layout.id, 'wechat')).html).toContain('https://mmbiz.qpic.cn/1')
    await service.prepareClipboard(layout.id, 'wechat'); expect(uploads).toBe(1)
    db.saveWechatPublishChannel({ appId: 'account-two', enabled: true }, Buffer.from('encrypted'))
    await service.prepareClipboard(layout.id, 'wechat'); expect(uploads).toBe(2)
    db.saveArticle({ ...original, rawMarkdown: '# 改过\n\n正文', source: 'manual' })
    await expect(service.prepareClipboard(layout.id, 'wechat')).rejects.toThrow('新版本')
  })
  it('待确认记录必须人工核对；核对记录保留，收到后不允许重推', async () => {
    const { db, original, layout, service } = setup()
    const record = db.createPublication({ articleId: original.id, articleVersionId: original.currentVersionId, layoutId: layout.id, channelId: 'wechat-official', title: '原稿', thumbMediaId: 'cover', status: 'unknown', snapshot: { appId: '', html: layout.html, input: { articleId: original.id, layoutId: layout.id, thumbMediaId: 'cover' } } })
    await expect(service.retry(record.id)).rejects.toThrow('待确认')
    const resolved = service.resolveUnknown({ id: record.id, decision: 'received', note: '已在目标草稿箱按标题与时间核对', expectedUpdatedAt: record.updatedAt, remoteId: 'remote-draft' })
    expect(resolved).toMatchObject({ status: 'draft', externalDraftId: 'remote-draft', resolution: { decision: 'received', note: expect.stringContaining('已在目标') } })
    await expect(service.retry(record.id)).rejects.toThrow('明确失败')
    const retro = db.savePublicationRetro(record.id, { goal: '', result: '', lesson: '', metrics: { reads: 0 } }).retro
    expect(retro?.metrics?.reads).toBe(0)
    expect(retro?.metrics?.shares).toBeUndefined()
    expect(() => service.resolveUnknown({ id: record.id, decision: 'not-received', note: '过期判断', expectedUpdatedAt: record.updatedAt })).toThrow('已变化')
  })
  it('旧文章按 ID 定位不依赖最近一页，摘要不传正文与版本数组', () => {
    const db = database(), old = article(db, '旧稿')
    for (let i = 0; i < 510; i++) article(db, `新稿${i}`)
    expect(db.workflow.listSummaries({ limit: 30 }).items.some(item => item.id === old.id)).toBe(false)
    expect(db.workflow.getSummary(old.id)).toMatchObject({ id: old.id, title: '旧稿' })
    expect(db.workflow.getSummary(old.id)).not.toHaveProperty('rawMarkdown')
    expect(db.workflow.getSummary(old.id)).not.toHaveProperty('versions')
  })
})

describe('C/D：输入交接、依据与可携带备份', () => {
  it('通用选题不需要账号定位', async () => {
    const db = database(), p = provider(db)
    const fields = Object.fromEntries(db.getTopicSchema().map(field => [field.name, '通用创作方向']))
    const gateway = { chat: async () => ({ ...response(JSON.stringify(fields)), providerId: p.id }) } as unknown as ModelGateway
    const result = await new TopicGenerator(db, gateway, makePromptRegistryStub()).generate({ providerId: p.id, model: 'mock', seedKeyword: '主题', relatedHotFavoriteIds: [], count: 1 })
    expect(result.failed).toEqual([]); expect(result.topics[0].accountIds).toEqual([])
  })
  it('超过两万字的文件完整保存，可检索后半段，片段预算不截断原文', async () => {
    const db = database(), text = '普通背景资料。\n'.repeat(4000) + '\n后半段独有证据：产品访谈确认用户只想先导入文章。'
    const bytes = new TextEncoder().encode(text)
    const material = await new FileMaterialService(db).importFromUpload({ fileName: '访谈.txt', data: bytes.buffer })
    expect(material.summary.length).toBeLessThanOrEqual(2000)
    expect(db.workflow.getDocument(material.id)?.content).toBe(text)
    const context = buildMaterialContext(db, [material], '后半段独有证据 产品访谈 导入文章', 2200)
    expect(context.text).toContain('后半段独有证据')
    expect(context.omittedChars).toBeGreaterThan(20000)
    for (const fragment of context.fragments) expect(text.slice(fragment.start, fragment.end)).toBe(fragment.text)
    expect(db.workflow.getDocument(material.id)?.content).toBe(text)
  })
  it('来源 ID 和逐字摘录验证失败时事实意见保持未核实且默认未采纳', async () => {
    const db = database(), p = provider(db), original = article(db)
    const role = db.listReviewRoles()[0]
    const gateway = { chat: async () => response('<评审意见>位置：正文｜严重程度：高｜问题：事实数字错误｜建议：改成 100｜类型：事实｜片段ID：虚构来源｜依据摘录：来源并不存在\n总体建议：核查。</评审意见>') } as unknown as ModelGateway
    const articles = new ArticleGenerator(db, gateway, makePromptRegistryStub())
    const result = await new ReviewService(db, gateway, articles).start({ articleId: original.id, roleIds: [role.id], fallbackProviderId: p.id, fallbackModel: 'mock' })
    expect(result.task.opinions[0].problems[0]).toMatchObject({ adopted: false, reviewKind: 'fact', evidence: { status: 'unverified' } })
    await expect(new ReviewService(db, gateway, articles).apply(result.task.id, p.id, 'mock')).rejects.toThrow('至少采纳')
  })
  it('可追溯的事实意见绑定原文与冻结来源，仍由作者决定是否采纳', async () => {
    const db = database(), p = provider(db), original = article(db)
    const material = db.addFileMaterial({ fileName: '访谈.txt', content: '受访用户认为导入文章比连接模型更优先。', formatNote: 'TXT' })
    const evidence = buildMaterialContext(db, [material], '导入文章', 2000)
    db.workflow.saveEvidence(original.currentVersionId, evidence)
    const fragment = evidence.fragments[0], role = db.listReviewRoles()[0]
    const gateway = { chat: async () => response(`<评审意见>位置：正文｜严重程度：中｜问题：缺少受访用户观点｜建议：补充访谈观点｜类型：事实｜原文摘录：原稿｜片段ID：${fragment.id}｜依据摘录：${fragment.text}
总体建议：人工核对。</评审意见>`) } as unknown as ModelGateway
    const result = await new ReviewService(db, gateway, new ArticleGenerator(db, gateway, makePromptRegistryStub())).start({ articleId: original.id, roleIds: [role.id], fallbackProviderId: p.id, fallbackModel: 'mock' })
    expect(result.task.opinions[0].problems[0]).toMatchObject({ adopted: false, anchor: '原稿', evidence: { status: 'source-matched', fragmentId: fragment.id } })
  })
  it('外部备份剔除密钥字节，新环境恢复完整素材、任务、图片，损坏包不覆盖', async () => {
    const root = mkdtempSync(join(tmpdir(), 'moliu-portable-source-')), external = mkdtempSync(join(tmpdir(), 'moliu-portable-export-'))
    const db = database(join(root, 'moliu.db')); provider(db); const original = article(db)
    const material = db.addFileMaterial({ fileName: '全文.txt', content: '完整文档末尾证据', formatNote: 'TXT' })
    const requestId = db.workflow.createRequest('generate', { frozen: true }, '生成记录', 1)
    const workspace = new WorkspaceService(db, root)
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [external] })
    const exported = await workspace.exportPortableBackup()
    expect(readFileSync(join(exported.path!, 'moliu.db')).includes(Buffer.from('PRIVATE-CREDENTIAL-MARKER'))).toBe(false)
    const destination = mkdtempSync(join(tmpdir(), 'moliu-portable-target-'))
    const next = database(join(destination, 'moliu.db')), receiving = new WorkspaceService(next, destination)
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exported.path] })
    const selected = await receiving.selectPortableBackup()
    expect(selected?.summary).toContain('不含密钥')
    await receiving.restoreBackup({ bundleDir: selected!.bundleDir })
    expect(next.getArticle(original.id)?.rawMarkdown).toContain('原稿')
    expect(next.workflow.getDocument(material.id)?.content).toBe('完整文档末尾证据')
    expect(next.workflow.getCreationRequest(requestId)?.title).toBe('生成记录')
    expect(next.listProviders()[0].hasApiKey).toBe(false)
    writeFileSync(join(exported.path!, 'moliu.db'), '损坏内容')
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exported.path] })
    await expect(receiving.selectPortableBackup()).rejects.toThrow('校验失败')
    expect(next.getArticle(original.id)).not.toBeNull()
  })
  it('高于当前程序的数据库拒绝恢复', () => {
    const root = mkdtempSync(join(tmpdir(), 'moliu-future-schema-')), file = join(root, 'future.db')
    const seeded = new AppDatabase(file); seeded.close()
    const raw = new DatabaseSync(file); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(999, new Date().toISOString()); raw.close()
    expect(database().isDatabaseFile(file)).toBe(false)
    expect(() => new AppDatabase(file)).toThrow('更高版本')
  })
})


describe('升级与事务保护', () => {
  it('旧配图表迁移保留资产引用，并允许无模型的手动集合', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'moliu-legacy-visual-')), 'moliu.db')
    const seeded = new AppDatabase(file), original = article(seeded), p = provider(seeded)
    const pack = seeded.saveVisualPack({ articleId: original.id, articleVersionId: original.currentVersionId, articleStatusSnapshot: 'draft', providerId: p.id, model: 'mock', cover: { visual: '', prompt: '', overlayText: '' }, inlineImages: [], releaseImages: [], rawXml: '' })
    const asset = seeded.saveVisualAsset({ packId: pack.id, kind: 'cover', slot: 0, prompt: '', fileName: 'old.png', source: 'imported' })
    seeded.close()
    const raw = new DatabaseSync(file)
    raw.exec('ALTER TABLE visual_packs DROP COLUMN kind')
    raw.close()
    const upgraded = database(file)
    expect(upgraded.listVisualPacks()[0]).toMatchObject({ id: pack.id, kind: 'generated', providerId: p.id })
    expect(upgraded.getVisualAsset(asset.id)?.packId).toBe(pack.id)
    expect(upgraded.createManualVisualPack(original.id).providerId).toBeUndefined()
  })
  it('嵌套保存失败时文章与任务一起回滚', () => {
    const db = database()
    expect(() => db.atomic(() => {
      article(db, '不应残留')
      db.workflow.createRequest('generate', { frozen: true }, '不应残留的任务', 2)
      throw new Error('模拟落盘失败')
    })).toThrow('模拟落盘失败')
    expect(db.workflow.listSummaries({ limit: 30 }).total).toBe(0)
    expect(db.workflow.listCreationRequests()).toHaveLength(0)
  })
})
