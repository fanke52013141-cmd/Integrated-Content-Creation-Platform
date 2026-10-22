import { describe, expect, it } from 'vitest'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'

describe('排版交付边界', () => {
  it('只提取首个一级标题，保留正文后续的 Markdown 标题和图文元素', () => {
    const result = renderLayoutMarkdown([
      '# 主标题',
      '',
      '**重点**与[链接](https://example.com)。',
      '',
      '![示意图](https://example.com/image.png)',
      '',
      '| 项目 | 值 |',
      '| --- | --- |',
      '| 状态 | 完成 |',
      '',
      '# 正文中的一级小节'
    ].join('\n'), 'web', 'wechat-green')

    expect(result.title).toBe('主标题')
    expect(result.html).toMatch(/<strong[^>]*>重点<\/strong>/)
    expect(result.html).toContain('https://example.com')
    expect(result.html).toContain('https://example.com/image.png')
    expect(result.html).toContain('<table')
    expect(result.html).toContain('正文中的一级小节')
  })

  it('微信公众号标题默认独立，品牌文案进入输出副本且被转义', () => {
    const source = '# 正式标题\n\n正文。'
    const result = renderLayoutMarkdown(source, 'wechat', 'wechat-green', undefined, { brandHeaderText: '<品牌>', brandFooterText: '固定署名' })
    expect(result.title).toBe('正式标题')
    expect(result.html).not.toContain('<h1')
    expect(result.html).toContain('&lt;品牌&gt;')
    expect(result.html).toMatch(/<section[^>]*border-left:[^>]*>[\s\S]*?&lt;品牌&gt;/)
    expect(result.plainText).toBe('<品牌>\n\n正文。\n\n固定署名')
    const withTitle = renderLayoutMarkdown(source, 'wechat', 'wechat-green', undefined, { showTitleInBody: true })
    expect(withTitle.html).toMatch(/<h1[^>]*>(?:<span leaf="">)?正式标题(?:<\/span>)?<\/h1>/)
    expect(source).toBe('# 正式标题\n\n正文。')
  })

  it('代码围栏里的一级标题不参与标题提取，链接脚注保留行内结构', () => {
    const result = renderLayoutMarkdown('```text\n# 示例代码\n```\n\n# 正式标题\n\n[**加粗**与 `code`](https://example.com/path)', 'wechat')
    expect(result.title).toBe('正式标题')
    expect(result.html).toContain('# 示例代码')
    expect(result.html).toMatch(/<strong[^>]*>(?:<span leaf="">)?加粗(?:<\/span>)?<\/strong>/)
    expect(result.html).toMatch(/<code[^>]*>(?:<span leaf="">)?code(?:<\/span>)?<\/code>/)
    expect(result.html).toContain('<sup')
    expect(result.html).toContain('https://example.com/path')
  })

  it('图片的替代文本和可见图注保留可读内容，不把 Markdown 强调符号当文字', () => {
    const result = renderLayoutMarkdown('# 图片\n\n![**可读图注**](https://example.com/img.png)', 'wechat')
    expect(result.html).toContain('alt="可读图注"')
    expect(result.html).toMatch(/<span style="[^"]*font-size: 12px[^"]*"><span leaf="">可读图注<\/span><\/span>/)
    expect(result.html).not.toContain('**可读图注**')
  })
})
