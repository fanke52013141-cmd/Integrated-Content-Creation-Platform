import { createHash, randomUUID } from 'node:crypto'

function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('文档模型不接受非有限数字')
    return value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalize(item)]))
  }
  throw new TypeError(`文档模型不接受 ${typeof value}`)
}

export function stableStringify(value) {
  return JSON.stringify(normalize(value))
}

export function hashValue(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function createThemeReference({ id, version = '1.0.0' }) {
  if (!id || !version) throw new Error('主题必须包含 id 和 version')
  return { id, version }
}

export function computeDocumentRevision({ source, metadata = {}, theme }) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('源文章不能为空')
  return hashValue({ source, metadata, theme: createThemeReference(theme) })
}

export function createDocument({ id = randomUUID(), source, sourceFormat = 'markdown', metadata = {}, theme }) {
  const themeReference = createThemeReference(theme)
  const revision = computeDocumentRevision({ source, metadata, theme: themeReference })
  return {
    schemaVersion: 1,
    id,
    sourceFormat,
    source,
    metadata: { ...metadata },
    theme: themeReference,
    revision,
  }
}

export function createAsset({ id = randomUUID(), uri, kind = 'image', sha256, bytes, width, height, mimeType, rights = {} }) {
  if (!uri || !sha256 || !mimeType) throw new Error('素材必须包含 uri、sha256 和 mimeType')
  return {
    schemaVersion: 1,
    id,
    uri,
    kind,
    sha256,
    bytes,
    width,
    height,
    mimeType,
    rights: { ...rights },
  }
}

export function createRenderSnapshot({ document, renderer, html, assets = [], quality = {} }) {
  if (!document?.revision) throw new Error('缺少文档 revision')
  if (!renderer?.name || !renderer?.version) throw new Error('渲染器必须包含 name 和 version')
  if (typeof html !== 'string' || !html.trim()) throw new Error('渲染结果不能为空')
  return {
    schemaVersion: 1,
    documentId: document.id,
    documentRevision: document.revision,
    theme: { ...document.theme },
    renderer: { ...renderer },
    html,
    htmlSha256: createHash('sha256').update(html).digest('hex'),
    assets: assets.map(asset => ({ ...asset })),
    quality: { ...quality },
  }
}
