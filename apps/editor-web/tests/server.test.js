import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('standalone server serves the editor and explicitly reports missing backend', async () => {
  const server = createAppServer({ root, apiOrigin: '' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const page = await fetch(base).then(response => response.text())
    assert.match(page, /内容创作工作台/)
    const response = await fetch(`${base}/api/health`)
    assert.equal(response.status, 503)
    const payload = await response.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'BACKEND_NOT_CONNECTED')
  }
  finally { server.close() }
})
