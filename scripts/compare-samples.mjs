/**
 * 微信真实产物样本回归（阶段四"质量闭环"）。
 *
 * 目的：把"优秀公众号文章的真实 HTML"作为量化基线，对比我们排版产物的
 * 结构特征（标签分布、内联覆盖率、嵌套深度），让"我们 vs 实战"有数字可看。
 * 真实样本用 wechat-article-exporter（github.com/wechat-article/wechat-article-exporter）
 * 从目标账号导出原始 HTML，放进 tests/fixtures/wechat-samples/；
 * 当前库内附一份手工构造的"实战风格"合成样本（见文件头标注），保证脚本可跑。
 *
 * 用法：node scripts/compare-samples.mjs [样本目录，默认 tests/fixtures/wechat-samples]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? 'tests/fixtures/wechat-samples')
let files
try {
  files = readdirSync(dir).filter(name => name.endsWith('.html'))
} catch {
  console.error(`[compare-samples] 样本目录不存在：${dir}（先用 wechat-article-exporter 导出真实样本放入）`)
  process.exit(2)
}
if (!files.length) {
  console.error(`[compare-samples] 样本目录为空：${dir}`)
  process.exit(2)
}

/** 无 DOM 依赖的轻量统计：正则计数足够回答"结构分布"问题 */
function analyze(html, label) {
  const tags = {}
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const name = match[1].toLowerCase()
    if (!match[0].startsWith('</')) tags[name] = (tags[name] ?? 0) + 1
  }
  const openTags = (html.match(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g) ?? []).length
  const withStyle = (html.match(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*\sstyle="/g) ?? []).length
  const leafSpans = (html.match(/<span[^>]*\bleaf\b[^>]*>/g) ?? []).length
  const sections = tags.section ?? 0
  const divs = tags.div ?? 0
  const images = tags.img ?? 0
  const tables = tags.table ?? 0
  const rows = [
    `样本: ${label}`,
    `  元素总数: ${openTags}`,
    `  内联样式覆盖率: ${openTags ? Math.round((withStyle / openTags) * 100) : 0}%`,
    `  section 数: ${sections}（div 数: ${divs}，微信不支持 div）`,
    `  leaf 包裹 span: ${leafSpans}`,
    `  图片: ${images} / 表格: ${tables}`,
    `  标签 Top6: ${Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => `${name}×${count}`).join(' ')}`
  ]
  return rows.join('\n')
}

console.log(`[compare-samples] 共 ${files.length} 个样本\n`)
for (const name of files) {
  const html = readFileSync(join(dir, name), 'utf8')
  console.log(analyze(html, name))
  console.log('')
}
console.log('[compare-samples] 提示：把本产物与 tests/fixtures/layout-golden（我们的产物基线）对比，')
console.log('[compare-samples] 内联覆盖率与 section/div 比例是"结构合规度"的两个核心信号。')
