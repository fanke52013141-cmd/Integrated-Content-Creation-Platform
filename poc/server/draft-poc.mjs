import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { assertArticleImage, assertThumbnail, resolveInside } from './images.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireCore = createRequire(path.join(ROOT, 'upstream/doocs-md/packages/core/package.json'))
const { JSDOM } = requireCore('jsdom')

function countCharacters(value = '') {
  return Array.from(value).length
}

export function normalizeArticleText(html) {
  const document = new JSDOM(`<body>${html}</body>`).window.document
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function blocker(code, message, extra = {}) {
  return { code, message, ...extra }
}

export async function inspectArticle({ fragment, metadata, assetsRoot }) {
  const blockers = []
  const warnings = []
  const images = []
  if (!metadata.title?.trim()) blockers.push(blocker('TITLE_REQUIRED', '标题不能为空'))
  if (countCharacters(metadata.title) > 32) blockers.push(blocker('TITLE_TOO_LONG', '标题超过 32 字'))
  if (countCharacters(metadata.author) > 16) blockers.push(blocker('AUTHOR_TOO_LONG', '作者超过 16 字'))
  if (countCharacters(metadata.digest) > 120) blockers.push(blocker('DIGEST_TOO_LONG', '摘要超过 120 字'))
  if (!fragment?.trim()) blockers.push(blocker('CONTENT_REQUIRED', '正文不能为空'))
  if (countCharacters(fragment) >= 20_000) blockers.push(blocker('CONTENT_TOO_LONG', '正文 HTML 达到或超过 2 万字符'))
  if (Buffer.byteLength(fragment) >= 1_000_000) blockers.push(blocker('CONTENT_BYTES_TOO_LARGE', '正文 HTML 达到或超过 1MB'))
  if (!metadata.thumb) blockers.push(blocker('COVER_REQUIRED', '缺少封面缩略图'))
  else {
    try {
      const cover = await assertThumbnail(resolveInside(assetsRoot, metadata.thumb))
      if (!cover.width || !cover.height) warnings.push(blocker('COVER_DIMENSIONS_UNKNOWN', '无法读取封面尺寸'))
    }
    catch (error) {
      blockers.push(blocker('COVER_INVALID', error.message))
    }
  }

  const document = new JSDOM(`<body>${fragment}</body>`, { url: 'http://localhost/' }).window.document
  for (const element of document.querySelectorAll('script, iframe, object, embed, link, meta')) {
    blockers.push(blocker('UNSAFE_ELEMENT', `正文包含禁止元素 <${element.localName}>`))
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name)) blockers.push(blocker('UNSAFE_EVENT_ATTRIBUTE', `正文包含事件属性 ${attribute.name}`))
      if (['src', 'href'].includes(attribute.name) && /^\s*javascript:/i.test(attribute.value)) {
        blockers.push(blocker('UNSAFE_URL', '正文包含 javascript: URL'))
      }
    }
  }

  for (const [index, image] of [...document.querySelectorAll('img')].entries()) {
    const id = image.getAttribute('data-asset-id') ?? `img-${index + 1}`
    const src = image.getAttribute('src') ?? ''
    const localSrc = image.getAttribute('data-local-src')
    const item = { id, src, localSrc, ready: false }
    try {
      if (localSrc) {
        item.metadata = await assertArticleImage(resolveInside(assetsRoot, localSrc))
        item.ready = true
      }
      else if (/^https:\/\/mmbiz\.qpic\.cn\//i.test(src)) {
        item.ready = true
      }
      else {
        blockers.push(blocker('IMAGE_REQUIRES_UPLOAD', `图片需要转存：${src || id}`, { asset: id }))
      }
    }
    catch (error) {
      blockers.push(blocker('IMAGE_INVALID', error.message, { asset: id }))
    }
    images.push(item)
  }

  return {
    target: 'wechat-draft',
    ready: blockers.length === 0,
    blockers,
    warnings,
    capabilities: { inspect: true, mockDraft: true, liveDraft: 'requires-explicit-live-flag' },
    counts: {
      title: countCharacters(metadata.title),
      author: countCharacters(metadata.author),
      digest: countCharacters(metadata.digest),
      contentCharacters: countCharacters(fragment),
      contentUtf8Bytes: Buffer.byteLength(fragment),
      images: images.length,
    },
    images,
    sideEffects: [],
  }
}

