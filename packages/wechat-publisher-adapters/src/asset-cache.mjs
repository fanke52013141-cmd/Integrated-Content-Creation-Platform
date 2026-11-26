import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ambiguousError, validationError } from './errors.mjs';
import { atomicWriteJson } from './file-store.mjs';
import { FileMutex } from './mutex.mjs';

export function hashBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw validationError('hashBytes expects Uint8Array/Buffer.', 'INVALID_ASSET_BYTES');
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hashFile(filePath) {
  return hashBytes(await readFile(filePath));
}

function cacheKey({ accountId, kind, hash }) {
  if (!accountId || !kind || !hash) throw validationError('accountId, kind and hash are required for the result cache.', 'INVALID_CACHE_KEY');
  return `${accountId}:${kind}:${hash}`;
}

function expectedErrorCode(kind) {
  return kind === 'draft' ? 'DRAFT_RECONCILIATION_REQUIRED' : 'ASSET_RECONCILIATION_REQUIRED';
}

function validateResult(kind, result) {
  if (kind === 'image' && typeof result?.url === 'string' && result.url) return;
  if ((kind === 'thumbnail' || kind === 'draft') && typeof result?.mediaId === 'string' && result.mediaId) return;
  throw ambiguousError(`Upload result for ${kind} is incomplete; refusing a blind retry.`, expectedErrorCode(kind), { kind });
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

async function execute({ context, load, save, remove, runExclusive, upload }) {
  const { upload: _upload, ...recordContext } = context;
  const key = cacheKey(context);
  const existing = await load(key);
  if (existing?.status === 'completed') return clone(existing.result);
  if (existing?.status === 'pending') {
    throw ambiguousError('A previous operation has an unknown remote outcome; reconcile it before retrying.', expectedErrorCode(context.kind), {
      key,
      idempotencyKey: context.idempotencyKey,
    });
  }
  return runExclusive(key, async () => {
    const current = await load(key);
    if (current?.status === 'completed') return clone(current.result);
    if (current?.status === 'pending') {
      throw ambiguousError('A previous operation has an unknown remote outcome; reconcile it before retrying.', expectedErrorCode(context.kind), {
        key,
        idempotencyKey: context.idempotencyKey,
      });
    }
    const timestamp = new Date().toISOString();
    await save(key, {
      schemaVersion: 1,
      ...recordContext,
      status: 'pending',
      result: null,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    try {
      const result = await upload();
      validateResult(context.kind, result);
      await save(key, {
        schemaVersion: 1,
        ...recordContext,
        status: 'completed',
        result: clone(result),
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: new Date().toISOString(),
      });
      return clone(result);
    } catch (error) {
      if (error?.sideEffect === 'none') await remove(key);
      throw error;
    }
  });
}

export class MemoryAssetCache {
  #records = new Map();
  #locks = new Map();

  async getRecord(context) {
    return clone(this.#records.get(cacheKey(context)) ?? null);
  }

  async get(context) {
    const record = await this.getRecord(context);
    return record?.status === 'completed' ? clone(record.result) : null;
  }

  async getOrUpload(context) {
    return execute({
      context,
      load: async (key) => clone(this.#records.get(key) ?? null),
      save: async (key, record) => { this.#records.set(key, clone(record)); },
      remove: async (key) => { this.#records.delete(key); },
      runExclusive: async (key, work) => {
        const previous = this.#locks.get(key) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        this.#locks.set(key, current);
        await previous;
        try {
          return await work();
        } finally {
          release();
          if (this.#locks.get(key) === current) this.#locks.delete(key);
        }
      },
      upload: context.upload,
    });
  }

  async complete(context, result) {
    validateResult(context.kind, result);
    const key = cacheKey(context);
    this.#records.set(key, {
      schemaVersion: 1,
      ...context,
      status: 'completed',
      result: clone(result),
      createdAt: this.#records.get(key)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return clone(result);
  }

  async clearPending(context, { confirm = false } = {}) {
    if (confirm !== true) throw validationError('Pending cache cleanup requires confirm:true.', 'CONFIRMATION_REQUIRED');
    const key = cacheKey(context);
    const record = this.#records.get(key);
    if (record?.status !== 'pending') return false;
    this.#records.delete(key);
    return true;
  }
}

export class FileAssetCache {
  constructor({ directory, lockTimeoutMs = 5000 } = {}) {
    if (!directory) throw new TypeError('FileAssetCache directory is required');
    this.directory = path.resolve(directory);
    this.mutex = new FileMutex({ directory: path.join(directory, 'locks'), timeoutMs: lockTimeoutMs });
  }

  pathFor(context) {
    const key = cacheKey(context);
    return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  async getRecord(context) {
    try {
      return JSON.parse(await readFile(this.pathFor(context), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw validationError('Asset cache record is corrupt.', 'CACHE_CORRUPT');
      throw error;
    }
  }

  async get(context) {
    const record = await this.getRecord(context);
    return record?.status === 'completed' ? clone(record.result) : null;
  }

  async getOrUpload(context) {
    return execute({
      context,
      load: async (key) => this.getRecord(context),
      save: async (key, record) => atomicWriteJson(this.pathFor(context), record),
      remove: async () => unlink(this.pathFor(context)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      }),
      runExclusive: (key, work) => this.mutex.runExclusive(`asset:${key}`, work),
      upload: context.upload,
    });
  }

  async complete(context, result) {
    validateResult(context.kind, result);
    const existing = await this.getRecord(context);
    await atomicWriteJson(this.pathFor(context), {
      schemaVersion: 1,
      ...context,
      status: 'completed',
      result: clone(result),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return clone(result);
  }

  async clearPending(context, { confirm = false } = {}) {
    if (confirm !== true) throw validationError('Pending cache cleanup requires confirm:true.', 'CONFIRMATION_REQUIRED');
    const record = await this.getRecord(context);
    if (record?.status !== 'pending') return false;
    await unlink(this.pathFor(context));
    return true;
  }
}
