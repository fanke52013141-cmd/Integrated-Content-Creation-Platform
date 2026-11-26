import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  Permission,
  ROLE_PERMISSIONS,
  WorkspaceRole,
  getRolePermissions,
  hasPermission,
} from '../src/index.mjs'
import { actors, errorCode, registerAsset, setup } from '../support/helpers.mjs'

test('workspace creation installs a fixed owner and defensive read snapshots', () => {
  const { service, workspaceId } = setup()
  const workspace = service.getWorkspace({ workspaceId, actorId: actors.viewer })
  assert.equal(workspace.ownerId, actors.owner)
  assert.match(workspace.createdAt, /^2026-01-01T/)

  const members = service.listMembers({ workspaceId, actorId: actors.viewer })
  assert.equal(members.length, 5)
  assert.equal(members.find(member => member.userId === actors.owner).role, WorkspaceRole.OWNER)

  workspace.name = 'tampered'
  members[0].role = WorkspaceRole.VIEWER
  assert.notEqual(service.getWorkspace({ workspaceId, actorId: actors.owner }).name, 'tampered')
  assert.equal(
    service.listMembers({ workspaceId, actorId: actors.owner })[0].role,
    WorkspaceRole.OWNER,
  )
})

test('role matrix separates editing, review and audit capabilities', () => {
  assert.equal(hasPermission(WorkspaceRole.EDITOR, Permission.ARTICLE_EDIT), true)
  assert.equal(hasPermission(WorkspaceRole.EDITOR, Permission.REVIEW_APPROVE), false)
  assert.equal(hasPermission(WorkspaceRole.REVIEWER, Permission.REVIEW_APPROVE), true)
  assert.equal(hasPermission(WorkspaceRole.REVIEWER, Permission.ARTICLE_EDIT), false)
  assert.equal(hasPermission(WorkspaceRole.VIEWER, Permission.COMMENT_CREATE), false)
  assert.equal(hasPermission(WorkspaceRole.ADMIN, Permission.AUDIT_READ), true)
  assert.equal(hasPermission('unknown', Permission.WORKSPACE_READ), false)
  assert.deepEqual(getRolePermissions('unknown'), [])
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS[WorkspaceRole.OWNER]))
})

test('member management enforces permissions, owner invariants and immediate revocation', () => {
  const { service, workspaceId } = setup()
  const member = service.addMember({
    workspaceId,
    actorId: actors.admin,
    userId: 'contractor',
    role: WorkspaceRole.EDITOR,
  })
  assert.equal(member.addedBy, actors.admin)

  const promoted = service.changeMemberRole({
    workspaceId,
    actorId: actors.admin,
    userId: 'contractor',
    role: WorkspaceRole.REVIEWER,
  })
  assert.equal(promoted.role, WorkspaceRole.REVIEWER)
  assert.equal(service.changeMemberRole({
    workspaceId,
    actorId: actors.admin,
    userId: 'contractor',
    role: WorkspaceRole.REVIEWER,
  }).updatedAt, promoted.updatedAt)

  service.removeMember({ workspaceId, actorId: actors.admin, userId: 'contractor' })
  errorCode(() => service.getWorkspace({ workspaceId, actorId: 'contractor' }), 'PERMISSION_DENIED')
  errorCode(() => service.removeMember({ workspaceId, actorId: actors.editor, userId: actors.viewer }), 'PERMISSION_DENIED')
  errorCode(() => service.removeMember({ workspaceId, actorId: actors.owner, userId: actors.owner }), 'OWNER_IMMUTABLE')
  errorCode(() => service.changeMemberRole({
    workspaceId,
    actorId: actors.owner,
    userId: actors.owner,
    role: WorkspaceRole.ADMIN,
  }), 'OWNER_IMMUTABLE')
})

test('invalid members, duplicate membership and outsiders are rejected', () => {
  const { service, workspaceId } = setup()
  errorCode(() => service.addMember({
    workspaceId,
    actorId: actors.owner,
    userId: 'new-owner',
    role: WorkspaceRole.OWNER,
  }), 'OWNER_ROLE_RESERVED')
  errorCode(() => service.addMember({
    workspaceId,
    actorId: actors.owner,
    userId: 'duplicate',
    role: 'superuser',
  }), 'VALIDATION_ERROR')
  service.addMember({ workspaceId, actorId: actors.owner, userId: 'duplicate', role: WorkspaceRole.VIEWER })
  errorCode(() => service.addMember({
    workspaceId,
    actorId: actors.owner,
    userId: 'duplicate',
    role: WorkspaceRole.VIEWER,
  }), 'MEMBER_EXISTS')
  errorCode(() => service.getWorkspace({ workspaceId, actorId: actors.outsider }), 'PERMISSION_DENIED')
  errorCode(() => service.getWorkspace({ workspaceId: 'missing', actorId: actors.owner }), 'NOT_FOUND')
})

