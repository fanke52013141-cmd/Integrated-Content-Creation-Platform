import { MemoryAssetCache } from './asset-cache.mjs';
import { validationError } from './errors.mjs';

function required(context) {
  if (!context.account?.id) throw validationError('account.id is required for draft operations.', 'ACCOUNT_REQUIRED');
  if (!context.idempotencyKey) throw validationError('idempotencyKey is required for draft add/findByKey.', 'IDEMPOTENCY_KEY_REQUIRED');
  return {
    accountId: context.account.id,
    kind: 'draft',
    hash: context.idempotencyKey,
    idempotencyKey: context.idempotencyKey,
  };
}

export function createWechatDrafts({ client, cache = new MemoryAssetCache() }) {
  if (!client) throw new TypeError('A WeChat client is required');
  return {
    idempotentAdd: true,

    async findByKey(context) {
      return cache.get(required(context));
    },

    async add(context) {
      const key = required(context);
      return cache.getOrUpload({
        ...key,
        upload: () => client.addDraft(context.article),
      });
    },

    async update(context) {
      if (!context.mediaId) throw validationError('mediaId is required for draft update.', 'MEDIA_ID_REQUIRED');
      return client.updateDraft({
        mediaId: context.mediaId,
        index: context.index ?? 0,
        article: context.article,
      });
    },

    async get(context) {
      return client.getDraft(context.mediaId);
    },

    /** Explicitly reconcile a mediaId after reading it from the remote account. */
    async reconcile(context) {
      const key = required(context);
      if (!context.mediaId) throw validationError('mediaId is required for reconciliation.', 'MEDIA_ID_REQUIRED');
      await client.getDraft(context.mediaId);
      await cache.complete(key, { mediaId: context.mediaId });
      return { mediaId: context.mediaId, reconciled: true };
    },
  };
}
