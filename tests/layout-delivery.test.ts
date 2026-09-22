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
})
