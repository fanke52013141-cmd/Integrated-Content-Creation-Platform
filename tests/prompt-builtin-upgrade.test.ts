import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database.js'
import type { PromptDefBase } from '../src/shared/contracts.js'

/**
 * 内置提示词升级迁移测试（本次优化新增的机制）：
 * BUILTIN_PROMPTS 演进后，已存在的老库必须能拿到新模板——
 * 1. 用户从未自定义（生效版本仍是 builtin 原文）：生效内容跟着升级；
 * 2. 用户已自定义：生效内容绝不能被覆盖，但 default_template 刷新为新基线；
 * 3. 重复 seed 幂等。
 */

const key = 'article.generate'
const def = (template: string): PromptDefBase => ({ key, title: '写文章', description: '', template })

describe('内置提示词升级迁移', () => {
  const dirs: string[] = []
  const dbs: AppDatabase[] = []
  afterEach(() => {
    while (dbs.length) dbs.pop()!.close()
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  function createDb(): AppDatabase {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-prompt-upgrade-'))
    dirs.push(dir)
    const db = new AppDatabase(join(dir, 'moliu.db'))
    dbs.push(db)
    return db
  }

  it('用户从未自定义：再次 seed 时生效内容升级为新模板', () => {
    const db = createDb()
    db.seedPrompts([def('旧模板 v1')])
    expect(db.getPromptActiveContent(key)).toBe('旧模板 v1')

    db.seedPrompts([def('新模板 v2')])

    expect(db.getPromptActiveContent(key)).toBe('新模板 v2')
    // 升级是原位替换，不堆积版本
    expect(db.listPromptVersions(key)).toHaveLength(1)
  })

  it('用户已自定义：生效内容不被覆盖，「恢复默认」拿到新基线', () => {
    const db = createDb()
    db.seedPrompts([def('旧模板 v1')])
    db.updatePrompt(key, '我的自定义模板', '用户调整')
    expect(db.getPromptActiveContent(key)).toBe('我的自定义模板')

    db.seedPrompts([def('新模板 v2')])

    expect(db.getPromptActiveContent(key)).toBe('我的自定义模板')
    expect(db.listPromptVersions(key)).toHaveLength(2)
    // 恢复默认写入的是刷新后的新内置基线，而不是旧文本
    db.resetPrompt(key)
    expect(db.getPromptActiveContent(key)).toBe('新模板 v2')
  })

  it('重复 seed 同一模板幂等，不产生变化', () => {
    const db = createDb()
    db.seedPrompts([def('模板 v1')])
    const before = db.listPromptVersions(key)
    db.seedPrompts([def('模板 v1')])
    db.seedPrompts([def('模板 v1')])
    expect(db.listPromptVersions(key)).toEqual(before)
  })
})
