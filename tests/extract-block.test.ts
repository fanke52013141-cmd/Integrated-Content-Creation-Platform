import { describe, expect, it } from 'vitest'
import { extractTaggedBlock } from '../src/main/gateway/extract-block.js'

describe('extractTaggedBlock', () => {
  it('returns the last block by default', () => {
    const result = extractTaggedBlock(
      '草稿<账号定位>第一版</账号定位>最终<账号定位>第二版</账号定位>',
      { tag: '账号定位' }
    )
    expect(result).toEqual({ matched: true, value: '第二版' })
  })

  it('supports all occurrences', () => {
    const result = extractTaggedBlock(
      '<意见>甲</意见>\n<意见 level="high">乙</意见>',
      { tag: '意见', occurrence: 'all' }
    )
    expect(result.value).toEqual(['甲', '乙'])
  })

  it('does not treat the tag as a regular expression', () => {
    const result = extractTaggedBlock('<a+b>值</a+b>', { tag: 'a+b' })
    expect(result.value).toBe('值')
  })
})
