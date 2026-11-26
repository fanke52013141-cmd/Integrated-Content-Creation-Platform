import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkspaceService, createWorkspaceService } from '../src/index.mjs'
import { actors, createArticle, errorCode, registerAsset, setup } from '../support/helpers.mjs'

test('factory creates a service and constructor validates injected dependencies', () => {
  const service = createWorkspaceService()
  assert.ok(service instanceof WorkspaceService)
  const workspace = service.createWorkspace({ name: 'Default dependencies', ownerId: 'owner' })
  assert.ok(workspace.id)
  assert.throws(() => new WorkspaceService({ clock: null }), TypeError)
  assert.throws(() => new WorkspaceService({ idGenerator: 'not-a-function' }), TypeError)

  const invalidClock = new WorkspaceService({ clock: () => 'invalid-date' })
  errorCode(() => invalidClock.createWorkspace({ name: 'Invalid clock', ownerId: 'owner' }), 'VALIDATION_ERROR')
})

test('invalid workflow calls are rejected before changing state', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  errorCode(() => createArticle(service, workspaceId, { body: 42 }), 'VALIDATION_ERROR')
  errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: 42,
  }), 'VALIDATION_ERROR')
  errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 0,
    body: 'Invalid revision',
  }), 'VALIDATION_ERROR')
  errorCode(() => service.requestChanges({ articleId: article.id, actorId: actors.reviewer, note: 'Too early' }), 'INVALID_STATE_TRANSITION')
  service.submitForReview({ articleId: article.id, actorId: actors.editor })
  errorCode(() => service.submitForReview({ articleId: article.id, actorId: actors.editor }), 'INVALID_STATE_TRANSITION')
  errorCode(() => service.listComments({ articleId: article.id, actorId: actors.viewer, status: 'deleted' }), 'VALIDATION_ERROR')
  assert.equal(service.getArticle({ articleId: article.id, actorId: actors.viewer }).status, 'in_review')
})

test('plain objects, unique lists, optional strings and reserved JSON keys are validated', () => {
  const { service, workspaceId } = setup()
  errorCode(() => service.createBrandKit({
    workspaceId,
    actorId: actors.owner,
    name: 'Invalid voice',
    voice: 42,
  }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { metadata: [] }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { metadata: new Date() }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, {
    metadata: JSON.parse('{"__proto__":{"polluted":true}}'),
  }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { assetIds: 'asset-1' }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { assetIds: ['same', 'same'] }), 'VALIDATION_ERROR')
  errorCode(() => createArticle(service, workspaceId, { assetIds: ['missing'] }), 'NOT_FOUND')
  const asset = registerAsset(service, workspaceId)
  errorCode(() => createArticle(service, workspaceId, { assetIds: [asset.id, asset.id] }), 'VALIDATION_ERROR')
  errorCode(() => registerAsset(service, workspaceId, { kind: '' }), 'VALIDATION_ERROR')
  errorCode(() => service.changeMemberRole({
    workspaceId,
    actorId: actors.owner,
    userId: actors.editor,
    role: 'owner',
  }), 'VALIDATION_ERROR')
})

test('usage options and audit filter containers are strictly validated', () => {
  const { service, workspaceId } = setup()
  const asset = registerAsset(service, workspaceId)
  errorCode(() => service.checkAssetUsage({ assetId: asset.id, actorId: actors.viewer, usage: [] }), 'VALIDATION_ERROR')
  errorCode(() => service.checkAssetUsage({
    assetId: asset.id,
    actorId: actors.viewer,
    usage: { commercial: 'yes' },
  }), 'VALIDATION_ERROR')
  errorCode(() => service.checkAssetUsage({ assetId: asset.id, actorId: actors.viewer, at: 'bad-date' }), 'VALIDATION_ERROR')
  errorCode(() => service.listAuditLogs({ workspaceId, actorId: actors.owner, filters: [] }), 'VALIDATION_ERROR')
})
