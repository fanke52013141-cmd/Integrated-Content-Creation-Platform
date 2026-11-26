import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actors, createArticle, errorCode, license, registerAsset, setup } from '../support/helpers.mjs'

test('asset registration preserves complete rights metadata with defensive copies', () => {
  const { service, workspaceId } = setup()
  const inputRights = license()
  const asset = registerAsset(service, workspaceId, { rights: inputRights })
  inputRights.metadata.territory = 'tampered'
  asset.rights.license = 'tampered'

  const stored = service.getAsset({ assetId: asset.id, actorId: actors.viewer })
  assert.equal(stored.rights.license, 'CC BY 4.0')
  assert.equal(stored.rights.metadata.territory, 'worldwide')
  assert.equal(stored.rights.acquiredAt, '2025-01-01T00:00:00.000Z')
  assert.equal(stored.rights.expiresAt, '2030-01-01T00:00:00.000Z')
  assert.equal(service.listAssets({ workspaceId, actorId: actors.viewer }).length, 1)
  errorCode(() => registerAsset(service, workspaceId, { actorId: actors.reviewer }), 'PERMISSION_DENIED')
})

test('rights metadata fails closed on missing fields and invalid dates', () => {
  const { service, workspaceId } = setup()
  for (const rights of [
    { ...license(), license: '' },
    { ...license(), source: '' },
    { ...license(), status: 'unknown' },
    { ...license(), commercialUse: 'yes' },
    { ...license(), modificationAllowed: undefined },
    { ...license(), acquiredAt: 'not-a-date' },
    { ...license(), acquiredAt: '2026-01-01', expiresAt: '2025-01-01' },
    { ...license(), metadata: { bad: Number.POSITIVE_INFINITY } },
  ]) {
    errorCode(() => registerAsset(service, workspaceId, { rights }), 'VALIDATION_ERROR')
  }
})

test('usage checks report commercial, modification and expiry violations together', () => {
  const { service, workspaceId } = setup()
  const asset = registerAsset(service, workspaceId, {
    rights: license({ commercialUse: false, modificationAllowed: false }),
  })
  const report = service.checkAssetUsage({
    assetId: asset.id,
    actorId: actors.viewer,
    usage: { commercial: true, modified: true },
    at: '2031-01-01T00:00:00Z',
  })
  assert.equal(report.usable, false)
  assert.deepEqual(report.violations.map(item => item.code), [
    'LICENSE_EXPIRED',
    'COMMERCIAL_USE_FORBIDDEN',
    'MODIFICATION_FORBIDDEN',
  ])
  assert.equal(service.checkAssetUsage({
    assetId: asset.id,
    actorId: actors.viewer,
    usage: { commercial: false, modified: false },
    at: '2026-01-01T00:00:00Z',
  }).usable, true)
})

test('pending and revoked licenses are not usable even when other terms allow use', () => {
  const { service, workspaceId } = setup()
  for (const status of ['pending', 'revoked']) {
    const asset = registerAsset(service, workspaceId, { rights: license({ status }) })
    const report = service.checkAssetUsage({ assetId: asset.id, actorId: actors.reviewer })
    assert.equal(report.usable, false)
    assert.equal(report.violations[0].code, 'NOT_AUTHORIZED')
  }
})

test('article rights report checks every referenced asset at one revision', () => {
  const { service, workspaceId } = setup()
  const allowed = registerAsset(service, workspaceId, { uri: 'asset://allowed' })
  const restricted = registerAsset(service, workspaceId, {
    uri: 'asset://restricted',
    rights: license({ commercialUse: false }),
  })
  const article = createArticle(service, workspaceId, { assetIds: [allowed.id, restricted.id] })
  const report = service.validateArticleAssets({
    articleId: article.id,
    actorId: actors.reviewer,
    usage: { commercial: true, modified: true },
  })
  assert.equal(report.revision, 1)
  assert.equal(report.assets.length, 2)
  assert.equal(report.usable, false)
  assert.equal(report.assets[0].usable, true)
  assert.equal(report.assets[1].violations[0].code, 'COMMERCIAL_USE_FORBIDDEN')

  const noAssets = createArticle(service, workspaceId)
  assert.equal(service.validateArticleAssets({ articleId: noAssets.id, actorId: actors.viewer }).usable, true)
})

test('approval is blocked by asset rights and can proceed after rights are corrected', () => {
  const { service, workspaceId } = setup()
  const asset = registerAsset(service, workspaceId, {
    rights: license({ commercialUse: false }),
  })
  const article = createArticle(service, workspaceId, { assetIds: [asset.id] })
  service.submitForReview({ articleId: article.id, actorId: actors.editor })
  const blocked = errorCode(() => service.approveArticle({
    articleId: article.id,
    actorId: actors.reviewer,
    assetUsage: { commercial: true },
  }), 'ASSET_LICENSE_BLOCKED')
  assert.equal(blocked.details.report.assets[0].usable, false)
  assert.equal(service.getArticle({ articleId: article.id, actorId: actors.reviewer }).status, 'in_review')

  service.updateAssetRights({
    assetId: asset.id,
    actorId: actors.editor,
    expectedRevision: 1,
    rights: license({ commercialUse: true }),
  })
  const approved = service.approveArticle({
    articleId: article.id,
    actorId: actors.reviewer,
    assetUsage: { commercial: true },
  })
  assert.equal(approved.status, 'approved')
})

