import { describe, expect, it } from 'vitest'
import {
  ARTICLE_GENRES,
  DEFAULT_LAYOUT_THEME_ID,
  LAYOUT_THEMES,
  recommendThemeForGenre,
  themesForGenre
} from '../src/main/services/layout-themes.js'
import type { ArticleGenre } from '../src/shared/contracts.js'

/**
 * 主题元信息与推荐逻辑测试。
 *
 * 核心问题：用户面对 5 个色块盲选。P3 的解法是让他先选"文章类型"，
 * 所以推荐逻辑必须覆盖全部类型、且不能推荐到不适配的主题。
 */

describe('P3 主题元信息', () => {
  it('每个主题都有 suitedFor 与 personality（元信息完整）', () => {
    for (const theme of LAYOUT_THEMES) {
      expect(theme.suitedFor.length, `${theme.id} 缺suitedFor`).toBeGreaterThan(0)
      expect(theme.personality.length, `${theme.id} 缺 personality`).toBeGreaterThan(0)
    }
  })

  it('suitedFor 只能引用已定义的类型', () => {
    const validIds = new Set(ARTICLE_GENRES.map((genre) => genre.id))
    for (const theme of LAYOUT_THEMES) {
      for (const genre of theme.suitedFor) {
        expect(validIds.has(genre), `${theme.id} 引用了未定义类型 ${genre}`).toBe(true)
      }
    }
  })

  it('主题 id 唯一', () => {
    const ids = LAYOUT_THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个主题的 personality 互不相同（否则无法区分相似主题）', () => {
    const list = LAYOUT_THEMES.map((theme) => theme.personality)
    expect(new Set(list).size).toBe(list.length)
  })

  it('全部主题都至少适配一种类型（不能有孤儿主题）', () => {
    const allGenres = new Set(ARTICLE_GENRES.map((genre) => genre.id))
    for (const genre of allGenres) {
      expect(themesForGenre(genre).length, `类型 ${genre} 没有适配主题`).toBeGreaterThan(0)
    }
  })
})

describe('按文章类型推荐主题', () => {
  it('每个类型都能推荐出主题', () => {
    for (const { id } of ARTICLE_GENRES) {
      const themeId = recommendThemeForGenre(id)
      expect(themeId, `类型 ${id} 无推荐`).toBeTruthy()
      expect(LAYOUT_THEMES.some((theme) => theme.id === themeId)).toBe(true)
    }
  })

  it('推荐的主题必定适配该类型', () => {
    for (const { id } of ARTICLE_GENRES) {
      const theme = LAYOUT_THEMES.find((item) => item.id === recommendThemeForGenre(id))
      expect(theme?.suitedFor, `类型 ${id} 推到了不适配的主题`).toContain(id)
    }
  })

  it('教程类推荐 wechat-green（百搭安全的选择）', () => {
    expect(recommendThemeForGenre('tutorial')).toBe('wechat-green')
  })

  it('专业科技类推荐克制的主题', () => {
    const id = recommendThemeForGenre('professional')
    const theme = LAYOUT_THEMES.find((item) => item.id === id)
    expect(['tech-blue', 'minimal']).toContain(id)
  })

  it('深度分析与叙事类推荐 magazine（衬线长文排版）', () => {
    expect(recommendThemeForGenre('analysis')).toBe('magazine')
    expect(recommendThemeForGenre('narrative')).toBe('magazine')
  })

  it('未指定类型时回落到默认主题', () => {
    expect(recommendThemeForGenre(undefined)).toBe(DEFAULT_LAYOUT_THEME_ID)
  })

  it('未知类型不抛错，回落到默认主题', () => {
    const bogus = 'not-a-genre' as ArticleGenre
    expect(recommendThemeForGenre(bogus)).toBe(DEFAULT_LAYOUT_THEME_ID)
  })

  it('候选列表全部适配该类型', () => {
    for (const { id } of ARTICLE_GENRES) {
      const candidates = themesForGenre(id)
      for (const candidateId of candidates) {
        const theme = LAYOUT_THEMES.find((item) => item.id === candidateId)
        expect(theme?.suitedFor, `${candidateId} 不适配 ${id} 却在候选里`).toContain(id)
      }
    }
  })

  it('未指定类型时候选是全部主题', () => {
    expect(themesForGenre(undefined).length).toBe(LAYOUT_THEMES.length)
  })

  it('推荐结果是确定的（同类型两次调用一致）', () => {
    for (const { id } of ARTICLE_GENRES) {
      expect(recommendThemeForGenre(id)).toBe(recommendThemeForGenre(id))
    }
  })
})
