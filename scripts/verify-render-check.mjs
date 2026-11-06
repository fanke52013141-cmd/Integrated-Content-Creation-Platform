/**
 * 渲染级检测的真机验证（阶段四验收）。
 *
 * 用本机 Chrome headless 跑测量脚本，证明它真能抓到"固定宽度溢出"与"行高叠字"，
 * 且对 golden 基线（合规产物）零误报。测量逻辑与 src/shared/render-measure.ts
 * 的 MEASURE_SCRIPT 保持同一实现——两端各自携带一份（TS 侧给 Electron，
 * 本文件给 Chrome），改动任一侧必须重跑本脚本并同步另一侧。
 *
 * 用法：node scripts/verify-render-check.mjs
 * 环境变量 CHROME_PATH 可指定浏览器路径，默认探测常见安装位置。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find(path => existsSync(path))
if (!chromePath) {
  console.error('[verify-render-check] 未找到 Chrome，设置 CHROME_PATH 后重试')
  process.exit(2)
}

// 与 src/shared/render-measure.ts 的 MEASURE_SCRIPT 同步（见文件头说明）
const MEASURE_SCRIPT = `(() => {
  const issues = []
  const MAX_PER_RULE = 5
  const container = document.getElementById('mly-wx-base')
  if (!container) return issues
  // 溢出往往发生在"固定宽子元素的父级"（子元素自身 scrollWidth == clientWidth），
  // 所以把容器自身也纳入扫描（与 src/shared/render-measure.ts 同步）
  const all = [container, ...Array.from(container.querySelectorAll('*'))]
  let overflowCount = 0
  for (const el of all) {
    if (overflowCount >= MAX_PER_RULE) break
    const overflowX = getComputedStyle(el).overflowX
    if (overflowX === 'auto' || overflowX === 'scroll') continue
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      issues.push({ rule: 'render-overflow', message: '内容横向溢出：内容宽 ' + el.scrollWidth + 'px 超出容器 ' + el.clientWidth + 'px（<' + el.tagName.toLowerCase() + '>）', hint: '固定宽度改 max-width:100% + margin:0 auto 居中' })
      overflowCount += 1
    }
  }
  let overlapCount = 0
  for (const el of all) {
    if (overlapCount >= MAX_PER_RULE) break
    let ownText = ''
    for (const node of el.childNodes) { if (node.nodeType === 3) ownText += node.textContent ?? '' }
    if (ownText.trim().length < 10) continue
    const style = getComputedStyle(el)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const fontSize = Number.parseFloat(style.fontSize)
    if (Number.isFinite(lineHeight) && Number.isFinite(fontSize) && fontSize > 0 && lineHeight < fontSize) {
      issues.push({ rule: 'render-line-overlap', message: '实际渲染行高 ' + Math.round(lineHeight) + 'px 小于字号 ' + Math.round(fontSize) + 'px，多行文字会叠字（<' + el.tagName.toLowerCase() + '>）', hint: '调大 line-height' })
      overlapCount += 1
    }
  }
  return issues
})()`

const BASE_CSS = '#mly-wx-base{font-size:17px;line-height:1.75;letter-spacing:0.5px;color:#333;word-break:break-word}#mly-wx-base p{margin:0 0 1em}#mly-wx-base section{margin:0}'

function buildDocument(html) {
  // MEASURE_SCRIPT 已是自执行的 IIFE（以 )() 结尾），这里直接求值即可，
  // 不要再包一层调用括号（会把返回数组当函数调用）
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:375px}body{overflow-wrap:anywhere}${BASE_CSS}</style></head><body><div id="mly-wx-base">${html}</div><pre id="measure-result" style="display:none"></pre><script>
  var result = ${MEASURE_SCRIPT};
  document.getElementById('measure-result').textContent = JSON.stringify(result);
  </` + `script></body></html>`
}

// 构造一个"必违规"样稿：固定 500px 宽（375 容器必溢出）+ 行高 0.8（16px 字号必叠字）
const dirtyHtml = '<section style="width:500px;margin:0 auto"><p style="font-size:16px;line-height:0.8">这是一段足够长的正文文字，用来触发渲染级检测的行高叠字规则，多行渲染时行与行会互相重叠。</p></section>'

function runChrome(documentHtml, label) {
  const tempDir = mkdtempSync(join(tmpdir(), 'moliu-render-check-'))
  const file = join(tempDir, 'doc.html')
  writeFileSync(file, documentHtml)
  try {
    const stdout = execFileSync(chromePath, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=2000', '--dump-dom', `file:///${file.replace(/\\/g, '/')}`
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
    // dump-dom 会保留 style 属性，且文本节点中的引号可能被序列化为实体
    const match = stdout.match(/<pre id="measure-result"[^>]*>([\s\S]*?)<\/pre>/)
    if (!match) throw new Error(`${label}：Chrome 输出中没有测量结果（--dump-dom 未执行脚本？）`)
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

let failed = false

// 用例 1：违规样稿必须抓到两类问题
const dirtyIssues = runChrome(buildDocument(dirtyHtml), '违规样稿')
const hasOverflow = dirtyIssues.some(issue => issue.rule === 'render-overflow')
const hasOverlap = dirtyIssues.some(issue => issue.rule === 'render-line-overlap')
console.log(`[verify-render-check] 违规样稿检出 ${dirtyIssues.length} 项：${dirtyIssues.map(issue => issue.rule).join(', ') || '无'}`)
if (!hasOverflow || !hasOverlap) {
  console.error('[verify-render-check] ✗ 违规样稿未同时检出溢出与叠字')
  failed = true
}

// 用例 2：golden 基线（合规产物）必须零问题
const goldenFile = resolve('tests/fixtures/layout-golden/wechat-green.html')
if (existsSync(goldenFile)) {
  const goldenHtml = readFileSync(goldenFile, 'utf8')
  const cleanIssues = runChrome(buildDocument(goldenHtml), 'golden 基线')
  console.log(`[verify-render-check] golden 基线检出 ${cleanIssues.length} 项：${cleanIssues.map(issue => issue.rule).join(', ') || '无'}`)
  if (cleanIssues.length > 0) {
    console.error('[verify-render-check] ✗ 合规产物被误报', JSON.stringify(cleanIssues, null, 2))
    failed = true
  }
} else {
  console.log('[verify-render-check] 跳过 golden 用例（基线尚未生成，先跑 npm test -- layout-golden）')
}

console.log(failed ? '[verify-render-check] ✗ 验证未通过' : '[verify-render-check] ✓ 渲染测量逻辑真机验证通过')
process.exit(failed ? 1 : 0)