test('asset rights updates use optimistic locking and revocation takes effect immediately', () => {
  const { service, workspaceId } = setup()
  const asset = registerAsset(service, workspaceId)
  const updated = service.updateAssetRights({
    assetId: asset.id,
    actorId: actors.editor,
    expectedRevision: 1,
    rights: license({ status: 'revoked' }),
  })
  assert.equal(updated.revision, 2)
  assert.equal(service.checkAssetUsage({ assetId: asset.id, actorId: actors.viewer }).usable, false)
  errorCode(() => service.updateAssetRights({
    assetId: asset.id,
    actorId: actors.editor,
    expectedRevision: 1,
    rights: license(),
  }), 'EDIT_CONFLICT')
  assert.equal(service.getAsset({ assetId: asset.id, actorId: actors.viewer }).rights.status, 'revoked')
})

test('article and brand references cannot cross workspace boundaries', () => {
  const { service, workspaceId } = setup()
  const second = service.createWorkspace({ name: 'Second', ownerId: actors.owner })
  const foreign = service.registerAsset({
    workspaceId: second.id,
    actorId: actors.owner,
    uri: 'asset://foreign',
    sha256: 'b'.repeat(64),
    mimeType: 'image/png',
    rights: license(),
  })
  errorCode(() => createArticle(service, workspaceId, { assetIds: [foreign.id] }), 'VALIDATION_ERROR')
  errorCode(() => service.createBrandKit({
    workspaceId,
    actorId: actors.owner,
    name: 'Foreign logo',
    logoAssetIds: [foreign.id],
  }), 'VALIDATION_ERROR')
  errorCode(() => service.getAsset({ assetId: foreign.id, actorId: actors.editor }), 'PERMISSION_DENIED')
})

test('audit log records ordered successful mutations with actor, entity and details', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  service.updateArticle({ articleId: article.id, actorId: actors.editor, expectedRevision: 1, body: 'v2' })
  const comment = service.addComment({ articleId: article.id, actorId: actors.editor, body: 'Question' })
  service.resolveComment({ commentId: comment.id, actorId: actors.reviewer })

  const all = service.listAuditLogs({ workspaceId, actorId: actors.admin, limit: 500 })
  assert.equal(all.total, 9)
  assert.deepEqual(all.items.slice(-4).map(entry => entry.action), [
    'article.created',
    'article.updated',
    'comment.added',
    'comment.resolved',
  ])
  const last = all.items.at(-1)
  assert.equal(last.actorId, actors.reviewer)
  assert.equal(last.entityId, comment.id)
  assert.equal(last.details.articleId, article.id)
  assert.match(last.id, /^audit_/)

  const filtered = service.listAuditLogs({
    workspaceId,
    actorId: actors.owner,
    filters: { entityType: 'article', entityId: article.id, subjectActorId: actors.editor },
  })
  assert.deepEqual(filtered.items.map(entry => entry.action), ['article.created', 'article.updated'])
  const page = service.listAuditLogs({ workspaceId, actorId: actors.owner, limit: 2, offset: 1 })
  assert.equal(page.items.length, 2)
  assert.equal(page.total, all.total)
  errorCode(() => service.listAuditLogs({ workspaceId, actorId: actors.editor }), 'PERMISSION_DENIED')
})

test('failed writes and no-op writes do not create misleading audit records', () => {
  const { service, workspaceId } = setup()
  const article = createArticle(service, workspaceId)
  const before = service.listAuditLogs({ workspaceId, actorId: actors.owner, limit: 500 }).total
  errorCode(() => service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 99,
    body: 'Conflict',
  }), 'EDIT_CONFLICT')
  errorCode(() => service.addComment({ articleId: article.id, actorId: actors.viewer, body: 'Denied' }), 'PERMISSION_DENIED')
  service.updateArticle({
    articleId: article.id,
    actorId: actors.editor,
    expectedRevision: 1,
    body: article.body,
  })
  const after = service.listAuditLogs({ workspaceId, actorId: actors.owner, limit: 500 }).total
  assert.equal(after, before)
})

test('audit snapshots and validation limits cannot be bypassed through returned objects', () => {
  const { service, workspaceId } = setup()
  const first = service.listAuditLogs({ workspaceId, actorId: actors.owner })
  first.items[0].details.name = 'tampered'
  first.items[0].actorId = 'tampered'
  const second = service.listAuditLogs({ workspaceId, actorId: actors.owner })
  assert.notEqual(second.items[0].details.name, 'tampered')
  assert.equal(second.items[0].actorId, actors.owner)
  errorCode(() => service.listAuditLogs({ workspaceId, actorId: actors.owner, limit: 0 }), 'VALIDATION_ERROR')
  errorCode(() => service.listAuditLogs({ workspaceId, actorId: actors.owner, limit: 501 }), 'VALIDATION_ERROR')
  errorCode(() => service.listAuditLogs({ workspaceId, actorId: actors.owner, offset: -1 }), 'VALIDATION_ERROR')
})
