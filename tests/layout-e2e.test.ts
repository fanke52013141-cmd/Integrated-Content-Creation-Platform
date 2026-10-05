// P1 端到端验收：确认真实排版输出能通过自己写的校验器
//
// 这是关键一步——单元测试用的是"构造样本"，
// 这里用真实的 markdown-it 渲染 + juice 内联后的产物，验证 0 error。
// 如果这里失败，说明校验器与渲染实现脱节了。
import { describe, expect, it } from 'vitest'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'
import { hasBlockingViolation, validateWechatLayout } from '../src/main/services/layout-validator.js'

// 覆盖公众号内容里真实会出现的元素
const REAL_WORLD_ARTICLES: Array<{ name: string; markdown: string }> = [
  {
    name: '技术教程（含代码块）',
    markdown: [
      '# 如何用 TypeScript 写一个类型守卫',
      '',
      '类型守卫是TypeScript 里最实用的能力之一。**核心思路**是让编译器帮你收窄类型。',
      '',
      '```typescript',
      'function isString(value: unknown): value is string {',
      '  return typeof value === "string"',
      '}',
      '```',
      '',
      '这样写的好处是调用方无需再做类型断言。详见 [官方文档](https://www.typescriptlang.org/docs)。',
      '',
      '## 常见错误',
      '',
      '| 写法 | 问题 | 正确做法 |',
      '| --- | --- | --- |',
      '| `as string` | 绕过检查 | 用类型守卫 |',
      '| `any` | 丢失全部类型信息 | 用 `unknown` |'
    ].join('\n')
  },
  {
    name: '体制内备考类长文（多级标题、引用、列表）',
    markdown: [
      '# 体制内备考三个月，时间到底够不够？',
      '',
      '很多人问我这个问题。答案是：**够，但前提是方法对**。',
      '',
      '> 备考不是比谁更能熬，是比谁的方法更少返工。',
      '',
      '## 一、先算时间账本',
      '',
      '把 90 天拆成三段：',
      '',
      '1. 基础阶段（30 天）：过一遍教材，建立框架',
      '2. 强化阶段（40 天）：刷题 + 错题归因',
      '3. 冲刺阶段（20 天）：套卷 + 时政',
      '',
      '## 二、最容易被忽略的',
      '',
      '- 错题本要按**知识点**分类，不是按日期',
      '- 时政从开始就积累，不要等最后一个月',
      '- 每周留半天复盘，比多刷100 道题有用',
      '',
      '### 常见误区',
      '',
      '>刷题越多分数越高？',
      '',
      '**不是。** 刷题量与分数不成正比，问题往往出在没有归因。'
    ].join('\n')
  },
  {
    name: '纯短文（无代码无表格）',
    markdown: '# 一个短想法\n\n有时候最好的方案是不做方案。'
  },
  {
    name: '深链接与特殊字符',
    markdown: '# 链接测试\n\n访问 [示例站点](https://example.com/path?a=1&b=2) 与 [锚点](#section)。\n\n符号测试：`<div>` & "引号" \'单引号\'。'
  }
]

describe('P1 端到端：真实排版输出必须通过校验', () => {
  for (const { name, markdown } of REAL_WORLD_ARTICLES) {
    it(`${name} 排版后无阻断性违规`, () => {
      const { html, title } = renderLayoutMarkdown(markdown, 'wechat', 'wechat-green')
      const violations = validateWechatLayout({ html, title })

      const errors = violations.filter((violation) => violation.level === 'error')
      if (errors.length) {
        // 失败时打印完整 HTML 便于定位，但主要断言只报规则名，保持输出可读
        expect(
          errors.map((e) => `${e.rule}: ${e.message}`),
          `存在阻断性问题。HTML 片段：${html.slice(0, 400)}`
        ).toEqual([])
      }
      expect(hasBlockingViolation(violations)).toBe(false)
    })
  }

  it('自定义 CSS 引入违规写法时会被拦住（防止用户自定义绕过校验）', () => {
    // 自定义主题 CSS 由用户输入，是最容易引入违规声明的入口
    const bad = renderLayoutMarkdown('# T\n\n正文', 'wechat', 'custom', '/* 无效 */ .mly-body { position: fixed; }')
    const violations = validateWechatLayout({ html: bad.html, title: bad.title })
    expect(violations.some((v) => v.message.includes('position:fixed/absolute/sticky'))).toBe(true)
  })

  it('全部文章类型都不产生 div / script', () => {
    for (const { markdown } of REAL_WORLD_ARTICLES) {
      const { html } = renderLayoutMarkdown(markdown, 'wechat', 'wechat-green')
      expect(html).not.toMatch(/<div/i)
      expect(html).not.toMatch(/<script/i)
    }
  })

  it('代码块在真实教程文章中保持结构完整', () => {
    const { html } = renderLayoutMarkdown(REAL_WORLD_ARTICLES[0].markdown, 'wechat', 'wechat-green')
    expect(html).not.toMatch(/<pre/i)
    expect(html).toContain('background:#1e293b')
    // 语法高亮会把标识符拆进带色的 span，因此逐个查关键词而非整行连续文本
    expect(html).toContain('function')
    expect(html).toContain('isString')
    expect(html).toContain('typescript')
    // 每行独立成段（margin:0），缩进用全角空格而非 white-space:pre。
    // 注意 juice 规范化属性后会补空格，因此不能依赖紧凑写法
    expect(html).toMatch(/margin:\s*0;\s*font-family/)
    expect(html).not.toContain('white-space:pre')
  })
})
