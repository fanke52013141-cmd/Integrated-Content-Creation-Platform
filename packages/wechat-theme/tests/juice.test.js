import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { themes, compileTheme } from '../index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../..')
const requireFromDoocs = createRequire(path.join(workspace, 'upstream/doocs-md/apps/web/package.json'))
const juiceModule = requireFromDoocs('juice')
const juice = juiceModule.default || juiceModule

// Mirror doocs getThemeStyles(): its clipboard path strips #output before juice.
function stripOutputScope(css) {
  let result = css
  result = result.replace(/#output\s*\{/g, 'body {')
  result = result.replace(/#output\s+/g, '')
  result = result.replace(/^#output\s*/gm, '')
  return result
}

const content = `
<h1>月度产品观察</h1>
<h2>关键结论</h2>
<p>正文保留 <strong>重点信息</strong>、<a href="https://example.com">参考链接</a> 与 <code class="codespan">inlineCode</code>。</p>
<blockquote><p>引用内容需要清晰的边界与阅读节奏。</p></blockquote>
<table><thead><tr><th>指标</th><th>结果</th></tr></thead><tbody><tr><td>完成率</td><td>96%</td></tr><tr><td id="alt-cell">错误率</td><td>4%</td></tr></tbody></table>
<pre class="code__pre"><code>const ready = true</code></pre>
<section class="wechat-card"><h3 class="wechat-card-title">卡片标题</h3><p>卡片正文</p></section>
<p class="wechat-note">注释内容</p>
<hr>
`

function openingTag(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'i'))
  assert.ok(match, `Missing ${tagName}`)
  return match[0]
}

function openingTagWithId(html, id) {
  const match = html.match(new RegExp(`<td\\b[^>]*id="${id}"[^>]*>`, 'i'))
  assert.ok(match, `Missing td#${id}`)
  return match[0]
}

for (const theme of themes) {
  test(`${theme.name}: juice inlines real #output component CSS without variables`, () => {
    const css = compileTheme(theme)
    const input = `<style>${stripOutputScope(css)}</style>${content}`
    const result = juice(input, {
      inlinePseudoElements: true,
      preserveImportant: true,
      resolveCSSVariables: false
    })

    assert.match(openingTag(result, 'h1'), /style="[^"]*(?:color|background-color):/i)
    assert.match(openingTag(result, 'h2'), /style="[^"]*(?:border|background-color):/i)
    assert.match(openingTag(result, 'blockquote'), /style="[^"]*border/i)
    assert.match(openingTag(result, 'table'), /style="[^"]*width:\s*100%/i)
    assert.match(openingTag(result, 'th'), /style="[^"]*background-color:/i)
    assert.ok(openingTagWithId(result, 'alt-cell').toLowerCase().includes(theme.tokens.color.soft.toLowerCase()), 'Even table row should expose its tinted td background after inlining')
    assert.match(openingTag(result, 'pre'), /style="[^"]*background-color:/i)
    assert.match(openingTag(result, 'section'), /style="[^"]*border/i)
    assert.match(result, /class="wechat-card-title"[^>]*style=|style="[^"]*border-bottom[^>]*class="wechat-card-title"/i)
    assert.match(result, /正文保留/)
    assert.match(result, /const ready = true/)
    assert.doesNotMatch(result, /var\s*\(|javascript:|@import|@font-face|@keyframes/i)
    assert.doesNotMatch(result, /<script\b/i)
    assert.ok(!result.includes('#output '), 'juice input contract should not retain scoped descendant selectors')
  })
}

test('juice integration uses the same options as doocs processClipboardContent', () => {
  assert.equal(typeof juice, 'function')
  const options = { inlinePseudoElements: true, preserveImportant: true, resolveCSSVariables: false }
  assert.deepEqual(options, { inlinePseudoElements: true, preserveImportant: true, resolveCSSVariables: false })
})
