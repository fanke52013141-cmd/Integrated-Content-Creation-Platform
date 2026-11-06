import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'
import { DEFAULT_STYLE_CONFIG, normalizeStyleConfig } from '../src/shared/layout-config.js'

/**
 * 排版产物 golden 基线（阶段三"主题 tokens 化"的安全网）。
 *
 * 主题 CSS 重构（baseCss → tokens + 元素配方）必须做到产物逐字节一致——
 * "重构不改变输出"靠自动比对保证，不靠人工肉眼。
 *
 * 重新生成基线：MLY_REGEN_GOLDEN=1 npm test -- layout-golden
 * （仅在有意变更视觉输出时允许，需在 PR 里附新旧预览截图说明）
 */

const GOLDEN_DIR = fileURLToPath(new URL('./fixtures/layout-golden/', import.meta.url))

const GOLDEN_MARKDOWN = `# 排版引擎黄金样稿

::: lead 这是引言卡：开篇的核心判断，决定读者是否继续读下去。
:::

正文第一段，包含**强调文字**、行内代码 \`const token = 1\`，以及一条[外部参考链接](https://example.com/article-ref)会被转换为文末脚注。

## 第一个章节

这一章验证标题层级与正文节奏。

### 小节标题

![黄金样稿配图说明](https://sample.invalid/golden-image.png)

- 列表项一
- 列表项二

::: key 重点提示：这一条会被渲染成带标签的提示块。
:::

::: ok 结论：阶段三的组件与主题重构全部落地。
:::

::: hero 排版的价值不在转换器，而在成体系的设计选择。
:::

> 引用块：验证左边线、底色与多行文本。

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 份额 | 42.5% | 纯数字列右对齐 |
| 天数 | 30 天 | 中文说明列保持左对齐 |

[[toc]]

[[secnum]]

\`\`\`js
function demo() {
  if (ready) {
    return 1
  }
}
\`\`\`

---

## 第二个章节

收尾段落观察分割线后的留白。`

const CASES: Array<{ name: string; themeId: string; styleConfig: Record<string, unknown> }> = [
  { name: 'wechat-green', themeId: 'wechat-green', styleConfig: {} },
  { name: 'magazine', themeId: 'magazine', styleConfig: {} },
  { name: 'tech-blue', themeId: 'tech-blue', styleConfig: {} },
  { name: 'warm-paper', themeId: 'warm-paper', styleConfig: {} },
  { name: 'minimal', themeId: 'minimal', styleConfig: {} },
  {
    name: 'wechat-green-styled',
    themeId: 'wechat-green',
    styleConfig: {
      accentColor: '#8b5cf6',
      heading2Variant: 'filled',
      quoteVariant: 'card',
      paragraphFirstLineIndent: true,
      showTitleInBody: true,
      bodyFontSize: 15,
      brandHeaderText: '心流 · 排版引擎',
      brandFooterText: '由心流排版引擎生成'
    }
  }
]

describe('排版 golden 基线（重构零 diff 安全网）', () => {
  const regen = process.env.MLY_REGEN_GOLDEN === '1'

  it.each(CASES.map(item => item.name))('主题 %s 的产物与基线逐字节一致', (name) => {
    const item = CASES.find(entry => entry.name === name)!
    const styleConfig = normalizeStyleConfig({ ...DEFAULT_STYLE_CONFIG, ...item.styleConfig })
    const rendered = renderLayoutMarkdown(GOLDEN_MARKDOWN, 'wechat', item.themeId, undefined, styleConfig)
    const file = join(GOLDEN_DIR, `${name}.html`)

    if (regen) {
      mkdirSync(GOLDEN_DIR, { recursive: true })
      writeFileSync(file, rendered.html)
      expect(true).toBe(true)
      return
    }
    expect(readFileSync(file, 'utf8')).toBe(rendered.html)
  })

  it('golden 样稿覆盖全部新组件与关键结构（防止基线空转）', () => {
    // class 会在 finalize 阶段剥除，覆盖性断言用各组件"独有的内联样式/文本"做证据
    const baseline = readFileSync(join(GOLDEN_DIR, 'wechat-green.html'), 'utf8')
    for (const marker of [
      'padding: 16px 20px',   // lead 引言卡
      'letter-spacing: 1px',  // hero 金句卡
      '本文目录',              // toc
      '一、',                  // secnum 中文序号
      '· · ·',                // 装饰分割线
      '参考链接',              // 外链脚注节
      'text-align: right',    // 数值列右对齐
      'max-width: 100%'       // 图片自适应
    ]) {
      expect(baseline, `golden 基线缺少 ${marker}，无法覆盖该能力`).toContain(marker)
    }
  })
})
