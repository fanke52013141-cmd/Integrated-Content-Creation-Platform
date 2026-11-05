import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { WechatPublishService } from '../src/main/services/wechat-publish-service.js'
import type { KeyStore } from '../src/main/security/key-store.js'

/**
 * H1 阅读数据回填脚手架测试：mock 微信 HTTP 层，
 * 验证 datacube 拉取 → metrics 写入复盘的 happy path 与"无 msgid"的明确报错。
 */

function keyStoreStub(): KeyStore {
  return { readWechatPublishSecret: () => 'test-secret' } as unknown as KeyStore
}

async function setup() {
  const database = new AppDatabase(':memory:')
  database.saveWechatPublishChannel({ appId: 'wx-test', enabled: true })
  const article = database.saveArticle({
    materialIds: [], manualOutline: '大纲', status: 'locked', rawMarkdown: '# 标题\n\n正文。', source: 'manual'
  })
  const layout = database.saveArticleLayout({
    articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: 'locked',
    platform: 'wechat', title: '排版稿', html: '<p>x</p>', plainText: 'x'
  })
  const service = new WechatPublishService(database, keyStoreStub(), {} as never, 'https://api.weixin.qq.com')
  const publication = database.createPublication({
    articleId: article.id, articleVersionId: article.currentVersionId, layoutId: layout.id,
    channelId: 'wechat-official', status: 'published', title: '标题', thumbMediaId: 'thumb'
  })
  return { database, service, publication }
}

describe('公众号阅读数据回填脚手架（H1）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('未登记 msgid 时给出明确指引，而不是静默返回空数据', async () => {
    const { service, publication } = await setup()
    await expect(service.refreshMetrics(publication.id)).rejects.toThrow('尚未登记发表态消息 ID')
  })

  it('happy path：datacube 数据按 msgid 命中后只更新复盘 metrics，不覆盖手填复盘', async () => {
    const { database, service, publication } = await setup()
    database.setPublicationPublishMsgid(publication.id, 'msg-001')
    database.savePublicationRetro(publication.id, { goal: '涨粉', result: '待观察', lesson: '' })

    const fetchMock = vi.fn(async (url: unknown) => {
      const path = String(url)
      if (path.includes('/cgi-bin/token')) {
        return Response.json({ access_token: 'token-1', expires_in: 7200 })
      }
      expect(path).toContain('/datacube/getarticletotal')
      return Response.json({ list: [
        { msgid: 'msg-other', int_page_read_count: 999, date: '2026-11-03' },
        { msgid: 'msg-001', int_page_read_count: 120, int_page_share_count: 9, date: '2026-11-03' },
        { msgid: 'msg-001', int_page_read_count: 150, int_page_share_count: 12, date: '2026-11-04' }
      ] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const updated = await service.refreshMetrics(publication.id)
    // 取窗口内最新一天的数据
    expect(updated.retro?.metrics).toMatchObject({ reads: 150, shares: 12, cutoff: '2026-11-04' })
    // 用户手填的复盘目标/结果被保留
    expect(updated.retro?.goal).toBe('涨粉')
    expect(updated.retro?.result).toBe('待观察')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('统计接口未返回该文章时给出隔天出数的提示', async () => {
    const { database, service, publication } = await setup()
    database.setPublicationPublishMsgid(publication.id, 'msg-001')
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('/cgi-bin/token')) return Response.json({ access_token: 'token-1', expires_in: 7200 })
      return Response.json({ list: [{ msgid: 'msg-other', int_page_read_count: 1, date: '2026-11-03' }] })
    }))
    await expect(service.refreshMetrics(publication.id)).rejects.toThrow('隔天才有统计')
  })
})
