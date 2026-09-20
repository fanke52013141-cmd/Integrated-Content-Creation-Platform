import { describe, expect, it } from 'vitest'
import { diffLines } from '../src/shared/text-diff.js'

const flatten = (rows: Array<{ kind: string; text: string }>): string[] =>
  rows.map((row) => `${row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '}${row.text}`)

describe('正文逐行差异', () => {
  it('完全相同的内容不产生增删行', () => {
    const text = '# 标题\n\n第一段。\n\n第二段。'
    expect(diffLines(text, text).every((row) => row.kind === 'equal')).toBe(true)
  })

  it('只改中间一段时，前后段落保持为未变行', () => {
    const before = '# 标题\n\n开头段。\n\n中段原样。\n\n结尾段。'
    const after = '# 标题\n\n开头段。\n\n中段改过了。\n\n结尾段。'
    expect(flatten(diffLines(before, after))).toEqual([
      ' # 标题',
      ' ',
      ' 开头段。',
      ' ',
      '-中段原样。',
      '+中段改过了。',
      ' ',
      ' 结尾段。'
    ])
  })

  it('新增与删除分别计数，供界面直接展示', () => {
    const before = '# 标题\n\n旧的一句。'
    const after = '# 标题\n\n新的一句。\n\n又多了一段。'
    const rows = diffLines(before, after)
    expect(rows.filter((row) => row.kind === 'removed').map((row) => row.text)).toEqual(['旧的一句。'])
    expect(rows.filter((row) => row.kind === 'added').map((row) => row.text).filter(Boolean)).toEqual(['新的一句。', '又多了一段。'])
  })

  it('超长文本退化为整段替换，不会把主线程算死', () => {
    const before = Array.from({ length: 3_000 }, (_, index) => `旧行 ${index}`).join('\n')
    const after = Array.from({ length: 3_000 }, (_, index) => `新行 ${index}`).join('\n')
    const started = Date.now()
    const rows = diffLines(before, after)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(rows.filter((row) => row.kind === 'removed')).toHaveLength(3_000)
    expect(rows.filter((row) => row.kind === 'added')).toHaveLength(3_000)
  })

  it('CRLF 与 LF 混用时不会整篇判为改动', () => {
    expect(diffLines('a\r\nb\r\nc', 'a\nb\nc').every((row) => row.kind === 'equal')).toBe(true)
  })
})
