import type { Article, ArticleLayout, ArticleListQuery, ArticleSummary, CreationRequest, Framework, FrameworkTemplate, Material, ReviewRole, ReviewTask, Topic, TopicSchemaField, VisualPack } from '../../shared/contracts'

/** 开发浏览器的显式预览样本；真实 Electron 桥不会调用此模块的构造器。 */
export function createUiFixtures(accountId: string): {
  articles: Article[]
  summaries(query?: ArticleListQuery): { items: ArticleSummary[]; total: number }
  topics: Topic[]
  schema: TopicSchemaField[]
  frameworks: Framework[]
  templates: FrameworkTemplate[]
  backups: string[]
  reviewRoles: ReviewRole[]
  reviewTasks: ReviewTask[]
  visualPacks: VisualPack[]
  layouts: ArticleLayout[]
  requests: CreationRequest[]
  materials: Material[]
} {
  const createdAt = '2026-10-09T08:00:00.000Z'
  const updatedAt = '2026-10-10T08:00:00.000Z'
  const markdown = '# 演示稿：给创作留出完整的空间\n\n每次开始写作，先给自己一个清楚的主题。把资料、观点和结构分开整理，写作时就更容易保持节奏。\n\n## 从一个问题开始\n\n好的选题可以用一句话解释：这篇文章替读者解决什么问题？\n\n- 收集可靠的资料和出处。\n- 确定想表达的主要观点。\n- 用三段结构组织论证。\n\n## 让正文成为工作区的中心\n\n把常用工具放在容易找到的位置，把复杂设置留给需要它们的时候。界面为思考留出空间，创作才能更顺畅。\n\n> 这是一篇用于检查界面的演示文章，不是用户的真实内容。\n\n## 完成后再回看\n\n检查结构、事实和表达方式。保存一个版本，之后仍然可以比较和恢复。'
  const articles: Article[] = [
    { id: 'ui-article', accountId, materialIds: [], manualOutline: '问题、结构与总结', status: 'draft', currentVersionId: 'ui-version-2', versionCount: 2, rawMarkdown: markdown, createdAt, updatedAt, references: [], versions: [
      { id: 'ui-version-2', articleId: 'ui-article', versionNumber: 2, source: 'manual', label: '整理后的结构', rawMarkdown: markdown, createdAt: updatedAt },
      { id: 'ui-version-1', articleId: 'ui-article', versionNumber: 1, source: 'manual', label: '第一版草稿', rawMarkdown: markdown.replace('把资料、观点和结构分开整理，写作时就更容易保持节奏。', '先把想法写下来，再慢慢修改。'), createdAt }
    ] },
    { id: 'ui-locked-article', accountId, materialIds: [], manualOutline: '一份可交付的稿件', status: 'locked', currentVersionId: 'ui-locked-version', versionCount: 1, rawMarkdown: '# 演示稿：一次清楚的创作流程\n\n从选题到成稿，每一步都有明确的输入与结果。\n\n## 准备\n\n确认主题，整理参考资料。\n\n## 写作\n\n写下主要观点，补充论据。\n\n## 交付\n\n完成评审、配图和排版，再检查发布要求。', createdAt, updatedAt, references: [], versions: [] }
  ]
  const summaryItems: ArticleSummary[] = articles.map(({ rawMarkdown, versions: _versions, references: _references, ...rest }) => ({ ...rest, title: rawMarkdown.split('\n')[0].replace(/^#\s*/, ''), excerpt: rawMarkdown.slice(0, 160), hasWorkDraft: false, layoutStale: false }))
  const schema: TopicSchemaField[] = ['选题主题', '核心观点', '读者价值'].map((name, sortOrder) => ({ id: `ui-schema-${sortOrder}`, name, required: true, sortOrder }))
  const topics: Topic[] = ['创作空间', '写作习惯'].map((seedKeyword, index) => ({ id: `ui-topic-${index}`, seedKeyword, accountIds: [accountId], relatedHotIds: [], status: index ? 'draft' : 'locked', isInLibrary: !index, currentVersionId: `ui-topic-version-${index}`, versionCount: 1, fields: { 选题主题: `演示选题：${seedKeyword}如何帮助内容创作者`, 核心观点: '把重要的内容放在视线中心，减少反复切换。', 读者价值: '给正在写作的读者一个可实践的方法。' }, createdAt, updatedAt, references: [], versions: [] }))
  const templates: FrameworkTemplate[] = [{ id: 'ui-template', name: '演示模板：问题与解决', sections: ['标题', '提出问题', '展开论证', '总结建议'], isDefault: true, isSystem: false, createdAt, updatedAt }]
  const frameworks: Framework[] = [{ id: 'ui-framework', topicId: topics[0].id, accountId, materialIds: [], templateId: templates[0].id, manualTopic: '演示框架：为写作留出空间', status: 'locked', currentVersionId: 'ui-framework-version', isCurrent: true, versionCount: 1, sections: [{ name: '标题', content: '演示框架：为写作留出空间' }, { name: '提出问题', content: '工具堆叠会打断思考，先确定当前创作的重点。' }, { name: '展开论证', content: '把资料整理、正文写作和辅助设置放在合理的位置。' }, { name: '总结建议', content: '先完成主要内容，再做检查与交付。' }], rawXml: '<框架><标题>演示框架：为写作留出空间</标题></框架>', createdAt, updatedAt, references: [] }]
  const reviewRoles: ReviewRole[] = [{ id: 'ui-review-role', name: '演示角色：结构编辑', systemPrompt: '检查结构、表达及论证。', extractionTag: '评审意见', extractionOccurrence: 'first', dimensions: ['结构', '表达'], sortOrder: 0, createdAt, updatedAt }]
  const reviewTasks: ReviewTask[] = [{ id: 'ui-review-task', articleId: articles[0].id, articleVersionId: articles[0].currentVersionId, articleVersionNumber: 2, roleIds: [reviewRoles[0].id], status: 'completed', failures: [], createdAt, updatedAt, opinions: [{ id: 'ui-opinion', taskId: 'ui-review-task', roleId: reviewRoles[0].id, roleName: reviewRoles[0].name, dimensions: ['结构', '表达'], overallSuggestion: '演示意见：结构清晰，可以补充一个具体的例子。', rawXml: '', extractionMatched: true, createdAt, problems: [{ id: 'ui-problem', position: '从一个问题开始', severity: 'low', issue: '演示问题：建议补充实际场景。', suggestion: '用一个读者熟悉的写作问题解释方法。', adopted: false, isManual: false, reviewKind: 'style', anchor: '好的选题可以用一句话解释' }] }] }]
  const visualPacks: VisualPack[] = [{ id: 'ui-visual-pack', kind: 'generated', articleId: articles[0].id, articleVersionId: articles[0].currentVersionId, articleStatusSnapshot: 'draft', cover: { visual: '演示方案：明亮书桌上的纸张与笔', prompt: 'A calm daylight writing desk, minimal composition, paper and pen, no text', overlayText: '给创作留出空间' }, inlineImages: [{ location: '从一个问题开始', purpose: '解释创作过程', ratio: '4:3', prompt: 'Paper notes organized into three clear groups on a desk, daylight', alt: '演示方案：整理好的写作笔记' }], releaseImages: [], rawXml: '', createdAt }]
  const layouts: ArticleLayout[] = [{ id: 'ui-layout', articleId: articles[0].id, articleVersionId: articles[0].currentVersionId, articleStatusSnapshot: 'draft', platform: 'wechat', title: summaryItems[0].title, html: '<h1>演示稿：给创作留出完整的空间</h1><p>这是一份用于检查布局的演示排版稿。</p><h2>从一个问题开始</h2><p>把资料、观点和结构分开整理，写作时就更容易保持节奏。</p>', plainText: markdown, themeId: 'wechat-green', createdAt }]
  return {
    articles, topics, schema, frameworks, templates, reviewRoles, reviewTasks, visualPacks, layouts,
    requests: [{ id: 'ui-request', kind: 'revise', articleId: articles[0].id, title: '演示记录：改稿候选', createdAt, results: [{ index: 1, status: 'succeeded', content: articles[1].rawMarkdown, completion: 'complete', message: '演示候选，用于检查对比界面', articleId: articles[1].id }, { index: 2, status: 'failed', content: '# 演示内容：尚未完成\n\n这段文字用于检查恢复内容弹窗。', completion: 'interrupted', message: '演示中断，用于检查恢复界面' }] }],
    materials: [{ id: 'ui-material', kind: 'text', origin: 'manual_text', title: '演示素材：创作工作区笔记', summary: '把资料、观点和结构分开整理，写作时更容易保持节奏。这是一条用于检查界面的演示素材。', sourceNote: '演示内容', relatedTopicId: topics[0].id, createdAt, updatedAt }],
    summaries(query = {}) {
      const matches = summaryItems.filter(item => (!query.status || item.status === query.status) && (!query.accountId || item.accountId === query.accountId) && (!query.dirtyOnly || item.hasWorkDraft) && (!query.search || `${item.title} ${articles.find(article => article.id === item.id)?.rawMarkdown}`.includes(query.search)))
      const offset = query.offset ?? 0
      return { items: matches.slice(offset, offset + (query.limit ?? 30)), total: matches.length }
    },
    backups: ['/demo/workspace/backups/2026-10-10_160000', '/demo/workspace/backups/2026-10-09_160000']
  }
}
