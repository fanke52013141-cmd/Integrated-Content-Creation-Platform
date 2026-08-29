import { basename } from 'node:path'
import type { PushWechatDraftInput, Publication, VisualAsset } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { KeyStore } from '../security/key-store.js'
import type { VisualAssetService } from './visual-asset-service.js'

interface WechatMediaResponse {
  media_id?: string
  url?: string
  errcode?: number
  errmsg?: string
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** access_token 官方有效期 7200s，提前 25 分钟过期以避开边界 */
const TOKEN_TTL_MS = (7200 - 25 * 60) * 1000

export class WechatPublishService {
  private tokenCache: { appId: string; token: string; expiresAt: number } | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly keyStore: KeyStore,
    private readonly visualAssets: VisualAssetService,
    private readonly apiBase = 'https://api.weixin.qq.com'
  ) {}

  async test(): Promise<{ ok: true; latencyMs: number; message: string }> {
    const started = performance.now()
    await this.token()
    return { ok: true, latencyMs: Math.round(performance.now() - started), message: '公众号凭证验证成功' }
  }

  async pushDraft(input: PushWechatDraftInput): Promise<Publication> {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    const layout = this.database.listArticleLayouts(article.id).find(item => item.id === input.layoutId)
    if (!layout) throw new Error('排版稿不存在或不属于该文章')

    const thumbMediaId = await this.resolveThumbMediaId(input)
    const base = {
      articleId: article.id,
      articleVersionId: layout.articleVersionId,
      layoutId: layout.id,
      channelId: 'wechat-official' as const,
      title: layout.title,
      thumbMediaId
    }

    const buildBody = (token: string): string => JSON.stringify({
      articles: [{
        title: layout.title,
        author: input.author?.trim() || undefined,
        digest: input.digest?.trim() || undefined,
        content: layout.html,
        content_source_url: input.contentSourceUrl?.trim() || undefined,
        thumb_media_id: thumbMediaId,
        show_cover_pic: 1,
        need_open_comment: 0,
        only_fans_can_comment: 0
      }]
    })

    const push = async (token: string): Promise<WechatMediaResponse> => {
      const response = await fetch(`${this.apiBase}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: buildBody(token)
      })
      return response.json() as Promise<WechatMediaResponse>
    }

    try {
      let payload = await push(await this.token())
      // 凭证失效时强制刷新重试一次（IP 白名单等配置类错误刷新无用，不重试）
      if (payload.errcode === 40001 || payload.errcode === 42001) {
        this.invalidateToken()
        payload = await push(await this.token(true))
      }
      if (payload.errcode || !payload.media_id) {
        throw new Error(wechatErrorMessage(payload.errcode, payload.errmsg) || `公众号草稿箱请求失败（errcode ${payload.errcode ?? '未知'}）`)
      }
      return this.database.createPublication({ ...base, externalDraftId: payload.media_id, status: 'draft' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '推送失败'
      // 记录失败快照便于追溯，但错误必须上抛，让界面能给出明确提示与重试入口
      this.database.createPublication({ ...base, status: 'failed', errorMessage: message })
      throw error instanceof Error ? error : new Error(message)
    }
  }

  /** 把图片资产上传到公众号永久素材库，返回 media_id 并回填到资产行 */
  async uploadAsset(assetId: string): Promise<VisualAsset> {
    const asset = this.database.getVisualAsset(assetId)
    if (!asset) throw new Error('图片资产不存在')
    if (asset.wechatMediaId) return asset
    const mediaId = await this.uploadImageFile(asset.fileName)
    return this.database.setVisualAssetWechatMedia(assetId, mediaId)
  }

  private async resolveThumbMediaId(input: PushWechatDraftInput): Promise<string> {
    if (input.coverAssetId) {
      const asset = await this.uploadAsset(input.coverAssetId)
      return asset.wechatMediaId!
    }
    const manual = input.thumbMediaId?.trim()
    if (manual) return manual
    throw new Error('缺少封面素材：请先生成或导入封面图片，或手动填写 thumbMediaId')
  }

  /** 上传 images 目录中的文件到公众号永久图片素材 */
  private async uploadImageFile(fileName: string): Promise<string> {
    const buffer = await this.visualAssets.readAssetFile(fileName)
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'image/png'
    const token = await this.token()

    const upload = async (token: string): Promise<WechatMediaResponse> => {
      const form = new FormData()
      form.append('media', new Blob([new Uint8Array(buffer)], { type: mime }), basename(fileName))
      const response = await fetch(`${this.apiBase}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, {
        method: 'POST',
        body: form
      })
      return response.json() as Promise<WechatMediaResponse>
    }

    let payload = await upload(token)
    if (payload.errcode === 40001 || payload.errcode === 42001) {
      this.invalidateToken()
      payload = await upload(await this.token(true))
    }
    if (payload.errcode || !payload.media_id) {
      throw new Error(wechatErrorMessage(payload.errcode, payload.errmsg) || `封面上传失败（errcode ${payload.errcode ?? '未知'}）`)
    }
    return payload.media_id
  }

  private invalidateToken(): void {
    this.tokenCache = null
  }

  private async token(forceRefresh = false): Promise<string> {
    const channel = this.database.getWechatPublishChannel()
    if (!channel.enabled || !channel.appId.trim()) throw new Error('微信公众号发布通道尚未启用或未填写 AppID')
    if (!forceRefresh && this.tokenCache && this.tokenCache.appId === channel.appId && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token
    }
    const secret = this.keyStore.readWechatPublishSecret()
    const response = await fetch(`${this.apiBase}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(channel.appId)}&secret=${encodeURIComponent(secret)}`)
    const payload = await response.json() as { access_token?: string; errcode?: number; errmsg?: string }
    if (!response.ok || payload.errcode || !payload.access_token) {
      throw new Error(wechatErrorMessage(payload.errcode, payload.errmsg) || `公众号凭证验证失败（HTTP ${response.status}）`)
    }
    this.tokenCache = { appId: channel.appId, token: payload.access_token, expiresAt: Date.now() + TOKEN_TTL_MS }
    return payload.access_token
  }
}

/** 常见公众号错误码的中文解释 */
function wechatErrorMessage(errcode: number | undefined, errmsg?: string): string | undefined {
  const hints: Record<number, string> = {
    40001: 'AppSecret 不正确或无权限，请核对后重试',
    40125: 'AppSecret 无效，请重置后重新填写',
    40164: '服务器 IP 不在公众号白名单：请到 mp.weixin.qq.com「基本配置」把本机 IP 加入 IP 白名单',
    41002: '缺少 AppID，请填写公众号 AppID',
    41004: '缺少 AppSecret，请填写公众号 AppSecret',
    42001: 'access_token 已过期，请重试',
    45009: '接口调用次数超限，请明天再试',
    53401: '封面图片不符合规范（尺寸或大小超限）',
    53404: '封面图片大小超限，请压缩后重试'
  }
  const base = errmsg?.trim()
  if (errcode !== undefined && hints[errcode]) return `${hints[errcode]}（errcode ${errcode}${base ? `：${base}` : ''}）`
  return base || undefined
}