test('workspace rename is authorized and idempotent for unchanged input', () => {
  const { service, workspaceId } = setup()
  errorCode(() => service.updateWorkspace({ workspaceId, actorId: actors.editor, name: 'Blocked' }), 'PERMISSION_DENIED')
  const renamed = service.updateWorkspace({ workspaceId, actorId: actors.admin, name: '  新团队名  ' })
  assert.equal(renamed.name, '新团队名')
  const unchanged = service.updateWorkspace({ workspaceId, actorId: actors.admin, name: '新团队名' })
  assert.equal(unchanged.updatedAt, renamed.updatedAt)
})

test('brand kit stores colors, typography, voice and logo references', () => {
  const { service, workspaceId } = setup()
  const logo = registerAsset(service, workspaceId)
  const brand = service.createBrandKit({
    workspaceId,
    actorId: actors.admin,
    name: '主品牌',
    colors: { primary: '#a1b2c3', overlay: '#00000080' },
    typography: { heading: 'Inter', body: 'Noto Sans SC' },
    logoAssetIds: [logo.id],
    voice: '专业、清晰',
  })
  assert.equal(brand.revision, 1)
  assert.equal(brand.colors.primary, '#A1B2C3')
  assert.deepEqual(brand.logoAssetIds, [logo.id])
  assert.deepEqual(service.getBrandKit({ workspaceId, actorId: actors.viewer }), brand)
  errorCode(() => service.createBrandKit({ workspaceId, actorId: actors.owner, name: 'Duplicate' }), 'BRAND_KIT_EXISTS')
  errorCode(() => service.createBrandKit({ workspaceId: 'missing', actorId: actors.owner, name: 'Missing' }), 'NOT_FOUND')
})

test('brand updates use optimistic locking and do not version no-op writes', () => {
  const { service, workspaceId } = setup()
  const brand = service.createBrandKit({ workspaceId, actorId: actors.owner, name: 'Brand', colors: { primary: '#112233' } })
  const updated = service.updateBrandKit({
    workspaceId,
    actorId: actors.owner,
    expectedRevision: 1,
    typography: { body: 'Inter' },
    voice: 'Clear',
  })
  assert.equal(updated.revision, 2)
  assert.equal(updated.name, 'Brand')

  const conflict = errorCode(() => service.updateBrandKit({
    workspaceId,
    actorId: actors.owner,
    expectedRevision: 1,
    name: 'Stale overwrite',
  }), 'EDIT_CONFLICT')
  assert.deepEqual(conflict.details, {
    entityType: 'brandKit',
    entityId: brand.id,
    expectedRevision: 1,
    actualRevision: 2,
  })
  assert.equal(service.getBrandKit({ workspaceId, actorId: actors.owner }).name, 'Brand')

  const noOp = service.updateBrandKit({
    workspaceId,
    actorId: actors.owner,
    expectedRevision: 2,
    voice: 'Clear',
  })
  assert.equal(noOp.revision, 2)
})

test('brand validation rejects malformed colors and foreign logo assets', () => {
  const { service, workspaceId } = setup()
  const second = service.createWorkspace({ name: 'Second', ownerId: actors.owner })
  const foreignLogo = service.registerAsset({
    workspaceId: second.id,
    actorId: actors.owner,
    uri: 'asset://foreign-logo',
    sha256: 'b'.repeat(64),
    mimeType: 'image/png',
    rights: {
      license: 'Proprietary',
      source: 'second-workspace',
      status: 'authorized',
      commercialUse: true,
      modificationAllowed: true,
    },
  })
  errorCode(() => service.createBrandKit({
    workspaceId,
    actorId: actors.owner,
    name: 'Bad color',
    colors: { primary: 'red' },
  }), 'VALIDATION_ERROR')
  errorCode(() => service.createBrandKit({
    workspaceId,
    actorId: actors.owner,
    name: 'Foreign logo',
    logoAssetIds: [foreignLogo.id],
  }), 'VALIDATION_ERROR')
  errorCode(() => service.createBrandKit({
    workspaceId,
    actorId: actors.viewer,
    name: 'Forbidden',
  }), 'PERMISSION_DENIED')
})
