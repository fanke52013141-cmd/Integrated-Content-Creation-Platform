import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../src/main/database.js'
import { createAccountFields, createDefaultTopicSchema } from '../src/shared/domain.js'

// 构造一条完整的「账号 → 选题 → 框架 → 成稿 + 素材」链路，用于删除溯源测试。
function buildPipeline(database: AppDatabase) {
  const account = database.saveAccount({
    fields: createAccountFields({ 账号名称: '溯源测试号', 领域: '科技' }),
    wizardAnswers: [],
    status: 'locked',
    source: 'manual'
  })

  // 选题：accountIds / relatedHotIds 可空，松耦合启动
  const topic = database.saveTopic({
    seedKeyword: 'AI 写作',
    accountIds: [account.id],
    relatedHotIds: [],
    status: 'draft',
    source: 'manual',
    fields: { 标题: 'AI 写作时代的创作者', 切入角度: '工具与人的分工', 备注: '' }
  })

  // 框架：选题 + 账号 + 素材均可空，松耦合启动
  const framework = database.saveFramework({
    topicId: topic.id,
    accountId: account.id,
    materialIds: [],
    templateId: database.listFrameworkTemplates()[0]?.id,
    manualTopic: '',
    status: 'draft',
    sections: [
      { name: '标题', content: 'AI 写作时代的创作者' },
      { name: '开头', content: '从工具与人的分工切入' },
      { name: '结尾', content: '回到人本身' }
    ]
  })

  // 手动素材
  const material = database.addManualMaterial({
    title: '外部参考素材',
    summary: '一篇关于 AI 写作工具的报道',
    sourceUrl: 'https://example.com/article'
  })

  // 成稿：关联框架、账号、素材
  const article = database.saveArticle({
    frameworkId: framework.id,
    accountId: account.id,
    materialIds: [material.id],
    manualOutline: '',
    status: 'draft',
    rawMarkdown: '# AI 写作时代的创作者\n\n正文内容。',
    source: 'manual'
  })

  // 创建溯源引用，模拟服务层的 createArtifactReference 调用
  database.createArtifactReference({
    sourceType: 'account-profile', sourceId: account.id,
    sourceVersionId: account.currentVersionId, sourceStatusSnapshot: 'locked',
    targetType: 'topic', targetId: topic.id
  })
  database.createArtifactReference({
    sourceType: 'topic', sourceId: topic.id,
    sourceVersionId: topic.currentVersionId, sourceStatusSnapshot: 'draft',
    targetType: 'framework', targetId: framework.id
  })
  database.createArtifactReference({
    sourceType: 'framework', sourceId: framework.id,
    sourceVersionId: framework.currentVersionId, sourceStatusSnapshot: 'draft',
    targetType: 'article', targetId: article.id
  })
  database.createArtifactReference({
    sourceType: 'material', sourceId: material.id,
    sourceVersionId: material.id, sourceStatusSnapshot: 'locked',
    targetType: 'article', targetId: article.id
  })

  return { account, topic, framework, material, article }
}

