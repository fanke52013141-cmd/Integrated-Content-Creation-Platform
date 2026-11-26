import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileDeliveryStore } from '../index.mjs';

const [root, key] = process.argv.slice(2);
const statePath = path.join(root, 'state.json');
const store = new FileDeliveryStore({ directory: path.join(root, 'store'), lockTimeoutMs: 10_000 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await store.runExclusive(key, async () => {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.active += 1;
  state.maxActive = Math.max(state.maxActive, state.active);
  await writeFile(statePath, JSON.stringify(state), 'utf8');
  await sleep(150);
  const latest = JSON.parse(await readFile(statePath, 'utf8'));
  latest.count += 1;
  latest.active -= 1;
  await writeFile(statePath, JSON.stringify(latest), 'utf8');
});
