import { WorkspaceService, WorkspaceRole } from '../src/index.mjs'

export const actors = Object.freeze({
  owner: 'user-owner',
  admin: 'user-admin',
  editor: 'user-editor',
  reviewer: 'user-reviewer',
  viewer: 'user-viewer',
  outsider: 'user-outsider',
})

export function setup() {
  let tick = 0
  let id = 0
  const service = new WorkspaceService({
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idGenerator: () => String(++id),
  })
  const workspace = service.createWorkspace({
    name: '内容团队',
    ownerId: actors.owner,
    ownerDisplayName: 'Owner',
  })
  for (const [key, role] of [
    ['admin', WorkspaceRole.ADMIN],
    ['editor', WorkspaceRole.EDITOR],
    ['reviewer', WorkspaceRole.REVIEWER],
    ['viewer', WorkspaceRole.VIEWER],
  ]) {
    service.addMember({
      workspaceId: workspace.id,
      actorId: actors.owner,
      userId: actors[key],
      role,
    })
  }
  return { service, workspaceId: workspace.id, workspace }
}

export function license(overrides = {}) {
  return {
    license: 'CC BY 4.0',
    source: 'https://example.test/asset',
    creator: 'Creator',
    copyrightHolder: 'Example',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Creator / Example',
    status: 'authorized',
    commercialUse: true,
    modificationAllowed: true,
    acquiredAt: '2025-01-01T00:00:00Z',
    expiresAt: '2030-01-01T00:00:00Z',
    evidenceRef: 'rights-file-1',
    restrictions: [],
    metadata: { territory: 'worldwide' },
    ...overrides,
  }
}

export function registerAsset(service, workspaceId, overrides = {}) {
  return service.registerAsset({
    workspaceId,
    actorId: actors.editor,
    uri: 'asset://image-1',
    kind: 'image',
    sha256: 'a'.repeat(64),
    mimeType: 'image/png',
    rights: license(),
    ...overrides,
  })
}

export function createArticle(service, workspaceId, overrides = {}) {
  return service.createArticle({
    workspaceId,
    actorId: actors.editor,
    title: '第一篇文章',
    body: 'Initial body',
    metadata: { channel: 'wechat' },
    ...overrides,
  })
}

export function errorCode(action, code) {
  let thrown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  if (!thrown) throw new Error(`Expected ${code}, but no error was thrown`)
  if (thrown.code !== code) throw thrown
  return thrown
}
