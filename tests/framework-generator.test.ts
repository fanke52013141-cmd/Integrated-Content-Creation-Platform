import { describe, expect, it } from 'vitest'
import { parseFrameworkXml } from '../src/main/services/framework-generator.js'

describe('framework generator parser', () => {
  const sections = ['标题', '开头', '论点一', '结尾']

  it('accepts a complete XML framework in the configured section order', () => {
    const result = parseFrameworkXml(`
      <框架>
        <标题>先写框架，文章才不会散</标题>
        <开头>从创作者动笔困难切入。</开头>
        <论点一>框架先确定读者和核心承诺。</论点一>
        <结尾>用一个可立即执行的下一步收束。</结尾>
      </框架>
    `, sections)
    expect(result).toEqual([
      { name: '标题', content: '先写框架，文章才不会散' },
      { name: '开头', content: '从创作者动笔困难切入。' },
      { name: '论点一', content: '框架先确定读者和核心承诺。' },
      { name: '结尾', content: '用一个可立即执行的下一步收束。' }
    ])
  })

  it('rejects incomplete templates instead of silently saving malformed output', () => {
    expect(() => parseFrameworkXml('<框架><标题>只有标题</标题></框架>', sections))
      .toThrow('完整返回框架章节')
  })
})
