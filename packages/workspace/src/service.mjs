import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  AssetLicenseError,
  EditConflictError,
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  WorkspaceError,
} from './errors.mjs'
import {
  ArticleStatus,
  LicenseStatus,
  Permission,
  ROLE_PERMISSIONS,
  WorkspaceRole,
} from './permissions.mjs'
import {
  booleanValue,
  hasOwn,
  isoDate,
  jsonObject,
  optionalString,
  plainObject,
  requiredString,
  revisionValue,
  stringArray,
} from './validation.mjs'

const EDITABLE_STATUSES = new Set([ArticleStatus.DRAFT, ArticleStatus.CHANGES_REQUESTED])
const LICENSE_STATUSES = new Set(Object.values(LicenseStatus))

function normalizeColors(value) {
  plainObject(value, 'colors')
  return Object.fromEntries(Object.entries(value).map(([name, color]) => {
    requiredString(name, 'colors key')
    requiredString(color, `colors.${name}`)
    if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) {
      throw new ValidationError('Brand colors must use #RRGGBB or #RRGGBBAA', { field: `colors.${name}` })
    }
    return [name, color.toUpperCase()]
  }))
}

function normalizeTypography(value) {
  plainObject(value, 'typography')
  return Object.fromEntries(Object.entries(value).map(([name, font]) => [
    requiredString(name, 'typography key'),
    requiredString(font, `typography.${name}`),
  ]))
}

function normalizeRights(value) {
  plainObject(value, 'rights')
  const status = requiredString(value.status, 'rights.status')
  if (!LICENSE_STATUSES.has(status)) {
    throw new ValidationError('rights.status must be authorized, pending or revoked', { field: 'rights.status' })
  }
  const normalized = {
    license: requiredString(value.license, 'rights.license'),
    source: requiredString(value.source, 'rights.source'),
    status,
    commercialUse: booleanValue(value.commercialUse, 'rights.commercialUse'),
    modificationAllowed: booleanValue(value.modificationAllowed, 'rights.modificationAllowed'),
    restrictions: value.restrictions === undefined ? [] : stringArray(value.restrictions, 'rights.restrictions'),
    metadata: value.metadata === undefined ? {} : jsonObject(value.metadata, 'rights.metadata'),
    acquiredAt: value.acquiredAt === undefined || value.acquiredAt === null
      ? null
      : isoDate(value.acquiredAt, 'rights.acquiredAt'),
    expiresAt: value.expiresAt === undefined || value.expiresAt === null
      ? null
      : isoDate(value.expiresAt, 'rights.expiresAt'),
  }
  for (const field of ['creator', 'copyrightHolder', 'licenseUrl', 'attribution', 'evidenceRef']) {
    if (value[field] !== undefined && value[field] !== null) {
      normalized[field] = optionalString(value[field], `rights.${field}`)
    }
  }
  if (normalized.acquiredAt && normalized.expiresAt
    && Date.parse(normalized.expiresAt) <= Date.parse(normalized.acquiredAt)) {
    throw new ValidationError('rights.expiresAt must be later than rights.acquiredAt', {
      field: 'rights.expiresAt',
    })
  }
  return normalized
}

function normalizeUsage(usage) {
  plainObject(usage, 'assetUsage')
  return {
    commercial: usage.commercial === undefined ? false : booleanValue(usage.commercial, 'assetUsage.commercial'),
    modified: usage.modified === undefined ? false : booleanValue(usage.modified, 'assetUsage.modified'),
  }
}

/**
 * Synchronous, in-memory domain service. Callers must authenticate actorId at
 * their boundary; this package authorizes workspace membership and roles only.
 */
export class WorkspaceService {
  #workspaces = new Map()
  #members = new Map()
  #brandKits = new Map()
  #assets = new Map()
  #articles = new Map()
  #versions = new Map()
  #comments = new Map()
  #auditLogs = new Map()
  #clock
  #idGenerator

  constructor({ clock = () => new Date(), idGenerator = randomUUID } = {}) {
    if (typeof clock !== 'function' || typeof idGenerator !== 'function') {
      throw new TypeError('clock and idGenerator must be functions')
    }
    this.#clock = clock
    this.#idGenerator = idGenerator
  }

  #now() {
    return isoDate(this.#clock(), 'clock')
  }

