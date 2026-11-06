import { describe, expect, it, vi } from 'vitest'

// 注意：本文件被 tsconfig.node.json exclude——被测对象是 renderer 文件
// （依赖 DOMPurify / 无扩展名导入），拉进 node 工程会破坏其 include 边界；
// vitest 仍然运行本文件（esbuild 转译不受 tsconfig include 影响）。
// sanitizeHtml 依赖 DOMPurify（需要浏览器 DOM），node 测试环境不可用；
// 这里只验证文档构造本身，sanitize 行为由运行时 DOMPurify 配置保证。
vi.mock('../src/renderer/src/lib', () => ({ sanitizeHtml: (html: string) => html }))

const { layoutPreviewDocument } = await import('../src/renderer/src/components/layout/preview-document.js')

/**
 * 预览文档构造测试（阶段二"预览保真"验收）。
 *
 * 预览的价值在于接近微信真机环境：正文容器要带上微信基础样式模拟，
 * 让"漏写重置/字号"的排版稿在预览里显形；暗色预览用 #191919 底色近似。
 */

describe('排版预览文档', () => {
  const html = '<article><p><span leaf="">正文</span></p></article>'

  it('注入微信基础样式模拟容器（17px 基准 + p 默认边距）', () => {
    const doc = layoutPreviewDocument(html)
    expect(doc).toContain('id="mly-wx-base"')
    expect(doc).toContain('font-size: 17px')
    expect(doc).toContain('#mly-wx-base p { margin: 0 0 1em; }')
    expect(doc).toContain('<div id="mly-wx-base">')
    expect(doc).toContain(html)
  })

  it('默认浅色底', () => {
    expect(layoutPreviewDocument(html)).toContain('background:#fff')
    expect(layoutPreviewDocument(html, {})).toContain('background:#fff')
  })

  it('暗色预览切到微信暗黑模式底色 #191919', () => {
    expect(layoutPreviewDocument(html, { dark: true })).toContain('background:#191919')
    expect(layoutPreviewDocument(html, { dark: true })).not.toContain('background:#fff')
  })

  it('保留 CSP 与 viewport（预览 iframe 的安全边界不变）', () => {
    const doc = layoutPreviewDocument(html)
    expect(doc).toContain("Content-Security-Policy")
    expect(doc).toContain("img-src data: http: https: moliu-asset:")
    expect(doc).toContain('width=device-width, initial-scale=1')
  })
})
