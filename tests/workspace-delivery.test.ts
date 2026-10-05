import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import { WorkspaceService } from '../src/main/services/workspace-service.js'
import type { GenerationDomain, GenerationTask } from '../src/shared/contracts.js'

/** 导出与备份的默认路径会弹原生目录框，测试里固定为「用户取消」 */
vi.mock('electron', () => ({
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
}))

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

function tempDataDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `moliu-${prefix}-`))
  mkdirSync(join(root, 'images'), { recursive: true })
  return root
}

function seedArticle(database: AppDatabase, title: string, materialIds: string[] = []): string {
  const article = database.saveArticle({
    materialIds, manualOutline: '', status: 'draft',
    rawMarkdown: `# ${title}\n\n正文内容。`, source: 'manual'
  })
  return article.id
}

describe('生成任务台账', () => {
  it('按真实结果记录 running / partial，并在重启时把残留任务标为中断', () => {
    const file = join(tempDataDir('ledger'), 'moliu.db')
    const database = new AppDatabase(file)
    database.beginGenerationTask({ id: 'task-1', domain: 'articles', label: '文章' })
    expect(database.listGenerationTasks(5)[0]).toMatchObject({ id: 'task-1', domain: 'articles', status: 'running' })

    database.finishGenerationTask('task-1', 'partial', '2 项未完成')
    expect(database.listGenerationTasks(5)[0]).toMatchObject({ status: 'partial', detail: '2 项未完成' })

    database.beginGenerationTask({ id: 'task-2', domain: 'reviews', label: '评审' })
    database.close()

    const reopened = new AppDatabase(file)
    const tasks = reopened.listGenerationTasks(5)
    expect(tasks.find((task: GenerationTask) => task.id === 'task-2')?.status).toBe('interrupted')
    expect(tasks.find((task: GenerationTask) => task.id === 'task-2')?.finishedAt).toBeTruthy()
    expect(tasks.find((task: GenerationTask) => task.id === 'task-1')?.status).toBe('partial')
    reopened.close()
  })

  it('台账按开始时间倒序返回，并遵守 limit', () => {
    const database = new AppDatabase(':memory:')
    const domains: GenerationDomain[] = ['topics', 'frameworks', 'articles']
    domains.forEach((domain, index) => {
      database.beginGenerationTask({ id: `t-${index}`, domain, label: domain })
      database.finishGenerationTask(`t-${index}`, 'succeeded', '')
    })
    const list = database.listGenerationTasks(2)
    expect(list).toHaveLength(2)
    expect(list[0]?.id).toBe('t-2')
    database.close()
  })

  it('丢弃配置类失败只移除 running 任务，已完成任务不受影响', () => {
    const database = new AppDatabase(':memory:')
    // 配置类失败：任务还在 running，丢弃后台账不留痕迹
    database.beginGenerationTask({ id: 'cfg-1', domain: 'visuals', label: '配图' })
    database.discardGenerationTask('cfg-1')
    expect(database.listGenerationTasks(5)).toHaveLength(0)
    // 防御：已完成/已失败的任务不允许被丢弃
    database.beginGenerationTask({ id: 'done-1', domain: 'articles', label: '文章' })
    database.finishGenerationTask('done-1', 'failed', '生成失败')
    database.discardGenerationTask('done-1')
    expect(database.listGenerationTasks(5)).toHaveLength(1)
    database.close()
  })

  it('素材引用汇总取成稿标题，未被引用时返回空表', () => {
    const database = new AppDatabase(':memory:')
    const material = database.addManualMaterial({ title: '访谈摘录', summary: '观点' })
    const articleId = seedArticle(database, '测试成稿', [material.id])

    const usage = database.materialUsage()
    expect(usage[material.id]).toEqual([{ id: articleId, title: '测试成稿' }])

    database.removeMaterial(material.id)
    expect(Object.keys(database.materialUsage())).not.toContain(material.id)
    database.close()
  })
})

describe('本地导出', () => {
  it('导出 Markdown 与内嵌图片的自包含 HTML', async () => {
    const dataPath = tempDataDir('export')
    const database = new AppDatabase(join(dataPath, 'moliu.db'))
    writeFileSync(join(dataPath, 'images', 'cover.png'), TINY_PNG)
    const article = database.saveArticle({
      materialIds: [], manualOutline: '', status: 'locked', source: 'manual',
      rawMarkdown: '# 导出测试\n\n![封面](moliu-asset://assets/cover.png)'
    })
    const workspace = new WorkspaceService(database, dataPath)

    const markdownFile = await workspace.exportArticle({ articleId: article.id, format: 'markdown', targetDir: join(dataPath, 'out') })
    expect(readFileSync(String(markdownFile.path), 'utf8')).not.toContain('moliu-asset://')
    expect(readFileSync(String(markdownFile.path), 'utf8')).toContain('-assets/')

    const htmlFile = await workspace.exportArticle({ articleId: article.id, format: 'html', targetDir: join(dataPath, 'out') })
    const html = readFileSync(String(htmlFile.path), 'utf8')
    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('moliu-asset://')

    const layout = database.saveArticleLayout({
      articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: 'locked',
      platform: 'web', title: '导出测试', html: '<p>排版正文</p>', plainText: '排版正文'
    })
    const layoutFile = await workspace.exportLayout({ layoutId: layout.id, targetDir: join(dataPath, 'out') })
    expect(readFileSync(String(layoutFile.path), 'utf8')).toContain('<p>排版正文</p>')
    database.close()
  })

  it('拒绝写出数据目录之外，原生目录框取消时返回 null 而不是抛错', async () => {
    const dataPath = tempDataDir('export-guard')
    const database = new AppDatabase(join(dataPath, 'moliu.db'))
    const articleId = seedArticle(database, '越界测试')
    const workspace = new WorkspaceService(database, dataPath)

    await expect(workspace.exportArticle({ articleId, format: 'markdown', targetDir: tmpdir() })).rejects.toThrow('只能写入应用数据目录内')
    await expect(workspace.exportArticle({ articleId, format: 'markdown' })).resolves.toEqual({ path: null })
    await expect(workspace.exportLayout({ layoutId: 'missing' })).rejects.toThrow('排版稿不存在')
    database.close()
  })
})

