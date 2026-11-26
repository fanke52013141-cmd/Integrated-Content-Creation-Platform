import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { assertArticleImage, assertThumbnail } from './images.mjs'

export class WeChatApiError extends Error {
  constructor(message, { code, status, rid } = {}) {
    super(message)
    this.name = 'WeChatApiError'
    this.code = code
    this.status = status
    this.rid = rid
  }
}

export class WeChatClient {
  constructor({ appId, appSecret, accessToken, apiBase = 'https://api.weixin.qq.com', fetchImpl = fetch }) {
    if (!accessToken && (!appId || !appSecret)) throw new Error('缺少 WECHAT_APP_ID/WECHAT_APP_SECRET 或 WECHAT_ACCESS_TOKEN')
    this.appId = appId
    this.appSecret = appSecret
    this.accessToken = accessToken
    this.apiBase = apiBase.replace(/\/$/, '')
    this.fetch = fetchImpl
  }

  async getAccessToken() {
    if (this.accessToken) return this.accessToken
    const query = new URLSearchParams({ grant_type: 'client_credential', appid: this.appId, secret: this.appSecret })
    const data = await this.requestJson(`/cgi-bin/token?${query}`, { skipAuth: true, method: 'GET' })
    if (!data.access_token) throw new WeChatApiError('微信未返回 access_token', { code: data.errcode })
    this.accessToken = data.access_token
    return this.accessToken
  }

  async requestJson(endpoint, { method = 'POST', body, form, skipAuth = false } = {}) {
    const token = skipAuth ? null : await this.getAccessToken()
    const url = new URL(`${this.apiBase}${endpoint}`)
    if (token) url.searchParams.set('access_token', token)
    const response = await this.fetch(url, {
      method,
      headers: form ? undefined : body ? { 'content-type': 'application/json' } : undefined,
      body: form ?? (body ? JSON.stringify(body) : undefined),
    })
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    }
    catch {
      throw new WeChatApiError(`微信接口返回非 JSON（HTTP ${response.status}）`, { status: response.status })
    }
    if (!response.ok || (data.errcode !== undefined && Number(data.errcode) !== 0)) {
      throw new WeChatApiError(`微信接口错误 ${data.errcode ?? response.status}: ${data.errmsg ?? text.slice(0, 200)}`, {
        code: data.errcode,
        status: response.status,
        rid: data.rid,
      })
    }
    return data
  }

  async uploadArticleImage(filePath) {
    const metadata = await assertArticleImage(filePath)
    const bytes = await readFile(filePath)
    const form = new FormData()
    form.append('media', new Blob([bytes], { type: metadata.type === 'png' ? 'image/png' : 'image/jpeg' }), path.basename(filePath))
    return this.requestJson('/cgi-bin/media/uploadimg', { form })
  }

  async uploadThumbnail(filePath) {
    const metadata = await assertThumbnail(filePath)
    const bytes = await readFile(filePath)
    const form = new FormData()
    form.append('media', new Blob([bytes], { type: 'image/jpeg' }), path.basename(filePath))
    return this.requestJson('/cgi-bin/material/add_material?type=thumb', { form })
  }

  async addDraft(article) {
    return this.requestJson('/cgi-bin/draft/add', { body: { articles: [article] } })
  }

  async getDraft(mediaId) {
    return this.requestJson('/cgi-bin/draft/get', { body: { media_id: mediaId } })
  }
}
