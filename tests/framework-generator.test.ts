import { describe, expect, it } from 'vitest'
import { parseFrameworkXml } from '../src/main/services/framework-generator.js'
import { AppDatabase } from '../src/main/database.js'

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

describe('框架版本历史与系统模板重置（PRD §4.2/§4.7）', () => {
  it('listFrameworkVersions 倒序返回各版本章节快照', () => {
    const db = new AppDatabase(':memory:')
    try {
      const saved = db.saveFramework({ materialIds: [], manualTopic: '版本测试', status: 'draft', sections: [{ name: '开头', content: '第一版' }] })
      db.saveFramework({ id: saved.id, materialIds: [], manualTopic: '版本测试', status: 'draft', sections: [{ name: '开头', content: '第二版' }] })
      const versions = db.listFrameworkVersions(saved.id)
      expect(versions.map((version) => version.versionNumber)).toEqual([2, 1])
      expect(versions[1].sections[0].content).toBe('第一版')
      expect(versions[0].sections[0].content).toBe('第二版')
    } finally { db.close() }
  })

  it('resetFrameworkTemplate：系统模板恢复内置章节，自定义模板拒绝', () => {
    const db = new AppDatabase(':memory:')
    try {
      db.saveFrameworkTemplate({ id: 'system-default', name: '改过名', sections: ['只剩一章'], isDefault: false })
      const reset = db.resetFrameworkTemplate('system-default')
      expect(reset.name).toBe('默认三论点框架')
      expect(reset.sections).toEqual(['标题', '开头', '论点一', '论点二', '论点三', '结尾'])
      expect(reset.isDefault).toBe(true)
      const custom = db.saveFrameworkTemplate({ name: '自定义', sections: ['A'], isDefault: false })
      expect(() => db.resetFrameworkTemplate(custom.id)).toThrow('只有系统内置模板')
    } finally { db.close() }
  })
})
