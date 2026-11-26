#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintHtml, loadMatrix, SUPPORTED_TARGETS } from './index.mjs';

const HELP = `WeChat compatibility linter\n\n用法：\n  node cli.mjs <article.html> [--target=preview|editor-paste|draft]\n  node cli.mjs --list-rules\n\n选项：\n  --target=<target>  默认 editor-paste；draft 会阻断本地/HTTP/非白名单图片\n  --list-rules       输出当前版本化矩阵，不读取文章\n  -h, --help         显示帮助\n\n退出码：\n  0  无阻断项（pass 或 degrade）\n  1  存在 block 项\n  2  参数、读取或执行异常\n`;

function parseArgs(argv) {
  const result = { file: null, target: null, listRules: false, help: false };
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') result.help = true;
    else if (arg === '--list-rules') result.listRules = true;
    else if (arg.startsWith('--target=')) result.target = arg.slice('--target='.length);
    else if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`);
    else if (result.file) throw new Error(`只能指定一个 HTML 文件：${arg}`);
    else result.file = arg;
  }
  return result;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.listRules) {
    process.stdout.write(`${JSON.stringify(loadMatrix(), null, 2)}\n`);
    return 0;
  }
  if (!args.file) {
    process.stderr.write(`未指定 HTML 文件。\n${HELP}`);
    return 2;
  }
  const filePath = path.resolve(args.file);
  const html = fs.readFileSync(filePath, 'utf8');
  const report = lintHtml(html, {
    target: args.target ?? undefined,
    source: filePath,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.valid ? 0 : 1;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`微信兼容检查执行失败：${error instanceof Error ? error.message : error}\n`);
    process.stderr.write(`支持目标：${SUPPORTED_TARGETS.join(', ')}\n`);
    process.exitCode = 2;
  }
}
