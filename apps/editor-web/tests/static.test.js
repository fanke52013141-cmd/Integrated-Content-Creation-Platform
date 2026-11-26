import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('static shell contains all editor surfaces and safe preview sandbox', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8')
  for (const id of ['markdown', 'preview', 'theme-list', 'title', 'author', 'summary', 'cover', 'auto-sync', 'version-list', 'restore-version', 'brand-name', 'comment-body', 'review-action']) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /iframe id="preview"[^>]*sandbox=""/)
  assert.match(html, /id="review-action"[^>]*disabled/)
  assert.match(html, /id="comment-body"[^>]*disabled/)
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i)
})

test('three bundled preview CSS files match the stable theme dist byte for byte', async () => {
  for (const id of ['tech-blue', 'editorial-red', 'jade-notes']) {
    const local = await readFile(path.join(root, 'assets/themes', `${id}.css`), 'utf8')
    const stable = await readFile(path.resolve(root, '../../packages/wechat-theme/dist', `${id}.css`), 'utf8')
    assert.equal(local, stable)
    assert.match(local, /#output/)
    assert.doesNotMatch(local, /var\s*\(|@font-face|@import|url\s*\(/i)
  }
})

test('application keeps local and backend evidence explicitly separate', async () => {
  const app = await readFile(path.join(root, 'app.js'), 'utf8')
  assert.match(app, /本地轻量预览 · 未执行服务端渲染\/微信校验/)
  assert.match(app, /不代表后端已确认/)
  assert.match(app, /backendRecord: state\.record/)
  assert.match(app, /api\.comment\(/)
  assert.match(app, /controller\.submit\(documentPayload/)
})
