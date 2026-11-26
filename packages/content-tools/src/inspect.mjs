import { ContentInspectionError } from './errors.mjs'
import { isSafeUrl } from './utils.mjs'

export function inspectContent(document, options = {}) {
  const blockers = []
  const warnings = [...(document?.importWarnings ?? [])]
  const settings = {
    requireTitle: options.requireTitle ?? true,
    minTextLength: options.minTextLength ?? 1,
    maxTitleLength: options.maxTitleLength ?? 200,
    maxTextLength: options.maxTextLength ?? 200_000,
    requireImageAlt: options.requireImageAlt ?? false,
  }
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.blocks)) {
    return {
      ready: false,
      status: 'blocked',
      blockers: [{ code: 'DOCUMENT_INVALID', message: 'A schemaVersion=1 normalized document with blocks is required.' }],
      warnings,
      stats: emptyStats(),
    }
  }
  const title = document.metadata?.title?.trim() ?? ''
  const text = document.plainText?.trim() ?? ''
  if (settings.requireTitle && !title) blockers.push({ code: 'TITLE_REQUIRED', message: 'A non-empty metadata.title is required.' })
  if (title.length > settings.maxTitleLength) blockers.push({ code: 'TITLE_TOO_LONG', message: `Title exceeds ${settings.maxTitleLength} characters.`, actual: title.length, limit: settings.maxTitleLength })
  if (text.length < settings.minTextLength) blockers.push({ code: 'BODY_EMPTY', message: 'Normalized body text is empty or below the configured minimum.', actual: text.length, minimum: settings.minTextLength })
  if (text.length > settings.maxTextLength) blockers.push({ code: 'BODY_TOO_LONG', message: `Body exceeds ${settings.maxTextLength} characters.`, actual: text.length, limit: settings.maxTextLength })
  if ((document.metadata?.summary?.length ?? 0) > 500) warnings.push({ code: 'SUMMARY_TOO_LONG', message: 'Summary exceeds 500 characters and may need a channel-specific digest.' })

  const headings = []
  walkBlocks(document.blocks, block => {
    if (block.type === 'heading') headings.push(block.level)
  })
  if (headings.filter(level => level === 1).length > 1) warnings.push({ code: 'MULTIPLE_H1', message: 'Multiple level-1 headings may produce inconsistent channel titles.' })
  for (let index = 1; index < headings.length; index += 1) {
    if (headings[index] > headings[index - 1] + 1) {
      warnings.push({ code: 'HEADING_LEVEL_SKIPPED', message: `Heading level jumps from H${headings[index - 1]} to H${headings[index]}.` })
      break
    }
  }
  for (const asset of document.assets ?? []) {
    if (!isSafeUrl(asset.uri, { image: true, internal: true })) {
      blockers.push({ code: 'ASSET_URL_UNSAFE', message: `Asset ${asset.id} has an unsupported URI.` })
    }
    if (!asset.alt?.trim()) {
      const finding = { code: 'IMAGE_ALT_MISSING', message: `Image ${asset.id} has no alternative text.`, assetId: asset.id }
      if (settings.requireImageAlt) blockers.push(finding)
      else warnings.push(finding)
    }
  }
  const stats = {
    characters: text.length,
    paragraphs: countBlocks(document.blocks, 'paragraph'),
    headings: headings.length,
    assets: document.assets?.length ?? 0,
    links: document.links?.length ?? 0,
  }
  return { ready: blockers.length === 0, status: blockers.length ? 'blocked' : 'ready', blockers, warnings: dedupeFindings(warnings), stats }
}

function walkBlocks(blocks, visit) {
  for (const block of blocks) {
    visit(block)
    if (block.type === 'quote') walkBlocks(block.blocks, visit)
  }
}

function countBlocks(blocks, type) {
  let count = 0
  walkBlocks(blocks, block => { if (block.type === type) count += 1 })
  return count
}

function dedupeFindings(findings) {
  const seen = new Set()
  return findings.filter(item => {
    const key = `${item.code}:${item.assetId ?? ''}:${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function emptyStats() {
  return { characters: 0, paragraphs: 0, headings: 0, assets: 0, links: 0 }
}

export function assertContentReady(document, options) {
  const report = inspectContent(document, options)
  if (!report.ready) throw new ContentInspectionError(report)
  return report
}
