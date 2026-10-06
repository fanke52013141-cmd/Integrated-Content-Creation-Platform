import { basename, extname } from 'node:path'
import type { DeliveryCheck, Publication, PublicationSnapshot, PushWechatDraftInput, SaveWechatPublishChannelInput, VisualAsset } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'
import type { KeyStore } from '../security/key-store.js'
import type { VisualAssetService } from './visual-asset-service.js'
import { localAssetNames, replaceLocalAssets } from './local-assets.js'
import { formatViolations, hasBlockingViolation, validateWechatLayout } from './layout-validator.js'

interface WechatResponse { media_id?: string; url?: string; errcode?: number; errmsg?: string; access_token?: string; expires_in?: number }
class WechatRejectedError extends Error {}
const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

/** 请求失败不打印 URL（token/secret 在查询参数内）。写入结果未知时禁止盲目重试。 */
export class WechatPublishService {
  private tokenCache: { appId: string; configVersion: string; token: string; expiresAt: number } | null = null
  private pushing = false
  private configurationBusy = false
  private uploading = 0
  async configure<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pushing || this.uploading || this.configurationBusy) throw new Error('公众号操作进行中，请完成后再更换连接')
    this.configurationBusy = true
    try { return await operation() } finally { this.configurationBusy = false }
  }

  constructor(private readonly database: AppDatabase, private readonly keyStore: KeyStore, private readonly visualAssets: VisualAssetService, private readonly apiBase = 'https://api.weixin.qq.com') {}

  async test(input?: SaveWechatPublishChannelInput): Promise<{ ok: true; latencyMs: number; message: string }> {
    const started = performance.now()
    if (input) {
      const saved = this.database.getWechatPublishChannel()
      if (input.appId !== saved.appId && !input.appSecret?.trim()) throw new Error('更换公众号时请填写新的 AppSecret')
      const secret = input.appSecret?.trim() || this.keyStore.readWechatPublishSecret()
      await this.fetchToken(input.appId.trim(), secret)
    } else {
      try { await this.token(true); this.database.workflow.recordVerification('success') }
      catch (error) { this.database.workflow.recordVerification('failure', errorMessage(error)); throw error }
    }
    return { ok: true, latencyMs: Math.round(performance.now() - started), message: input ? '当前表单凭证验证成功，请保存以启用' : '公众号凭证验证成功' }
  }

  async preflight(input: PushWechatDraftInput): Promise<DeliveryCheck> {
    const issues: string[] = []
    const article = this.database.getArticle(input.articleId)
    const layout = this.database.getArticleLayout(input.layoutId)
    const channel = this.database.getWechatPublishChannel()
    if (!article) issues.push('文章不存在')
    if (!layout || layout.articleId !== input.articleId) issues.push('排版稿不属于当前文章')
    if (layout?.platform !== 'wechat') issues.push('请选择微信公众号排版稿')
    // HTML 合规校验：preflight 已覆盖业务前置条件，但排版稿本身是否会被微信
    // 过滤格式（<pre>、position 声明、外链图等）此前无人检查。
    // 放在这里而不是推送时硬拦截，是为了让用户在点「推送」之前就看到问题。
    if (layout?.platform === 'wechat') {
      const violations = validateWechatLayout({ html: layout.html, title: layout.title })
      const errors = violations.filter((violation) => violation.level === 'error')
      if (errors.length) issues.push(`排版稿有${errors.length} 处格式会被公众号丢弃：${formatViolations(errors)}`)
    }
    if (article && layout && layout.articleVersionId !== article.currentVersionId) issues.push('正文已有新版本，请重新排版')
    if (article) { try { this.database.workflow.assertSaved(article.id) } catch (error) { issues.push(errorMessage(error)) } }
    if (!channel.enabled || !channel.appId || !channel.hasAppSecret) issues.push('请先保存并启用公众号连接')
    if (input.appId && input.appId !== channel.appId) issues.push('目标公众号已变化，请重新确认交付预览')
    if (!input.coverAssetId && !input.thumbMediaId?.trim()) issues.push('请选择封面图片')
    if (input.coverAssetId) {
      const asset = this.database.getVisualAsset(input.coverAssetId)
      const pack = asset ? this.database.listVisualPacks(input.articleId).find(item => item.id === asset.packId) : undefined
      if (!asset || !pack || asset.kind !== 'cover') issues.push('所选封面不属于当前文章，请重新选择')
      else { try { await this.visualAssets.readAssetFile(asset.fileName) } catch { issues.push('封面文件缺失，请重新导入') } }
    }
    let names: string[] = []
    try { names = localAssetNames(layout?.html ?? '') } catch (error) { issues.push(errorMessage(error)) }
    const registeredAssets = new Set(this.database.listVisualAssets().map(asset => asset.fileName))
    for (const name of names) {
      if (!registeredAssets.has(name)) { issues.push(`正文图片“${name}”未登记，请重新插入`); continue }
      try { await this.visualAssets.readAssetFile(name) } catch { issues.push(`正文图片“${name}”缺失`) }
    }
    const remoteImages = [...(layout?.html ?? '').matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1])
    if (remoteImages.some(url => !url.startsWith('moliu-asset://') && !/^https?:\/\/mmbiz\.(?:qpic|qlogo)\.cn\//i.test(url))) {
      issues.push('正文含外部图片，请先导入到配图并重新插入，确保公众号可读取')
    }
    return { ready: !issues.length, issues, localImageCount: names.length, title: layout?.title ?? '', articleVersionNumber: article?.versionCount ?? 0, appId: channel.appId }
  }

  async pushDraft(input: PushWechatDraftInput): Promise<Publication> {
    if (this.pushing || this.configurationBusy) throw new Error('已有公众号操作进行中，请等待完成')
    this.pushing = true
    try {
      const check = await this.preflight(input)
      if (!check.ready) throw new Error(check.issues.join('；'))
      const layout = this.database.getArticleLayout(input.layoutId)!
      const snapshot: PublicationSnapshot = { appId: check.appId, html: layout.html, input: { ...input, appId: check.appId } }
      return await this.deliver(snapshot, layout.title, layout.articleVersionId)
    } finally { this.pushing = false }
  }

  async retry(publicationId: string): Promise<Publication> {
    const publication = this.database.getPublication(publicationId)
    if (!publication?.snapshot) throw new Error('发布记录没有完整交付快照，请重新选择文章推送')
    if (publication.status === 'unknown') throw new Error('上次推送结果待确认，请先到公众号草稿箱核对，避免重复推送')
    if (publication.status !== 'failed') throw new Error('只能重试明确失败的交付')
    const check = await this.preflight(publication.snapshot.input)
    if (!check.ready) throw new Error(check.issues.join('；'))
    if (this.pushing || this.configurationBusy) throw new Error('已有公众号操作进行中，请等待完成')
    this.pushing = true
    try { return await this.deliver({ ...publication.snapshot, retryOf: publication.id }, publication.title, publication.articleVersionId) }
    finally { this.pushing = false }
  }

  resolveUnknown(input: { id: string; decision: 'received' | 'not-received' | 'unresolved'; note: string; expectedUpdatedAt: string; remoteId?: string }): Publication {
    if (this.pushing || this.configurationBusy) throw new Error('公众号操作进行中，请完成后再核对结果')
    const record = this.database.getPublication(input.id)
    if (!record || record.status !== 'unknown' || record.updatedAt !== input.expectedUpdatedAt) throw new Error('交付记录已变化，请刷新后核对')
    return this.database.atomic(() => {
      this.database.workflow.saveResolution(input.id, { ...input, checkedAt: new Date().toISOString() })
      return this.database.updatePublicationOutcome(input.id, input.decision === 'received' ? 'draft' : input.decision === 'not-received' ? 'failed' : 'unknown', record.thumbMediaId,
        input.decision === 'not-received' ? `人工核对未收到：${input.note}` : input.decision === 'unresolved' ? `仍待确认：${input.note}` : undefined, input.remoteId)
    })
  }

  async prepareClipboard(layoutId: string, mode: 'wechat' | 'placeholders'): Promise<{ html: string; text: string; imageCount: number }> {
    if (this.configurationBusy || this.pushing) throw new Error('公众号操作进行中，请稍后复制')
    const layout = this.database.getArticleLayout(layoutId)
    const article = layout && this.database.getArticle(layout.articleId)
    if (!layout || !article) throw new Error('排版稿或文章不存在')
    this.database.workflow.assertSaved(article.id)
    if (layout.articleVersionId !== article.currentVersionId) throw new Error('正文已有新版本，请重新排版后复制')
    const names = localAssetNames(layout.html)
    if (mode === 'placeholders') {
      let count = 0
      const html = layout.html.replace(/<img\b[^>]*>/gi, () => `<p>【图片 ${++count}：请在公众号编辑器手动插入】</p>`)
      return { html, text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), imageCount: count }
    }
    if (layout.platform !== 'wechat') throw new Error('请选择微信公众号排版稿')
    const violations = validateWechatLayout({ html: layout.html, title: layout.title }).filter(item => item.level === 'error')
    if (violations.length) throw new Error(formatViolations(violations))
    this.uploading++
    try {
      const appId = this.database.getWechatPublishChannel().appId
      const html = await this.prepareInlineImages(layout.html, appId)
      if (html.includes('moliu-asset:')) throw new Error('仍有本地图片地址，已停止复制')
      if ([...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].some(match => !/^https?:\/\/mmbiz\.(?:qpic|qlogo)\.cn\//i.test(match[1]))) throw new Error('含外部图片，请先导入或选择手动插图复制')
      if (this.database.getArticle(article.id)?.currentVersionId !== layout.articleVersionId) throw new Error('上传期间正文已变化，请重新排版')
      this.database.workflow.assertSaved(article.id)
      return { html, text: layout.plainText, imageCount: names.length }
    } finally { this.uploading-- }
  }

  private async deliver(snapshot: PublicationSnapshot, title: string, versionId: string): Promise<Publication> {
    let thumbMediaId = snapshot.input.thumbMediaId?.trim() ?? ''
    let draftRequestSent = false
    const base = { articleId: snapshot.input.articleId, articleVersionId: versionId, layoutId: snapshot.input.layoutId, channelId: 'wechat-official' as const, title, snapshot }
    const record = this.database.createPublication({ ...base, thumbMediaId, status: 'failed', errorMessage: '交付准备未完成，可以重试' })
    try {
      if (snapshot.input.coverAssetId) thumbMediaId = (await this.uploadAsset(snapshot.input.coverAssetId)).wechatMediaId!
      const html = await this.prepareInlineImages(snapshot.html, snapshot.appId)
      if (html.includes('moliu-asset:')) throw new Error('正文仍有未处理的本地图片')
      const check = await this.preflight(snapshot.input)
      if (!check.ready) throw new Error(check.issues.join('；'))
      const token = await this.token()
      const push = (accessToken: string) => this.request(`/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articles: [{ title, author: snapshot.input.author?.trim() || undefined, digest: snapshot.input.digest?.trim() || undefined,
          content: html, content_source_url: snapshot.input.contentSourceUrl?.trim() || undefined, thumb_media_id: thumbMediaId, show_cover_pic: 1, need_open_comment: 0, only_fans_can_comment: 0 }] })
      })
      this.database.updatePublicationOutcome(record.id, 'unknown', thumbMediaId, '请求已发起，请核对公众号草稿箱后确认结果')
      draftRequestSent = true
      let payload = await push(token)
      if (payload.errcode === 40001 || payload.errcode === 42001) {
        this.tokenCache = null
        draftRequestSent = false
        const refreshed = await this.token(true)
        draftRequestSent = true
        payload = await push(refreshed)
      }
      if (payload.errcode) throw new WechatRejectedError(wechatErrorMessage(payload.errcode, payload.errmsg))
      if (!payload.media_id) throw new Error('公众号未返回草稿标识，请到草稿箱核对结果')
      return this.database.updatePublicationOutcome(record.id, 'draft', thumbMediaId, undefined, payload.media_id)
    } catch (error) {
      const unknown = draftRequestSent && !(error instanceof WechatRejectedError)
      return this.database.updatePublicationOutcome(record.id, unknown ? 'unknown' : 'failed', thumbMediaId, unknown ? `推送结果待确认，请到公众号草稿箱核对：${errorMessage(error)}` : errorMessage(error))
    }
  }

  private async prepareInlineImages(html: string, appId: string): Promise<string> {
    const replacements = new Map<string, string>()
    const assets = new Map(this.database.listVisualAssets().map(asset => [asset.fileName, asset]))
    for (const name of localAssetNames(html)) {
      const asset = assets.get(name)
      if (!asset) throw new Error(`正文图片“${name}”未登记，请重新导入`)
      await this.visualAssets.readAssetFile(name)
      let url = this.database.workflow.getUpload(asset.id, appId, 'inline')
      if (!url) {
        const payload = await this.uploadImageFile(name, 'inline')
        if (!payload.url || !/^https?:\/\/mmbiz\.(?:qpic|qlogo)\.cn\/[^\s"'<>]*$/i.test(payload.url)) throw new Error('正文图片上传未返回有效地址')
        url = payload.url
        this.database.workflow.saveUpload(asset.id, appId, 'inline', url)
      }
      replacements.set(name, url)
    }
    return replaceLocalAssets(html, replacements)
  }

  async uploadAsset(assetId: string): Promise<VisualAsset> {
    if (this.configurationBusy) throw new Error('正在保存公众号连接，请稍后上传')
    this.uploading += 1
    try { return await this.uploadAssetInternal(assetId) } finally { this.uploading -= 1 }
  }

  private async uploadAssetInternal(assetId: string): Promise<VisualAsset> {
    const asset = this.database.getVisualAsset(assetId)
    if (!asset) throw new Error('图片资产不存在')
    const appId = this.database.getWechatPublishChannel().appId
    const cached = this.database.workflow.getUpload(assetId, appId, 'cover')
    if (cached) return { ...asset, wechatMediaId: cached }
    const payload = await this.uploadImageFile(asset.fileName, 'cover')
    if (!payload.media_id) throw new Error('封面上传没有返回素材标识')
    this.database.workflow.saveUpload(assetId, appId, 'cover', payload.media_id)
    return this.database.setVisualAssetWechatMedia(assetId, payload.media_id)
  }

  private async uploadImageFile(fileName: string, kind: 'cover' | 'inline'): Promise<WechatResponse> {
    const buffer = await this.visualAssets.readAssetFile(fileName)
    const mime = MIME_BY_EXT[extname(fileName).toLowerCase()]
    if (!mime) throw new Error('公众号图片需为 PNG 或 JPG，请转换后重新导入')
    const upload = async (token: string): Promise<WechatResponse> => {
      const form = new FormData()
      form.append('media', new Blob([new Uint8Array(buffer)], { type: mime }), basename(fileName))
      return this.request(`${kind === 'cover' ? '/cgi-bin/material/add_material' : '/cgi-bin/media/uploadimg'}?access_token=${encodeURIComponent(token)}${kind === 'cover' ? '&type=image' : ''}`, { method: 'POST', body: form })
    }
    let payload = await upload(await this.token())
    if (payload.errcode === 40001 || payload.errcode === 42001) { this.tokenCache = null; payload = await upload(await this.token(true)) }
    if (payload.errcode) throw new WechatRejectedError(wechatErrorMessage(payload.errcode, payload.errmsg))
    return payload
  }

  private async token(force = false): Promise<string> {
    const channel = this.database.getWechatPublishChannel()
    if (!channel.enabled || !channel.appId.trim()) throw new Error('公众号连接未启用')
    if (!force && this.tokenCache?.appId === channel.appId && this.tokenCache.configVersion === channel.updatedAt && Date.now() < this.tokenCache.expiresAt) return this.tokenCache.token
    const payload = await this.fetchToken(channel.appId, this.keyStore.readWechatPublishSecret())
    this.tokenCache = { appId: channel.appId, configVersion: channel.updatedAt, token: payload.access_token!, expiresAt: Date.now() + Math.max(30, (payload.expires_in ?? 7200) - 300) * 1000 }
    return payload.access_token!
  }

  private async fetchToken(appId: string, secret: string): Promise<WechatResponse> {
    if (!appId || !secret) throw new Error('请填写 AppID 和 AppSecret')
    const payload = await this.request(`/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`)
    if (payload.errcode || !payload.access_token) throw new WechatRejectedError(wechatErrorMessage(payload.errcode, payload.errmsg))
    return payload
  }

  private async request(path: string, init?: RequestInit): Promise<WechatResponse> {
    let response: Response
    try { response = await fetch(`${this.apiBase}${path}`, { ...init, signal: AbortSignal.timeout(45_000) }) }
    catch { throw new Error('公众号请求超时或网络中断') }
    if (!response.ok) throw new Error(`公众号接口暂时不可用（HTTP ${response.status}）`)
    try { return await response.json() as WechatResponse }
    catch { throw new Error('公众号接口返回了无法识别的响应') }
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '公众号请求失败' }
function wechatErrorMessage(code?: number, message?: string): string {
  const hints: Record<number, string> = { 40001: '凭证无效，请核对后重试', 40125: 'AppSecret 无效，请重新填写', 40164: '请在公众号后台将当前公网 IP 加入白名单', 42001: '凭证已过期，请重新验证', 45009: '接口调用次数超限，请稍后再试', 53401: '封面尺寸或大小不符合要求', 53404: '封面过大，请压缩后重试' }
  return `${code !== undefined ? hints[code] ?? message ?? '公众号请求被拒绝' : message ?? '公众号未返回有效凭证'}${code !== undefined ? `（错误码 ${code}）` : ''}`
}
