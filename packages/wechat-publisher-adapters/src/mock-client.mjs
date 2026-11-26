import { MemoryAssetCache } from './asset-cache.mjs';
import { createWechatAssets } from './assets.mjs';
import {
  checkAccountHealth,
  createInspectorAdapter,
  createMockRenderer,
  createVerifierAdapter,
} from './core-adapters.mjs';
import { createWechatDrafts } from './drafts.mjs';
import { AdapterError } from './errors.mjs';

export class MockWechatClient {
  constructor() {
    this.calls = [];
    this.drafts = new Map();
    this.failures = new Map();
    this.draftSequence = 0;
  }

  failNext(method, error = new AdapterError('Mock transient failure', {
    code: 'ETIMEDOUT',
    category: 'transient',
    retryable: true,
    sideEffect: 'possible',
  }), { after = false } = {}) {
    const queue = this.failures.get(method) ?? [];
    queue.push({ error, after });
    this.failures.set(method, queue);
  }

  async invoke(method, args, work) {
    this.calls.push({ method, ...args });
    const queue = this.failures.get(method) ?? [];
    const fault = queue.shift();
    if (fault && !fault.after) throw fault.error;
    const result = await work();
    if (fault?.after) throw fault.error;
    return result;
  }

  async getAccessToken() {
    return this.invoke('token', {}, async () => 'MOCK_ACCESS_TOKEN');
  }

  async uploadArticleImage({ hash, filename }) {
    return this.invoke('uploadimg', { hash, filename }, async () => ({
      url: `https://mmbiz.qpic.cn/mock/${hash.slice(0, 20)}.png`,
    }));
  }

  async uploadThumbnail({ hash, filename }) {
    return this.invoke('add_material', { hash, filename }, async () => ({
      mediaId: `MOCK_THUMB_${hash.slice(0, 20)}`,
      url: `https://mmbiz.qpic.cn/mock/thumb-${hash.slice(0, 20)}.jpg`,
    }));
  }

  async addDraft(article) {
    return this.invoke('draft.add', { title: article.title }, async () => {
      this.draftSequence += 1;
      const mediaId = `MOCK_DRAFT_${this.draftSequence}`;
      this.drafts.set(mediaId, [structuredClone(article)]);
      return { mediaId };
    });
  }

  async updateDraft({ mediaId, index = 0, article }) {
    return this.invoke('draft.update', { mediaId, index, title: article.title }, async () => {
      if (!this.drafts.has(mediaId)) {
        throw new AdapterError('Draft not found', { code: 'DRAFT_NOT_FOUND', category: 'permanent' });
      }
      const articles = this.drafts.get(mediaId);
      articles[index] = structuredClone(article);
      this.drafts.set(mediaId, articles);
      return { ok: true, mediaId, index };
    });
  }

  async getDraft(mediaId) {
    return this.invoke('draft.get', { mediaId }, async () => {
      if (!this.drafts.has(mediaId)) {
        throw new AdapterError('Draft not found', { code: 'DRAFT_NOT_FOUND', category: 'permanent' });
      }
      return { news_item: structuredClone(this.drafts.get(mediaId)) };
    });
  }

  async getDraftCount() {
    return this.invoke('draft.count', {}, async () => ({ totalCount: this.drafts.size }));
  }

  async healthCheck() {
    const token = await this.getAccessToken();
    const drafts = await this.getDraftCount();
    return {
      ok: true,
      token: { configured: Boolean(token), expiresAt: 'mock' },
      drafts,
      capabilities: {
        draftAdd: true,
        draftUpdate: true,
        draftGet: true,
        publish: false,
        massSend: false,
      },
    };
  }
}

export function createMockAdapters({
  client = new MockWechatClient(),
  cache = new MemoryAssetCache(),
  assetsRoot,
  lint,
} = {}) {
  return {
    renderer: createMockRenderer(),
    inspector: createInspectorAdapter({ lint }),
    assets: createWechatAssets({ client, cache, assetsRoot }),
    drafts: createWechatDrafts({ client, cache }),
    verifier: createVerifierAdapter(),
    health: {
      check: (account) => checkAccountHealth({ client, account }),
    },
    client,
    cache,
    calls: client.calls,
    failNext: client.failNext.bind(client),
    state: client,
  };
}
