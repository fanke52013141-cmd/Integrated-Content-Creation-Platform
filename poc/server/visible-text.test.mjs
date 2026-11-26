import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectiveImageSources, visibleText } from './visible-text.mjs'

test('visibleText ignores editor wrappers but preserves code line breaks', () => {
  const source = '<h2>代码块</h2><pre>interface X {\n  a: string\n}</pre>'
  const readback = '<div><h2>代码块</h2></div><div><pre>interface X {\n  a: string\n}</pre></div>'
  assert.equal(visibleText(source), visibleText(readback))
  assert.match(visibleText(source), /interface X \{\na: string\n\}/)
})

test('effectiveImageSources accepts src and data-src fallbacks', () => {
  assert.deepEqual(
    effectiveImageSources('<img src="https://mmbiz.qpic.cn/a"><img data-src="https://mmbiz.qpic.cn/b">'),
    ['https://mmbiz.qpic.cn/a', 'https://mmbiz.qpic.cn/b'],
  )
})

test('visibleText removes script and style content', () => {
  assert.equal(visibleText('<p>正文</p><script>alert(1)</script><style>p{}</style>'), '正文')
})
