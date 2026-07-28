import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaterialSearchService } from '../src/main/services/material-search-service.js'

const database = {
  getSearchService: () => ({ enabled: true })
}
const keyStore = { readSearchService: () => 'test-key' }

describe('MaterialSearchService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps only Summary for web results and maps source metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ResponseMetadata: { RequestId: 'request-1' },
      Result: { LogId: 'log-1', WebResults: [{
        Id: 'web-1', Title: '网页标题', Url: 'https://example.com/article', SiteName: '示例站点',
        Snippet: '短预览', Summary: '给 AI 使用的长摘要', Content: '绝不能保存的全文',
        PublishTime: '2026-07-28T00:00:00+08:00', RankScore: 0.92, AuthInfoDes: '非常权威'
      }] }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new MaterialSearchService(database as never, keyStore as never, 'https://search.example.com')
    const result = await service.search({ query: '人工智能', type: 'web', count: 10 })
    expect(fetchMock).toHaveBeenCalledWith('https://search.example.com', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).Filter).toMatchObject({ NeedContent: true, NeedUrl: true })
    expect(result.results).toEqual([expect.objectContaining({ summary: '给 AI 使用的长摘要', sourceName: '示例站点', authority: '非常权威' })])
    expect(JSON.stringify(result)).not.toContain('绝不能保存的全文')
  })

  it('maps image references and surfaces quota errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ResponseMetadata: { RequestId: 'request-2' },
      Result: { ImageResults: [{
        Id: 'image-1', Title: '图片', Url: 'https://example.com/page', SiteName: '示例图站',
        Image: { Url: 'https://example.com/image.jpg', Width: 1200, Height: 800, Shape: '横长方形', Watermark: '1' }
      }] }
    }), { status: 200 })))
    const service = new MaterialSearchService(database as never, keyStore as never, 'https://search.example.com')
    const image = await service.search({ query: '科技办公桌', type: 'image' })
    expect(image.results).toEqual([expect.objectContaining({ imageUrl: 'https://example.com/image.jpg', watermark: '1' })])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ResponseMetadata: { Error: { Code: '10406' } }, Result: null
    }), { status: 200 })))
    await expect(service.search({ query: '测试', type: 'web' })).rejects.toThrow('免费额度已耗尽')
  })
})
