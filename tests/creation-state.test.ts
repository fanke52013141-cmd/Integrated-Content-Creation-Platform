import { describe, expect, it } from 'vitest'
import { isRecentlyUsedTheme, orderThemesByRecency } from '../src/shared/creation-state.js'

/**
 * 主题「最近使用置顶」排序测试（阶段五 6.1 动线收敛）。
 *
 * 排序是纯展示层行为：置顶的主题必须仍然存在于原清单、
 * 未命中的保持原顺序、输入里的空值/重复/未知 id 都不能破坏结果。
 */

const themes = [
  { id: 'wechat-green', name: '微信经典' },
  { id: 'magazine', name: '杂志衬线' },
  { id: 'tech-blue', name: '科技蓝' },
  { id: 'warm-paper', name: '暖纸' },
  { id: 'minimal', name: '极简黑白' }
]

describe('主题最近使用置顶', () => {
  it('最近使用的主题排到最前，且按新旧顺序排列', () => {
    const ordered = orderThemesByRecency(themes, ['tech-blue', 'magazine'])
    expect(ordered.map(theme => theme.id)).toEqual(['tech-blue', 'magazine', 'wechat-green', 'warm-paper', 'minimal'])
  })

  it('未命中置顶的选项保持原顺序', () => {
    const ordered = orderThemesByRecency(themes, ['minimal'])
    expect(ordered.map(theme => theme.id)).toEqual(['minimal', 'wechat-green', 'magazine', 'tech-blue', 'warm-paper'])
  })

  it('空清单 / 空记录时保持原顺序', () => {
    expect(orderThemesByRecency(themes, []).map(theme => theme.id)).toEqual(themes.map(theme => theme.id))
    expect(orderThemesByRecency(themes, [undefined, null, '']).map(theme => theme.id)).toEqual(themes.map(theme => theme.id))
  })

  it('重复与未知 id 不产生副作用（不丢主题、不重复）', () => {
    const ordered = orderThemesByRecency(themes, ['tech-blue', 'tech-blue', 'not-a-theme'])
    expect(ordered.map(theme => theme.id)).toEqual(['tech-blue', 'wechat-green', 'magazine', 'warm-paper', 'minimal'])
    expect(ordered.length).toBe(themes.length)
  })

  it('isRecentlyUsedTheme 只认首个出现的命中顺序（去重语义一致）', () => {
    expect(isRecentlyUsedTheme(['magazine'], 'magazine')).toBe(true)
    expect(isRecentlyUsedTheme(['magazine'], 'wechat-green')).toBe(false)
    expect(isRecentlyUsedTheme([], 'magazine')).toBe(false)
    expect(isRecentlyUsedTheme([undefined], 'magazine')).toBe(false)
  })
})
