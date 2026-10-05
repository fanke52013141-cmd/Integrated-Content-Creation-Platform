import { describe, expect, it } from 'vitest'
import { isNumericCell, markNumericCells, annotateWideTables } from '../src/main/services/layout-table.js'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'
import { hasBlockingViolation, validateWechatLayout } from '../src/main/services/layout-validator.js'

/**
 * 表格增强测试。
 *
 * 背景：微信里表格有两个固有问题——窄屏横向溢出、数字列左对齐难对比。
 * 这里验证数值列识别与宽表格提示是否正确。
 */

describe('数值单元格识别', () => {
  it.each([
    ['30', true],
    ['3.14', true],
    ['1,234', true],
    ['1,234.56', true],
    ['45%', true],
    ['-8', true],
    ['+5', true],
    ['¥100', true],
    ['$1,000', true],
    ['3 天', false],
    ['约 30 天', false],
    ['3 门', false],
    ['第一章', false],
    ['A', false],
    ['', false],
    ['   ', false]
  ])('%s → %s', (input, expected) => {
    expect(isNumericCell(input)).toBe(expected)
  })

  it('含中文标点的说明文字不算数值', () => {
    expect(isNumericCell('3,000 以上（含税）')).toBe(false)
    expect(isNumericCell('第一部分：3 章')).toBe(false)
  })

  it('带 HTML 标签的内容按纯文本判断', () => {
    expect(isNumericCell('<strong>30</strong>')).toBe(true)
    expect(isNumericCell('<em>30 天</em>')).toBe(false)
  })
})

describe('表格标记', () => {
  it('纯数字单元格被标记', () => {
    const html = '<table><tr><td>30</td><td>三天</td></tr></table>'
    const out = markNumericCells(html)
    expect(out).toContain('mly-num')
    expect(out).toMatch(/mly-num[^>]*>30</)
  })

  it('表头不被标记', () => {
    const html = '<table><tr><th>30</th></tr></table>'
    expect(markNumericCells(html)).not.toContain('mly-num')
  })

  it('已有标记的不重复添加', () => {
    const once = markNumericCells('<table><tr><td>30</td></tr></table>')
    expect(markNumericCells(once)).toBe(once)
  })

  it('无表格时原样返回', () => {
    const html = '<p>没有表格</p>'
    expect(markNumericCells(html)).toBe(html)
  })
})

describe('宽表格提示', () => {
  it('超过 4 列时加滑动提示', () => {
    const cells = Array.from({ length: 6 }, () => '<td>x</td>').join('')
    const html = `<table><tr>${cells}</tr></table>`
    const out = annotateWideTables(html)
    expect(out).toContain('表格共 6 列')
    expect(out).toContain('左右滑动')
  })

  it('4 列及以下不加提示（手机能放下）', () => {
    const cells = Array.from({ length: 4 }, () => '<td>x</td>').join('')
    expect(annotateWideTables(`<table><tr>${cells}</tr></table>`)).not.toContain('左右滑动')
  })

  it('提示是 p 而非 div（微信会过滤 div）', () => {
    const cells = Array.from({ length: 8 }, () => '<td>x</td>').join('')
    const out = annotateWideTables(`<table><tr>${cells}</tr></table>`)
    expect(out).toContain('<p')
    expect(out).not.toMatch(/<div/)
  })
})

describe('真实表格排版', () => {
  const dataTable = [
    '# 2024 年国考职位表',
    '',
    '| 职位 | 招录人数 | 竞争比 |',
    '| --- | --- | --- |',
    '| 海关总署 | 30 | 145:1 |',
    '| 税务系统 | 1200 | 55:1 |',
    '| 统计局 | 8 | 320:1 |',
    '',
    '| 地区 | 通过率 | 薪资 |',
    '| --- | --- | --- |',
    '| 北京 | 12% | 25k |',
    '| 河南 | 8% | 15k |'
  ].join('\n')

  it('表格排版后数值列右对齐样式已内联', () => {
    const { html } = renderLayoutMarkdown(dataTable, 'wechat', 'wechat-green')
    // mly-num 的样式（text-align:right）应已内联到 td
    expect(html).toMatch(/text-align:\s*right/i)
  })

  it('单元格可换行（word-break 已内联）', () => {
    const { html } = renderLayoutMarkdown(dataTable, 'wechat', 'wechat-green')
    expect(html).toMatch(/word-break:\s*break-word/i)
  })

  it('表格排版后无阻断性违规', () => {
    const { html, title } = renderLayoutMarkdown(dataTable, 'wechat', 'wechat-green')
    const violations = validateWechatLayout({ html, title })
    const errors = violations.filter((v) => v.level === 'error')
    expect(errors.map((e) => `${e.rule}: ${e.message}`), html.slice(0, 300)).toEqual([])
    expect(hasBlockingViolation(violations)).toBe(false)
  })

  it('class 已剥除但样式保留（微信兼容的平衡点）', () => {
    const { html } = renderLayoutMarkdown(dataTable, 'wechat', 'wechat-green')
    expect(html).not.toContain('mly-num"')
    // 但右对齐样式必须在
    expect(html).toMatch(/text-align:\s*right/i)
  })

  it('小红书平台的表格不做微信增强', () => {
    const { html } = renderLayoutMarkdown(dataTable, 'xiaohongshu', 'wechat-green')
    expect(html).not.toContain('左右滑动')
  })
})
