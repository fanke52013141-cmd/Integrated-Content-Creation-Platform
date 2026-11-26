import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { compareDraftHtml, createDraftFromFiles, inspectArticle, MockWeChatClient, readDefaultPocFiles } from './draft-poc.mjs'
import { WeChatClient } from './wechat-client.mjs'

const hasArtifacts = await readFile(path.resolve('poc/artifacts/article-fragment.html'), 'utf8').then(() => true).catch(() => false)

test('inspect accepts the generated POC article without network calls', { skip: !hasArtifacts }, async () => {
  const input = await readDefaultPocFiles()
  const report = await inspectArticle(input)
  assert.equal(report.ready, true, JSON.stringify(report.blockers))
  assert.equal(report.counts.images, 1)
  assert.deepEqual(report.sideEffects, [])
})

test('inspect blocks missing cover, long title and external images', async () => {
  const report = await inspectArticle({
    fragment: '<p>正文</p><img src="https://example.com/a.png">',
    metadata: { title: '长'.repeat(33), author: '', digest: '', thumb: '' },
    assetsRoot: path.resolve('poc/fixtures'),
  })
  assert.equal(report.ready, false)
  assert.ok(report.blockers.some(item => item.code === 'TITLE_TOO_LONG'))
  assert.ok(report.blockers.some(item => item.code === 'COVER_REQUIRED'))
  assert.ok(report.blockers.some(item => item.code === 'IMAGE_REQUIRES_UPLOAD'))
})

test('mock draft uploads local assets and reads back identical text', { skip: !hasArtifacts }, async () => {
  const input = await readDefaultPocFiles()
  const client = new MockWeChatClient()
  const result = await createDraftFromFiles({ client, ...input })
  assert.equal(result.ok, true)
  assert.equal(result.comparison.semanticTextEqual, true)
  assert.ok(result.article.content.includes('https://mmbiz.qpic.cn/poc/poc-diagram.png'))
  assert.equal(client.calls.filter(call => call.method === 'addDraft').length, 1)
  assert.equal(client.calls.filter(call => call.method === 'getDraft').length, 1)
  assert.equal(client.calls.some(call => call.method === 'publish'), false)
})

test('compareDraftHtml reports semantic differences', () => {
  const result = compareDraftHtml('<p>相同文本</p>', '<p>不同文本</p>')
  assert.equal(result.semanticTextEqual, false)
  assert.ok(result.firstDifference >= 0)
})

test('WeChatClient refuses to run without credentials', () => {
  assert.throws(() => new WeChatClient({}), /缺少/)
})
