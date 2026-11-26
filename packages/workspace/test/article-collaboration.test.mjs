import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArticleStatus, ROLE_PERMISSIONS, WorkspaceRole } from '../src/index.mjs'
import { actors, createArticle, errorCode, setup } from '../support/helpers.mjs'

test('article creation starts at draft revision 1 with an immutable initial version', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  assert.equal(article.status, ArticleStatus.DRAFT)
  assert.equal(article.revision, 1)
  assert.equal(article.createdBy, actors.editor)

  const versions = service.listArticleVersions({ articleId: article.id, actorId: actors.viewer })
  assert.equal(versions.length, 1)
  assert.equal(versions[0].reason, 'created')
  assert.equal(versions[0].body, 'Initial body')

  article.body = 'tampered'
  versions[0].body = 'tampered'
  assert.equal(service.getArticle({ articleId: article.id, actorId: actors.viewer }).body, 'Initial body')
  assert.equal(service.getArticleVersion({ articleId: article.id, actorId: actors.viewer, revision: 1 }).body, 'Initial body')
})

test('optimistic locking detects a stale edit without overwriting newer content', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  const updated = service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: 'Winner',
    changeSummary: 'First edit',
  })
  assert.equal(updated.revision, 2)

  const conflict = errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: 'Stale loser',
  }), 'EDIT_CONFLICT')
  assert.equal(conflict.details.actualRevision, 2)
  assert.equal(service.getArticle({ articleId: article.id, actorId: actors.editor }).body, 'Winner')
  assert.equal(service.listArticleVersions({ articleId: article.id, actorId: actors.editor }).length, 2)
})

test('no-op article edits do not create versions and updates replace metadata atomically', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  const same = service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    title: article.title,
    metadata: { channel: 'wechat' },
  })
  assert.equal(same.revision, 1)
  assert.equal(service.listArticleVersions({ articleId: article.id, actorId: actors.editor }).length, 1)

  const changed = service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    metadata: { channel: 'other', order: 2 },
  })
  assert.deepEqual(changed.metadata, { channel: 'other', order: 2 })
  assert.equal(changed.revision, 2)
})

test('draft to review to approved records reviewer, revision and review history', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  const submitted = service.submitForReview({ articleId: article.id, actorId: actors.editor, note: 'Ready' })
  assert.equal(submitted.status, ArticleStatus.IN_REVIEW)
  assert.equal(submitted.submittedRevision, 1)
  assert.equal(submitted.submittedBy, actors.editor)

  const approved = service.approveArticle({ articleId: article.id, actorId: actors.reviewer, note: 'LGTM' })
  assert.equal(approved.status, ArticleStatus.APPROVED)
  assert.equal(approved.approvedBy, actors.reviewer)
  assert.equal(approved.approvedRevision, 1)
  assert.deepEqual(approved.reviewHistory.map(event => event.action), ['submitted', 'approved'])
  assert.equal(service.listArticleVersions({ articleId: article.id, actorId: actors.reviewer }).length, 1)

  errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: 'Edit after approval',
  }), 'INVALID_STATE_TRANSITION')
  errorCode(() => service.approveArticle({ articleId: article.id, actorId: actors.reviewer }), 'INVALID_STATE_TRANSITION')
})

test('review rejection returns to an editable state and supports resubmission', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  service.submitForReview({ articleId: article.id, actorId: actors.editor })
  errorCode(() => service.requestChanges({ articleId: article.id, actorId: actors.reviewer, note: '' }), 'VALIDATION_ERROR')
  const rejected = service.requestChanges({ articleId: article.id, actorId: actors.reviewer, note: 'Add evidence' })
  assert.equal(rejected.status, ArticleStatus.CHANGES_REQUESTED)

  const edited = service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: 'Body with evidence',
  })
  assert.equal(edited.status, ArticleStatus.CHANGES_REQUESTED)
  service.submitForReview({ articleId: article.id, actorId: actors.editor, note: 'Fixed' })
  const approved = service.approveArticle({ articleId: article.id, actorId: actors.reviewer })
  assert.equal(approved.approvedRevision, 2)
  assert.deepEqual(approved.reviewHistory.map(event => event.action), [
    'submitted',
    'changes_requested',
    'submitted',
    'approved',
  ])
})

test('workflow permissions prevent self-assigned reviewer powers and reviewer edits', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  errorCode(() => service.approveArticle({ articleId: article.id, actorId: actors.editor }), 'PERMISSION_DENIED')
  errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.reviewer,
    expectedRevision: 1,
    body: 'Reviewer edit',
  }), 'PERMISSION_DENIED')
  errorCode(() => service.submitForReview({ articleId: article.id, actorId: actors.viewer }), 'PERMISSION_DENIED')

  service.submitForReview({ articleId: article.id, actorId: actors.editor })
  errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: 'Concurrent review edit',
  }), 'INVALID_STATE_TRANSITION')
})

test('empty drafts cannot enter review and article lists filter by status', () => {
  const { service, workspaceId } = setup()
  const empty = createArticle(service, workspaceId, { title: 'Empty', body: '  ' })
  errorCode(() => service.submitForReview({ articleId: empty.id, actorId: actors.editor }), 'VALIDATION_ERROR')
  const ready = createArticle(service, workspaceId, { title: 'Ready' })
  service.submitForReview({ articleId: ready.id, actorId: actors.editor })
  assert.deepEqual(
    service.listArticles({ workspaceId, actorId: actors.viewer, status: ArticleStatus.DRAFT }).map(item => item.id),
    [empty.id],
  )
  errorCode(() => service.listArticles({ workspaceId, actorId: actors.viewer, status: 'published' }), 'VALIDATION_ERROR')
})

