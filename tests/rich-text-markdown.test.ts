import { describe, expect, it } from 'vitest'
import { supportsBasicRichText } from '../src/shared/rich-text-markdown.js'

describe('visual rich text Markdown safety gate', () => {
  it('accepts only the flat Markdown subset the editor can serialize', () => {
    expect(supportsBasicRichText('# 标题\n\n正文 **加粗**、*斜体*、~~删除~~、`代码`。\n\n- 一项\n- 二项\n\n> 引用\n\n![图](moliu-asset://image)')).toBe(true)
  })

  it('keeps complex Markdown in source mode instead of flattening it', () => {
    expect(supportsBasicRichText('~~~text\n代码\n~~~')).toBe(false)
    expect(supportsBasicRichText('名称 | 数量\n--- | ---\n苹果 | 2')).toBe(false)
    expect(supportsBasicRichText('- 外层\n  - 内层')).toBe(false)
    expect(supportsBasicRichText('3. 从第三项开始')).toBe(false)
    expect(supportsBasicRichText('<section>原始 HTML</section>')).toBe(false)
  })
})
