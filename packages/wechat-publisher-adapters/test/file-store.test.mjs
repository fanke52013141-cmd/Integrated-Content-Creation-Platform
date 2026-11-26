import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileDeliveryStore } from '../index.mjs';
import { PACKAGE_DIR, temporaryDirectory } from '../helpers/shared.mjs';

function runWorker(key, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PACKAGE_DIR, 'helpers', 'lock-worker.mjs'), root, key], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}: ${stderr}`)));
  });
}

test('file store persists snapshots atomically and rejects secrets/corruption', async () => {
  const root = await temporaryDirectory();
  try {
    const store = new FileDeliveryStore({ directory: path.join(root, 'store') });
    await store.save({ key: 'key-1', revision: 1, nested: { ok: true } });
    await store.save({ key: 'key-1', revision: 2, nested: { ok: true } });
    assert.equal((await store.load('key-1')).revision, 2);
    assert.deepEqual(await store.keys(), ['key-1']);
    assert.equal(JSON.parse(await readFile(store.pathFor('key-1'), 'utf8')).revision, 2);
    await assert.rejects(store.save({ key: 'secret', accessToken: 'do-not-persist' }), (error) => error.code === 'SECRET_IN_RECORD');
    assert.equal(await store.load('missing'), null);
    await writeFile(store.pathFor('broken'), '{bad json', 'utf8');
    await assert.rejects(store.load('broken'), (error) => error.code === 'STORE_CORRUPT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('file mutex serializes two independent processes without losing work', { timeout: 20_000 }, async () => {
  const root = await temporaryDirectory();
  try {
    await writeFile(path.join(root, 'state.json'), JSON.stringify({ active: 0, maxActive: 0, count: 0 }), 'utf8');
    await Promise.all([runWorker('shared-key', root), runWorker('shared-key', root)]);
    const state = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
    assert.equal(state.count, 2);
    assert.equal(state.active, 0);
    assert.equal(state.maxActive, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dead-owner stale lock is reclaimed and released safely', async () => {
  const root = await temporaryDirectory();
  try {
    const store = new FileDeliveryStore({ directory: path.join(root, 'store'), staleLockMs: 1 });
    const lockPath = store.lockPathFor('stale-key');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      token: 'old', pid: 99999999, hostname: os.hostname(), createdAt: new Date(0).toISOString(),
    }), 'utf8');
    await utimes(lockPath, new Date(0), new Date(0));
    const result = await store.runExclusive('stale-key', async () => 'recovered');
    assert.equal(result, 'recovered');
    await assert.rejects(readFile(lockPath, 'utf8'), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
