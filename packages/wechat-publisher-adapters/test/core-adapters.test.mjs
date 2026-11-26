import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdapterError,
  checkAccountHealth,
  createInspectorAdapter,
  createRendererAdapter,
  MockWechatClient,
} from '../index.mjs';
import { makeInput } from '../helpers/shared.mjs';

test('renderer adapter supports injected implementations and fails closed when absent', async () => {
  const renderer = createRendererAdapter({ render: async () => ({ html: '<p>real</p>', plainText: 'real' }) });
  assert.deepEqual(await renderer.render({}), { html: '<p>real</p>', plainText: 'real' });
  const missing = createRendererAdapter();
  await assert.rejects(missing.render({ document: {} }), (error) => error.code === 'RENDERER_UNAVAILABLE');
});

test('inspector converts injected quality findings and preserves image/thumbnail references', async () => {
  const inspector = createInspectorAdapter({
    lint: async () => ({
      findings: [
        { severity: 'block', ruleId: 'TEST_BLOCK', message: 'blocked', recommendation: 'fix' },
        { severity: 'degrade', ruleId: 'TEST_WARN', message: 'warning', recommendation: 'review' },
      ],
    }),
  });
  const { document } = makeInput();
  const report = await inspector.inspect({ document, rendered: { html: '<p>safe</p>' } });
  assert.equal(report.ready, false);
  assert.equal(report.blockers[0].code, 'TEST_BLOCK');
  assert.equal(report.warnings[0].code, 'TEST_WARN');
  assert.equal(report.images[0].id, 'image-1');
  assert.ok(report.thumbnail);
});

test('health failures are categorized without exposing credentials', async () => {
  const report = await checkAccountHealth({
    account: { id: 'account-a' },
    client: {
      async healthCheck() {
        throw new AdapterError('invalid credential', {
          code: 40001,
          category: 'auth',
          status: 401,
          details: { appSecret: 'must-not-leak' },
        });
      },
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.category, 'auth');
  assert.equal(report.error.status, 401);
  assert.equal(JSON.stringify(report).includes('must-not-leak'), false);
});

test('mock client exposes no publish or mass-send capability', () => {
  const client = new MockWechatClient();
  assert.equal(client.publish, undefined);
  assert.equal(client.massSend, undefined);
  assert.equal(client.freeSend, undefined);
});
