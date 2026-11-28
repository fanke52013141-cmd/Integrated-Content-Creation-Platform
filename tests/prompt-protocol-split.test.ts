import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { getBuiltinPromptProtocol, PromptRegistry } from '../src/main/gateway/prompt-registry.js'

describe('Batch C: prompt business/protocol layer separation', () => {
  it('auto-appends locked protocol and interpolates variables even when user edits business prompt', () => {
    const db = new AppDatabase(':memory:')
    try {
      const registry = new PromptRegistry(db)
      registry.seed()
      db.updatePrompt('framework.generate', '请用犀利、反常识的编辑视角写框架。', '用户只改风格')

      const rendered = registry.render('framework.generate', { '章节标签': ['<标题>', '<开头>', '<结尾>'] })
      expect(rendered).toContain('请用犀利、反常识的编辑视角写框架。')
      expect(rendered).toContain('允许且只允许的章节标签：<标题>、<开头>、<结尾>')
      expect(getBuiltinPromptProtocol('framework.generate')).toContain('<框架>')
    } finally {
      db.close()
    }
  })

  it('does not duplicate protocol when a legacy customized prompt already includes the protocol marker', () => {
    const db = new AppDatabase(':memory:')
    try {
      const registry = new PromptRegistry(db)
      registry.seed()
      const legacy = '我的旧自定义提示词。\n允许且只允许的章节标签：{{章节标签}}。'
      db.updatePrompt('framework.generate', legacy, '旧版导入')

      const rendered = registry.render('framework.generate', { '章节标签': ['<标题>', '<结尾>'] })
      expect(rendered.match(/允许且只允许的章节标签/g)).toHaveLength(1)
    } finally {
      db.close()
    }
  })
})
