import { replaceImageSource } from './content.mjs'
import { DeliveryError } from './errors.mjs'
import { sha256 } from './idempotency.mjs'

export function transientError(message = 'Temporary mock failure', overrides = {}) {
  return new DeliveryError(message, {
    code: 'ETIMEDOUT',
    category: 'transient',
    retryable: true,
    sideEffect: 'possible',
    ...overrides,
  })
}

export function mockInput(overrides = {}) {
  const document = {
    id: 'document-1',
    markdown: '# Mock title\n\nMock body',
    metadata: {
      title: 'Mock title',
      author: 'Mock author',
      digest: 'Mock digest',
      content_source_url: '',
    },
    renderedHtml: '<h1>Mock title</h1><p>Mock body</p><img src="assets/a.png">',
    images: [{ id: 'image-1', src: 'assets/a.png' }],
    thumbnail: { id: 'cover', src: 'assets/cover.jpg' },
    ...overrides.document,
  }
  if (overrides.document?.metadata || !document.metadata) {
    document.metadata = {
      title: 'Mock title',
      author: 'Mock author',
      digest: 'Mock digest',
      content_source_url: '',
      ...overrides.document?.metadata,
    }
  }
  return {
    document,
    theme: { id: 'default', options: { primaryColor: '#0F4C81' }, ...overrides.theme },
    account: { id: 'account-1', credentialRef: 'mock-account', ...overrides.account },
    renderer: { id: 'doocs-md', version: '80b43d4', options: {}, ...overrides.renderer },
  }
}

/**
 * Fully in-memory adapter set. Failure queues can throw before an operation or
 * after its simulated side effect, which covers ambiguous-response recovery.
 */
export function createMockAdapters({ readbackTransform } = {}) {
  const calls = []
  const faults = new Map()
  const images = new Map()
  const thumbnails = new Map()
  const draftByKey = new Map()
  const draftByMediaId = new Map()
  let draftSequence = 0

  function failNext(method, error = transientError(), { after = false } = {}) {
    const queue = faults.get(method) ?? []
    queue.push({ error, after })
    faults.set(method, queue)
  }

  async function invoke(method, args, work) {
    calls.push({ method, ...args })
    const queue = faults.get(method) ?? []
    const fault = queue.shift()
    if (fault && !fault.after) throw fault.error
    const result = await work()
    if (fault?.after) throw fault.error
    return result
  }

  const renderer = {
    async render(context) {
      return invoke('render', { deliveryKey: context.deliveryKey }, async () => ({
        html: context.document.renderedHtml ?? `<h1>${context.document.metadata.title}</h1><p>${context.document.markdown}</p>`,
        plainText: context.document.markdown,
      }))
    },
  }

  const inspector = {
    async inspect(context) {
      return invoke('inspect', { deliveryKey: context.deliveryKey }, async () => {
        const blockers = [...(context.document.inspectionBlockers ?? [])]
        if (!context.document.metadata?.title) blockers.push({ code: 'TITLE_REQUIRED', message: 'Title is required' })
        return {
          ready: blockers.length === 0,
          blockers,
          warnings: context.document.inspectionWarnings ?? [],
          article: {
            title: context.document.metadata?.title ?? '',
            author: context.document.metadata?.author ?? '',
            digest: context.document.metadata?.digest ?? '',
            content_source_url: context.document.metadata?.content_source_url ?? '',
            content: context.rendered.html,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
          images: context.document.images ?? [],
          thumbnail: context.document.thumbnail,
        }
      })
    },
  }

  const assets = {
    idempotentUploads: true,

    async uploadImage(context) {
      return invoke('assets.uploadImage', {
        deliveryKey: context.deliveryKey,
        idempotencyKey: context.idempotencyKey,
        imageId: context.image.id,
      }, async () => {
        if (!images.has(context.idempotencyKey)) {
          images.set(context.idempotencyKey, {
            url: `https://mmbiz.qpic.cn/mock/${encodeURIComponent(context.image.id)}-${sha256(context.idempotencyKey).slice(0, 12)}`,
          })
        }
        return { ...images.get(context.idempotencyKey) }
      })
    },

    async replaceImage(content, image, url) {
      return replaceImageSource(content, image, url)
    },

    async uploadThumbnail(context) {
      return invoke('assets.uploadThumbnail', {
        deliveryKey: context.deliveryKey,
        idempotencyKey: context.idempotencyKey,
      }, async () => {
        if (!thumbnails.has(context.idempotencyKey)) {
          const suffix = sha256(context.idempotencyKey).slice(0, 12)
          thumbnails.set(context.idempotencyKey, {
            mediaId: `MOCK_THUMB_${suffix}`,
            url: `https://mmbiz.qpic.cn/mock/thumb-${suffix}`,
          })
        }
        return { ...thumbnails.get(context.idempotencyKey) }
      })
    },
  }

  const drafts = {
    idempotentAdd: true,

    async findByKey(context) {
      return invoke('drafts.findByKey', {
        deliveryKey: context.deliveryKey,
        idempotencyKey: context.idempotencyKey,
      }, async () => {
        const mediaId = draftByKey.get(context.idempotencyKey)
        return mediaId ? { mediaId } : null
      })
    },

    async add(context) {
      return invoke('drafts.add', {
        deliveryKey: context.deliveryKey,
        idempotencyKey: context.idempotencyKey,
        title: context.article.title,
      }, async () => {
        let mediaId = draftByKey.get(context.idempotencyKey)
        if (!mediaId) {
          draftSequence += 1
          mediaId = `MOCK_DRAFT_${draftSequence}`
          draftByKey.set(context.idempotencyKey, mediaId)
          draftByMediaId.set(mediaId, structuredClone(context.article))
        }
        return { mediaId }
      })
    },

    async get(context) {
      return invoke('drafts.get', {
        deliveryKey: context.deliveryKey,
        mediaId: context.mediaId,
      }, async () => {
        const article = draftByMediaId.get(context.mediaId)
        if (!article) throw new DeliveryError('Draft not found', { code: 'DRAFT_NOT_FOUND' })
        const projected = readbackTransform ? await readbackTransform(structuredClone(article)) : article
        return { news_item: [structuredClone(projected)] }
      })
    },
  }

  const verifier = {
    async compare(context) {
      return invoke('verifier.compare', { deliveryKey: context.deliveryKey }, async () => {
        const fields = ['title', 'author', 'digest', 'content', 'thumb_media_id']
        const differences = fields.filter(field => context.expected[field] !== context.actual[field])
        return {
          ok: differences.length === 0,
          semanticTextEqual: context.expected.content === context.actual.content,
          differences,
        }
      })
    },
  }

  return {
    renderer,
    inspector,
    assets,
    drafts,
    verifier,
    calls,
    failNext,
    state: {
      images,
      thumbnails,
      draftByKey,
      draftByMediaId,
    },
    effectCounts() {
      return {
        images: images.size,
        thumbnails: thumbnails.size,
        draftAdds: draftByKey.size,
        total: images.size + thumbnails.size + draftByKey.size,
      }
    },
  }
}