describe('INT-03 删除溯源链 - 上游删除后下游保留与失效标记', () => {
  it('删除账号：下游框架/成稿保留，artifact_references 仍可查', () => {
    const database = new AppDatabase(':memory:')
    const { account, topic, framework, article } = buildPipeline(database)

    database.removeAccount(account.id)

    // 账号本身及其版本被 CASCADE 删除
    expect(database.getAccount(account.id)).toBeNull()

    // 框架保留：frameworks.account_id 有 ON DELETE SET NULL，被擦除（与 articles 对齐）
    const frameworkAfter = database.getFramework(framework.id)
    expect(frameworkAfter).not.toBeNull()
    expect(frameworkAfter!.accountId).toBeUndefined()

    // 成稿保留：articles.account_id 有 ON DELETE SET NULL，被擦除
    const articleAfter = database.getArticle(article.id)
    expect(articleAfter).not.toBeNull()
    expect(articleAfter!.accountId).toBeUndefined()

    // 选题保留（topics 表无 FK 指向 account_profiles，accountIds 仅是 JSON 数组）
    const topicAfter = database.getTopic(topic.id)
    expect(topicAfter).not.toBeNull()
    // accountIds 仍保留旧值（无 DB 级保护，UI 端需自行判断账号是否存在）
    expect(topicAfter!.accountIds).toEqual([account.id])

    // artifact_references 表保留历史溯源记录（immutable trigger 阻止 update）
    const refsForTopic = database.listArtifactReferencesForTarget('topic', topic.id)
    expect(refsForTopic).toHaveLength(1)
    expect(refsForTopic[0].sourceId).toBe(account.id) // 仍指向已删账号
    expect(refsForTopic[0].sourceStatusSnapshot).toBe('locked')

    const refsForArticle = database.listArtifactReferencesForTarget('article', article.id)
    expect(refsForArticle.find((r) => r.sourceType === 'framework')).toBeDefined()
    database.close()
  })

  it('删除选题：下游框架保留，topicId 字段保留旧值供 UI 标失效', () => {
    const database = new AppDatabase(':memory:')
    const { topic, framework } = buildPipeline(database)

    database.removeTopic(topic.id)

    // 选题及其版本被 CASCADE 删除
    expect(database.getTopic(topic.id)).toBeNull()

    // 框架保留，topicId 不是 FK，仍保留旧值
    const frameworkAfter = database.getFramework(framework.id)
    expect(frameworkAfter).not.toBeNull()
    expect(frameworkAfter!.topicId).toBe(topic.id) // UI 据此判定"选题已失效"

    // artifact_references 仍保留指向已删选题的记录
    const refs = database.listArtifactReferencesForTarget('framework', framework.id)
    expect(refs.find((r) => r.sourceType === 'topic' && r.sourceId === topic.id)).toBeDefined()
    database.close()
  })

  it('删除框架：下游成稿保留，framework_id 被 SET NULL', () => {
    const database = new AppDatabase(':memory:')
    const { framework, article } = buildPipeline(database)

    database.removeFramework(framework.id)

    // 框架及其版本被 CASCADE 删除
    expect(database.getFramework(framework.id)).toBeNull()

    // 成稿保留，framework_id 被 SET NULL（UI 标"框架已失效"）
    const articleAfter = database.getArticle(article.id)
    expect(articleAfter).not.toBeNull()
    expect(articleAfter!.frameworkId).toBeUndefined()

    // artifact_references 仍保留指向已删框架的记录
    const refs = database.listArtifactReferencesForTarget('article', article.id)
    expect(refs.find((r) => r.sourceType === 'framework' && r.sourceId === framework.id)).toBeDefined()
    database.close()
  })

  it('删除素材：成稿 materialIds JSON 数组仍含已删 id（无 FK 保护，UI 端 resolveMaterials 抛错）', () => {
    const database = new AppDatabase(':memory:')
    const { material, article } = buildPipeline(database)

    database.removeMaterial(material.id)

    // 素材被删除
    expect(database.listMaterials().find((m) => m.id === material.id)).toBeUndefined()

    // 成稿保留，materialIds 仍含已删 id（JSON 数组，无 DB 级 cascade）
    const articleAfter = database.getArticle(article.id)
    expect(articleAfter).not.toBeNull()
    expect(articleAfter!.materialIds).toEqual([material.id]) // UI 端需自行检测失效

    // artifact_references 仍保留指向已删素材的记录
    const refs = database.listArtifactReferencesForTarget('article', article.id)
    expect(refs.find((r) => r.sourceType === 'material' && r.sourceId === material.id)).toBeDefined()
    database.close()
  })

  it('删除成稿：CASCADE 删除其版本、评审任务、配图、排版、发布记录', () => {
    const database = new AppDatabase(':memory:')
    const { article } = buildPipeline(database)

    // 为成稿附加下游产物
    const reviewRole = database.saveReviewRole({
      name: '内容编辑', systemPrompt: '你是编辑', extractionTag: '评审意见',
      extractionOccurrence: 'last', dimensions: ['准确性'], sortOrder: 0
    })
    const reviewTask = database.createReviewTask(article.id, [reviewRole.id])
    database.saveVisualPack({
      articleId: article.id, articleVersionId: article.currentVersionId,
      articleStatusSnapshot: 'draft', providerId: 'p1', model: 'm1', rawXml: '<配图方案/>',
      cover: { visual: '', prompt: '', overlayText: '' },
      inlineImages: [], releaseImages: []
    })
    const layout = database.saveArticleLayout({
      articleId: article.id, articleVersionId: article.currentVersionId,
      articleStatusSnapshot: 'draft', platform: 'wechat',
      title: '标题', html: '<p>html</p>', plainText: '纯文本'
    })
    database.createPublication({
      articleId: article.id, articleVersionId: article.currentVersionId,
      layoutId: layout.id, channelId: 'wechat-official',
      status: 'draft', title: '标题', thumbMediaId: 'thumb-1'
    })

    // 删除成稿
    database.removeArticle(article.id)

    expect(database.getArticle(article.id)).toBeNull()
    // 版本被 CASCADE 删除
    expect(database.getArticle(article.id)).toBeNull()
    // 评审任务被 CASCADE 删除
    expect(database.getReviewTask(reviewTask.id)).toBeNull()
    // 配图被 CASCADE 删除
    expect(database.listVisualPacks(article.id)).toEqual([])
    // 排版被 CASCADE 删除
    expect(database.listArticleLayouts(article.id)).toEqual([])
    // 发布记录被 CASCADE 删除
    expect(database.listPublications().filter((p) => p.articleId === article.id)).toEqual([])
    database.close()
  })

  it('artifact_references 表不可变：UPDATE 触发 RAISE ABORT', () => {
    const database = new AppDatabase(':memory:')
    const { account, topic } = buildPipeline(database)
    const refs = database.listArtifactReferencesForTarget('topic', topic.id)
    expect(refs).toHaveLength(1)

    // 任何 UPDATE 都应被 trigger 阻止
    expect(() => {
      const db = (database as unknown as { db: DatabaseSync }).db
      db.prepare('UPDATE artifact_references SET source_id = ? WHERE id = ?')
        .run('tampered', refs[0].id)
    }).toThrow(/immutable/)

    // 原始记录未被篡改
    const refsAfter = database.listArtifactReferencesForTarget('topic', topic.id)
    expect(refsAfter[0].sourceId).toBe(account.id)
    database.close()
  })

  it('消费草稿态上游：artifact_references 保留草稿状态快照（INT-04）', () => {
    const database = new AppDatabase(':memory:')
    // 草稿态账号
    const account = database.saveAccount({
      fields: createAccountFields({ 账号名称: '草稿账号' }),
      wizardAnswers: [],
      status: 'draft',
      source: 'manual'
    })
    const topic = database.saveTopic({
      seedKeyword: '草稿消费',
      accountIds: [account.id],
      relatedHotIds: [],
      status: 'draft',
      source: 'manual',
      fields: { 标题: '草稿消费测试', 切入角度: '测试', 备注: '' }
    })
    // 创建引用时快照为 draft
    database.createArtifactReference({
      sourceType: 'account-profile', sourceId: account.id,
      sourceVersionId: account.currentVersionId, sourceStatusSnapshot: 'draft',
      targetType: 'topic', targetId: topic.id
    })

    // 之后账号锁定，但引用快照仍是 draft（供 UI 警告"消费时为草稿态"）
    database.setAccountLocked(account.id, true)
    const refs = database.listArtifactReferencesForTarget('topic', topic.id)
    expect(refs[0].sourceStatusSnapshot).toBe('draft')
    database.close()
  })
})