describe('整库备份与恢复', () => {
  it('备份包含快照与图片，恢复回到备份时点并保留改前副本', async () => {
    const dataPath = tempDataDir('backup')
    const database = new AppDatabase(join(dataPath, 'moliu.db'))
    writeFileSync(join(dataPath, 'images', 'a.png'), TINY_PNG)
    seedArticle(database, '备份里的成稿')
    const workspace = new WorkspaceService(database, dataPath)

    const backup = await workspace.createBackup({ targetDir: join(dataPath, 'backups') })
    expect(existsSync(join(backup.path, 'moliu.db'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(backup.path, 'manifest.json'), 'utf8')) as { checksum: string; images: number }
    expect(manifest.images).toBe(1)
    expect(manifest.checksum).toBe(backup.checksum)
    expect(await workspace.listBackupBundles()).toEqual([backup.path])

    // 备份之后新写一篇并删掉图片，恢复应回到只有一篇且图片回来
    seedArticle(database, '备份后的新稿')
    const { rmSync } = await import('node:fs')
    rmSync(join(dataPath, 'images', 'a.png'))
    expect(database.listArticles()).toHaveLength(2)

    const restored = await workspace.restoreBackup({ bundleDir: backup.path })
    expect(restored.restoredImages).toBe(1)
    expect(database.listArticles()).toHaveLength(1)
    expect(database.listArticles()[0].rawMarkdown).toContain('备份里的成稿')
    expect(existsSync(join(dataPath, 'images', 'a.png'))).toBe(true)
    expect(existsSync(join(dataPath, 'moliu.db.pre-restore'))).toBe(true)
    database.close()
  })

  it('自定义位置创建的备份同样出现在备份列表中', async () => {
    const dataPath = tempDataDir('backup-custom')
    const database = new AppDatabase(join(dataPath, 'moliu.db'))
    seedArticle(database, '自定义位置备份')
    const workspace = new WorkspaceService(database, dataPath)

    // createBackup 允许写入 userData 内任意子目录；列表必须能看到，否则无法从界面恢复
    const custom = await workspace.createBackup({ targetDir: join(dataPath, 'custom-backups') })
    const atRoot = await workspace.createBackup({ targetDir: dataPath })
    const listed = await workspace.listBackupBundles()
    expect(listed).toContain(custom.path)
    expect(listed).toContain(atRoot.path)
    // 恢复入口按列表路径走，自定义位置备份必须能通过完整性校验完成恢复
    const restored = await workspace.restoreBackup({ bundleDir: custom.path })
    expect(restored.restoredImages).toBe(0)
    database.close()
  })

  it('校验和不匹配或缺少 manifest 时停止恢复', async () => {
    const dataPath = tempDataDir('backup-tamper')
    const database = new AppDatabase(join(dataPath, 'moliu.db'))
    seedArticle(database, '完整性测试')
    const workspace = new WorkspaceService(database, dataPath)
    const backup = await workspace.createBackup({ targetDir: join(dataPath, 'backups') })

    const manifestPath = join(backup.path, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { checksum: string }
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, checksum: 'tampered' }), 'utf8')
    await expect(workspace.restoreBackup({ bundleDir: backup.path })).rejects.toThrow('校验不一致')

    const { rmSync } = await import('node:fs')
    rmSync(manifestPath)
    await expect(workspace.restoreBackup({ bundleDir: backup.path })).rejects.toThrow('manifest')
    await expect(workspace.restoreBackup({ bundleDir: tmpdir() })).rejects.toThrow('只能写入应用数据目录内')
    database.close()
  })

  it('拒绝把不是本应用数据库的文件当备份恢复', async () => {
    const dataPath = tempDataDir('backup-fake')
    const database = new AppDatabase(join(dataPath, 'moliu.db'))
    const workspace = new WorkspaceService(database, dataPath)
    const bundle = join(dataPath, 'backups', 'moliu-backup-fake')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ app: 'moliu', imageChecksums: {}, checksum: 'x' }), 'utf8')
    writeFileSync(join(bundle, 'moliu.db'), 'not a database', 'utf8')
    await expect(workspace.restoreBackup({ bundleDir: bundle })).rejects.toThrow('校验不一致')
    database.close()
  })
})
