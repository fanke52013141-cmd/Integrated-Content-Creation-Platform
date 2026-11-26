#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const QUALITY_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(QUALITY_DIR, '..', '..');
export const CLI_DIR = path.join(REPO_ROOT, 'upstream', 'verify-article-structure-spec', 'cli');
const PNPM_PATH = path.join(QUALITY_DIR, '.tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
const TSX_PATH = path.join(CLI_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

export const KNOWN_UNCOVERED_RULES = Object.freeze([
  {
    id: 'spec-chapter-3-fonts',
    scope: '规范第 3 章字体检测',
    reason: '上游 cli/README.md 明确说明尚未接入。',
  },
  {
    id: 'spec-2.2-span-leaf',
    scope: '规范第 2.2 节 span[leaf] 结构检测',
    reason: '上游 cli/README.md 明确说明尚未接入。',
  },
  {
    id: 'spec-2.3-section-nodeleaf',
    scope: '规范第 2.3 节 section[nodeleaf] 结构检测',
    reason: '上游 cli/README.md 明确说明尚未接入。',
  },
  {
    id: 'redundant-node',
    scope: 'redundant-node',
    reason: '仅预留文案和跳过用例，尚未纳入规范或实现检测。',
  },
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function getToolInfo() {
  const pkg = readJson(path.join(CLI_DIR, 'package.json'));
  const pnpmPkg = readJson(path.join(QUALITY_DIR, '.tools', 'node_modules', 'pnpm', 'package.json'));
  const lockText = fs.readFileSync(path.join(CLI_DIR, 'pnpm-lock.yaml'), 'utf8');
  return {
    name: pkg.name,
    version: pkg.version,
    source: 'upstream/verify-article-structure-spec/cli',
    lockfileVersion: lockText.match(/^lockfileVersion:\s*['"]?([^'"\s]+)/m)?.[1] ?? null,
    pnpmVersion: pnpmPkg.version,
  };
}

export function getRuntimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

export function getChromiumInfo(executablePath) {
  const explicit = executablePath || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit) {
    const resolved = path.resolve(explicit);
    return {
      executablePath: resolved,
      source: executablePath ? 'cli-argument' : 'PUPPETEER_EXECUTABLE_PATH',
      exists: fs.existsSync(resolved),
    };
  }

  try {
    const requireFromCli = createRequire(path.join(CLI_DIR, 'package.json'));
    const puppeteer = requireFromCli('puppeteer');
    const resolved = puppeteer.executablePath();
    return {
      executablePath: resolved,
      source: 'puppeteer-default',
      exists: fs.existsSync(resolved),
    };
  } catch (error) {
    return {
      executablePath: null,
      source: 'unresolved',
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function displayCommand(executable, args) {
  return [executable, ...args]
    .map((value) => (/[\s"]/u.test(value) ? JSON.stringify(value) : value))
    .join(' ');
}

function runOfficial(args, executablePath) {
  const startedAt = new Date();
  const env = { ...process.env };
  if (executablePath) env.PUPPETEER_EXECUTABLE_PATH = path.resolve(executablePath);
  // The harness may provide a reduced PATH; Puppeteer uses taskkill on Windows.
  if (process.platform === 'win32' && process.env.SystemRoot) {
    env.PATH = `${process.env.SystemRoot}\\System32;${env.PATH ?? ''}`;
  }
  const completed = spawnSync(process.execPath, args, {
    cwd: CLI_DIR,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000,
    windowsHide: true,
  });
  const officialExitCode = typeof completed.status === 'number' ? completed.status : 2;
  return {
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    command: {
      executable: process.execPath,
      args,
      display: displayCommand(process.execPath, args),
      cwd: CLI_DIR,
    },
    officialExitCode,
    stdout: completed.stdout ?? '',
    stderr: completed.stderr ?? '',
    spawnError: completed.error
      ? (completed.error instanceof Error ? completed.error.message : String(completed.error))
      : null,
    signal: completed.signal ?? null,
  };
}

export function writeRecord(record, outputPath) {
  const resolved = path.resolve(outputPath);
  const relative = path.relative(QUALITY_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`结果文件必须位于 poc/quality 内：${resolved}`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return resolved;
}

function defaultResultPath(inputPath) {
  const base = path.basename(inputPath, path.extname(inputPath))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'article';
  return path.join(QUALITY_DIR, 'results', `${base}.quality.json`);
}

export function runCheck({ input, out, executablePath }) {
  const inputPath = path.resolve(input);
  const outputPath = out ? path.resolve(out) : defaultResultPath(inputPath);
  // Match upstream tests/cli.test.ts: direct tsx entry keeps stdout pure JSON.
  const args = [TSX_PATH, path.join(CLI_DIR, 'src', 'index.ts'), inputPath, '--json'];
  if (executablePath) args.push(`--executable-path=${path.resolve(executablePath)}`);

  const run = runOfficial(args, executablePath);
  let result = null;
  let parseError = null;
  try {
    result = JSON.parse(run.stdout);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const failed = Boolean(run.spawnError) || run.officialExitCode === 2 || parseError;
  const exitCode = failed ? 2 : run.officialExitCode;
  const outcome = exitCode === 0 ? 'valid' : exitCode === 1 && result ? 'violations' : 'error';
  const record = {
    schemaVersion: 1,
    kind: 'verify-article-structure/check',
    generatedAt: new Date().toISOString(),
    durationMs: run.durationMs,
    tool: getToolInfo(),
    runtime: getRuntimeInfo(),
    chromium: getChromiumInfo(executablePath),
    input: { path: inputPath },
    command: run.command,
    officialExitCode: run.officialExitCode,
    exitCode,
    outcome,
    result,
    parseError,
    spawnError: run.spawnError,
    signal: run.signal,
    stdout: run.stdout,
    stderr: run.stderr,
    knownUncoveredRules: KNOWN_UNCOVERED_RULES,
  };
  record.recordPath = path.resolve(outputPath);
  writeRecord(record, record.recordPath);
  return record;
}

export function runProbe({ out, executablePath }) {
  const outputPath = path.resolve(out);
  const args = [TSX_PATH, path.join(CLI_DIR, 'src', 'probe.ts')];
  const run = runOfficial(args, executablePath);
  const failed = Boolean(run.spawnError) || run.officialExitCode !== 0;
  const record = {
    schemaVersion: 1,
    kind: 'verify-article-structure/probe',
    generatedAt: new Date().toISOString(),
    durationMs: run.durationMs,
    tool: getToolInfo(),
    runtime: getRuntimeInfo(),
    chromium: getChromiumInfo(executablePath),
    input: { name: 'official embedded probe HTML' },
    command: run.command,
    officialExitCode: run.officialExitCode,
    exitCode: failed ? run.officialExitCode || 2 : 0,
    outcome: failed ? 'error' : 'passed',
    spawnError: run.spawnError,
    signal: run.signal,
    stdout: run.stdout,
    stderr: run.stderr,
    knownUncoveredRules: KNOWN_UNCOVERED_RULES,
  };
  record.recordPath = path.resolve(outputPath);
  writeRecord(record, record.recordPath);
  return record;
}

function parseArgs(argv) {
  const parsed = { input: null, out: null, executablePath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '--out') parsed.out = argv[++index];
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--executable-path') parsed.executablePath = argv[++index];
    else if (arg.startsWith('--executable-path=')) parsed.executablePath = arg.slice('--executable-path='.length);
    else if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`);
    else if (parsed.input) throw new Error(`只能指定一个 HTML 文件：${arg}`);
    else parsed.input = arg;
  }
  return parsed;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.input) {
      process.stdout.write(`用法：node poc/quality/verify.mjs <article.html> [选项]\n\n选项：\n  --out=<path>              JSON 结果路径（必须位于 poc/quality 内）\n  --executable-path=<path>  指定 Chromium，同 PUPPETEER_EXECUTABLE_PATH\n  -h, --help                显示帮助\n\n退出码：0 无违规 / 1 有违规 / 2 执行或 JSON 解析异常\n`);
      process.exit(args.help ? 0 : 2);
    }
    if (!fs.existsSync(PNPM_PATH)) {
      throw new Error(`局部 pnpm 8 未安装：${PNPM_PATH}`);
    }
    const record = runCheck(args);
    process.stdout.write(`${JSON.stringify({
      recordPath: record.recordPath,
      exitCode: record.exitCode,
      outcome: record.outcome,
      violationKeys: record.result?.violations?.map((entry) => entry.key) ?? [],
    }, null, 2)}\n`);
    process.exit(record.exitCode);
  } catch (error) {
    process.stderr.write(`质量包装执行失败：${error instanceof Error ? error.stack : error}\n`);
    process.exit(2);
  }
}
