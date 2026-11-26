import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DeliveryMachine } from '../../wechat-publisher/src/state-machine.mjs';
import { stepIdempotencyKey } from '../../wechat-publisher/src/idempotency.mjs';
import {
  AdapterError,
  compareDraftArticles,
  createMockAdapters,
  FileAssetCache,
  FileDeliveryStore,
  MockWechatClient,
  reconcileDraftAndResume,
} from '../index.mjs';
import { makeInput, temporaryDirectory } from '../helpers/shared.mjs';

function machineFor(root, adapters) {
  return new DeliveryMachine({
    store: new FileDeliveryStore({ directory: path.join(root, 'deliveries') }),
    renderer: adapters.renderer,
    inspector: adapters.inspector,
    assets: adapters.assets,
    drafts: adapters.drafts,
    verifier: adapters.verifier,
    retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    sleep: async () => {},
  });
}

test('mock adapters satisfy the complete DeliveryMachine contract without network', async () => {
  const root = await temporaryDirectory();
  try {
    const client = new MockWechatClient();
    const adapters = createMockAdapters({
      client,
      cache: new FileAssetCache({ directory: path.join(root, 'asset-cache') }),
    });
    const machine = machineFor(root, adapters);
    const input = makeInput();
    const record = await machine.deliver(input);
    assert.equal(record.status, 'completed', JSON.stringify(record.error));
    assert.equal(record.result.scope, 'draft-only');
    assert.equal(record.result.uploads.length, 1);
    assert.match(record.result.uploads[0].url, /^https:\/\/mmbiz\.qpic\.cn\/mock\//u);
    assert.match(record.result.mediaId, /^MOCK_DRAFT_/u);
    assert.equal(client.calls.filter((call) => call.method === 'draft.add').length, 1);
    assert.equal(client.calls.filter((call) => call.method === 'uploadimg').length, 1);
    assert.equal(client.calls.filter((call) => call.method === 'add_material').length, 1);

    const again = await machine.deliver(input);
    assert.equal(again.status, 'completed');
    assert.equal(client.calls.filter((call) => call.method === 'draft.add').length, 1);
    assert.equal(client.calls.filter((call) => call.method === 'uploadimg').length, 1);
    assert.equal(client.calls.filter((call) => call.method === 'add_material').length, 1);

    const updatedArticle = {
      title: 'Updated title',
      author: 'Mock author',
      digest: 'Mock digest',
      content: '<h1>Updated title</h1><p>Updated body</p>',
      thumb_media_id: record.result.thumbMediaId,
    };
    await adapters.drafts.update({ mediaId: record.result.mediaId, article: updatedArticle });
    const readback = await adapters.drafts.get({ mediaId: record.result.mediaId });
    assert.equal(readback.news_item[0].title, 'Updated title');
    const health = await adapters.health.check(input.account);
    assert.equal(health.ok, true);
    assert.equal(health.capabilities.publish, false);
    assert.equal(health.capabilities.massSend, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lost draft response requires reconciliation and never creates a blind duplicate', async () => {
  const root = await temporaryDirectory();
  try {
    const client = new MockWechatClient();
    const adapters = createMockAdapters({ client });
    const machine = machineFor(root, adapters);
    const input = makeInput();
    client.failNext('draft.add', new AdapterError('response lost after remote add', {
      code: 'ETIMEDOUT', category: 'transient', retryable: true, sideEffect: 'possible',
    }), { after: true });

    const record = await machine.deliver(input);
    assert.equal(record.status, 'needs_reconciliation', JSON.stringify(record.error));
    assert.equal(record.error.code, 'DRAFT_RECONCILIATION_REQUIRED');
    assert.equal(client.calls.filter((call) => call.method === 'draft.add').length, 1);

    const mediaId = 'MOCK_DRAFT_1';
    const resumed = await reconcileDraftAndResume({
      machine,
      drafts: adapters.drafts,
      key: record.key,
      account: input.account,
      idempotencyKey: stepIdempotencyKey(record.key, 'draftAdd'),
      mediaId,
    });
    assert.equal(resumed.status, 'completed', JSON.stringify(resumed.error));
    assert.equal(resumed.result.mediaId, mediaId);
    assert.equal(client.calls.filter((call) => call.method === 'draft.add').length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifier compares semantic content and critical metadata', () => {
  const expected = {
    title: 'Title', author: 'A', digest: 'D', content_source_url: '', thumb_media_id: 'T',
    content: '<p>Same <strong>text</strong></p><img src="https://mmbiz.qpic.cn/a.png">',
  };
  const actual = {
    ...expected,
    content: '<section><p>Same text</p><img src="https://mmbiz.qpic.cn/a.png"></section>',
  };
  const equal = compareDraftArticles(expected, actual);
  assert.equal(equal.semanticTextEqual, true);
  assert.equal(equal.imagesEqual, true);
  assert.equal(equal.structuralEqual, false);
  assert.equal(equal.ok, true);
  const mismatch = compareDraftArticles(expected, { ...actual, title: 'Other' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.differences[0].field, 'title');
});