  #id(prefix) {
    return `${prefix}_${requiredString(String(this.#idGenerator()), 'idGenerator result')}`
  }

  #workspaceRecord(workspaceId) {
    const id = requiredString(workspaceId, 'workspaceId')
    const workspace = this.#workspaces.get(id)
    if (!workspace) throw new NotFoundError('workspace', id)
    return workspace
  }

  #articleRecord(articleId) {
    const id = requiredString(articleId, 'articleId')
    const article = this.#articles.get(id)
    if (!article) throw new NotFoundError('article', id)
    return article
  }

  #assetRecord(assetId) {
    const id = requiredString(assetId, 'assetId')
    const asset = this.#assets.get(id)
    if (!asset) throw new NotFoundError('asset', id)
    return asset
  }

  #commentRecord(commentId) {
    const id = requiredString(commentId, 'commentId')
    const comment = this.#comments.get(id)
    if (!comment) throw new NotFoundError('comment', id)
    return comment
  }

  #authorize(workspaceId, actorId, permission) {
    const workspace = this.#workspaceRecord(workspaceId)
    const actor = requiredString(actorId, 'actorId')
    const member = this.#members.get(workspace.id)?.get(actor)
    if (!member || !ROLE_PERMISSIONS[member.role].includes(permission)) {
      throw new PermissionDeniedError(actor, permission, workspace.id)
    }
    return { workspace, actor, member }
  }

  #assertRevision(entityType, entityId, actualRevision, expectedRevision) {
    revisionValue(expectedRevision)
    if (actualRevision !== expectedRevision) {
      throw new EditConflictError({ entityType, entityId, actualRevision, expectedRevision })
    }
  }

  #audit(workspaceId, actorId, action, entityType, entityId, details = {}, occurredAt = this.#now()) {
    const entry = {
      id: this.#id('audit'),
      workspaceId,
      actorId,
      action,
      entityType,
      entityId,
      occurredAt,
      details: structuredClone(details),
    }
    this.#auditLogs.get(workspaceId).push(entry)
    return entry
  }

  createWorkspace({ name, ownerId, ownerDisplayName } = {}) {
    const id = this.#id('ws')
    const owner = requiredString(ownerId, 'ownerId')
    const occurredAt = this.#now()
    const workspace = {
      id,
      name: requiredString(name, 'name'),
      ownerId: owner,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
    this.#workspaces.set(id, workspace)
    this.#members.set(id, new Map())
    this.#auditLogs.set(id, [])
    this.#members.get(id).set(owner, {
      workspaceId: id,
      userId: owner,
      displayName: optionalString(ownerDisplayName, 'ownerDisplayName', owner),
      role: WorkspaceRole.OWNER,
      addedBy: owner,
      addedAt: occurredAt,
      updatedAt: occurredAt,
    })
    this.#audit(id, owner, 'workspace.created', 'workspace', id, { name: workspace.name }, occurredAt)
    return structuredClone(workspace)
  }

  getWorkspace({ workspaceId, actorId } = {}) {
    const { workspace } = this.#authorize(workspaceId, actorId, Permission.WORKSPACE_READ)
    return structuredClone(workspace)
  }

  updateWorkspace({ workspaceId, actorId, name } = {}) {
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.WORKSPACE_UPDATE)
    const nextName = requiredString(name, 'name')
    if (workspace.name === nextName) return structuredClone(workspace)
    const previousName = workspace.name
    const occurredAt = this.#now()
    workspace.name = nextName
    workspace.updatedAt = occurredAt
    this.#audit(workspace.id, actor, 'workspace.updated', 'workspace', workspace.id, {
      previousName,
      name: nextName,
    }, occurredAt)
    return structuredClone(workspace)
  }

  listMembers({ workspaceId, actorId } = {}) {
    const { workspace } = this.#authorize(workspaceId, actorId, Permission.MEMBER_READ)
    return structuredClone([...this.#members.get(workspace.id).values()])
  }

  addMember({ workspaceId, actorId, userId, role, displayName } = {}) {
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.MEMBER_MANAGE)
    const user = requiredString(userId, 'userId')
    const memberRole = requiredString(role, 'role')
    if (!ROLE_PERMISSIONS[memberRole]) throw new ValidationError('Unknown workspace role', { field: 'role', role })
    if (memberRole === WorkspaceRole.OWNER) {
      throw new ValidationError('The owner role is fixed at workspace creation', { field: 'role' }, 'OWNER_ROLE_RESERVED')
    }
    const members = this.#members.get(workspace.id)
    if (members.has(user)) {
      throw new WorkspaceError(`Member already exists: ${user}`, {
        code: 'MEMBER_EXISTS',
        details: { workspaceId: workspace.id, userId: user },
      })
    }
    const occurredAt = this.#now()
    const member = {
      workspaceId: workspace.id,
      userId: user,
      displayName: optionalString(displayName, 'displayName', user),
      role: memberRole,
      addedBy: actor,
      addedAt: occurredAt,
      updatedAt: occurredAt,
    }
    members.set(user, member)
    this.#audit(workspace.id, actor, 'member.added', 'member', user, { role: memberRole }, occurredAt)
    return structuredClone(member)
  }

  changeMemberRole({ workspaceId, actorId, userId, role } = {}) {
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.MEMBER_MANAGE)
    const user = requiredString(userId, 'userId')
    const member = this.#members.get(workspace.id).get(user)
    if (!member) throw new NotFoundError('member', user)
    if (member.role === WorkspaceRole.OWNER) {
      throw new WorkspaceError('The workspace owner cannot be demoted', {
        code: 'OWNER_IMMUTABLE',
        details: { workspaceId: workspace.id, userId: user },
      })
    }
    const nextRole = requiredString(role, 'role')
    if (!ROLE_PERMISSIONS[nextRole] || nextRole === WorkspaceRole.OWNER) {
      throw new ValidationError('Role must be admin, editor, reviewer or viewer', { field: 'role' })
    }
    if (member.role === nextRole) return structuredClone(member)
    const previousRole = member.role
    const occurredAt = this.#now()
    member.role = nextRole
    member.updatedAt = occurredAt
    this.#audit(workspace.id, actor, 'member.role_changed', 'member', user, {
      previousRole,
      role: nextRole,
    }, occurredAt)
    return structuredClone(member)
  }

  removeMember({ workspaceId, actorId, userId } = {}) {
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.MEMBER_MANAGE)
    const user = requiredString(userId, 'userId')
    const member = this.#members.get(workspace.id).get(user)
    if (!member) throw new NotFoundError('member', user)
    if (member.role === WorkspaceRole.OWNER) {
      throw new WorkspaceError('The workspace owner cannot be removed', {
        code: 'OWNER_IMMUTABLE',
        details: { workspaceId: workspace.id, userId: user },
      })
    }
    this.#members.get(workspace.id).delete(user)
    const occurredAt = this.#now()
    this.#audit(workspace.id, actor, 'member.removed', 'member', user, { role: member.role }, occurredAt)
    return structuredClone(member)
  }

  #brandRecord(workspaceId) {
    const brandKit = this.#brandKits.get(workspaceId)
    if (!brandKit) throw new NotFoundError('brandKit', workspaceId)
    return brandKit
  }

  #normalizeLogoAssets(workspaceId, value) {
    const assetIds = stringArray(value, 'logoAssetIds')
    for (const assetId of assetIds) {
      const asset = this.#assetRecord(assetId)
      if (asset.workspaceId !== workspaceId) {
        throw new ValidationError('Brand logos must belong to the same workspace', { field: 'logoAssetIds', assetId })
      }
    }
    return assetIds
  }

  createBrandKit(input = {}) {
    const { workspaceId, actorId } = input
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.BRAND_MANAGE)
    if (this.#brandKits.has(workspace.id)) {
      throw new WorkspaceError(`Brand kit already exists for ${workspace.id}`, {
        code: 'BRAND_KIT_EXISTS',
        details: { workspaceId: workspace.id },
      })
    }
    const occurredAt = this.#now()
    const brandKit = {
      id: this.#id('brand'),
      workspaceId: workspace.id,
      revision: 1,
      name: requiredString(input.name, 'name'),
      colors: normalizeColors(input.colors ?? {}),
      typography: normalizeTypography(input.typography ?? {}),
      logoAssetIds: this.#normalizeLogoAssets(workspace.id, input.logoAssetIds ?? []),
      voice: optionalString(input.voice, 'voice'),
      createdBy: actor,
      createdAt: occurredAt,
      updatedBy: actor,
      updatedAt: occurredAt,
    }
    this.#brandKits.set(workspace.id, brandKit)
    this.#audit(workspace.id, actor, 'brand.created', 'brandKit', brandKit.id, { revision: 1 }, occurredAt)
    return structuredClone(brandKit)
  }

  getBrandKit({ workspaceId, actorId } = {}) {
    const { workspace } = this.#authorize(workspaceId, actorId, Permission.BRAND_READ)
    return structuredClone(this.#brandRecord(workspace.id))
  }

  updateBrandKit(input = {}) {
    const { workspaceId, actorId, expectedRevision } = input
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.BRAND_MANAGE)
    const brandKit = this.#brandRecord(workspace.id)
    this.#assertRevision('brandKit', brandKit.id, brandKit.revision, expectedRevision)
    const supportedFields = ['name', 'colors', 'typography', 'logoAssetIds', 'voice']
    const changedFields = supportedFields.filter(field => hasOwn(input, field))
    if (changedFields.length === 0) throw new ValidationError('No brand kit fields supplied')
    const next = structuredClone(brandKit)
    if (hasOwn(input, 'name')) next.name = requiredString(input.name, 'name')
    if (hasOwn(input, 'colors')) next.colors = normalizeColors(input.colors)
    if (hasOwn(input, 'typography')) next.typography = normalizeTypography(input.typography)
    if (hasOwn(input, 'logoAssetIds')) next.logoAssetIds = this.#normalizeLogoAssets(workspace.id, input.logoAssetIds)
    if (hasOwn(input, 'voice')) next.voice = optionalString(input.voice, 'voice')
    if (isDeepStrictEqual(
      { name: next.name, colors: next.colors, typography: next.typography, logoAssetIds: next.logoAssetIds, voice: next.voice },
      { name: brandKit.name, colors: brandKit.colors, typography: brandKit.typography, logoAssetIds: brandKit.logoAssetIds, voice: brandKit.voice },
    )) return structuredClone(brandKit)
    const previousRevision = brandKit.revision
    const occurredAt = this.#now()
    next.revision = previousRevision + 1
    next.updatedBy = actor
    next.updatedAt = occurredAt
    this.#brandKits.set(workspace.id, next)
    this.#audit(workspace.id, actor, 'brand.updated', 'brandKit', next.id, {
      previousRevision,
      revision: next.revision,
      fields: changedFields,
    }, occurredAt)
    return structuredClone(next)
  }

  registerAsset(input = {}) {
    const { workspaceId, actorId } = input
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.ASSET_MANAGE)
    const occurredAt = this.#now()
    const asset = {
      id: this.#id('asset'),
      workspaceId: workspace.id,
      revision: 1,
      uri: requiredString(input.uri, 'uri'),
      kind: optionalString(input.kind, 'kind', 'image'),
      sha256: requiredString(input.sha256, 'sha256'),
      mimeType: requiredString(input.mimeType, 'mimeType'),
      rights: normalizeRights(input.rights),
      createdBy: actor,
      createdAt: occurredAt,
      updatedBy: actor,
      updatedAt: occurredAt,
    }
    if (!asset.kind) throw new ValidationError('kind must be a non-empty string', { field: 'kind' })
    this.#assets.set(asset.id, asset)
    this.#audit(workspace.id, actor, 'asset.registered', 'asset', asset.id, {
      revision: 1,
      license: asset.rights.license,
      licenseStatus: asset.rights.status,
    }, occurredAt)
    return structuredClone(asset)
  }

  getAsset({ assetId, actorId } = {}) {
    const asset = this.#assetRecord(assetId)
    this.#authorize(asset.workspaceId, actorId, Permission.ASSET_READ)
    return structuredClone(asset)
  }

  listAssets({ workspaceId, actorId } = {}) {
    const { workspace } = this.#authorize(workspaceId, actorId, Permission.ASSET_READ)
    return structuredClone([...this.#assets.values()].filter(asset => asset.workspaceId === workspace.id))
  }

  updateAssetRights(input = {}) {
    const { assetId, actorId, expectedRevision } = input
    const asset = this.#assetRecord(assetId)
    const { actor } = this.#authorize(asset.workspaceId, actorId, Permission.ASSET_MANAGE)
    this.#assertRevision('asset', asset.id, asset.revision, expectedRevision)
    const rights = normalizeRights(input.rights)
    if (isDeepStrictEqual(rights, asset.rights)) return structuredClone(asset)
    const previousRevision = asset.revision
    const occurredAt = this.#now()
    asset.rights = rights
    asset.revision += 1
    asset.updatedBy = actor
    asset.updatedAt = occurredAt
    this.#audit(asset.workspaceId, actor, 'asset.rights_updated', 'asset', asset.id, {
      previousRevision,
      revision: asset.revision,
      license: rights.license,
      licenseStatus: rights.status,
    }, occurredAt)
    return structuredClone(asset)
  }

  #assetUsageReport(asset, usage, checkedAt) {
    const violations = []
    if (asset.rights.status !== LicenseStatus.AUTHORIZED) {
      violations.push({ code: 'NOT_AUTHORIZED', message: `Asset authorization is ${asset.rights.status}` })
    }
    if (asset.rights.expiresAt && Date.parse(asset.rights.expiresAt) <= Date.parse(checkedAt)) {
      violations.push({ code: 'LICENSE_EXPIRED', message: `Asset license expired at ${asset.rights.expiresAt}` })
    }
    if (usage.commercial && !asset.rights.commercialUse) {
      violations.push({ code: 'COMMERCIAL_USE_FORBIDDEN', message: 'Commercial use is not allowed' })
    }
    if (usage.modified && !asset.rights.modificationAllowed) {
      violations.push({ code: 'MODIFICATION_FORBIDDEN', message: 'Asset modification is not allowed' })
    }
    return {
      assetId: asset.id,
      usable: violations.length === 0,
      violations,
    }
  }

  checkAssetUsage(input = {}) {
    const { assetId, actorId, at } = input
    const asset = this.#assetRecord(assetId)
    this.#authorize(asset.workspaceId, actorId, Permission.ASSET_READ)
    const usage = normalizeUsage(input.usage ?? {})
    const checkedAt = at === undefined ? this.#now() : isoDate(at, 'at')
    return {
      ...this.#assetUsageReport(asset, usage, checkedAt),
      checkedAt,
    }
  }

  #articleAssetReport(article, usage, checkedAt) {
    const assets = article.assetIds.map(assetId => {
      const asset = this.#assetRecord(assetId)
      return this.#assetUsageReport(asset, usage, checkedAt)
    })
    return {
      articleId: article.id,
      revision: article.revision,
      usable: assets.every(report => report.usable),
      checkedAt,
      assets,
    }
  }

  validateArticleAssets(input = {}) {
    const { articleId, actorId, at } = input
    const article = this.#articleRecord(articleId)
    this.#authorize(article.workspaceId, actorId, Permission.ARTICLE_READ)
    const usage = normalizeUsage(input.usage ?? {})
    const checkedAt = at === undefined ? this.#now() : isoDate(at, 'at')
    return this.#articleAssetReport(article, usage, checkedAt)
  }

  #normalizeArticleAssets(workspaceId, value) {
    const assetIds = stringArray(value, 'assetIds')
    for (const assetId of assetIds) {
      const asset = this.#assetRecord(assetId)
      if (asset.workspaceId !== workspaceId) {
        throw new ValidationError('Article assets must belong to the same workspace', { field: 'assetIds', assetId })
      }
    }
    return assetIds
  }

  #appendVersion(article, actorId, reason, occurredAt, { summary = '', restoredFromRevision = null } = {}) {
    const version = {
      id: this.#id('version'),
      workspaceId: article.workspaceId,
      articleId: article.id,
      revision: article.revision,
      title: article.title,
      body: article.body,
      metadata: structuredClone(article.metadata),
      assetIds: [...article.assetIds],
      reason,
      summary,
      restoredFromRevision,
      createdBy: actorId,
      createdAt: occurredAt,
    }
    this.#versions.get(article.id).push(version)
    return version
  }

  createArticle(input = {}) {
    const { workspaceId, actorId } = input
    const { workspace, actor } = this.#authorize(workspaceId, actorId, Permission.ARTICLE_CREATE)
    if (input.body !== undefined && typeof input.body !== 'string') {
      throw new ValidationError('body must be a string', { field: 'body' })
    }
    const occurredAt = this.#now()
    const article = {
      id: this.#id('article'),
      workspaceId: workspace.id,
      revision: 1,
      title: requiredString(input.title, 'title'),
      body: input.body ?? '',
      metadata: jsonObject(input.metadata ?? {}, 'metadata'),
      assetIds: this.#normalizeArticleAssets(workspace.id, input.assetIds ?? []),
      status: ArticleStatus.DRAFT,
      createdBy: actor,
      createdAt: occurredAt,
      updatedBy: actor,
      updatedAt: occurredAt,
      submittedBy: null,
      submittedAt: null,
      submittedRevision: null,
      approvedBy: null,
      approvedAt: null,
      approvedRevision: null,
      reviewHistory: [],
    }
    this.#articles.set(article.id, article)
    this.#versions.set(article.id, [])
    this.#appendVersion(article, actor, 'created', occurredAt)
    this.#audit(workspace.id, actor, 'article.created', 'article', article.id, { revision: 1 }, occurredAt)
    return structuredClone(article)
  }

  getArticle({ articleId, actorId } = {}) {
    const article = this.#articleRecord(articleId)
    this.#authorize(article.workspaceId, actorId, Permission.ARTICLE_READ)
    return structuredClone(article)
  }

  listArticles({ workspaceId, actorId, status } = {}) {
    const { workspace } = this.#authorize(workspaceId, actorId, Permission.ARTICLE_READ)
    if (status !== undefined && !Object.values(ArticleStatus).includes(status)) {
      throw new ValidationError('Unknown article status', { field: 'status', status })
    }
    return structuredClone([...this.#articles.values()].filter(article => (
      article.workspaceId === workspace.id && (status === undefined || article.status === status)
    )))
  }

  #assertArticleEditable(article) {
    if (!EDITABLE_STATUSES.has(article.status)) {
      throw new StateTransitionError('article', article.id, article.status, 'edit')
    }
  }

  updateArticle(input = {}) {
    const { articleId, actorId, expectedRevision } = input
    const article = this.#articleRecord(articleId)
    const { actor } = this.#authorize(article.workspaceId, actorId, Permission.ARTICLE_EDIT)
    this.#assertArticleEditable(article)
    this.#assertRevision('article', article.id, article.revision, expectedRevision)
    const supportedFields = ['title', 'body', 'metadata', 'assetIds']
    const changedFields = supportedFields.filter(field => hasOwn(input, field))
    if (changedFields.length === 0) throw new ValidationError('No article fields supplied')
    const next = {
      title: article.title,
      body: article.body,
      metadata: structuredClone(article.metadata),
      assetIds: [...article.assetIds],
    }
    if (hasOwn(input, 'title')) next.title = requiredString(input.title, 'title')
    if (hasOwn(input, 'body')) {
      if (typeof input.body !== 'string') throw new ValidationError('body must be a string', { field: 'body' })
      next.body = input.body
    }
    if (hasOwn(input, 'metadata')) next.metadata = jsonObject(input.metadata, 'metadata')
    if (hasOwn(input, 'assetIds')) next.assetIds = this.#normalizeArticleAssets(article.workspaceId, input.assetIds)
    if (isDeepStrictEqual(next, {
      title: article.title,
      body: article.body,
      metadata: article.metadata,
      assetIds: article.assetIds,
    })) return structuredClone(article)
    const previousRevision = article.revision
    const occurredAt = this.#now()
    article.title = next.title
    article.body = next.body
    article.metadata = next.metadata
    article.assetIds = next.assetIds
    article.revision += 1
    article.updatedBy = actor
    article.updatedAt = occurredAt
    this.#appendVersion(article, actor, 'edited', occurredAt, {
      summary: optionalString(input.changeSummary, 'changeSummary'),
    })
    this.#audit(article.workspaceId, actor, 'article.updated', 'article', article.id, {
      previousRevision,
      revision: article.revision,
      fields: changedFields,
    }, occurredAt)
    return structuredClone(article)
  }

  #appendReviewEvent(article, actor, action, from, to, note, occurredAt) {
    const event = {
      id: this.#id('review'),
      action,
      from,
      to,
      actorId: actor,
      note,
      articleRevision: article.revision,
      occurredAt,
    }
    article.reviewHistory.push(event)
    return event
  }

  submitForReview({ articleId, actorId, note } = {}) {
    const article = this.#articleRecord(articleId)
    const { actor } = this.#authorize(article.workspaceId, actorId, Permission.ARTICLE_SUBMIT)
    if (!EDITABLE_STATUSES.has(article.status)) {
      throw new StateTransitionError('article', article.id, article.status, ArticleStatus.IN_REVIEW)
    }
    if (!article.body.trim()) throw new ValidationError('An article needs a non-empty body before review', { field: 'body' })
    const reviewNote = optionalString(note, 'note')
    const from = article.status
    const occurredAt = this.#now()
    article.status = ArticleStatus.IN_REVIEW
    article.submittedBy = actor
    article.submittedAt = occurredAt
    article.submittedRevision = article.revision
    article.updatedBy = actor
    article.updatedAt = occurredAt
    this.#appendReviewEvent(article, actor, 'submitted', from, ArticleStatus.IN_REVIEW, reviewNote, occurredAt)
    this.#audit(article.workspaceId, actor, 'article.submitted', 'article', article.id, {
      from,
      to: ArticleStatus.IN_REVIEW,
      revision: article.revision,
      note: reviewNote,
    }, occurredAt)
    return structuredClone(article)
  }

  approveArticle({ articleId, actorId, note, assetUsage } = {}) {
    const article = this.#articleRecord(articleId)
    const { actor } = this.#authorize(article.workspaceId, actorId, Permission.REVIEW_APPROVE)
    if (article.status !== ArticleStatus.IN_REVIEW) {
      throw new StateTransitionError('article', article.id, article.status, ArticleStatus.APPROVED)
    }
    const usage = normalizeUsage(assetUsage ?? {})
    const occurredAt = this.#now()
    const report = this.#articleAssetReport(article, usage, occurredAt)
    if (!report.usable) throw new AssetLicenseError(article.id, report)
    const reviewNote = optionalString(note, 'note')
    const from = article.status
    article.status = ArticleStatus.APPROVED
    article.approvedBy = actor
    article.approvedAt = occurredAt
    article.approvedRevision = article.revision
    article.updatedBy = actor
    article.updatedAt = occurredAt
    this.#appendReviewEvent(article, actor, 'approved', from, ArticleStatus.APPROVED, reviewNote, occurredAt)
    this.#audit(article.workspaceId, actor, 'article.approved', 'article', article.id, {
      from,
      to: ArticleStatus.APPROVED,
      revision: article.revision,
      note: reviewNote,
      assetUsage: usage,
    }, occurredAt)
    return structuredClone(article)
  }

  requestChanges({ articleId, actorId, note } = {}) {
    const article = this.#articleRecord(articleId)
    const { actor } = this.#authorize(article.workspaceId, actorId, Permission.REVIEW_REQUEST_CHANGES)
    if (article.status !== ArticleStatus.IN_REVIEW) {
      throw new StateTransitionError('article', article.id, article.status, ArticleStatus.CHANGES_REQUESTED)
    }
    const reviewNote = requiredString(note, 'note')
    const from = article.status
    const occurredAt = this.#now()
    article.status = ArticleStatus.CHANGES_REQUESTED
    article.updatedBy = actor
    article.updatedAt = occurredAt
    this.#appendReviewEvent(article, actor, 'changes_requested', from, ArticleStatus.CHANGES_REQUESTED, reviewNote, occurredAt)
    this.#audit(article.workspaceId, actor, 'article.changes_requested', 'article', article.id, {
      from,
      to: ArticleStatus.CHANGES_REQUESTED,
      revision: article.revision,
      note: reviewNote,
    }, occurredAt)
    return structuredClone(article)
  }

  listArticleVersions({ articleId, actorId } = {}) {
    const article = this.#articleRecord(articleId)
    this.#authorize(article.workspaceId, actorId, Permission.VERSION_READ)
    return structuredClone(this.#versions.get(article.id))
  }

  getArticleVersion({ articleId, actorId, revision } = {}) {
    const article = this.#articleRecord(articleId)
    this.#authorize(article.workspaceId, actorId, Permission.VERSION_READ)
    revisionValue(revision, 'revision')
    const version = this.#versions.get(article.id).find(item => item.revision === revision)
    if (!version) throw new NotFoundError('articleVersion', `${article.id}@${revision}`)
    return structuredClone(version)
  }

  restoreArticleVersion(input = {}) {
    const { articleId, actorId, revision, expectedRevision } = input
    const article = this.#articleRecord(articleId)
    const { actor } = this.#authorize(article.workspaceId, actorId, Permission.ARTICLE_EDIT)
    this.#assertArticleEditable(article)
    this.#assertRevision('article', article.id, article.revision, expectedRevision)
    revisionValue(revision, 'revision')
    const source = this.#versions.get(article.id).find(item => item.revision === revision)
    if (!source) throw new NotFoundError('articleVersion', `${article.id}@${revision}`)
    const previousRevision = article.revision
    const occurredAt = this.#now()
    article.title = source.title
    article.body = source.body
    article.metadata = structuredClone(source.metadata)
    article.assetIds = [...source.assetIds]
    article.revision += 1
    article.updatedBy = actor
    article.updatedAt = occurredAt
    this.#appendVersion(article, actor, 'restored', occurredAt, {
      summary: optionalString(input.changeSummary, 'changeSummary'),
      restoredFromRevision: source.revision,
    })
    this.#audit(article.workspaceId, actor, 'article.version_restored', 'article', article.id, {
      previousRevision,
      revision: article.revision,
      restoredFromRevision: source.revision,
    }, occurredAt)
    return structuredClone(article)
  }

  addComment(input = {}) {
    const { articleId, actorId, parentId } = input
    const article = this.#articleRecord(articleId)
    const { actor } = this.#authorize(article.workspaceId, actorId, Permission.COMMENT_CREATE)
    const body = requiredString(input.body, 'body')
    let parent = null
    if (parentId !== undefined && parentId !== null) {
      parent = this.#commentRecord(parentId)
      if (parent.articleId !== article.id) {
        throw new ValidationError('A comment parent must belong to the same article', { field: 'parentId' })
      }
    }
    let anchor = null
    if (input.anchor !== undefined && input.anchor !== null) {
      plainObject(input.anchor, 'anchor')
      const { start, end } = input.anchor
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || end > article.body.length) {
        throw new ValidationError('anchor must satisfy 0 <= start <= end <= body length', { field: 'anchor' })
      }
      anchor = { start, end }
    }
    const occurredAt = this.#now()
    const comment = {
      id: this.#id('comment'),
      workspaceId: article.workspaceId,
      articleId: article.id,
      articleRevision: article.revision,
      parentId: parent?.id ?? null,
      body,
      anchor,
      status: 'open',
      createdBy: actor,
      createdAt: occurredAt,
      resolvedBy: null,
      resolvedAt: null,
    }
    this.#comments.set(comment.id, comment)
    this.#audit(article.workspaceId, actor, 'comment.added', 'comment', comment.id, {
      articleId: article.id,
      articleRevision: article.revision,
      parentId: comment.parentId,
    }, occurredAt)
    return structuredClone(comment)
  }

  listComments({ articleId, actorId, status } = {}) {
    const article = this.#articleRecord(articleId)
    this.#authorize(article.workspaceId, actorId, Permission.COMMENT_READ)
    if (status !== undefined && status !== 'open' && status !== 'resolved') {
      throw new ValidationError('Comment status must be open or resolved', { field: 'status' })
    }
    return structuredClone([...this.#comments.values()].filter(comment => (
      comment.articleId === article.id && (status === undefined || comment.status === status)
    )))
  }

  resolveComment({ commentId, actorId } = {}) {
    const comment = this.#commentRecord(commentId)
    const { actor } = this.#authorize(comment.workspaceId, actorId, Permission.COMMENT_RESOLVE)
    if (comment.status === 'resolved') return structuredClone(comment)
    const occurredAt = this.#now()
    comment.status = 'resolved'
    comment.resolvedBy = actor
    comment.resolvedAt = occurredAt
    this.#audit(comment.workspaceId, actor, 'comment.resolved', 'comment', comment.id, {
      articleId: comment.articleId,
    }, occurredAt)
    return structuredClone(comment)
  }

  listAuditLogs({ workspaceId, actorId, filters = {}, limit = 100, offset = 0 } = {}) {
    const { workspace } = this.#authorize(workspaceId, actorId, Permission.AUDIT_READ)
    plainObject(filters, 'filters')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new ValidationError('limit must be an integer between 1 and 500', { field: 'limit' })
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new ValidationError('offset must be a non-negative integer', { field: 'offset' })
    }
    const items = this.#auditLogs.get(workspace.id).filter(entry => (
      (filters.action === undefined || entry.action === filters.action)
      && (filters.entityType === undefined || entry.entityType === filters.entityType)
      && (filters.entityId === undefined || entry.entityId === filters.entityId)
      && (filters.subjectActorId === undefined || entry.actorId === filters.subjectActorId)
    ))
    return structuredClone({
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
    })
  }
}

export function createWorkspaceService(options) {
  return new WorkspaceService(options)
}
