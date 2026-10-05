import { describe, expect, it } from 'vitest'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'
import { hasBlockingViolation, validateWechatLayout } from '../src/main/services/layout-validator.js'

/**
 * 版式组件测试。
 *
 * 三条底线，任何一条不满足都是不可接受的缺陷：
 * 1. 组件能渲染成预期的结构
 * 2. 组件产物能通过合规校验（不会引入新的格式丢失方式）
 * 3. 语法写错时降级而非报错（不能因一个符号让整篇文章渲染失败）
 */

const render = (md: string) => renderLayoutMarkdown(md, 'wechat', 'wechat-green')

describe('P2 版式组件', () => {
  describe('提示块 ::: tip / warn / key', () => {
    // 注意：P1 会剥除 class（微信强制移除非内联属性），因此断言一律用样式特征定位，
    // 不能依赖 class 名——那是中间态的产物
    const CALLOUT = /<section style="[^"]*border-left:\s*4px solid[^"]*">/
    const LEAD = /<section style="[^"]*border-radius:\s*0 8px 8px 0[^"]*">/

    it('tip 渲染提示块并带「提示」标签', () => {
      const { html } = render('# T\n\n::: tip 这是补充说明\n:::\n')
      expect(html).toMatch(CALLOUT)
      expect(html).toContain('提示')
    })

    it('warn / key 使用不同标签文字', () => {
      expect(render('# T\n\n::: warn 小心\n:::\n').html).toContain('注意')
      expect(render('# T\n\n::: key 核心\n:::\n').html).toContain('重点')
    })

    it('组件样式已内联，且不残留自定义标签', () => {
      const { html } = render('# T\n\n::: tip 说明\n:::\n')
      // 内联样式在（微信只认内联）
      expect(html).toMatch(/<section style="[^"]*border-left[^"]*">/)
      // 自定义标签不能残留在产物里
      expect(html).not.toMatch(/<mly-/)
      // class 已被剥除（P1 的微信兼容处理）
      expect(html).not.toContain('mly-callout"')
    })

    it('内容保留完整', () => {
      const { html } = render('# T\n\n::: key 三个月的正确姿势\n:::\n')
      expect(html).toContain('三个月的正确姿势')
    })
  })

  describe('引言卡 ::: lead', () => {
    it('渲染引言卡，不带提示标签', () => {
      const { html } = render('# T\n\n::: lead 开篇的核心判断\n:::\n')
      // 引言卡与提示块视觉同构，区别在于不带类型标签
      expect(html).toContain('开篇的核心判断')
      expect(html).not.toContain('提示')
      expect(html).not.toContain('重点')
    })
  })

  describe('目录 [[toc]]', () => {
    const longArticle = [
      '# 标题', '', '[[toc]]', '',
      '## 第一章', '内容', '## 第二章', '内容', '### 小节', '内容', '## 第三章', '内容'
    ].join('\n')

    it('生成目录并汇总二三级标题', () => {
      const { html } = render(longArticle)
      expect(html).toContain('本文目录')
      expect(html).toContain('第一章')
      expect(html).toContain('小节')
      expect(html).not.toContain('mly-toc-marker')
    })

    it('标题不足 3 个时不生成目录（价值不大，降级）', () => {
      const { html } = render('# 标题\n\n[[toc]]\n\n## 唯一章节\n\n内容')
      expect(html).not.toContain('本文目录')
      expect(html).not.toContain('mly-toc-marker')
    })

    it('无 [[toc]] 时不注入目录', () => {
      const { html } = render('# T\n\n## A\n\n内容\n\n## B\n\n内容')
      expect(html).not.toContain('本文目录')
    })
  })

  describe('分割线变体', () => {
    it('hr 变为装饰分割线', () => {
      const { html } = render('# T\n\n上段\n\n---\n\n下段')
      expect(html).toContain('· · ·')
      expect(html).not.toMatch(/<hr/i)
    })

    it('分隔符不会误伤表格', () => {
      // 表格里的 --- 是分隔行，不是分割线
      const table = '# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
      const { html } = render(table)
      expect(html).toContain('<table')
      expect(html).not.toContain('· · ·')
    })
  })

  describe('降级友好', () => {
    it('::: 语法未闭合时不抛错，保留原文本', () => {
      const { html } = render('# T\n\n::: tip 没写完的提示')
      expect(html).toContain('没写完的提示')
    })

    it('组件语法内的空内容不产生空块', () => {
      const { html } = render('# T\n\n::: tip\n:::\n\n正文')
      expect(html).toContain('正文')
      expect(html).not.toContain('mly-callout')
    })

    it('普通文章不受组件功能影响', () => {
      const plain = '# 标题\n\n这是一段普通正文，含**加粗**。\n\n- 项目一\n- 项目二'
      const { html } = render(plain)
      expect(html).toContain('普通正文')
      expect(html).toMatch(/<strong/)
      expect(html).toMatch(/<li/)
    })

    it('任何自定义标签都不会残留在最终产物里', () => {
      const { html } = render('# T\n\n::: lead 引言\n:::\n\n[[toc]]\n\n## A\n\n## B\n\n## C')
      expect(html).not.toMatch(/<\/?mly-[a-z]/i)
    })
  })

  describe('组件产物必须通过合规校验', () => {
    const samples: Array<[string, string]> = [
      ['提示块', '# T\n\n::: warn 注意这里\n:::\n\n正文'],
      ['引言卡', '# T\n\n::: lead 开篇判断\n:::\n\n正文'],
      ['目录', '# T\n\n[[toc]]\n\n## A\n\nx\n\n## B\n\ny\n\n## C\n\nz'],
      ['分割线', '# T\n\n上\n\n---\n\n下'],
      ['组合使用', '# T\n\n::: lead 判断\n:::\n\n[[toc]]\n\n## 一\n\n::: tip 说明\n:::\n\n---\n\n## 二\n\n正文']
    ]

    for (const [name, md] of samples) {
      it(`${name}排版后无阻断性违规`, () => {
        const { html, title } = render(md)
        const violations = validateWechatLayout({ html, title })
        const errors = violations.filter((v) => v.level === 'error')
        expect(errors.map((e) => `${e.rule}: ${e.message}`), html.slice(0, 300)).toEqual([])
        expect(hasBlockingViolation(violations)).toBe(false)
      })
    }
  })

  describe('组件跟随主题换色', () => {
    it('不同主题下引言卡的主色不同', () => {
      const md = '# T\n\n::: lead 判断\n:::'
      const green = renderLayoutMarkdown(md, 'wechat', 'wechat-green').html
      const magazine = renderLayoutMarkdown(md, 'wechat', 'magazine').html
      // 主题不同 →组件主色不同
      expect(green).not.toBe(magazine)
      expect(green).toMatch(/border-left:\s*4px solid #07c160/)
      expect(magazine).toMatch(/border-left:\s*4px solid #1a1a1a/)
    })
  })

  describe('小红书平台不受影响', () => {
    it('组件语法不生效（降级为纯文本）', () => {
      const { html } = renderLayoutMarkdown('# T\n\n::: lead 判断\n:::\n\n正文', 'xiaohongshu', 'wechat-green')
      expect(html).not.toContain('· · ·')
      expect(html).toContain('判断')
    })
  })
})