test('restoring a version creates a new head and preserves every snapshot', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId, { body: 'v1', metadata: { keep: 1 } })
  service.updateArticle({ articleId: article.id, actorId: actors.editor, expectedRevision: 1, body: 'v2', metadata: { keep: 2 } })
  service.updateArticle({ articleId: article.id, actorId: actors.editor, expectedRevision: 2, body: 'v3' })
  const restored = service.restoreArticleVersion({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 3,
    revision: 1,
    changeSummary: 'Revert to original',
  })
  assert.equal(restored.revision, 4)
  assert.equal(restored.body, 'v1')
  assert.deepEqual(restored.metadata, { keep: 1 })

  const versions = service.listArticleVersions({ articleId: article.id, actorId: actors.editor })
  assert.deepEqual(versions.map(version => version.revision), [1, 2, 3, 4])
  assert.equal(versions[3].reason, 'restored')
  assert.equal(versions[3].restoredFromRevision, 1)
  assert.equal(versions[2].body, 'v3')
})

test('restore is also optimistic and rejects missing versions without mutation', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  service.updateArticle({ articleId: article.id, actorId: actors.editor, expectedRevision: 1, body: 'v2' })
  errorCode(() => service.restoreArticleVersion({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    revision: 1,
  }), 'EDIT_CONFLICT')
  errorCode(() => service.restoreArticleVersion({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 2,
    revision: 99,
  }), 'NOT_FOUND')
  assert.equal(service.getArticle({ articleId: article.id, actorId: actors.editor }).body, 'v2')
})

test('comments support replies, revision-bound anchors, resolution and filtering', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId, { body: 'abcdef' })
  const root = service.addComment({
    articleId: article.id,
    actorId: actors.editor,
    body: 'Check this',
    anchor: { start: 1, end: 4 },
  })
  const reply = service.addComment({
    articleId: article.id,
    actorId: actors.reviewer,
    parentId: root.id,
    body: 'Looks correct',
  })
  assert.equal(reply.parentId, root.id)
  assert.equal(reply.articleRevision, 1)
  assert.deepEqual(root.anchor, { start: 1, end: 4 })

  const resolved = service.resolveComment({ commentId: root.id, actorId: actors.reviewer })
  assert.equal(resolved.status, 'resolved')
  assert.equal(service.resolveComment({ commentId: root.id, actorId: actors.reviewer }).resolvedAt, resolved.resolvedAt)
  assert.deepEqual(
    service.listComments({ articleId: article.id, actorId: actors.viewer, status: 'open' }).map(item => item.id),
    [reply.id],
  )
  errorCode(() => service.addComment({ articleId: article.id, actorId: actors.viewer, body: 'Forbidden' }), 'PERMISSION_DENIED')
  errorCode(() => service.resolveComment({ commentId: reply.id, actorId: actors.viewer }), 'PERMISSION_DENIED')
})

test('invalid comment anchors and cross-article parents are rejected', () => {
  const { service, workspaceId } = setup()
  const first = createArticle(service, workspaceId, { body: 'short' })
  const second = createArticle(service, workspaceId)
  const root = service.addComment({ articleId: first.id, actorId: actors.editor, body: 'Root' })
  errorCode(() => service.addComment({
    articleId: first.id,
    actorId: actors.editor,
    body: 'Bad anchor',
    anchor: { start: 3, end: 2 },
  }), 'VALIDATION_ERROR')
  errorCode(() => service.addComment({
    articleId: first.id,
    actorId: actors.editor,
    body: 'Out of range',
    anchor: { start: 0, end: 100 },
  }), 'VALIDATION_ERROR')
  errorCode(() => service.addComment({
    articleId: second.id,
    actorId: actors.editor,
    parentId: root.id,
    body: 'Wrong parent',
  }), 'VALIDATION_ERROR')
})

test('article metadata accepts JSON only and cannot be mutated through input references', () => {
  const { service, workspaceId } = setup()
  const metadata = { nested: { labels: ['a'] } }
  const article = createArticle(service, workspaceId, { metadata })
  metadata.nested.labels.push('b')
  assert.deepEqual(article.metadata.nested.labels, ['a'])
  assert.deepEqual(service.getArticle({ articleId: article.id, actorId: actors.viewer }).metadata.nested.labels, ['a'])

  errorCode(() => createArticle(service, workspaceId, { metadata: { invalid: undefined } }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { metadata: { invalid: Number.NaN } }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { metadata: { invalid: () => {} } }), 'VALIDATION_ERROR')
})

test('removed members immediately lose article permissions without erasing authorship history', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  service.removeMember({ workspaceId, actorId: actors.owner, userId: actors.editor })
  errorCode(() => service.getArticle({ articleId: article.id, actorId: actors.editor }), 'PERMISSION_DENIED')
  const readable = service.getArticle({ articleId: article.id, actorId: actors.owner })
  assert.equal(readable.createdBy, actors.editor)
  assert.equal(ROLE_PERMISSIONS[WorkspaceRole.OWNER].includes('audit.read'), true)
})
