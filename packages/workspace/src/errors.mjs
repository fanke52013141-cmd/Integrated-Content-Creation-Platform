export class WorkspaceError extends Error {
  constructor(message, { code = 'WORKSPACE_ERROR', details = {}, cause } = {}) {
    super(message, { cause })
    this.name = new.target.name
    this.code = code
    this.details = structuredClone(details)
  }
}

export class ValidationError extends WorkspaceError {
  constructor(message, details = {}, code = 'VALIDATION_ERROR') {
    super(message, { code, details })
  }
}

export class NotFoundError extends WorkspaceError {
  constructor(entityType, entityId) {
    super(`${entityType} not found: ${entityId}`, {
      code: 'NOT_FOUND',
      details: { entityType, entityId },
    })
  }
}

export class PermissionDeniedError extends WorkspaceError {
  constructor(actorId, permission, workspaceId) {
    super(`Actor ${actorId} lacks permission ${permission}`, {
      code: 'PERMISSION_DENIED',
      details: { actorId, permission, workspaceId },
    })
  }
}

export class StateTransitionError extends WorkspaceError {
  constructor(entityType, entityId, from, to) {
    super(`${entityType} ${entityId} cannot transition from ${from} to ${to}`, {
      code: 'INVALID_STATE_TRANSITION',
      details: { entityType, entityId, from, to },
    })
  }
}

export class EditConflictError extends WorkspaceError {
  constructor({ entityType, entityId, expectedRevision, actualRevision }) {
    super(`${entityType} ${entityId} has revision ${actualRevision}; expected ${expectedRevision}`, {
      code: 'EDIT_CONFLICT',
      details: { entityType, entityId, expectedRevision, actualRevision },
    })
  }
}

export class AssetLicenseError extends WorkspaceError {
  constructor(articleId, report) {
    super(`Article ${articleId} contains assets that are not licensed for this use`, {
      code: 'ASSET_LICENSE_BLOCKED',
      details: { articleId, report },
    })
  }
}
