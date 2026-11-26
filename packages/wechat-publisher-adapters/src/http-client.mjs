import path from 'node:path';
import { AdapterError, classifyError, validationError } from './errors.mjs';
import {
  assertLiveConfiguration,
  publicCredentials,
  resolveWechatCredentials,
} from './credentials.mjs';

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  throw validationError('Asset bytes must be a Uint8Array/Buffer.', 'INVALID_ASSET_BYTES');
}

export class WeChatHttpClient {
  constructor({
    credentials,
    live = false,
    env = process.env,
    fetchImpl = fetch,
    timeoutMs = 10_000,
    now = () => Date.now(),
  }) {
    if (!credentials) throw new TypeError('credentials are required');
    this.credentials = credentials;
    this.live = live;
    this.env = env;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.accessToken = credentials.accessToken;
    this.tokenExpiresAt = credentials.accessToken ? Number.POSITIVE_INFINITY : 0;
  }

  assertNetworkAllowed() {
    assertLiveConfiguration({
      live: this.live,
      env: this.env,
      credentials: this.credentials,
    });
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt > this.now()) return this.accessToken;
    const data = await this.requestJson('/cgi-bin/token', {
      method: 'GET',
      skipAuth: true,
      query: {
        grant_type: 'client_credential',
        appid: this.credentials.appId,
        secret: this.credentials.appSecret,
      },
      sideEffect: 'none',
    });
    if (!data.access_token) {
      throw validationError('WeChat token response has no access_token.', 'TOKEN_RESPONSE_INVALID');
    }
    this.accessToken = data.access_token;
    const expiresIn = Number(data.expires_in ?? 7200);
    this.tokenExpiresAt = this.now() + Math.max(60, expiresIn - 300) * 1000;
    return this.accessToken;
  }

  async requestJson(endpoint, {
    method = 'POST',
    query,
    body,
    form,
    skipAuth = false,
    sideEffect = 'none',
  } = {}) {
    this.assertNetworkAllowed();
    const token = skipAuth ? null : await this.getAccessToken();
    const base = this.credentials.apiBase.replace(/\/$/u, '');
    const url = new URL(`${base}${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (token) url.searchParams.set('access_token', token);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: form ? undefined : body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new AdapterError(`WeChat request timed out: ${endpoint}`, {
          code: 'ETIMEDOUT',
          category: 'transient',
          retryable: true,
          sideEffect,
          details: { endpoint },
        });
      }
      throw classifyError(error, { sideEffect, details: { endpoint } });
    } finally {
      clearTimeout(timer);
    }

    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw classifyError(error, { sideEffect, details: { endpoint } });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AdapterError(`WeChat returned non-JSON for ${endpoint} (HTTP ${response.status})`, {
        code: 'INVALID_JSON_RESPONSE',
        category: response.status >= 500 ? 'transient' : 'permanent',
        retryable: response.status >= 500,
        sideEffect,
        status: response.status,
        details: { endpoint },
      });
    }
    if (!response.ok || (data.errcode !== undefined && Number(data.errcode) !== 0)) {
      const error = new AdapterError(`WeChat API ${endpoint} failed: ${data.errcode ?? response.status} ${data.errmsg ?? text.slice(0, 160)}`, {
        code: data.errcode ?? response.status,
        status: response.status,
        sideEffect,
        details: { endpoint, rid: data.rid },
      });
      error.errcode = data.errcode;
      error.rid = data.rid;
      throw classifyError(error, { sideEffect });
    }
    return data;
  }

  async uploadArticleImage({ bytes, filename = 'image.png', mimeType = 'image/png' }) {
    const form = new FormData();
    form.append('media', new Blob([bytesOf(bytes)], { type: mimeType }), path.basename(filename));
    const data = await this.requestJson('/cgi-bin/media/uploadimg', {
      form,
      sideEffect: 'possible',
    });
    if (!data.url) throw validationError('uploadimg returned no URL.', 'UPLOAD_INVALID_RESPONSE');
    return { url: data.url };
  }

  async uploadThumbnail({ bytes, filename = 'cover.jpg' }) {
    const form = new FormData();
    form.append('media', new Blob([bytesOf(bytes)], { type: 'image/jpeg' }), path.basename(filename));
    const data = await this.requestJson('/cgi-bin/material/add_material?type=thumb', {
      form,
      sideEffect: 'possible',
    });
    if (!data.media_id) throw validationError('add_material returned no media_id.', 'UPLOAD_INVALID_RESPONSE');
    return { mediaId: data.media_id, ...(data.url ? { url: data.url } : {}) };
  }

  async addDraft(article) {
    const data = await this.requestJson('/cgi-bin/draft/add', {
      body: { articles: [article] },
      sideEffect: 'possible',
    });
    if (!data.media_id) {
      throw new AdapterError('draft/add returned no media_id; reconciliation is required.', {
        code: 'DRAFT_RECONCILIATION_REQUIRED',
        category: 'ambiguous',
        retryable: false,
        sideEffect: 'possible',
      });
    }
    return { mediaId: data.media_id };
  }

  async updateDraft({ mediaId, index = 0, article }) {
    if (!mediaId) throw validationError('mediaId is required for draft/update.', 'MEDIA_ID_REQUIRED');
    await this.requestJson('/cgi-bin/draft/update', {
      body: { media_id: mediaId, index, articles: article },
      sideEffect: 'possible',
    });
    return { ok: true, mediaId, index };
  }

  async getDraft(mediaId) {
    if (!mediaId) throw validationError('mediaId is required for draft/get.', 'MEDIA_ID_REQUIRED');
    return this.requestJson('/cgi-bin/draft/get', {
      body: { media_id: mediaId },
      sideEffect: 'none',
    });
  }

  async getDraftCount() {
    const data = await this.requestJson('/cgi-bin/draft/count', {
      body: {},
      sideEffect: 'none',
    });
    return { totalCount: Number(data.total_count ?? 0) };
  }

  async healthCheck() {
    const token = await this.getAccessToken();
    const drafts = await this.getDraftCount();
    return {
      ok: true,
      account: publicCredentials(this.credentials),
      token: { configured: Boolean(token), expiresAt: Number.isFinite(this.tokenExpiresAt) ? new Date(this.tokenExpiresAt).toISOString() : 'provided' },
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

export function createWechatClient({
  account = { id: 'default' },
  credentials,
  live = false,
  env = process.env,
  ...options
} = {}) {
  const resolved = credentials ?? resolveWechatCredentials({ account, env });
  assertLiveConfiguration({ live, env, credentials: resolved });
  return new WeChatHttpClient({ credentials: resolved, live, env, ...options });
}
