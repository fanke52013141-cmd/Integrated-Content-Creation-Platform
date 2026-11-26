import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validationError } from './errors.mjs';
import { FileMutex } from './mutex.mjs';

const SECRET_KEYS = new Set(['appsecret', 'accesstoken', 'password', 'privatekey', 'secretkey', 'credentials']);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function assertNoSecrets(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-zA-Z0-9]/gu, '').toLowerCase();
    if (SECRET_KEYS.has(normalized)) {
      throw validationError(`Secret-like field must not be persisted: ${path}.${key}`, 'SECRET_IN_RECORD');
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

export async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function keyHash(key) {
  return createHash('sha256').update(key).digest('hex');
}

export class FileDeliveryStore {
  constructor({ directory, lockTimeoutMs = 5000, staleLockMs } = {}) {
    if (!directory) throw new TypeError('FileDeliveryStore directory is required');
    this.directory = path.resolve(directory);
    this.mutex = new FileMutex({
      directory: path.join(this.directory, 'locks'),
      timeoutMs: lockTimeoutMs,
      ...(staleLockMs === undefined ? {} : { staleMs: staleLockMs }),
    });
  }

  pathFor(key) {
    return path.join(this.directory, `${keyHash(key)}.json`);
  }

  lockPathFor(key) {
    return this.mutex.pathFor(`delivery:${key}`);
  }

  async load(key) {
    try {
      return clone(JSON.parse(await readFile(this.pathFor(key), 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        throw validationError(`Delivery record is corrupt: ${this.pathFor(key)}`, 'STORE_CORRUPT', { key });
      }
      throw error;
    }
  }

  async save(record) {
    if (!record?.key || typeof record.key !== 'string') {
      throw validationError('Delivery record requires a string key.', 'INVALID_DELIVERY_RECORD');
    }
    assertNoSecrets(record);
    const snapshot = clone(record);
    await atomicWriteJson(this.pathFor(record.key), snapshot);
    return clone(snapshot);
  }

  async runExclusive(key, work) {
    return this.mutex.runExclusive(`delivery:${key}`, work);
  }

  async keys() {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory);
    const keys = [];
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try {
        const record = JSON.parse(await readFile(path.join(this.directory, file), 'utf8'));
        if (record.key) keys.push(record.key);
      } catch {
        // keys() does not hide corruption in load(); listing skips unrelated/corrupt files.
      }
    }
    return keys.sort();
  }
}
