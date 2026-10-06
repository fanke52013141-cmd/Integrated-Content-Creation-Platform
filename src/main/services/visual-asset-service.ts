import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImportVisualAssetInput, GenerateVisualAssetInput, VisualAsset, VisualAssetKind } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'

/** 从二进制头部嗅探图片扩展名（生图接口可能返回 png 或 jpeg） */
function sniffImageExt(bytes: Uint8Array): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg'
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return '.webp'
  throw new Error('文件不是可识别的 PNG / JPG / WebP 图片')
}

/**
 * 视觉图片资产管理：调用生图模型产出图片、从本地导入兜底、登记到 visual_assets 表。
 * 图片文件存放在 userData/images 下，渲染层通过 moliu-asset:// 协议访问。
 */
export class VisualAssetService {
  constructor(
    private readonly database: AppDatabase,
    private readonly gateway: ModelGateway,
    private readonly imagesDir: string
  ) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.imagesDir, { recursive: true })
  }

  async generate(input: GenerateVisualAssetInput, signal?: AbortSignal): Promise<VisualAsset> {
    const pack = this.database.listVisualPacks().find((item) => item.id === input.packId)
    if (!pack) throw new Error('配图方案不存在，请先创建手动配图或生成方案')
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('提示词为空，无法生成图片')

    await this.ensureDir()
    const result = await this.gateway.generateImage({
      providerId: input.providerId,
      model: input.model,
      prompt,
      size: input.size,
      signal
    })
    const bytes = Buffer.from(result.base64, 'base64')
    const fileName = `${randomUUID()}${sniffImageExt(bytes)}`
    await writeFile(join(this.imagesDir, fileName), bytes)
    try { return this.database.saveVisualAsset({
      packId: input.packId,
      kind: input.kind,
      slot: input.slot ?? 0,
      prompt,
      fileName,
      source: 'generated',
      providerId: result.providerId,
      model: result.model,
      size: input.size
    }) } catch (error) { await unlink(join(this.imagesDir, fileName)).catch(() => undefined); throw error }
  }

  async importFromFile(input: ImportVisualAssetInput): Promise<VisualAsset> {
    const ext = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].find((value) => input.filePath.toLowerCase().endsWith(value))
    if (!ext) throw new Error('仅支持导入 PNG / JPG / WebP 图片')
    const bytes = await readFile(input.filePath)
    return this.importFromBytes({
      packId: input.packId,
      kind: input.kind,
      slot: input.slot,
      prompt: input.prompt,
      fileName: basename(input.filePath)
    }, bytes)
  }

  /** 渲染层直接上传文件内容（沙箱下拿不到本地路径） */
  async importFromData(input: { packId: string; kind: VisualAssetKind; slot?: number; prompt: string; fileName: string; data: ArrayBuffer }): Promise<VisualAsset> {
    return this.importFromBytes({
      packId: input.packId,
      kind: input.kind,
      slot: input.slot,
      prompt: input.prompt,
      fileName: input.fileName
    }, Buffer.from(input.data))
  }

  private async importFromBytes(input: { packId: string; kind: VisualAssetKind; slot?: number; prompt: string; fileName: string }, bytes: Buffer): Promise<VisualAsset> {
    const pack = this.database.listVisualPacks().find((item) => item.id === input.packId)
    if (!pack) throw new Error('配图方案不存在，请先创建手动配图或生成方案')
    if (!bytes.length) throw new Error('图片内容为空')
    if (bytes.length > 10 * 1024 * 1024) throw new Error('图片超过 10MB，请压缩后再导入')
    const ext = sniffImageExt(bytes)
    // 仅接受 png/jpg：公众号素材接口不接受 webp，避免下游上传失败
    if (!['.png', '.jpg'].includes(ext)) throw new Error('仅支持导入 PNG / JPG 图片')

    await this.ensureDir()
    const fileName = `${randomUUID()}${ext}`
    await writeFile(join(this.imagesDir, fileName), bytes)
    try { return this.database.saveVisualAsset({
      packId: input.packId,
      kind: input.kind,
      slot: input.slot ?? 0,
      prompt: input.prompt.trim(),
      fileName,
      source: 'imported'
    }) } catch (error) { await unlink(join(this.imagesDir, fileName)).catch(() => undefined); throw error }
  }

  async removeAsset(id: string): Promise<void> {
    const asset = this.database.getVisualAsset(id)
    if (!asset) return
    if (this.database.workflow.isAssetReferenced(asset.fileName)) throw new Error('图片仍被正文、草稿或历史排版引用，请先移除引用后再删除')
    this.database.removeVisualAsset(id)
    try {
      await unlink(join(this.imagesDir, asset.fileName))
    } catch {
      // 文件可能已被手动清理，忽略
    }
  }

  /** 删除整个视觉包时清理其下所有图片文件 */
  async removePackAssets(packId: string): Promise<void> {
    const assets = this.database.listVisualAssets(packId)
    if (assets.some(asset => this.database.workflow.isAssetReferenced(asset.fileName))) throw new Error('配图方案中的图片仍被文章引用，不能删除')
    for (const asset of assets) {
      try {
        await unlink(join(this.imagesDir, asset.fileName))
      } catch {
        // ignore
      }
    }
  }

  async readAssetFile(fileName: string): Promise<Buffer> {
    const safe = basename(fileName)
    return readFile(join(this.imagesDir, safe))
  }
}

export type { VisualAssetKind }
