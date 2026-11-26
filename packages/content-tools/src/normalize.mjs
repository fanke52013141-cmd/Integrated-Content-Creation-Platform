import { blocksToPlainText, renderHtmlBlocks, renderMarkdownBlocks } from './blocks.mjs'
import { collapseWhitespace, sha256 } from './utils.mjs'

export function normalizeMetadata(input = {}) {
  const tags = Array.isArray(input.tags)
    ? input.tags
    : typeof input.tags === 'string' ? input.tags.split(',') : []
  const metadata = {
    title: collapseWhitespace(input.title ?? ''),
    author: collapseWhitespace(input.author ?? input.creator ?? ''),
    summary: collapseWhitespace(input.summary ?? input.description ?? input.digest ?? ''),
    tags: [...new Set(tags.map(item => collapseWhitespace(item)).filter(Boolean))],
  }
  for (const key of ['cover', 'sourceUrl', 'canonicalUrl', 'publishedAt']) {
    if (input[key] != null && collapseWhitespace(input[key])) metadata[key] = collapseWhitespace(input[key])
  }
  return metadata
}

export function createNormalizedDocument({
  format,
  name,
  sourceSha256,
  metadata = {},
  blocks,
  assets = [],
  links = [],
  warnings = [],
  authorization,
}) {
  if (!Array.isArray(blocks)) throw new TypeError('Normalized blocks are required')
  const normalizedMetadata = normalizeMetadata(metadata)
  if (!normalizedMetadata.title) {
    const heading = blocks.find(block => block.type === 'heading')
    if (heading) normalizedMetadata.title = blocksToPlainText([heading]).slice(0, 300)
  }
  const normalizedAssets = assets.map((asset, index) => ({
    id: asset.id ?? `asset-${index + 1}`,
    kind: asset.kind ?? 'image',
    uri: asset.uri,
    alt: asset.alt ?? '',
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
    ...(Number.isInteger(asset.bytes) ? { bytes: asset.bytes } : {}),
    ...(asset.source ? { source: asset.source } : {}),
  }))
  const hashInput = { metadata: normalizedMetadata, blocks, assets: normalizedAssets.map(({ source, ...asset }) => asset), links }
  const contentHash = sha256(hashInput)
  const document = {
    schemaVersion: 1,
    id: `doc_${contentHash.slice(0, 24)}`,
    source: { format, ...(name ? { name } : {}), sha256: sourceSha256 },
    metadata: normalizedMetadata,
    blocks,
    markdown: renderMarkdownBlocks(blocks),
    html: renderHtmlBlocks(blocks),
    plainText: blocksToPlainText(blocks),
    assets: normalizedAssets,
    links: [...new Set(links)],
    contentHash,
    importWarnings: warnings,
  }
  if (authorization) {
    document.source.authorization = {
      confirmed: authorization.confirmed === true,
      basis: collapseWhitespace(authorization.basis ?? ''),
      reference: collapseWhitespace(authorization.reference ?? ''),
    }
  }
  return document
}