export function compareDraftHtml(sourceHtml, readbackHtml) {
  const sourceText = normalizeArticleText(sourceHtml)
  const readbackText = normalizeArticleText(readbackHtml)
  const firstDifference = sourceText === readbackText
    ? -1
    : [...sourceText].findIndex((character, index) => character !== [...readbackText][index])
  const sourceDocument = new JSDOM(`<body>${sourceHtml}</body>`).window.document
  const readbackDocument = new JSDOM(`<body>${readbackHtml}</body>`).window.document
  const sourceTags = [...sourceDocument.querySelectorAll('*')].map(element => element.localName)
  const readbackTags = [...readbackDocument.querySelectorAll('*')].map(element => element.localName)
  return {
    semanticTextEqual: sourceText === readbackText,
    sourceTextCharacters: sourceText.length,
    readbackTextCharacters: readbackText.length,
    firstDifference,
    sourcePreview: firstDifference >= 0 ? sourceText.slice(Math.max(0, firstDifference - 60), firstDifference + 100) : '',
    readbackPreview: firstDifference >= 0 ? readbackText.slice(Math.max(0, firstDifference - 60), firstDifference + 100) : '',
    sourceElementCount: sourceTags.length,
    readbackElementCount: readbackTags.length,
    sourceImageCount: sourceDocument.querySelectorAll('img').length,
    readbackImageCount: readbackDocument.querySelectorAll('img').length,
  }
}

export async function createDraftFromFiles({ client, fragment, metadata, assetsRoot }) {
  const inspection = await inspectArticle({ fragment, metadata, assetsRoot })
  if (!inspection.ready) {
    const error = new Error('发布前检查未通过')
    error.inspection = inspection
    throw error
  }

  const document = new JSDOM(`<body>${fragment}</body>`, { url: 'http://localhost/' }).window.document
  const uploads = []
  for (const image of [...document.querySelectorAll('img[data-local-src]')]) {
    const localSrc = image.getAttribute('data-local-src')
    const result = await client.uploadArticleImage(resolveInside(assetsRoot, localSrc))
    if (!result.url) throw new Error(`正文图片上传未返回 URL：${localSrc}`)
    image.setAttribute('src', result.url)
    uploads.push({ localSrc, url: result.url })
  }
  const externalImages = [...document.querySelectorAll('img')].filter(image => !/^https:\/\/mmbiz\.qpic\.cn\//i.test(image.getAttribute('src') ?? ''))
  if (externalImages.length) throw new Error(`仍有 ${externalImages.length} 张图片不是微信正文图片 URL`)

  const thumb = await client.uploadThumbnail(resolveInside(assetsRoot, metadata.thumb))
  if (!thumb.media_id) throw new Error('封面上传未返回 media_id')
  const article = {
    article_type: 'news',
    title: metadata.title,
    author: metadata.author,
    digest: metadata.digest,
    content: document.body.innerHTML,
    content_source_url: metadata.content_source_url,
    thumb_media_id: thumb.media_id,
    need_open_comment: metadata.need_open_comment ?? 0,
    only_fans_can_comment: metadata.only_fans_can_comment ?? 0,
  }
  const created = await client.addDraft(article)
  if (!created.media_id) throw new Error('新增草稿未返回 media_id')
  const readback = await client.getDraft(created.media_id)
  const readbackArticle = readback.news_item?.[0]
  if (!readbackArticle?.content) throw new Error('草稿读回缺少正文')
  const comparison = compareDraftHtml(article.content, readbackArticle.content)
  return {
    ok: comparison.semanticTextEqual,
    mediaId: created.media_id,
    uploads,
    thumbMediaId: thumb.media_id,
    article,
    readbackArticle,
    comparison,
    note: 'Only draft/add and draft/get are called. No publish or mass-send operation exists in this POC.',
  }
}

export class MockWeChatClient {
  constructor() {
    this.calls = []
    this.article = null
  }

  async uploadArticleImage(filePath) {
    this.calls.push({ method: 'uploadArticleImage', filePath })
    const name = path.basename(filePath).replace(/[^a-zA-Z0-9.-]/g, '_')
    return { url: `https://mmbiz.qpic.cn/poc/${name}`, errcode: 0 }
  }

  async uploadThumbnail(filePath) {
    this.calls.push({ method: 'uploadThumbnail', filePath })
    return { media_id: 'MOCK_THUMB_MEDIA_ID', url: 'https://mmbiz.qpic.cn/poc/cover.jpg' }
  }

  async addDraft(article) {
    this.calls.push({ method: 'addDraft', title: article.title })
    this.article = article
    return { media_id: 'MOCK_DRAFT_MEDIA_ID' }
  }

  async getDraft(mediaId) {
    this.calls.push({ method: 'getDraft', mediaId })
    return { news_item: [this.article] }
  }
}

export async function readDefaultPocFiles() {
  const [fragment, metadataRaw] = await Promise.all([
    readFile(path.join(ROOT, 'poc/artifacts/article-fragment.html'), 'utf8'),
    readFile(path.join(ROOT, 'poc/fixtures/article.json'), 'utf8'),
  ])
  return { fragment, metadata: JSON.parse(metadataRaw), assetsRoot: path.join(ROOT, 'poc/fixtures') }
}
