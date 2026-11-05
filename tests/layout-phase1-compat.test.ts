import { describe, expect, it } from 'vitest'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'

/**
 * 阶段一合规修复的产物级回归测试（2026-11-06 优化方案阶段一验收）。
 *
 * 校验器测试证明"规则能抓问题"，这里证明"管线产物本身合规"：
 * 产物是 juice 内联后的最终形态，微信收到什么就是什么。
 */

const SAMPLE = `# 阶段一样本

这是第一段正文，用于验证字体策略与基础结构。内容足够长，覆盖继承链检查。

## 二级标题

\`\`\`ts
function demo() {
  if (ready) {
    return 1
  }
}
\`\`\`

> 引用内容一段

最后一段。`

describe('阶段一产物合规（微信兼容）', () => {
  const rendered = renderLayoutMarkdown(SAMPLE, 'wechat')

  it('正文/标题不再携带 font-family（官方规范；代码块 monospace 保留）', () => {
    const fontFamilies = [...rendered.html.matchAll(/font-family:([^;"]+)/g)].map(match => match[1].trim())
    // 产物中允许存在的 font-family 只有等宽字体栈（代码块与代码行内），其余一律不得出现
    for (const family of fontFamilies) {
      expect(family, `发现非等宽 font-family: ${family}`).toMatch(/Mono|monospace/)
    }
    expect(fontFamilies.length).toBeGreaterThan(0) // 代码块确实存在
  })

  it('高亮代码块的行首缩进被保全（全角空格，微信不折叠）', () => {
    // 源码缩进 2/4 空格的行 → 行首应为对应数量的全角空格（hljs 会把关键字包进 span，
    // 所以断言"全角空格 + 标签开头"的形态，以及闭合括号行内保留的全角缩进）
    expect(rendered.html).toContain('　　<span')
    expect(rendered.html).toContain('　　　　<span')
    expect(rendered.html).toContain('<span leaf="">　　}</span>')
  })

  it('img 携带 max-width 自适应而非固定 width（微信强制覆盖宽度的对冲）', () => {
    for (const tag of rendered.html.match(/<img[^>]*>/gi) ?? []) {
      expect(tag).toMatch(/max-width:100%|data-w=/)
    }
  })

  it('产物通过微信合规校验（零 error）', async () => {
    const { validateWechatLayout } = await import('../src/main/services/layout-validator.js')
    const violations = validateWechatLayout({ html: rendered.html, title: rendered.title, digest: '摘'.repeat(120) })
    expect(violations.filter(v => v.level === 'error')).toEqual([])
  })
})
