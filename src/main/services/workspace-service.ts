import { dialog } from 'electron'
import { copyFile, mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { LocalFileResult } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import { renderLayoutMarkdown } from './article-layout-service.js'
import { localAssetNames, replaceLocalAssets } from './local-assets.js'

export type ExportFormat = 'markdown' | 'html'

/**
 * 本地交付与数据安全：把文章导出成 Markdown / 自包含 HTML（图片转 data URI），
 * 以及整库备份（数据库快照 + 图片目录 + 校验清单）与恢复。
 * 渲染层可以显式传 targetDir，但只允许落在 userData 内，避免被诱导写任意路径。
 */
export class WorkspaceService {
  constructor(
    private readonly database: AppDatabase,
    private readonly dataPath: string
  ) {}

  private get imagesDir(): string {
    return join(this.dataPath, 'images')
  }

  /** 只允许 dataPath 内的目录，越界一律拒绝 */
  private insideData(candidate: string): string {
    const absolute = resolve(candidate)
    const root = resolve(this.dataPath)
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
      throw new Error('只能写入应用数据目录内的位置')
    }
    return absolute
  }

  async exportArticle(input: { articleId: string; format: ExportFormat; targetDir?: string }): Promise<LocalFileResult> {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    this.database.workflow.assertSaved(article.id)
    const fileName = `${slug(articleTitle(article.rawMarkdown))}-V${article.versionCount}-${article.id.slice(0, 8)}.${input.format === 'html' ? 'html' : 'md'}`
    const directory = input.targetDir ? this.insideData(input.targetDir) : await this.pickDirectory([formatFilter('Markdown', ['md']), formatFilter('HTML', ['html'])])
    if (!directory) return { path: null }
    await mkdir(directory, { recursive: true })
    let body: string
    if (input.format === 'html') body = await this.embedImages(wrapDocument(articleTitle(article.rawMarkdown), renderLayoutMarkdown(article.rawMarkdown, 'web').html))
    else {
      const replacements = new Map<string, string>()
      const folder = `${fileName.slice(0, -3)}-assets`
      const names = localAssetNames(article.rawMarkdown)
      if (names.length) await mkdir(join(directory, folder), { recursive: true })
      for (const name of names) {
        const destination = `${randomUUID()}${extname(name)}`
        await copyFile(join(this.imagesDir, name), join(directory, folder, destination), constants.COPYFILE_EXCL)
        replacements.set(name, `./${encodeURIComponent(folder)}/${encodeURIComponent(destination)}`)
      }
      body = replaceLocalAssets(article.rawMarkdown, replacements)
    }
    const target = await this.writeUnique(directory, fileName, body)
    return { path: target }
  }

  /** 富文本排版稿另存为单个 HTML 文件（图片内嵌，离线可打开） */
  async exportLayout(input: { layoutId: string; targetDir?: string }): Promise<LocalFileResult> {
    const layout = this.database.getArticleLayout(input.layoutId)
    if (!layout) throw new Error('排版稿不存在')
    this.database.workflow.assertSaved(layout.articleId)
    const fileName = `${slug(layout.title)}-排版稿-${layout.id.slice(0, 8)}.html`
    const directory = input.targetDir ? this.insideData(input.targetDir) : await this.pickDirectory([formatFilter('HTML', ['html'])])
    if (!directory) return { path: null }
    await mkdir(directory, { recursive: true })
    const target = await this.writeUnique(directory, fileName, await this.embedImages(wrapDocument(layout.title, layout.html)))
    return { path: target }
  }

  async createBackup(input?: { targetDir?: string }): Promise<{ path: string; checksum: string }> {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    // 默认直接落到 userData/backups：一键备份不需要选路径，且与 listBackupBundles/恢复同处一地
    const parent = input?.targetDir ? this.insideData(input.targetDir) : join(this.dataPath, 'backups')
    if (!parent) throw new Error('未选择备份位置')
    const bundle = join(parent, `moliu-backup-${stamp}-${randomUUID().slice(0, 8)}`)
    await mkdir(bundle, { recursive: true })
    this.database.backupTo(join(bundle, 'moliu.db'))
    const imageCount = await this.copyImages(join(bundle, 'images'))
    const checksum = await sha256(join(bundle, 'moliu.db'))
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
      app: 'moliu',
      formatVersion: 2,
      createdAt: new Date().toISOString(),
      database: 'moliu.db',
      checksum,
      images: imageCount,
      imageChecksums: await this.imageChecksums(join(bundle, 'images')),
      counts: {
        articles: this.database.workflow.listSummaries({ limit: 1 }).total,
        materials: this.database.listMaterials().length,
        accounts: this.database.listAccounts().length
      }
    }, null, 2), 'utf8')
    return { path: bundle, checksum }
  }

  /** 从备份目录恢复整库与图片；恢复前数据库层会自动留存 pre-restore 副本 */
  async restoreBackup(input: { bundleDir: string }): Promise<{ restoredImages: number }> {
    const bundle = this.insideData(input.bundleDir)
    const manifestFile = join(bundle, 'manifest.json')
    let expectedChecksum: string | undefined
    let imageChecksums: Record<string, string> = {}
    try {
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { app?: string; checksum?: string; imageChecksums?: Record<string, string> }
      if (manifest.app !== 'moliu' || !manifest.checksum || !manifest.imageChecksums) throw new Error('备份清单不完整')
      expectedChecksum = manifest.checksum
      imageChecksums = manifest.imageChecksums
    } catch {
      throw new Error('备份缺少 manifest.json，无法确认完整性')
    }
    const dbFile = join(bundle, 'moliu.db')
    const checksum = await sha256(dbFile)
    if (expectedChecksum && expectedChecksum !== checksum) throw new Error('备份文件校验不一致，可能已损坏，已停止恢复')
    if (!this.database.isDatabaseFile(dbFile)) throw new Error('备份中的 moliu.db 不是本应用的数据库')
    const stagedImages = join(this.dataPath, `images-restore-${randomUUID()}`)
    const rollbackImages = join(this.dataPath, `images-pre-restore-${randomUUID()}`)
    await mkdir(stagedImages)
    let movedOriginal = false
    let installedNew = false
    try {
      for (const [file, expected] of Object.entries(imageChecksums)) {
        if (file !== basename(file) || !/\.(png|jpe?g|webp|gif)$/i.test(file)) throw new Error('备份图片文件名无效')
        const source = join(bundle, 'images', file)
        if (await sha256(source) !== expected) throw new Error(`备份图片“${file}”校验不一致`)
        await copyFile(source, join(stagedImages, file))
      }
      try { await rename(this.imagesDir, rollbackImages); movedOriginal = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await rename(stagedImages, this.imagesDir)
      installedNew = true
      this.database.restoreFrom(dbFile)
      return { restoredImages: Object.keys(imageChecksums).length }
    } catch (error) {
      if (installedNew) await rm(this.imagesDir, { recursive: true, force: true })
      if (movedOriginal) await rename(rollbackImages, this.imagesDir)
      throw error
    } finally { await rm(stagedImages, { recursive: true, force: true }) }
  }

  private async copyImages(target: string): Promise<number> {
    let files: string[] = []
    try {
      files = await readdir(this.imagesDir)
    } catch {
      return 0
    }
    if (!files.length) return 0
    await mkdir(target, { recursive: true })
    for (const file of files) await copyFile(join(this.imagesDir, file), join(target, file))
    return files.length
  }

  private async imageChecksums(directory: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {}
    const files = await readdir(directory).catch(() => [] as string[])
    for (const file of files) result[file] = await sha256(join(directory, file))
    return result
  }

  private async writeUnique(directory: string, fileName: string, body: string): Promise<string> {
    const ext = extname(fileName)
    for (let suffix = 0; suffix < 1000; suffix += 1) {
      const target = join(directory, suffix ? `${fileName.slice(0, -ext.length)}-${suffix}${ext}` : fileName)
      try { await writeFile(target, body, { encoding: 'utf8', flag: 'wx' }); return target }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    throw new Error('该目录中同名导出过多，请选择其他位置')
  }

  /** 把 moliu-asset://assets/x.png 换成 data URI，导出的文件脱离应用也能看图 */
  private async embedImages(html: string): Promise<string> {
    const names = localAssetNames(html)
    const table = new Map<string, string>()
    for (const name of names) {
      try {
        const bytes = await readFile(join(this.imagesDir, name))
        table.set(name, `data:${mimeOf(name)};base64,${bytes.toString('base64')}`)
      } catch { throw new Error(`图片“${name}”已丢失，请重新导入后导出`) }
    }
    return replaceLocalAssets(html, table)
  }

  private async pickDirectory(filters?: Electron.FileFilter[]): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '选择保存位置',
      buttonLabel: filters ? '保存到这里' : '备份到这里',
      properties: ['openDirectory', 'createDirectory'],
      ...(filters ? { filters } : {})
    })
    if (result.canceled || !result.filePaths[0]) return null
    return resolve(result.filePaths[0])
  }

  /**
   * 备份清单：默认扫描 userData/backups，同时覆盖 userData 根与一级子目录里的
   * 备份包——createBackup 允许自定义 targetDir，写入位置必须与列表位置一致，
   * 否则自定义位置的备份在备份页看不到、也无法从界面恢复。
   */
  async listBackupBundles(): Promise<string[]> {
    const bundles: string[] = []
    try {
      const topLevel = await readdir(this.dataPath, { withFileTypes: true })
      for (const entry of topLevel) {
        if (!entry.isDirectory()) continue
        const layer = join(this.dataPath, entry.name)
        if (entry.name.startsWith('moliu-backup-')) {
          bundles.push(layer)
          continue
        }
        try {
          const nested = await readdir(layer, { withFileTypes: true })
          for (const nestedEntry of nested) {
            if (nestedEntry.isDirectory() && nestedEntry.name.startsWith('moliu-backup-')) {
              bundles.push(join(layer, nestedEntry.name))
            }
          }
        } catch {
          // 单个子目录读不了不影响其余位置的扫描
        }
      }
    } catch {
      return []
    }
    return bundles.sort().reverse()
  }
}

function wrapDocument(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function articleTitle(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '未命名文章'
}

function slug(value: string): string {
  const clean = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '') || '未命名文章'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `文章-${clean}` : clean
}

function mimeOf(name: string): string {
  const ext = extname(name).toLowerCase()
  if (ext === '.jpg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function formatFilter(name: string, extensions: string[]): Electron.FileFilter { return { name, extensions } }
