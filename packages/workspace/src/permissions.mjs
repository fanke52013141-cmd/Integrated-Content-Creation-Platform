export const WorkspaceRole = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  EDITOR: 'editor',
  REVIEWER: 'reviewer',
  VIEWER: 'viewer',
})

export const ArticleStatus = Object.freeze({
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
})

export const LicenseStatus = Object.freeze({
  AUTHORIZED: 'authorized',
  PENDING: 'pending',
  REVOKED: 'revoked',
})

export const Permission = Object.freeze({
  WORKSPACE_READ: 'workspace.read',
  WORKSPACE_UPDATE: 'workspace.update',
  MEMBER_READ: 'member.read',
  MEMBER_MANAGE: 'member.manage',
  BRAND_READ: 'brand.read',
  BRAND_MANAGE: 'brand.manage',
  ASSET_READ: 'asset.read',
  ASSET_MANAGE: 'asset.manage',
  ARTICLE_CREATE: 'article.create',
  ARTICLE_READ: 'article.read',
  ARTICLE_EDIT: 'article.edit',
  ARTICLE_SUBMIT: 'article.submit',
  REVIEW_APPROVE: 'review.approve',
  REVIEW_REQUEST_CHANGES: 'review.request_changes',
  COMMENT_READ: 'comment.read',
  COMMENT_CREATE: 'comment.create',
  COMMENT_RESOLVE: 'comment.resolve',
  VERSION_READ: 'version.read',
  AUDIT_READ: 'audit.read',
})

const allPermissions = Object.values(Permission)
const editorPermissions = [
  Permission.WORKSPACE_READ,
  Permission.MEMBER_READ,
  Permission.BRAND_READ,
  Permission.ASSET_READ,
  Permission.ASSET_MANAGE,
  Permission.ARTICLE_CREATE,
  Permission.ARTICLE_READ,
  Permission.ARTICLE_EDIT,
  Permission.ARTICLE_SUBMIT,
  Permission.COMMENT_READ,
  Permission.COMMENT_CREATE,
  Permission.COMMENT_RESOLVE,
  Permission.VERSION_READ,
]
const reviewerPermissions = [
  Permission.WORKSPACE_READ,
  Permission.MEMBER_READ,
  Permission.BRAND_READ,
  Permission.ASSET_READ,
  Permission.ARTICLE_READ,
  Permission.REVIEW_APPROVE,
  Permission.REVIEW_REQUEST_CHANGES,
  Permission.COMMENT_READ,
  Permission.COMMENT_CREATE,
  Permission.COMMENT_RESOLVE,
  Permission.VERSION_READ,
]
const viewerPermissions = [
  Permission.WORKSPACE_READ,
  Permission.MEMBER_READ,
  Permission.BRAND_READ,
  Permission.ASSET_READ,
  Permission.ARTICLE_READ,
  Permission.COMMENT_READ,
  Permission.VERSION_READ,
]

export const ROLE_PERMISSIONS = Object.freeze({
  [WorkspaceRole.OWNER]: Object.freeze([...allPermissions]),
  [WorkspaceRole.ADMIN]: Object.freeze([...allPermissions]),
  [WorkspaceRole.EDITOR]: Object.freeze(editorPermissions),
  [WorkspaceRole.REVIEWER]: Object.freeze(reviewerPermissions),
  [WorkspaceRole.VIEWER]: Object.freeze(viewerPermissions),
})

export function hasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function getRolePermissions(role) {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}
