/**
 * 微信官方图文结构校验包装（阶段四"质量闭环"）。
 *
 * 官方工具：npm 包 verify-article-structure（MIT，微信 wechatjs/verify-article-structure-spec 仓库发布）。
 * 基于 puppeteer 真实浏览器，检测官方规范的全部已实现规则（宽度溢出、行高叠字、
 * 冗余嵌套、darkmode 对比度等），并支持 dedupe 清理冗余嵌套。
 *
 * 定位：开发期/发布前工具，**不写入 package.json**（puppeteer 首装会拉几百 MB
 * Chromium，Windows CI 下载不稳）。本机使用：
 *
 *   npm i --no-save verify-article-structure        # 或 PUPPETEER_SKIP_DOWNLOAD=1 跳过 Chromium 下载
 *   set PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
 *   node scripts/check-layout.mjs path/to/article.html
 *
 * 不带参数时校验 tests/fixtures/layout-golden/ 全部基线。已验证：golden 基线
 * isValid=true（官方规则零违规）。未安装官方包时以 SKIPPED 退出（exit 0），不阻断流程。
 */
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const CLI_PATH = resolve('node_modules/verify-article-structure/dist/src/cli.js')
const args = process.argv.slice(2).filter(arg => arg !== '--json')
const asJson = process.argv.includes('--json')
const targets = args.length ? args : ['tests/fixtures/layout-golden']

if (!existsSync(CLI_PATH)) {
  console.log('[check-layout] SKIPPED：未安装 verify-article-structure。')
  console.log('[check-layout] 安装后重跑：npm i --no-save verify-article-structure')
  console.log('[check-layout] （可选）PUPPETEER_EXECUTABLE_PATH 指向本机 Chrome，跳过 Chromium 下载')
  console.log('[check-layout] 待检文件：')
  for (const target of targets) {
    const path = resolve(target)
    if (!existsSync(path)) { console.error(`  目标不存在：${path}`); process.exit(2) }
    if (path.match(/\.html?$/i)) console.log(`  - ${path}`)
    else for (const name of readdirSync(path).filter(file => file.endsWith('.html'))) console.log(`  - ${resolve(path, name)}`)
  }
  process.exit(0)
}

const files = []
for (const target of targets) {
  const path = resolve(target)
  if (!existsSync(path)) { console.error(`[check-layout] 目标不存在：${path}`); process.exit(2) }
  if (path.match(/\.html?$/i)) files.push(path)
  else for (const name of readdirSync(path).filter(file => file.endsWith('.html'))) files.push(resolve(path, name))
}
if (!files.length) { console.error('[check-layout] 没有找到待检 HTML'); process.exit(2) }

const env = { ...process.env }
if (!env.PUPPETEER_EXECUTABLE_PATH) {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  if (existsSync(chrome)) env.PUPPETEER_EXECUTABLE_PATH = chrome
}

let failed = false
for (const file of files) {
  const result = spawnSync(process.execPath, [CLI_PATH, 'check', file, '--json'], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024, env
  })
  const stdout = result.stdout ?? ''
  // CLI 的 --json 输出可能混有 stderr 警告行；取第一段完整 JSON 解析
  const jsonMatch = stdout.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error(`[check-layout] ✗ ${file}：无法解析官方工具输出${result.stderr ? `（${result.stderr.slice(0, 200)}）` : ''}`)
    failed = true
    continue
  }
  let parsed
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    console.error(`[check-layout] ✗ ${file}：官方工具输出不是合法 JSON`)
    failed = true
    continue
  }
  const violations = parsed.violations ?? []
  if (asJson) console.log(JSON.stringify({ file, isValid: parsed.isValid, violations }, null, 2))
  else console.log(`[check-layout] ${parsed.isValid && !violations.length ? '✓' : '✗'} ${file}（官方规则违规 ${violations.length} 项）`)
  if (!parsed.isValid || violations.length > 0) failed = true
}
process.exit(failed ? 1 : 0)
