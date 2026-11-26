import { DELIVERY_RECORD_SCHEMA, DELIVERY_STEPS, DRAFT_ONLY_NOTE } from './constants.mjs'
import { replaceImageSource } from './content.mjs'
import { DeliveryError, normalizeFailure, StepAbort } from './errors.mjs'
import { buildIdempotencyKey, normalizeDeliveryInput, stepIdempotencyKey } from './idempotency.mjs'

function initialStep() {
  return { status: 'pending', attempts: 0 }
}

function readbackArticle(readback) {
  return readback?.article ?? readback?.news_item?.[0] ?? null
}

function assertResultUrl(result, message) {
  if (!result?.url || typeof result.url !== 'string') {
    throw new DeliveryError(message, { code: 'UPLOAD_INVALID_RESPONSE', category: 'permanent', sideEffect: 'possible' })
  }
}

/**
 * Draft-only delivery orchestrator. All remote effects are supplied by adapters;
 * this class neither imports nor calls a concrete WeChat HTTP implementation.
 */
export class DeliveryMachine {
  constructor({
    store,
    renderer,
    inspector,
    assets,
    drafts,
    verifier,
    retry = {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = () => new Date(),
  }) {
    if (!store?.load || !store?.save || !store?.runExclusive) {
      throw new TypeError('store must implement load/save/runExclusive')
    }
    if (assets?.idempotentUploads !== true) {
      throw new TypeError('assets.idempotentUploads must be true; ambiguous uploads are never repeated blindly')
    }
    for (const [name, dependency, methods] of [
      ['renderer', renderer, ['render']],
      ['inspector', inspector, ['inspect']],
      ['assets', assets, ['uploadImage', 'uploadThumbnail']],
      ['drafts', drafts, ['add', 'get']],
      ['verifier', verifier, ['compare']],
    ]) {
      for (const method of methods) {
        if (typeof dependency?.[method] !== 'function') throw new TypeError(`${name}.${method}() is required`)
      }
    }
    this.store = store
    this.renderer = renderer
    this.inspector = inspector
    this.assets = assets
    this.drafts = drafts
    this.verifier = verifier
    this.retry = {
      maxAttempts: retry.maxAttempts ?? 3,
      baseDelayMs: retry.baseDelayMs ?? 100,
      maxDelayMs: retry.maxDelayMs ?? 2_000,
    }
    if (!Number.isInteger(this.retry.maxAttempts) || this.retry.maxAttempts < 1) {
      throw new TypeError('retry.maxAttempts must be a positive integer')
    }
    this.sleep = sleep
    this.now = now
  }

  timestamp() {
    const value = this.now()
    return typeof value === 'string' ? value : value.toISOString()
  }

  async persist(record) {
    record.revision += 1
    record.updatedAt = this.timestamp()
    await this.store.save(record)
  }

  context(record) {
    return {
      deliveryKey: record.key,
      document: record.input.document,
      theme: record.input.theme,
      renderer: record.input.renderer,
      account: record.input.account,
    }
  }

  history(record, step, event, extra = {}) {
    record.history.push({ at: this.timestamp(), step, event, ...extra })
  }

  recordSideEffect(record, effect) {
    if (!record.sideEffects.some(item => item.idempotencyKey === effect.idempotencyKey)) {
      record.sideEffects.push({ at: this.timestamp(), ...effect })
    }
  }

  createRecord(input) {
    const key = buildIdempotencyKey(input)
    const now = this.timestamp()
    return {
      schemaVersion: DELIVERY_RECORD_SCHEMA,
      key,
      input,
      target: 'wechat-draft',
      status: 'pending',
      revision: 0,
      currentStep: DELIVERY_STEPS[0],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      steps: Object.fromEntries(DELIVERY_STEPS.map(step => [step, initialStep()])),
      sideEffects: [],
      history: [],
      error: null,
      result: null,
    }
  }

  async deliver(input) {
    const normalized = normalizeDeliveryInput(input)
    const key = buildIdempotencyKey(normalized)
    return this.store.runExclusive(key, async () => {
      let record = await this.store.load(key)
      if (!record) record = this.createRecord(normalized)
      return this.executeExisting(record)
    })
  }

  /** Resume using only the persisted key and original non-secret input. */
  async resume(key, { reconcile = false } = {}) {
    return this.store.runExclusive(key, async () => {
      const record = await this.store.load(key)
      if (!record) throw new DeliveryError(`Unknown delivery: ${key}`, { code: 'DELIVERY_NOT_FOUND' })
      if (record.status === 'needs_reconciliation' && !reconcile) return record
      return this.executeExisting(record)
    })
  }

  async get(key) {
    return this.store.load(key)
  }

  async executeExisting(record) {
    if (record.status === 'completed' || record.status === 'needs_reconciliation') return record
    try {
      await this.run(record)
    }
    catch (error) {
      if (!(error instanceof StepAbort)) throw error
    }
    return this.store.load(record.key)
  }

  async runStep(record, name, operation) {
    const step = record.steps[name]
    if (step.status === 'completed') return step.output

    let runAttempt = 0
    while (true) {
      runAttempt += 1
      step.attempts += 1
      step.status = 'running'
      step.startedAt = this.timestamp()
      step.error = null
      record.status = 'running'
      record.currentStep = name
      record.error = null
      this.history(record, name, 'started', { attempt: step.attempts, runAttempt })
      await this.persist(record)

      let output
      try {
        output = await operation({ record, step, attempt: step.attempts, runAttempt })
      }
      catch (error) {
        const failure = normalizeFailure(error, name)
        if (name === 'draftAdd') {
          if (failure.sideEffect === 'none') step.remoteState = 'none'
          else if (step.remoteState !== 'confirmed') step.remoteState = 'possible'
        }
        step.status = 'failed'
        step.error = failure
        record.error = failure

        const cannotReconcile = name === 'draftAdd'
          && step.remoteState === 'possible'
          && !this.drafts.idempotentAdd
          && typeof this.drafts.findByKey !== 'function'
        const needsReconciliation = failure.code === 'DRAFT_RECONCILIATION_REQUIRED' || cannotReconcile
        if (needsReconciliation) {
          record.status = 'needs_reconciliation'
        }
        else if (failure.retryable && runAttempt < this.retry.maxAttempts) {
          record.status = 'retry_wait'
        }
        else {
          record.status = 'failed'
        }
        this.history(record, name, 'failed', { attempt: step.attempts, runAttempt, error: failure })
        await this.persist(record)

        if (record.status === 'retry_wait') {
          const delay = Math.min(
            this.retry.baseDelayMs * (2 ** (runAttempt - 1)),
            this.retry.maxDelayMs,
          )
          await this.sleep(delay)
          continue
        }
        throw new StepAbort()
      }

      step.status = 'completed'
      step.output = output
      step.completedAt = this.timestamp()
      step.error = null
      record.error = null
      this.history(record, name, 'completed', { attempt: step.attempts, runAttempt })
      await this.persist(record)
      return output
    }
  }

  validateInspection(inspection) {
    if (!inspection || typeof inspection !== 'object') {
      throw new DeliveryError('Inspector returned no result', { code: 'INSPECT_INVALID_RESPONSE' })
    }
    if (!inspection.ready) {
      throw new DeliveryError('Article inspection blocked delivery', {
        code: 'INSPECTION_BLOCKED',
        category: 'validation',
        details: { blockers: inspection.blockers ?? [], warnings: inspection.warnings ?? [] },
      })
    }
    if (typeof inspection.article?.content !== 'string') {
      throw new DeliveryError('Inspector must return article.content', { code: 'INSPECT_INVALID_RESPONSE' })
    }
    const ids = new Set()
    for (const image of inspection.images ?? []) {
      if (!image?.id || ids.has(image.id)) {
        throw new DeliveryError('Image ids must be present and unique', { code: 'INSPECT_INVALID_RESPONSE' })
      }
      ids.add(image.id)
    }
  }

  async runImages(record, inspection) {
    const images = inspection.images ?? []
    return this.runStep(record, 'images', async ({ step }) => {
      step.items ??= {}
      let content = inspection.article.content
      const uploads = []

      for (const image of images) {
        let item = step.items[image.id]
        if (item?.status !== 'completed') {
          const idempotencyKey = stepIdempotencyKey(record.key, 'image', image.id)
          const uploaded = await this.assets.uploadImage({
            ...this.context(record),
            image,
            idempotencyKey,
            attempt: step.attempts,
          })
          assertResultUrl(uploaded, `Image upload returned no URL: ${image.id}`)
          item = {
            status: 'completed',
            id: image.id,
            idempotencyKey,
            url: uploaded.url,
            completedAt: this.timestamp(),
          }
          step.items[image.id] = item
          this.recordSideEffect(record, { type: 'image-upload', id: image.id, idempotencyKey, url: uploaded.url })
          // Persist the URL before pure HTML replacement; a replacement error must
          // never cause a second upload during resume.
          await this.persist(record)
        }

        const replace = this.assets.replaceImage ?? replaceImageSource
        content = await replace.call(this.assets, content, image, item.url)
        uploads.push({ id: image.id, url: item.url, idempotencyKey: item.idempotencyKey })
        step.output = { content, uploads }
        await this.persist(record)
      }

      return { content, uploads }
    })
  }

  async addOrReconcileDraft(record, step, article) {
    const idempotencyKey = stepIdempotencyKey(record.key, 'draftAdd')
    const context = {
      ...this.context(record),
      idempotencyKey,
      article,
    }

    if (step.remoteState === 'possible') {
      if (typeof this.drafts.findByKey === 'function') {
        const existing = await this.drafts.findByKey(context)
        if (existing?.mediaId) {
          step.remoteState = 'confirmed'
          this.recordSideEffect(record, {
            type: 'draft-add',
            idempotencyKey,
            mediaId: existing.mediaId,
            reconciled: true,
          })
          return { mediaId: existing.mediaId, article, reconciled: true }
        }
      }
      if (!this.drafts.idempotentAdd) {
        throw new DeliveryError('Previous draft add may have succeeded; refusing a blind duplicate', {
          code: 'DRAFT_RECONCILIATION_REQUIRED',
          category: 'ambiguous',
          sideEffect: 'possible',
          details: { idempotencyKey },
        })
      }
    }

    // This write is the recovery marker for a crash after the remote response
    // but before the mediaId could be saved.
    step.remoteState = 'possible'
    await this.persist(record)
    const created = await this.drafts.add(context)
    if (!created?.mediaId) {
      throw new DeliveryError('Draft add returned no mediaId; reconciliation is required', {
        code: 'DRAFT_RECONCILIATION_REQUIRED',
        category: 'ambiguous',
        sideEffect: 'possible',
        details: { idempotencyKey },
      })
    }
    step.remoteState = 'confirmed'
    this.recordSideEffect(record, { type: 'draft-add', idempotencyKey, mediaId: created.mediaId })
    return { mediaId: created.mediaId, article, reconciled: false }
  }

  async run(record) {
    const rendered = await this.runStep(record, 'render', async () => {
      const output = await this.renderer.render(this.context(record))
      if (typeof output?.html !== 'string') {
        throw new DeliveryError('Renderer must return { html }', { code: 'RENDER_INVALID_RESPONSE' })
      }
      return output
    })

    const inspection = await this.runStep(record, 'inspect', async () => {
      const output = await this.inspector.inspect({ ...this.context(record), rendered })
      this.validateInspection(output)
      return output
    })

    const images = await this.runImages(record, inspection)

    const thumbnail = await this.runStep(record, 'thumbnail', async () => {
      const source = inspection.thumbnail ?? record.input.document.thumbnail
      if (!source) {
        throw new DeliveryError('A configured thumbnail is required', {
          code: 'COVER_REQUIRED',
          category: 'validation',
        })
      }
      const idempotencyKey = stepIdempotencyKey(record.key, 'thumbnail')
      const output = await this.assets.uploadThumbnail({
        ...this.context(record),
        thumbnail: source,
        idempotencyKey,
      })
      if (!output?.mediaId) {
        throw new DeliveryError('Thumbnail upload returned no mediaId', {
          code: 'UPLOAD_INVALID_RESPONSE',
          sideEffect: 'possible',
        })
      }
      this.recordSideEffect(record, {
        type: 'thumbnail-upload',
        idempotencyKey,
        mediaId: output.mediaId,
        ...(output.url ? { url: output.url } : {}),
      })
      return output
    })

    const article = {
      article_type: 'news',
      ...inspection.article,
      content: images.content,
      thumb_media_id: thumbnail.mediaId,
    }

    const added = await this.runStep(record, 'draftAdd', ({ step }) => this.addOrReconcileDraft(record, step, article))

    const readback = await this.runStep(record, 'draftGet', async () => {
      const output = await this.drafts.get({
        ...this.context(record),
        mediaId: added.mediaId,
      })
      const actual = readbackArticle(output)
      if (typeof actual?.content !== 'string') {
        throw new DeliveryError('Draft readback contains no article content', {
          code: 'READBACK_EMPTY',
          category: 'transient',
          retryable: true,
        })
      }
      return { article: actual }
    })

    const comparison = await this.runStep(record, 'compare', async () => {
      const output = await this.verifier.compare({
        ...this.context(record),
        expected: article,
        actual: readback.article,
      })
      if (!output?.ok) {
        throw new DeliveryError('Draft readback differs from the submitted article', {
          code: 'READBACK_MISMATCH',
          category: 'validation',
          details: output,
        })
      }
      return output
    })

    const report = await this.runStep(record, 'report', async () => ({
      ok: true,
      target: 'wechat-draft',
      scope: 'draft-only',
      key: record.key,
      accountId: record.input.account.id,
      renderer: record.input.renderer,
      mediaId: added.mediaId,
      thumbMediaId: thumbnail.mediaId,
      uploads: images.uploads,
      warnings: inspection.warnings ?? [],
      comparison,
      sideEffects: structuredClone(record.sideEffects),
      note: DRAFT_ONLY_NOTE,
    }))

    record.status = 'completed'
    record.completedAt = this.timestamp()
    record.currentStep = 'report'
    record.result = report
    this.history(record, 'report', 'delivery-completed', { mediaId: added.mediaId })
    await this.persist(record)
  }
}
