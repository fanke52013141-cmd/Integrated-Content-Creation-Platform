import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  AdapterError,
  detectImageType,
  FileAssetCache,
  MemoryAssetCache,
  resolveAsset,
} from '../index.mjs';
import { jpegBytes, pngBytes, temporaryDirectory } from '../helpers/shared.mjs';

function cacheContext(overrides = {}) {
  return {
    accountId: 'account-1',
    kind: 'image',
    hash: 'abc123',
    idempotencyKey: 'image-key',
    ...overrides,
  };
}

test('memory cache coalesces concurrent uploads by account/kind/hash', async () => {
  const cache = new MemoryAssetCache();
  let uploads = 0;
  const context = cacheContext({
    upload: async () => {
      uploads += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { url: 'https://mmbiz.qpic.cn/cached.png' };
    },
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => cache.getOrUpload(context)));
  assert.equal(uploads, 1);
  assert.equal(new Set(results.map((result) => result.url)).size, 1);
  assert.deepEqual(await cache.get(context), { url: 'https://mmbiz.qpic.cn/cached.png' });
});

test('file cache survives reload and isolates accounts', async () => {
  const root = await temporaryDirectory();
  try {
    const directory = path.join(root, 'cache');
    const cache = new FileAssetCache({ directory });
    let uploads = 0;
    const upload = async () => ({ url: `https://mmbiz.qpic.cn/${++uploads}.png` });
    const first = cacheContext({ upload });
    assert.equal((await cache.getOrUpload(first)).url.endsWith('/1.png'), true);
    const reloaded = new FileAssetCache({ directory });
    assert.equal((await reloaded.getOrUpload(first)).url.endsWith('/1.png'), true);
    const otherAccount = cacheContext({ accountId: 'account-2', upload });
    assert.equal((await reloaded.getOrUpload(otherAccount)).url.endsWith('/2.png'), true);
    assert.equal(uploads, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ambiguous upload failure blocks a blind retry until pending state is cleared', async () => {
  const cache = new MemoryAssetCache();
  let uploads = 0;
  const context = cacheContext({
    upload: async () => {
      uploads += 1;
      throw new AdapterError('response lost', {
        code: 'ETIMEDOUT', category: 'transient', retryable: true, sideEffect: 'possible',
      });
    },
  });
  await assert.rejects(cache.getOrUpload(context), /response lost/u);
  assert.equal((await cache.getRecord(context)).status, 'pending');
  await assert.rejects(cache.getOrUpload(context), (error) => error.code === 'ASSET_RECONCILIATION_REQUIRED');
  assert.equal(uploads, 1);
  assert.equal(await cache.clearPending(context, { confirm: true }), true);
  const retry = cacheContext({ upload: async () => ({ url: 'https://mmbiz.qpic.cn/recovered.png' }) });
  assert.equal((await cache.getOrUpload(retry)).url.endsWith('recovered.png'), true);
});

test('asset validation handles signatures, size, and disabled remote fetching', async () => {
  assert.equal(detectImageType(pngBytes()), 'png');
  assert.equal(detectImageType(jpegBytes()), 'jpg');
  const image = await resolveAsset({ bytes: pngBytes() }, { kind: 'image', allowedRemoteHosts: new Set() });
  assert.match(image.hash, /^[a-f0-9]{64}$/u);
  const existing = await resolveAsset({ src: 'https://mmbiz.qpic.cn/a.png' }, {
    kind: 'image', allowedRemoteHosts: new Set(['mmbiz.qpic.cn']),
  });
  assert.match(existing.remoteUrl, /^https:\/\/mmbiz\.qpic\.cn\//u);
  await assert.rejects(resolveAsset({ src: 'https://example.com/a.png' }, {
    kind: 'image', allowedRemoteHosts: new Set(['mmbiz.qpic.cn']),
  }), (error) => error.code === 'ASSET_REMOTE_FETCH_DISABLED');
  await assert.rejects(resolveAsset({ bytes: Buffer.alloc(64 * 1024 + 1, 1) }, {
    kind: 'thumbnail', allowedRemoteHosts: new Set(),
  }), (error) => ['ASSET_INVALID_TYPE', 'ASSET_TOO_LARGE'].includes(error.code));
});
