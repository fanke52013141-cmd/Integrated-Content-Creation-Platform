import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAsset, createDocument, createRenderSnapshot, createThemeReference, stableStringify } from './index.mjs'

const theme = createThemeReference({ id: 'aurora-tech', version: '1.0.0' })

test('stableStringify normalizes object key order', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
})

test('document revision is stable and changes with theme version', () => {
  const input = { id: 'doc-1', source: '# 标题', metadata: { title: '标题' }, theme }
  const first = createDocument(input)
  const second = createDocument(input)
  assert.equal(first.revision, second.revision)
  const changed = createDocument({ ...input, theme: { ...theme, version: '1.0.1' } })
  assert.notEqual(first.revision, changed.revision)
})

test('empty source and incomplete theme are rejected', () => {
  assert.throws(() => createDocument({ source: ' ', theme }), /源文章不能为空/)
  assert.throws(() => createThemeReference({ id: '' }), /id 和 version/)
})

test('render snapshot binds document, theme, renderer and output hash', () => {
  const document = createDocument({ id: 'doc-1', source: '# 标题', theme })
  const asset = createAsset({ uri: 'assets/a.png', sha256: 'abc', mimeType: 'image/png' })
  const snapshot = createRenderSnapshot({
    document,
    renderer: { name: 'doocs', version: '80b43d4' },
    html: '<h1>标题</h1>',
    assets: [asset],
    quality: { passed: true },
  })
  assert.equal(snapshot.documentRevision, document.revision)
  assert.equal(snapshot.theme.id, 'aurora-tech')
  assert.equal(snapshot.assets.length, 1)
  assert.equal(snapshot.quality.passed, true)
  assert.equal(snapshot.htmlSha256.length, 64)
})
