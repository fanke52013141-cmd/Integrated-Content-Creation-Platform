import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImportVisualAssetInput, GenerateVisualAssetInput, EditVisualAssetInput, VisualAsset, VisualAssetKind } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { ModelGateway } from '../gateway/model-gateway.js'
import { pixelSizeForRatio } from '../gateway/image-sizing.js'
import { isCancelledError } from '../gateway/types.js'

/** 从二进制头部嗅探图片扩展名（生图接口可能返回 png 或 jpeg） */
function sniffImageExt(bytes: Uint8Array): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg'
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return '.webp'
  throw new Error('文件不是可识别的 PNG / JPG / WebP 图片')
}

/** 读取 PNG / JPEG 的像素尺寸，用于在图片资产上记录实际输出大小 */
function readImageSize(bytes: Buffer): string | undefined {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = bytes.readUInt16BE(offset + 5)
        const width = bytes.readUInt16BE(offset + 7)
        return `${width}x${height}`
      }
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
  }
  return undefined
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
    let taskId: string | undefined
    let result: Awaited<ReturnType<ModelGateway['generateImage']>>
    try {
      result = await this.gateway.generateImage({
        providerId: input.providerId,
        model: input.model,
        prompt,
        ratio: input.ratio,
        size: input.size,
        quality: input.quality ?? 'low',
        resolution: input.resolution ?? '1k',
        background: input.background,
        signal,
        // 任务 id 一拿到就落库：之后即使应用退出/崩溃，重启也能续查这张图
        onTaskCreated: (id) => {
          taskId = id
          this.database.createImageTask({
            id,
            providerId: input.providerId,
            model: input.model,
            packId: input.packId,
            kind: input.kind,
            slot: input.slot ?? 0,
            prompt,
            ratio: input.ratio,
            quality: input.quality ?? 'low',
            resolution: input.resolution ?? '1k'
          })
        },
        onProgress: (progress) => {
          if (taskId) this.database.updateImageTaskProgress(taskId, progress)
        }
      })
    } catch (error) {
      // 用户取消/关闭应用时不要把任务标记为失败：任务可能仍在供应商侧生成，
      // 保留 pending 状态，下次启动由 resumePendingTasks 续查
      if (taskId && !isCancelledError(error) && !signal?.aborted) {
        this.database.failImageTask(taskId, error instanceof Error ? error.message : '生图失败')
      }
      throw error
    }
    return this.persistImage({
      packId: input.packId,
      kind: input.kind,
      slot: input.slot,
      prompt,
      requestedSize: input.size,
      background: input.background
    }, result)
  }

  /**
   * 参考图编辑：把公网图片 URL 与修改提示词交给 /images/edits，
   * 结果与普通生成一样落成本地资产（并记录远端 URL，便于继续改图）。
   */
  async edit(input: EditVisualAssetInput, signal?: AbortSignal): Promise<VisualAsset> {
    const pack = this.database.listVisualPacks().find((item) => item.id === input.packId)
    if (!pack) throw new Error('配图方案不存在，请先创建手动配图或生成方案')
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('修改提示词为空，无法改图')
    let imageUrl = input.imageUrl?.trim() ?? ''
    if (!imageUrl) {
      if (!input.assetId) throw new Error('缺少参考图：请提供图片地址或选择本地图片')
      const asset = this.database.getVisualAsset(input.assetId)
      if (!asset) throw new Error('参考图资产不存在，可能已被删除')
      // 本地图片先上传换公网 URL，编辑接口只接受 URL
      const bytes = await readFile(join(this.imagesDir, asset.fileName))
      imageUrl = await this.gateway.uploadImage({
        providerId: input.providerId,
        bytes,
        fileName: asset.fileName,
        mimeType: asset.fileName.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png',
        signal
      })
    } else if (!/^https?:\/\//i.test(imageUrl)) {
      throw new Error('参考图必须是可访问的 http(s) 图片地址')
    }

    await this.ensureDir()
    let taskId: string | undefined
    let result: Awaited<ReturnType<ModelGateway['editImage']>>
    try {
      result = await this.gateway.editImage({
        providerId: input.providerId,
        model: input.model,
        prompt,
        imageUrl,
        // 改图接口实测只吃像素尺寸（传比例会一直卡住）
        size: pixelSizeForRatio(input.ratio ?? '1:1'),
        quality: input.quality ?? 'low',
        background: input.background,
        signal,
        onTaskCreated: (id) => {
          taskId = id
          this.database.createImageTask({
            id,
            providerId: input.providerId,
            model: input.model,
            packId: input.packId,
            kind: input.kind,
            slot: input.slot ?? 0,
            prompt,
            ratio: input.ratio ?? '1:1',
            quality: input.quality ?? 'low'
          })
        },
        onProgress: (progress) => {
          if (taskId) this.database.updateImageTaskProgress(taskId, progress)
        }
      })
    } catch (error) {
      if (taskId && !isCancelledError(error) && !signal?.aborted) {
        this.database.failImageTask(taskId, error instanceof Error ? error.message : '改图失败')
      }
      throw error
    }
    return this.persistImage({
      packId: input.packId,
      kind: input.kind,
      slot: input.slot,
      prompt,
      requestedSize: pixelSizeForRatio(input.ratio ?? '1:1'),
      background: input.background
    }, result)
  }

  /** 把网关返回的图片数据落盘、登记资产，并把生图任务标记完成 */
  private async persistImage(
    context: { packId: string; kind: VisualAssetKind; slot?: number; prompt: string; requestedSize?: string; background?: 'transparent' },
    result: { base64: string; providerId: string; model: string; costUsd?: number; remoteUrl?: string; taskId?: string }
  ): Promise<VisualAsset> {
    const bytes = Buffer.from(result.base64, 'base64')
    const fileName = `${randomUUID()}${sniffImageExt(bytes)}`
    await writeFile(join(this.imagesDir, fileName), bytes)
    // 供应商回传账单时用实际费用；不回传时回落到模型配置的单张成本（标注为估算）
    const configuredPrice = this.database.getProvider(result.providerId)?.models
      .find((model) => model.modelId === result.model)?.pricePerImage
    const costUsd = result.costUsd ?? configuredPrice
    const costEstimated = result.costUsd === undefined && configuredPrice !== undefined
    try {
      const asset = this.database.saveVisualAsset({
        packId: context.packId,
        kind: context.kind,
        slot: context.slot ?? 0,
        prompt: context.prompt,
        fileName,
        source: 'generated',
        providerId: result.providerId,
        model: result.model,
        // 记录实际输出尺寸（比例制供应商按 ratio 出图，尺寸由它决定）
        size: readImageSize(bytes) ?? context.requestedSize,
        costUsd,
        costEstimated,
        remoteUrl: result.remoteUrl,
        background: context.background
      })
      if (result.taskId) this.database.completeImageTask(result.taskId, asset.id, result.costUsd)
      return asset
    } catch (error) {
      await unlink(join(this.imagesDir, fileName)).catch(() => undefined)
      if (result.taskId) this.database.failImageTask(result.taskId, error instanceof Error ? error.message : '图片保存失败')
      throw error
    }
  }

  /**
   * 应用启动后补查上次没跑完的生图任务：只依赖任务 id 与供应商配置，
   * 完成的直接落成图片资产，失败的写回错误，避免「钱花了图没了」。
   */
  async resumePendingTasks(signal?: AbortSignal): Promise<number> {
    const tasks = this.database.listPendingImageTasks()
    if (!tasks.length) return 0
    await this.ensureDir()
    let restored = 0
    for (const task of tasks) {
      if (signal?.aborted) break
      try {
        const result = await this.gateway.resumeImageTask({
          providerId: task.providerId,
          model: task.model,
          taskId: task.id,
          signal,
          onProgress: (progress) => this.database.updateImageTaskProgress(task.id, progress)
        })
        await this.persistImage({
          packId: task.packId,
          kind: task.kind,
          slot: task.slot,
          prompt: task.prompt
        }, { ...result, providerId: task.providerId, model: task.model })
        restored += 1
      } catch (error) {
        this.database.failImageTask(task.id, error instanceof Error ? error.message : '续查失败')
      }
    }
    return restored
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
