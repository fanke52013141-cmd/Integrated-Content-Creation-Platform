import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { WechatPublishService } from '../src/main/services/wechat-publish-service.js'
import type { KeyStore } from '../src/main/security/key-store.js'

/**
 * freepublish「发表」链路状态机测试（批次 6）：mock 微信 HTTP 层。
 * 覆盖：成功回填 msgid/URL、失败（status 3）、窗口内未出结果落 unknown + 续查打通、
 * 无权限（48001）明确报错、非草稿记录拒绝发表。
 */

function keyStoreStub(): KeyStore {
  return { readWechatPublishSecret: () => 'test-secret' } as unknown as KeyStore
}

const FAST_POLL = { attempts: 3, pollIntervalMs: 1 }

async function setup(status: 'draft' | 'failed' = 'draft', externalDraftId?: string) {
  const database = new AppDatabase(':memory:')
  database.saveWechatPublishChannel({ appId: 'wx-test', enabled: true })
  const article = database.saveArticle({ materialIds: [], manualOutline: '', status: 'locked', rawMarkdown: '# 标题\n\n正文。', source: 'manual' })
  const layout = database.saveArticleLayout({
    articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: 'locked',
    platform: 'wechat', title: '排版稿', html: '<p>x</p>', plainText: 'x'
  })
  const service = new WechatPublishService(database, keyStoreStub(), {} as never, 'https://api.weixin.qq.com')
  const publication = database.createPublication({
    articleId: article.id, articleVersionId: article.currentVersionId, layoutId: layout.id,
    channelId: 'wechat-official', status, title: '标题', thumbMediaId: 'thumb', externalDraftId
  })
  return { database, service, publication }
}

function mockFetch(respond: (path: string, body: Record<string, unknown>) => Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown, init?: { body?: string }) => {
    const path = String(url)
    if (path.includes('/cgi-bin/token')) return Response.json({ access_token: 'token-1', expires_in: 7200 })
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(init?.body ?? '{}') as Record<string, unknown> } catch { body = {} }
    return Response.json(respond(path, body))
  })
}

describe('freepublish 发表状态机', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('成功：submit → get(status=0) 回填 msgid 与文章 URL，记录置 published', async () => {
    const { database, service, publication } = await setup('draft', 'MEDIA-1')
    const fetchMock = mockFetch((path, body) => {
      if (path.includes('/freepublish/submit')) { expect(body.media_id).toBe('MEDIA-1'); return { publish_id: 'PUB-1' } }
      if (path.includes('/freepublish/get')) return { publish_status: 0, article_id: 'MSG-9', article_detail: { item: [{ article_url: 'https://mp.weixin.qq.com/s/abc' }] } }
      throw new Error(`unexpected ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await service.freepublish({ publicationId: publication.id }, FAST_POLL)
    expect(result.status).toBe('published')
    expect(result.publishMsgid).toBe('MSG-9')
    expect(result.publishedUrl).toBe('https://mp.weixin.qq.com/s/abc')
    expect(database.getPublication(publication.id)?.publishMsgid).toBe('MSG-9')
    // submit/get 请求都带凭证（URL 查询串）
    expect(fetchMock).toHaveBeenCalledTimes(3) // token + submit + get
  })

  it('失败（publish_status=3）：报错并落 failed，不回填 msgid', async () => {
    const { database, service, publication } = await setup('draft', 'MEDIA-1')
    vi.stubGlobal('fetch', mockFetch((path) => {
      if (path.includes('/freepublish/submit')) return { publish_id: 'PUB-2' }
      if (path.includes('/freepublish/get')) return { publish_status: 3, fail_idx: 0 }
      throw new Error(`unexpected ${path}`)
    }))
    await expect(service.freepublish({ publicationId: publication.id }, FAST_POLL)).rejects.toThrow('发表失败')
    const record = database.getPublication(publication.id)!
    expect(record.status).toBe('failed')
    expect(record.publishMsgid).toBeUndefined()
  })

  it('窗口内未出结果：落 unknown 并登记 publishTask，checkFreepublish 续查成功', async () => {
    const { database, service, publication } = await setup('draft', 'MEDIA-1')
    let getStatus = 1
    vi.stubGlobal('fetch', mockFetch((path) => {
      if (path.includes('/freepublish/submit')) return { publish_id: 'PUB-3' }
      if (path.includes('/freepublish/get')) return { publish_status: getStatus }
      throw new Error(`unexpected ${path}`)
    }))
    // 第一次发表：轮询窗口内一直是「推送中」→ 落 unknown 可续查
    await expect(service.freepublish({ publicationId: publication.id }, FAST_POLL)).rejects.toThrow('核对发表结果')
    const unknown = database.getPublication(publication.id)!
    expect(unknown.status).toBe('unknown')
    expect(database.workflow.getResolution(publication.id)?.publishTask?.publishId).toBe('PUB-3')
    // 公众号侧出结果 → 续查打通
    getStatus = 0
    const resolved = await service.checkFreepublish({ publicationId: publication.id }, FAST_POLL)
    expect(resolved.status).toBe('published')
    expect(resolved.publishMsgid).toBe('PUB-3')
  })

  it('无权限（48001）：报错带可读提示并落 failed，不落 unknown', async () => {
    const { database, service, publication } = await setup('draft', 'MEDIA-1')
    vi.stubGlobal('fetch', mockFetch((path) => {
      if (path.includes('/freepublish/submit')) return { errcode: 48001, errmsg: 'api unauthorized' }
      throw new Error(`unexpected ${path}`)
    }))
    await expect(service.freepublish({ publicationId: publication.id }, FAST_POLL)).rejects.toThrow('没有「发表」权限')
    expect(database.getPublication(publication.id)!.status).toBe('failed')
  })

  it('非草稿记录拒绝发表；无 publishTask 的记录拒绝续查', async () => {
    const { service, publication: failed } = await setup('failed')
    await expect(service.freepublish({ publicationId: failed.id })).rejects.toThrow('只有已成功推送草稿箱')
    const { service: service2, publication: draft } = await setup('draft', 'MEDIA-2')
    await expect(service2.checkFreepublish({ publicationId: draft.id })).rejects.toThrow('没有进行中的发表任务')
  })
})
