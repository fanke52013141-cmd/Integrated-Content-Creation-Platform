import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import {
  extractArticleFromHtml,
  isBlockedHostname,
  isPrivateOrReservedIp,
  UrlMaterialService
} from '../src/main/services/url-material-service.js'

describe('Batch C: URL material clipper & SSRF guard', () => {
  it('blocks localhost, private IPv4/IPv6, and non-http protocols', () => {
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('127.0.0.1')).toBe(true)
    expect(isBlockedHostname('192.168.1.10')).toBe(true)
    expect(isBlockedHostname('10.0.0.5')).toBe(true)
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('::1')).toBe(true)
    expect(isBlockedHostname('example.com')).toBe(false)
  })

  it('extractArticleFromHtml strips scripts/nav and prioritizes WeChat #js_content / article', () => {
    const html = `
      <html>
        <head><title>网页标题</title><meta property="og:site_name" content="测试号" /></head>
        <body>
          <nav>导航菜单不应提取</nav>
          <script>alert('xss')</script>
          <div id="js_content">
            <h2>核心观察</h2>
            <p>第一段高质量正文内容，记录真实调研结论。</p>
            <p>第二段补充案例与细节说明。</p>
          </div>
        </body>
      </html>
    `
    const parsed = extractArticleFromHtml(html, 'https://mp.weixin.qq.com/s/test')
    expect(parsed.title).toBe('网页标题')
    expect(parsed.siteName).toBe('测试号')
    expect(parsed.content).toContain('第一段高质量正文内容')
    expect(parsed.content).not.toContain('导航菜单不应提取')
    expect(parsed.content).not.toContain('alert')
  })

  it('UrlMaterialService rejects private DNS rebinding and saves full text document on success', async () => {
    const db = new AppDatabase(':memory:')
    try {
      const blockedService = new UrlMaterialService(
        db,
        async () => new Response('ok'),
        async () => ['10.0.0.2']
      )
      await expect(blockedService.importFromUrl({ url: 'https://internal.example.com/report' })).rejects.toThrow('内网地址')

      const okHtml = '<html><head><title>Deep Research 报告</title></head><body><article><p>这是一份从外部 Deep Research 导出的深度行业分析正文，包含完整的背景与结论。</p></article></body></html>'
      const okService = new UrlMaterialService(
        db,
        async () => new Response(okHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
        async () => ['93.184.216.34']
      )
      const saved = await okService.importFromUrl({ url: 'https://example.com/deep-research' })
      expect(saved.title).toBe('Deep Research 报告')
      expect(saved.sourceUrl).toBe('https://example.com/deep-research')
      expect(db.workflow.getDocument(saved.id)?.content).toContain('深度行业分析正文')
    } finally {
      db.close()
    }
  })
})
