import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedHotService } from '../src/main/services/embedded-hot-service.js'
import { HotspotService } from '../src/main/services/hotspot-service.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function embeddedStub(): EmbeddedHotService {
  return {
    start: async () => 'http://127.0.0.1:45678',
    status: () => ({
      mode: 'embedded',
      state: 'ready',
      version: '2.0.8',
      routeCount: 2
    })
  } as EmbeddedHotService
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HotspotService', () => {
  it('discovers sources and normalizes upstream items without rewriting titles', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/all')) {
        return jsonResponse({
          code: 200,
          routes: [
            { name: 'ithome', path: '/ithome' },
            { name: 'bilibili', path: '/bilibili' }
          ]
        })
      }
      return jsonResponse({
        code: 200,
        title: 'IT之家',
        updateTime: '2026-07-28T02:00:00.000Z',
        data: [
          {
            id: 42,
            title: '原样保留的热点标题',
            desc: '描述',
            hot: 125_000,
            url: 'https://example.com/item'
          }
        ]
      })
    })
    vi.stubGlobal('fetch', request)

    const service = new HotspotService(embeddedStub())
    const bootstrap = await service.bootstrap()
    const [result] = await service.refresh(['ithome'])

    expect(bootstrap.sources.map((source) => source.id)).toEqual(['bilibili', 'ithome'])
    expect(result.status).toBe('ready')
    expect(result.items[0]).toMatchObject({
      id: '42',
      title: '原样保留的热点标题',
      hotValue: '13万',
      source: 'ithome',
      rank: 1
    })
  })

  it('isolates a broken platform as an error result', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/all')) {
        return jsonResponse({
          code: 200,
          routes: [{ name: 'weibo', path: '/weibo' }]
        })
      }
      return new Response('<html>upstream failed</html>', {
        status: 500,
        headers: { 'content-type': 'text/html' }
      })
    }))

    const service = new HotspotService(embeddedStub())
    await service.bootstrap()
    const [result] = await service.refresh(['weibo'])

    expect(result.status).toBe('error')
    expect(result.items).toEqual([])
    expect(result.error).toBe('微博限制匿名访问')
  })

  it('falls back to the current Baidu page structure when the bundled parser returns no items', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/all')) {
        return jsonResponse({
          code: 200,
          routes: [{ name: 'baidu', path: '/baidu' }]
        })
      }
      if (url.includes('top.baidu.com')) {
        return new Response(
          '<!--s-data:{"currentBoard":{"cards":[{"content":[{"content":[{"index":1,"word":"百度热点","url":"https://m.baidu.com/s?word=test","hotScore":123456}]}]}]}}-->',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
        )
      }
      return jsonResponse({ code: 200, title: '百度', data: [] })
    }))

    const service = new HotspotService(embeddedStub())
    await service.bootstrap()
    const [result] = await service.refresh(['baidu'])

    expect(result.status).toBe('ready')
    expect(result.items[0]).toMatchObject({
      title: '百度热点',
      rank: 1,
      hotValue: '12万'
    })
  })
})
