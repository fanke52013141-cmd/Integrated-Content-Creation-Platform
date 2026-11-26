#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLI_DIR,
  KNOWN_UNCOVERED_RULES,
  QUALITY_DIR,
  REPO_ROOT,
  getChromiumInfo,
  getRuntimeInfo,
  getToolInfo,
  runCheck,
  runProbe,
  writeRecord,
} from './verify.mjs';

function executablePathArg(argv) {
  const direct = argv.find((arg) => arg.startsWith('--executable-path='));
  if (direct) return direct.slice('--executable-path='.length);
  const index = argv.indexOf('--executable-path');
  return index >= 0 ? argv[index + 1] : undefined;
}

function relativeRecord(record) {
  return path.relative(REPO_ROOT, record.recordPath);
}

function main() {
  const executablePath = executablePathArg(process.argv.slice(2));
  const resultsDir = path.join(QUALITY_DIR, 'results');
  const fixturesDir = path.join(CLI_DIR, 'tests', 'fixtures');

  const probe = runProbe({
    out: path.join(resultsDir, 'official-probe.json'),
    executablePath,
  });
  const violations = runCheck({
    input: path.join(fixturesDir, 'e2e-violations.html'),
    out: path.join(resultsDir, 'official-e2e-violations.json'),
    executablePath,
  });
  const clean = runCheck({
    input: path.join(fixturesDir, 'e2e-clean.html'),
    out: path.join(resultsDir, 'official-e2e-clean.json'),
    executablePath,
  });

  const violationKeys = violations.result?.violations?.map((entry) => entry.key) ?? [];
  const checks = [
    {
      name: 'official probe',
      expectedExitCode: 0,
      actualExitCode: probe.exitCode,
      pass: probe.exitCode === 0 && probe.outcome === 'passed',
      record: relativeRecord(probe),
    },
    {
      name: 'official e2e-violations.html',
      expectedExitCode: 1,
      actualExitCode: violations.exitCode,
      expectedViolationKeys: ['caret-color', 'height-nodisplay'],
      actualViolationKeys: violationKeys,
      pass: violations.exitCode === 1
        && violations.result?.isValid === false
        && ['caret-color', 'height-nodisplay'].every((key) => violationKeys.includes(key)),
      record: relativeRecord(violations),
    },
    {
      name: 'official e2e-clean.html',
      expectedExitCode: 0,
      actualExitCode: clean.exitCode,
      pass: clean.exitCode === 0
        && clean.result?.isValid === true
        && Array.isArray(clean.result?.violations)
        && clean.result.violations.length === 0,
      record: relativeRecord(clean),
    },
  ];
  const allPassed = checks.every((check) => check.pass);
  const summary = {
    schemaVersion: 1,
    kind: 'verify-article-structure/official-fixture-summary',
    generatedAt: new Date().toISOString(),
    tool: getToolInfo(),
    runtime: getRuntimeInfo(),
    chromium: getChromiumInfo(executablePath),
    allPassed,
    checks,
    knownUncoveredRules: KNOWN_UNCOVERED_RULES,
    note: '官方 fixture/probe 通过只证明当前已实现规则可运行，不代表覆盖完整规范，也不代表主测试文章已通过。',
  };
  const summaryPath = path.join(resultsDir, 'official-summary.json');
  summary.recordPath = summaryPath;
  writeRecord(summary, summaryPath);
  process.stdout.write(`${JSON.stringify({
    allPassed,
    summaryPath: summary.recordPath,
    checks,
  }, null, 2)}\n`);
  process.exit(allPassed ? 0 : 1);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`官方校验汇总失败：${error instanceof Error ? error.stack : error}\n`);
    process.exit(2);
  }
}
