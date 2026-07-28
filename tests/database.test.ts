import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../src/main/database.js'
import { createAccountFields } from '../src/shared/domain.js'

describe('AppDatabase', () => {
  it('persists account versions and restores without overwriting history', () => {
    const database = new AppDatabase(':memory:')
    const created = database.saveAccount({
      fields: createAccountFields({ 账号名称: '墨流测试号', 领域: '科技' }),
      wizardAnswers: [],
      status: 'draft',
      source: 'manual'
    })
    expect(created.versionCount).toBe(1)
    expect(created.isCurrent).toBe(true)

    const changedFields = created.fields.map((field) =>
      field.name === '领域' ? { ...field, value: '人工智能' } : field
    )
    const changed = database.saveAccount({
      id: created.id,
      fields: changedFields,
      wizardAnswers: [],
      status: 'locked',
      source: 'manual'
    })
    expect(changed.versionCount).toBe(2)
    expect(changed.status).toBe('locked')

    const restored = database.restoreAccountVersion(created.id, created.versions[0].id)
    expect(restored.versionCount).toBe(3)
    expect(restored.status).toBe('draft')
    expect(restored.fields.find((field) => field.name === '领域')?.value).toBe('科技')
    database.close()
  })

  it('stores immutable references to an exact account version', () => {
    const database = new AppDatabase(':memory:')
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '草稿账号' }),
      wizardAnswers: [],
      status: 'draft',
      source: 'manual'
    })
    const reference = database.createArtifactReference({
      sourceType: 'account-profile',
      sourceId: account.id,
      sourceVersionId: account.currentVersionId,
      sourceStatusSnapshot: 'draft',
      targetType: 'topic',
      targetId: 'topic-1'
    })

    expect(database.listArtifactReferencesForTarget('topic', 'topic-1')).toEqual([reference])
    const internalDatabase = (database as unknown as { db: DatabaseSync }).db
    expect(() => internalDatabase.prepare(
      'UPDATE artifact_references SET source_status_snapshot = ? WHERE id = ?'
    ).run('locked', reference.id)).toThrow('immutable')
    database.close()
  })

  it('stores multiple model aliases under one provider', () => {
    const database = new AppDatabase(':memory:')
    const provider = database.saveProvider({
      displayName: '中转站',
      protocol: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      defaultModel: 'model-b',
      enabled: true,
      isRelay: true,
      capabilities: {
        chat: true,
        jsonMode: true,
        streaming: false,
        vision: false,
        image: false
      },
      models: [
        {
          modelId: 'model-a',
          displayName: '快速模型',
          contextLimit: 100_000,
          reasoningVariants: ['low', 'high'],
          isDefault: false,
          enabled: true
        },
        {
          modelId: 'model-b',
          displayName: '质量模型',
          outputLimit: 32_000,
          reasoningVariants: [],
          isDefault: true,
          enabled: true
        }
      ]
    })

    expect(provider.defaultModel).toBe('model-b')
    expect(provider.models).toHaveLength(2)
    expect(provider.models[0].displayName).toBe('质量模型')
    expect(provider.models[1].reasoningVariants).toEqual(['low', 'high'])
    database.close()
  })

  it('locks hotspot snapshots, deduplicates favorites, and keeps tags mutable', () => {
    const database = new AppDatabase(':memory:')
    const hotItem = {
      id: 'hot-42',
      title: '必须保持原样的热点标题',
      desc: '原始描述',
      url: 'https://example.com/hot-42',
      source: 'example',
      sourceTitle: '示例平台',
      subtitle: '热榜',
      updateTime: '2026-07-28T02:00:00.000Z',
      hotValue: '12万',
      rank: 2,
      rawJson: '{"id":"hot-42"}'
    }

    const first = database.addHotFavorite({ hotItem, tags: ['待选题'] })
    const duplicate = database.addHotFavorite({
      hotItem: { ...hotItem, title: '试图覆盖标题' },
      tags: ['已用']
    })

    expect(first.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(duplicate.favorite.hotItem.title).toBe('必须保持原样的热点标题')
    expect(database.listHotFavorites()).toHaveLength(1)

    const updated = database.updateHotFavoriteTags(first.favorite.id, ['已用'])
    expect(updated.tags).toEqual(['已用'])
    expect(updated.hotItem.title).toBe('必须保持原样的热点标题')

    const internalDatabase = (database as unknown as { db: DatabaseSync }).db
    expect(() => internalDatabase.prepare(
      'UPDATE hot_favorites SET title = ? WHERE id = ?'
    ).run('被篡改', first.favorite.id)).toThrow('immutable')

    database.removeHotFavorite(first.favorite.id)
    expect(database.listHotFavorites()).toEqual([])
    database.close()
  })

  it('persists hotspot platform visibility and ordering preferences', () => {
    const database = new AppDatabase(':memory:')
    database.saveHotSourcePreferences([
      { sourceId: 'zhihu', hidden: false, sortOrder: 1 },
      { sourceId: 'weibo', hidden: true, sortOrder: 0 }
    ])

    expect(database.listHotSourcePreferences().map((preference) => ({
      sourceId: preference.sourceId,
      hidden: preference.hidden,
      sortOrder: preference.sortOrder
    }))).toEqual([
      { sourceId: 'weibo', hidden: true, sortOrder: 0 },
      { sourceId: 'zhihu', hidden: false, sortOrder: 1 }
    ])

    database.saveHotSourcePreferences([
      { sourceId: 'weibo', hidden: false, sortOrder: 2 }
    ])
    expect(database.listHotSourcePreferences().find(
      (preference) => preference.sourceId === 'weibo'
    )).toMatchObject({ hidden: false, sortOrder: 2 })
    database.close()
  })

  it('persists global topic schema, topic versions, library membership, and exact references', () => {
    const database = new AppDatabase(':memory:')
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '选题账号' }),
      wizardAnswers: [],
      status: 'locked',
      source: 'manual'
    })
    const schema = database.getTopicSchema()
    expect(schema).toHaveLength(7)
    const topic = database.saveTopic({
      seedKeyword: 'AI Agent 落地',
      accountIds: [account.id],
      relatedHotIds: [],
      status: 'draft',
      source: 'manual',
      fields: Object.fromEntries(schema.map((field) => [field.name, `${field.name} 内容`]))
    })
    database.createArtifactReference({
      sourceType: 'account-profile',
      sourceId: account.id,
      sourceVersionId: account.currentVersionId,
      sourceStatusSnapshot: 'locked',
      targetType: 'topic',
      targetId: topic.id
    })
    const changed = database.saveTopic({
      id: topic.id,
      seedKeyword: topic.seedKeyword,
      accountIds: topic.accountIds,
      relatedHotIds: topic.relatedHotIds,
      status: 'locked',
      source: 'manual',
      fields: { ...topic.fields, 选题主题: 'AI Agent 真正落地的三道坎' }
    })

    expect(changed.versionCount).toBe(2)
    expect(changed.fields.选题主题).toContain('三道坎')
    expect(changed.references).toHaveLength(1)
    database.setTopicInLibrary(topic.id, true)
    expect(database.listTopics(true).map((item) => item.id)).toEqual([topic.id])
    database.setTopicLocked(topic.id, false)
    expect(database.getTopic(topic.id)?.status).toBe('draft')
    database.close()
  })

  it('stores a separate encrypted-search configuration record and deduplicates material snapshots', () => {
    const database = new AppDatabase(':memory:')
    expect(database.getSearchService()).toMatchObject({ id: 'doubao-custom', hasApiKey: false })
    database.saveSearchService({ enabled: true }, Buffer.from('encrypted-search-key'))
    expect(database.getSearchService()).toMatchObject({ enabled: true, hasApiKey: true })
    expect(database.getEncryptedSearchServiceKey()).toEqual(Buffer.from('encrypted-search-key'))

    const first = database.addSearchMaterial({
      kind: 'web', origin: 'doubao_web', externalId: 'web-1', title: '网页素材', summary: '给 AI 的摘要',
      sourceUrl: 'https://example.com/article', sourceName: '示例站点', query: '测试'
    })
    const duplicate = database.addSearchMaterial({
      kind: 'web', origin: 'doubao_web', externalId: 'web-1', title: '被忽略的新标题', summary: '新摘要'
    })
    const manual = database.addManualMaterial({ title: '访谈摘录', summary: '人工整理的观点', sourceNote: '个人整理' })
    expect(first.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(duplicate.material.title).toBe('网页素材')
    expect(manual.kind).toBe('text')
    expect(database.listMaterials()).toHaveLength(2)
    database.close()
  })

  it('persists framework templates and versioned outline drafts', () => {
    const database = new AppDatabase(':memory:')
    const template = database.saveFrameworkTemplate({
      name: '测试框架', sections: ['标题', '开头', '结尾'], isDefault: true
    })
    expect(database.listFrameworkTemplates().find((item) => item.id === template.id)?.isDefault).toBe(true)
    const first = database.saveFramework({
      templateId: template.id, materialIds: [], manualTopic: '框架测试主题', status: 'draft',
      sections: [
        { name: '标题', content: '第一版标题' },
        { name: '开头', content: '第一版开头' },
        { name: '结尾', content: '第一版结尾' }
      ]
    })
    const updated = database.saveFramework({
      id: first.id, templateId: template.id, materialIds: [], manualTopic: '框架测试主题', status: 'locked',
      sections: [
        { name: '标题', content: '第二版标题' },
        { name: '开头', content: '第二版开头' },
        { name: '结尾', content: '第二版结尾' }
      ]
    })
    expect(updated).toMatchObject({ versionCount: 2, status: 'locked' })
    expect(updated.sections[0].content).toBe('第二版标题')
    expect(updated.rawXml).toContain('<标题>第二版标题</标题>')
    database.close()
  })

  it('persists Markdown articles, their versions, and restores a previous article version', () => {
    const database = new AppDatabase(':memory:')
    const first = database.saveArticle({
      materialIds: [], manualOutline: '<框架><标题>测试</标题></框架>', status: 'draft',
      rawMarkdown: '# 第一版\n\n第一版正文。', source: 'generate', model: 'test-model'
    })
    const changed = database.saveArticle({
      id: first.id, materialIds: [], manualOutline: first.manualOutline, status: 'locked',
      rawMarkdown: '# 第二版\n\n第二版正文。', source: 'manual'
    })
    expect(changed).toMatchObject({ versionCount: 2, status: 'locked', rawMarkdown: expect.stringContaining('第二版') })
    const restored = database.restoreArticleVersion(changed.id, changed.versions.find((version) => version.versionNumber === 1)!.id)
    expect(restored).toMatchObject({ versionCount: 3, status: 'draft', rawMarkdown: expect.stringContaining('第一版') })
    database.close()
  })
})
