import assert from 'node:assert/strict';
import test from 'node:test';
import { createWechatClient, WeChatHttpClient } from '../index.mjs';
import { jpegBytes, pngBytes } from '../helpers/shared.mjs';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function mockTransport() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    switch (parsed.pathname) {
      case '/cgi-bin/token': return jsonResponse({ access_token: 'TOKEN', expires_in: 7200 });
      case '/cgi-bin/media/uploadimg': return jsonResponse({ url: 'https://mmbiz.qpic.cn/body.png' });
      case '/cgi-bin/material/add_material': return jsonResponse({ media_id: 'THUMB', url: 'https://mmbiz.qpic.cn/thumb.jpg' });
      case '/cgi-bin/draft/add': return jsonResponse({ media_id: 'DRAFT' });
      case '/cgi-bin/draft/update': return jsonResponse({ errcode: 0, errmsg: 'ok' });
      case '/cgi-bin/draft/get': return jsonResponse({ news_item: [{ title: 'Title', content: '<p>body</p>' }] });
      case '/cgi-bin/draft/count': return jsonResponse({ total_count: 1 });
      default: return jsonResponse({ errcode: 404, errmsg: 'not found' }, 404);
    }
  };
  return { calls, fetchImpl };
}

function liveClient(fetchImpl) {
  return createWechatClient({
    live: true,
    env: { WECHAT_LIVE: '1' },
    credentials: {
      accountId: 'account-1',
      appId: 'APP_ID',
      appSecret: 'APP_SECRET',
      apiBase: 'https://api.weixin.qq.com',
    },
    fetchImpl,
  });
}

test('HTTP contract covers token caching, uploads, draft add/update/get/count and health', async () => {
  const transport = mockTransport();
  const client = liveClient(transport.fetchImpl);
  const image = await client.uploadArticleImage({ bytes: pngBytes(), filename: 'a.png', mimeType: 'image/png' });
  assert.equal(image.url, 'https://mmbiz.qpic.cn/body.png');
  const thumb = await client.uploadThumbnail({ bytes: jpegBytes(), filename: 'cover.jpg' });
  assert.equal(thumb.mediaId, 'THUMB');
  const article = { title: 'Title', content: '<p>body</p>', thumb_media_id: 'THUMB' };
  assert.deepEqual(await client.addDraft(article), { mediaId: 'DRAFT' });
  assert.deepEqual(await client.updateDraft({ mediaId: 'DRAFT', article }), { ok: true, mediaId: 'DRAFT', index: 0 });
  assert.equal((await client.getDraft('DRAFT')).news_item[0].title, 'Title');
  assert.equal((await client.getDraftCount()).totalCount, 1);
  const health = await client.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.capabilities.publish, false);
  assert.equal(health.capabilities.massSend, false);

  const tokenCalls = transport.calls.filter((call) => call.url.pathname === '/cgi-bin/token');
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].url.searchParams.get('appid'), 'APP_ID');
  assert.equal(tokenCalls[0].url.searchParams.get('secret'), 'APP_SECRET');
  const update = transport.calls.find((call) => call.url.pathname === '/cgi-bin/draft/update');
  const updateBody = JSON.parse(update.init.body);
  assert.equal(updateBody.media_id, 'DRAFT');
  assert.equal(updateBody.index, 0);
  assert.deepEqual(updateBody.articles, article);
  assert.equal(Array.isArray(updateBody.articles), false);
  assert.equal(update.url.searchParams.get('access_token'), 'TOKEN');
  const upload = transport.calls.find((call) => call.url.pathname === '/cgi-bin/media/uploadimg');
  assert.equal(upload.init.body instanceof FormData, true);
  assert.equal(upload.init.body.has('media'), true);
});

test('default client performs no network without explicit live configuration', async () => {
  const transport = mockTransport();
  const client = new WeChatHttpClient({
    credentials: { accountId: 'a', accessToken: 'TOKEN', apiBase: 'https://api.weixin.qq.com' },
    fetchImpl: transport.fetchImpl,
  });
  await assert.rejects(client.getDraftCount(), /WECHAT_LIVE=1/u);
  assert.equal(transport.calls.length, 0);
  assert.throws(() => createWechatClient({
    live: false,
    env: {},
    credentials: { accountId: 'a', accessToken: 'TOKEN', apiBase: 'https://api.weixin.qq.com' },
    fetchImpl: transport.fetchImpl,
  }), /WECHAT_LIVE=1/u);
});

test('HTTP and WeChat failures preserve category, retryability, and write side effects', async () => {
  const rateLimited = async () => jsonResponse({ errcode: 45009, errmsg: 'rate limited', rid: 'rid-1' }, 429);
  const client = createWechatClient({
    live: true,
    env: { WECHAT_LIVE: '1' },
    credentials: { accountId: 'account-1', accessToken: 'TOKEN', apiBase: 'https://api.weixin.qq.com' },
    fetchImpl: rateLimited,
  });
  await assert.rejects(
    client.addDraft({ title: 't', content: 'x' }),
    (error) => {
      assert.equal(Number(error.code), 45009);
      assert.equal(error.category, 'transient');
      assert.equal(error.retryable, true);
      assert.equal(error.sideEffect, 'possible');
      assert.equal(error.status, 429);
      assert.equal(error.details.rid, 'rid-1');
      return true;
    },
  );

  const nonJson = liveClient(async () => new Response('upstream error', { status: 503 }));
  await assert.rejects(nonJson.getDraftCount(), (error) => {
    assert.equal(error.code, 'INVALID_JSON_RESPONSE');
    assert.equal(error.retryable, true);
    return true;
  });
});
