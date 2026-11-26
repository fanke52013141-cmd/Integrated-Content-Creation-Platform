import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdownPreview, renderInlineMarkdown } from '../lib/markdown.js'

test('offline Markdown renders headings, lists, quote, table and fenced code', () => {
  const html = renderMarkdownPreview('# 标题\n\n> 引用\n\n- 一\n- 二\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst ok = true\n```')
  assert.match(html, /<h1>标题<\/h1>/)
  assert.match(html, /<blockquote><p>引用<\/p><\/blockquote>/)
  assert.match(html, /<ul><li>一<\/li><li>二<\/li><\/ul>/)
  assert.match(html, /<th>A<\/th>/)
  assert.match(html, /<td>2<\/td>/)
  assert.match(html, /data-language="js"/)
  assert.match(html, /const ok = true/)
})

test('offline preview escapes raw HTML and refuses javascript links', () => {
  const html = renderMarkdownPreview('<script>alert(1)</script>\n\n[危险](javascript:alert(1))')
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /href="javascript:/)
  assert.match(html, /危险/)
})

test('inline renderer supports safe links and emphasis', () => {
  const html = renderInlineMarkdown('**重点**、*斜体*、`x < y`、[示例](https://example.com)')
  assert.match(html, /<strong>重点<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /x < y|x &lt; y/)
  assert.match(html, /href="https:\/\/example.com"/)
})
