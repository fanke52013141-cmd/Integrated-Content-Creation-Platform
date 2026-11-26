import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AdapterError } from './errors.mjs';

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

export class FileMutex {
  #locks = new Map();

  constructor({ directory, staleMs = 30 * 60 * 1000, timeoutMs = 5000, retryDelayMs = 25, sleep = sleepDefault }) {
    if (!directory) throw new TypeError('FileMutex directory is required');
    this.directory = path.resolve(directory);
    this.staleMs = staleMs;
    this.timeoutMs = timeoutMs;
    this.retryDelayMs = retryDelayMs;
    this.sleep = sleep;
  }

  pathFor(key) {
    return path.join(this.directory, `${digest(key)}.lock`);
  }

  async recoverStale(lockPath) {
    let lockStat;
    try {
      lockStat = await stat(lockPath);
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
    let data = null;
    try {
      data = JSON.parse(await readFile(lockPath, 'utf8'));
    } catch {
      // An empty/partial lock can only be reclaimed after the stale interval.
    }
    const age = Date.now() - lockStat.mtimeMs;
    const sameHostDeadOwner = data?.hostname === os.hostname() && !processAlive(Number(data?.pid));
    if (sameHostDeadOwner || age >= this.staleMs) {
      try {
        await unlink(lockPath);
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return true;
        throw error;
      }
    }
    return false;
  }

  async acquire(key) {
    await mkdir(this.directory, { recursive: true });
    const lockPath = this.pathFor(key);
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + this.timeoutMs;
    while (true) {
      let handle;
      try {
        handle = await open(lockPath, 'wx');
        await handle.writeFile(JSON.stringify({
          token,
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: new Date().toISOString(),
        }), 'utf8');
        await handle.sync();
        return { handle, lockPath, token };
      } catch (error) {
        await handle?.close().catch(() => {});
        if (error.code !== 'EEXIST') {
          // If we created the lock but failed while writing its owner metadata,
          // do not leave a fresh, unparsable lock blocking every other process.
          if (handle) await unlink(lockPath).catch(() => {});
          throw error;
        }
        if (await this.recoverStale(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new AdapterError(`Delivery key is locked by another process: ${key}`, {
            code: 'DELIVERY_LOCKED',
            category: 'transient',
            retryable: true,
            sideEffect: 'none',
            details: { key },
          });
        }
        await this.sleep(this.retryDelayMs);
      }
    }
  }

  async release(lock) {
    try {
      const data = JSON.parse(await readFile(lock.lockPath, 'utf8'));
      if (data.token === lock.token) await unlink(lock.lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      await lock.handle.close().catch(() => {});
    }
  }

  async runExclusive(key, work) {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let releaseLocal;
    const current = new Promise((resolve) => { releaseLocal = resolve; });
    this.#locks.set(key, current);
    await previous;
    let lock;
    try {
      lock = await this.acquire(key);
      return await work();
    } finally {
      if (lock) await this.release(lock);
      releaseLocal();
      if (this.#locks.get(key) === current) this.#locks.delete(key);
    }
  }
}
