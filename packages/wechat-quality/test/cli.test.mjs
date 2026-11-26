import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PACKAGE_DIR, 'cli.mjs');
const FIXTURES = path.join(PACKAGE_DIR, 'test', 'fixtures');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

test('CLI emits JSON and exits 0 for a valid draft', () => {
  const result = run([path.join(FIXTURES, 'valid-draft.html'), '--target=draft']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'pass');
  assert.equal(report.valid, true);
  assert.ok(report.source.endsWith('valid-draft.html'));
});

test('CLI exits 0 for degrade and 1 for block', () => {
  const degrade = run([path.join(FIXTURES, 'valid-preview.html'), '--target=preview']);
  assert.equal(degrade.status, 0, degrade.stderr);
  assert.equal(JSON.parse(degrade.stdout).status, 'degrade');

  const block = run([path.join(FIXTURES, 'invalid-comprehensive.html'), '--target=draft']);
  assert.equal(block.status, 1, block.stderr);
  const report = JSON.parse(block.stdout);
  assert.equal(report.status, 'block');
  assert.ok(report.summary.blockers > 0);
});

test('CLI --list-rules exposes the exact matrix version', () => {
  const result = run(['--list-rules']);
  assert.equal(result.status, 0, result.stderr);
  const matrix = JSON.parse(result.stdout);
  assert.equal(matrix.matrixVersion, '1.0.0');
  assert.ok(matrix.rules.length >= 19);
});

test('CLI returns 2 for a missing file or unknown target', () => {
  const missing = run(['not-found.html']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /执行失败/u);

  const target = run([path.join(FIXTURES, 'valid-draft.html'), '--target=production']);
  assert.equal(target.status, 2);
  assert.match(target.stderr, /Unknown target/u);
});

test('CLI help and missing input have documented exit codes', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /退出码/u);

  const missing = run([]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /未指定 HTML 文件/u);
});
