import { dialog } from 'electron'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { LocalFileResult } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import { renderLayoutMarkdown } from './article-layout-service.js'

export type ExportFormat = 'markdown' | 'html'

const ASSET_PATTERN = /moliu-asset:\/\/assets\/([^"'()\s>]+)/g

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
    const fileName = `${slug(articleTitle(article.rawMarkdown))}.${input.format === 'html' ? 'html' : 'md'}`
    const body = input.format === 'html'
      ? await this.embedImages(renderLayoutMarkdown(article.rawMarkdown, 'web').html)
      : article.rawMarkdown
    const directory = input.targetDir ? this.insideData(input.targetDir) : await this.pickDirectory([formatFilter('Markdown', ['md']), formatFilter('HTML', ['html'])])
    if (!directory) return { path: null }
    await mkdir(directory, { recursive: true })
    const target = join(directory, fileName)
    await writeFile(target, body, 'utf8')
    return { path: target }
  }

  /** 富文本排版稿另存为单个 HTML 文件（图片内嵌，离线可打开） */
  async exportLayout(input: { layoutId: string; targetDir?: string }): Promise<LocalFileResult> {
    const layout = this.database.getArticleLayout(input.layoutId)
    if (!layout) throw new Error('排版稿不存在')
    const fileName = `${slug(layout.title)}-排版稿.html`
    const directory = input.targetDir ? this.insideData(input.targetDir) : await this.pickDirectory([formatFilter('HTML', ['html'])])
    if (!directory) return { path: null }
    await mkdir(directory, { recursive: true })
    const target = join(directory, fileName)
    await writeFile(target, await this.embedImages(wrapDocument(layout.title, layout.html)), 'utf8')
    return { path: target }
  }

  async createBackup(input?: { targetDir?: string }): Promise<{ path: string; checksum: string }> {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    // 默认直接落到 userData/backups：一键备份不需要选路径，且与 listBackupBundles/恢复同处一地
    const parent = input?.targetDir ? this.insideData(input.targetDir) : join(this.dataPath, 'backups')
    if (!parent) throw new Error('未选择备份位置')
    const bundle = join(parent, `moliu-backup-${stamp}`)
    await mkdir(bundle, { recursive: true })
    this.database.backupTo(join(bundle, 'moliu.db'))
    const imageCount = await this.copyImages(join(bundle, 'images'))
    const checksum = await sha256(join(bundle, 'moliu.db'))
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
      app: 'moliu',
      createdAt: new Date().toISOString(),
      database: 'moliu.db',
      checksum,
      images: imageCount,
      counts: {
        articles: this.database.listArticles().length,
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
    try {
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { checksum?: string }
      expectedChecksum = manifest.checksum
    } catch {
      throw new Error('备份缺少 manifest.json，无法确认完整性')
    }
    const dbFile = join(bundle, 'moliu.db')
    const checksum = await sha256(dbFile)
    if (expectedChecksum && expectedChecksum !== checksum) throw new Error('备份文件校验不一致，可能已损坏，已停止恢复')
    if (!this.database.isDatabaseFile(dbFile)) throw new Error('备份中的 moliu.db 不是本应用的数据库')
    const restoredImages = await this.restoreImages(join(bundle, 'images'))
    this.database.restoreFrom(dbFile)
    return { restoredImages }
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

  private async restoreImages(source: string): Promise<number> {
    let files: string[] = []
    try {
      files = (await readdir(source)).filter((file) => ['.png', '.jpg', '.webp'].includes(extname(file).toLowerCase()))
    } catch {
      return 0
    }
    await mkdir(this.imagesDir, { recursive: true })
    for (const file of files) await copyFile(join(source, file), join(this.imagesDir, file))
    return files.length
  }

  /** 把 moliu-asset://assets/x.png 换成 data URI，导出的文件脱离应用也能看图 */
  private async embedImages(html: string): Promise<string> {
    const names = [...new Set([...html.matchAll(ASSET_PATTERN)].map((match) => basename(decodeURIComponent(match[1]))))]
    const table = new Map<string, string>()
    for (const name of names) {
      try {
        const bytes = await readFile(join(this.imagesDir, name))
        table.set(name, `data:${mimeOf(name)};base64,${bytes.toString('base64')}`)
      } catch {
        // 图片文件已丢失时保留原地址，不阻断导出
      }
    }
    return html.replace(ASSET_PATTERN, (match, raw: string) => table.get(basename(decodeURIComponent(raw))) ?? match)
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

  /** 清理导出用的临时目录（导出成功后用户选择「打开目录」前的容错） */
  async listBackupBundles(): Promise<string[]> {
    const root = resolve(this.dataPath, 'backups')
    try {
      const entries = await readdir(root, { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('moliu-backup-')).map((entry) => join(root, entry.name)).sort().reverse()
    } catch {
      return []
    }
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
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名文章'
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
