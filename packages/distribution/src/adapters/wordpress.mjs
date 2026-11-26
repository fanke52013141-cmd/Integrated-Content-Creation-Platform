import { DistributionError, validateHttpUrl } from '../errors.mjs'
import { semanticText } from '../utils.mjs'
import { httpRequest } from './http.mjs'

export class WordPressRestAdapter {
  channel = 'wordpress'
  mode
  idempotent = true

  constructor({ baseUrl, fetch: fetchImpl = globalThis.fetch, credentials, credentialProvider, timeoutMs = 15_000, mode = 'live' }) {
    if (!baseUrl || typeof fetchImpl !== 'function') throw new TypeError('WordPress baseUrl and fetch are required')
    const root = validateHttpUrl(baseUrl, 'WordPress baseUrl')
    this.postsUrl = /\/wp-json\/wp\/v2(?:\/posts)?$/.test(root)
      ? `${root.replace(/\/posts$/, '')}/posts`
      : `${root}/wp-json/wp/v2/posts`
    this.fetch = fetchImpl
    this.credentials = credentials
    this.credentialProvider = credentialProvider
    this.timeoutMs = timeoutMs
    this.mode = mode
  }

  capabilities() {
    return { draft: true, publish: true, readback: true, reconcile: true, idempotency: true }
  }

  async createDraft(context) {
    const existing = await this.findByKey(context)
    if (existing) return existing
    const { document, idempotencyKey } = context
    const response = await this.request('POST', this.postsUrl, context, {
      title: document.title,
      content: document.html || markdownAsHtml(document.markdown || document.plainText),
      excerpt: document.metadata?.summary ?? '',
      status: 'draft',
      slug: slugForKey(idempotencyKey),
    })
    if (!response.data?.id) throw invalidWordPressResponse('WordPress create response has no post id', 'possible')
    return this.mapPost(response.data, { existing: false })
  }

  async findByKey(context) {
    const query = new URLSearchParams({ slug: slugForKey(context.idempotencyKey), status: 'any', context: 'edit', per_page: '1' })
    const response = await this.request('GET', `${this.postsUrl}?${query}`, context)
    if (!Array.isArray(response.data)) {
      throw new DistributionError('WordPress slug lookup returned a malformed response; creation is blocked', {
        code: 'WORDPRESS_LOOKUP_INVALID', category: 'permanent', sideEffect: 'none',
      })
    }
    const posts = response.data
    return posts.length ? this.mapPost(posts[0], { existing: true, reconciled: true }) : null
  }

  async getStatus(context) {
    const remoteId = context.receipt?.remote?.remoteId ?? context.remoteId
    if (!remoteId) return this.findByKey(context)
    const response = await this.request('GET', `${this.postsUrl}/${encodeURIComponent(remoteId)}?context=edit`, context)
    if (!response.data?.id) throw invalidWordPressResponse('WordPress readback has no post id')
    return this.mapPost(response.data, { reconciled: true })
  }

  async reconcile(context) {
    const actual = await this.getStatus(context)
    if (!actual) return null
    const differences = comparePost(context.document, actual)
    return { ...actual, matches: differences.length === 0, differences }
  }

  async publish(context) {
    const remoteId = context.receipt?.remote?.remoteId ?? context.remoteId
    if (!remoteId) throw new DistributionError('A verified WordPress draft is required before publish', { code: 'DRAFT_REQUIRED', category: 'validation' })
    const response = await this.request('POST', `${this.postsUrl}/${encodeURIComponent(remoteId)}`, context, { status: 'publish' })
    if (!response.data?.id) throw invalidWordPressResponse('WordPress publish response has no post id', 'possible')
    const result = this.mapPost(response.data, { published: true })
    if (result.status !== 'published') {
      throw new DistributionError(`WordPress did not confirm publish status: ${result.providerStatus}`, { code: 'PUBLISH_UNCONFIRMED', sideEffect: 'possible', details: { providerStatus: result.providerStatus } })
    }
    return result
  }

  async request(method, url, context, body) {
    const headers = { ...(await this.authHeaders(context)) }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return httpRequest({ fetchImpl: this.fetch, url, method, headers, body, timeoutMs: this.timeoutMs })
  }

  async authHeaders(context) {
    const credentials = this.credentialProvider
      ? await this.credentialProvider(context.account?.credentialRef, context.account)
      : this.credentials
    if (!credentials) return {}
    if (credentials.token) return { Authorization: `Bearer ${credentials.token}` }
    if (credentials.username && credentials.applicationPassword) {
      const encoded = Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }
    throw new DistributionError('WordPress credentials require token or username + applicationPassword', { code: 'ADAPTER_CONFIG_INVALID', category: 'authorization' })
  }

  mapPost(post, extra = {}) {
    if (!post?.id) throw invalidWordPressResponse('WordPress post response has no id')
    const providerStatus = String(post.status ?? 'unknown')
    return {
      remoteId: String(post.id),
      status: providerStatus === 'publish' ? 'published' : ['draft', 'pending'].includes(providerStatus) ? 'draft' : 'accepted',
      providerStatus,
      url: post.link,
      title: semanticText(post.title?.rendered ?? post.title?.raw ?? post.title ?? ''),
      content: post.content?.raw ?? post.content?.rendered ?? post.content ?? '',
      slug: post.slug,
      modifiedAt: post.modified_gmt ?? post.modified,
      ...extra,
    }
  }
}

function slugForKey(key) {
  return `icp-${String(key).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 48)}`
}

function comparePost(expected, actual) {
  const differences = []
  if (semanticText(expected.title) !== semanticText(actual.title)) differences.push({ field: 'title', expected: expected.title, actual: actual.title })
  const expectedText = semanticText(expected.plainText || expected.html || expected.markdown)
  const actualText = semanticText(actual.content)
  if (expectedText !== actualText) differences.push({ field: 'content', expectedLength: expectedText.length, actualLength: actualText.length })
  return differences
}

function markdownAsHtml(markdown) {
  return markdown.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function invalidWordPressResponse(message, sideEffect = 'none') {
  return new DistributionError(message, { code: 'WORDPRESS_RESPONSE_INVALID', sideEffect })
}

export function createWordPressAdapter(options) {
  return new WordPressRestAdapter(options)
}
