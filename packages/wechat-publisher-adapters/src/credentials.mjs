import { readFile } from 'node:fs/promises';
import { validationError } from './errors.mjs';

export function parseEnvText(text) {
  const result = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equals = normalized.indexOf('=');
    if (equals <= 0) continue;
    const key = normalized.slice(0, equals).trim();
    let value = normalized.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, '').trim();
    }
    if (key) result[key] = value;
  }
  return result;
}

export async function loadEnvFile(filePath, { env = {}, override = false } = {}) {
  const parsed = parseEnvText(await readFile(filePath, 'utf8'));
  return { ...parsed, ...env, ...(override ? parsed : env) };
}

export function accountEnvPrefix(accountId) {
  const normalized = String(accountId ?? 'default').replace(/[^a-zA-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').toUpperCase() || 'DEFAULT';
  return `WECHAT_ACCOUNT_${normalized}_`;
}

function readAccountValue(env, prefix, suffix, genericSuffix = suffix) {
  return env[`${prefix}${suffix}`] ?? env[`WECHAT_${genericSuffix}`];
}

export function resolveWechatCredentials({ account = { id: 'default' }, env = process.env } = {}) {
  const prefix = accountEnvPrefix(account.id);
  return {
    accountId: account.id,
    appId: readAccountValue(env, prefix, 'APP_ID'),
    appSecret: readAccountValue(env, prefix, 'APP_SECRET'),
    accessToken: readAccountValue(env, prefix, 'ACCESS_TOKEN'),
    apiBase: readAccountValue(env, prefix, 'API_BASE') ?? 'https://api.weixin.qq.com',
  };
}

export function assertLiveConfiguration({ live, env = process.env, credentials }) {
  if (live !== true || env.WECHAT_LIVE !== '1') {
    throw validationError(
      'Live network requires both live:true and WECHAT_LIVE=1; mock mode performs no network requests.',
      'LIVE_NETWORK_DISABLED',
    );
  }
  if (!credentials?.accessToken && (!credentials?.appId || !credentials?.appSecret)) {
    throw validationError(
      'Live mode requires WECHAT_ACCESS_TOKEN or WECHAT_APP_ID + WECHAT_APP_SECRET.',
      'WECHAT_CREDENTIALS_REQUIRED',
    );
  }
  let api;
  try {
    api = new URL(credentials.apiBase);
  } catch {
    throw validationError('WECHAT_API_BASE must be an absolute URL.', 'INVALID_API_BASE');
  }
  if (api.protocol !== 'https:') {
    throw validationError('WECHAT_API_BASE must use HTTPS.', 'INSECURE_API_BASE');
  }
  return credentials;
}

export function publicCredentials(credentials) {
  return {
    accountId: credentials.accountId,
    appIdConfigured: Boolean(credentials.appId),
    appSecretConfigured: Boolean(credentials.appSecret),
    accessTokenConfigured: Boolean(credentials.accessToken),
    apiBase: credentials.apiBase,
  };
}