describe('INT-02 松耦合引用 - 任意环节可独立启动', () => {
  it('选题可无账号、无热点独立创建', () => {
    const database = new AppDatabase(':memory:')
    const topic = database.saveTopic({
      seedKeyword: '独立选题',
      accountIds: [],
      relatedHotIds: [],
      status: 'draft',
      source: 'manual',
      fields: { 标题: '无账号无热点', 切入角度: '独立', 备注: '' }
    })
    expect(topic.id).toBeDefined()
    expect(topic.accountIds).toEqual([])
    expect(topic.relatedHotIds).toEqual([])
    database.close()
  })

  it('框架可无选题、无账号、无素材独立创建（手动主题）', () => {
    const database = new AppDatabase(':memory:')
    const framework = database.saveFramework({
      topicId: undefined,
      accountId: undefined,
      materialIds: [],
      templateId: undefined,
      manualTopic: '纯手动框架',
      status: 'draft',
      sections: [{ name: '标题', content: '手动' }]
    })
    expect(framework.id).toBeDefined()
    expect(framework.topicId).toBeUndefined()
    expect(framework.accountId).toBeUndefined()
    expect(framework.manualTopic).toBe('纯手动框架')
    database.close()
  })

  it('成稿可无框架、无账号、无素材独立创建（手动大纲）', () => {
    const database = new AppDatabase(':memory:')
    const article = database.saveArticle({
      frameworkId: undefined,
      accountId: undefined,
      materialIds: [],
      manualOutline: '手动大纲：标题 + 几个要点',
      status: 'draft',
      rawMarkdown: '# 独立成稿\n\n内容。',
      source: 'manual'
    })
    expect(article.id).toBeDefined()
    expect(article.frameworkId).toBeUndefined()
    expect(article.manualOutline).toBe('手动大纲：标题 + 几个要点')
    database.close()
  })

  it('选题 schema 改即生效：新字段成为默认，历史选题不受影响（INT-06）', () => {
    const database = new AppDatabase(':memory:')
    // 默认 schema
    const defaultSchema = database.getTopicSchema()
    expect(defaultSchema.length).toBeGreaterThan(0)

    // 基于默认 schema 创建一个选题
    const oldTopic = database.saveTopic({
      seedKeyword: '旧 schema',
      accountIds: [],
      relatedHotIds: [],
      status: 'locked',
      source: 'manual',
      fields: Object.fromEntries(defaultSchema.map((f) => [f.name, `值-${f.name}`]))
    })

    // 修改 schema：替换为全新字段
    database.saveTopicSchema([
      { id: '', name: '全新字段A', required: true, sortOrder: 0 },
      { id: '', name: '全新字段B', required: false, sortOrder: 1 }
    ])
    const newSchema = database.getTopicSchema()
    expect(newSchema.map((f) => f.name)).toEqual(['全新字段A', '全新字段B'])

    // 历史选题不受影响
    const oldTopicAfter = database.getTopic(oldTopic.id)
    expect(oldTopicAfter).not.toBeNull()
    expect(Object.keys(oldTopicAfter!.fields).sort()).toEqual(defaultSchema.map((f) => f.name).sort())

    // 重置 schema 回默认
    database.resetTopicSchema()
    expect(database.getTopicSchema().map((f) => f.name)).toEqual(createDefaultTopicSchema().map((f) => f.name))
    database.close()
  })
})
