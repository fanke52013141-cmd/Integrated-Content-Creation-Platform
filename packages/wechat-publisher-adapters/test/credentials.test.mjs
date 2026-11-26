import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import {
  accountEnvPrefix,
  assertLiveConfiguration,
  loadEnvFile,
  parseEnvText,
  publicCredentials,
  resolveWechatCredentials,
} from '../index.mjs';
import { temporaryDirectory } from '../helpers/shared.mjs';

test('dotenv parsing and account-specific credential resolution', async () => {
  const root = await temporaryDirectory();
  try {
    const file = path.join(root, 'wechat.env');
    await writeFile(file, '# comment\nWECHAT_APP_ID="generic-id"\nWECHAT_APP_SECRET=generic-secret\nWECHAT_ACCOUNT_TEAM_A_APP_ID=team-id\nWECHAT_ACCOUNT_TEAM_A_APP_SECRET=team-secret\n', 'utf8');
    const env = await loadEnvFile(file, { env: { WECHAT_LIVE: '1' } });
    assert.equal(env.WECHAT_LIVE, '1');
    assert.equal(accountEnvPrefix('team-a'), 'WECHAT_ACCOUNT_TEAM_A_');
    const credentials = resolveWechatCredentials({ account: { id: 'team-a' }, env });
    assert.equal(credentials.appId, 'team-id');
    assert.equal(credentials.appSecret, 'team-secret');
    assertLiveConfiguration({ live: true, env, credentials });
    const publicView = publicCredentials(credentials);
    assert.equal(publicView.appSecretConfigured, true);
    assert.equal(JSON.stringify(publicView).includes('team-secret'), false);
    assert.equal(publicView.appSecret, undefined);
    assert.equal(publicView.accessToken, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dotenv parser handles export, quotes, and inline comments', () => {
  const parsed = parseEnvText('export A=1\nB="two words"\nC=value # comment\n');
  assert.deepEqual(parsed, { A: '1', B: 'two words', C: 'value' });
});

test('live configuration fails closed without explicit flags, credentials, or HTTPS', () => {
  const credentials = { accountId: 'a', appId: 'id', appSecret: 'secret', apiBase: 'https://api.weixin.qq.com' };
  assert.throws(() => assertLiveConfiguration({ live: false, env: {}, credentials }), /WECHAT_LIVE=1/u);
  assert.throws(() => assertLiveConfiguration({ live: true, env: {}, credentials }), /WECHAT_LIVE=1/u);
  assert.throws(
    () => assertLiveConfiguration({ live: true, env: { WECHAT_LIVE: '1' }, credentials: { apiBase: credentials.apiBase } }),
    (error) => error.code === 'WECHAT_CREDENTIALS_REQUIRED',
  );
  assert.throws(() => assertLiveConfiguration({ live: true, env: { WECHAT_LIVE: '1' }, credentials: { ...credentials, apiBase: 'http://example.com' } }), /HTTPS/u);
});
