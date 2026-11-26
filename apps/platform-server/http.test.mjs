import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlatformHttpServer } from './http.mjs'

async function setup() {
  const server = createPlatformHttpServer({
    staticRoot: process.cwd(),
    themes: [{ id: 'tech-blue', version: '1.0.0' }],
    renderer: {
      async render(input) {
        return { html: '<h1>测试</h1>', plainText: '测试', themeId: input.themeId ?? 'tech-blue' }
      },
    },
    delivery: {
      accounts: () => [{ id: 'mock-account', mode: 'mock' }],
      async submit(document) {
        return { key: 'delivery-1', status: 'completed', input: { document } }
      },
      async get(key) {
        return key === 'delivery-1' ? { key, status: 'completed' } : null
      },
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

test('health and theme APIs expose no secrets', async () => {
  const { server, base } = await setup()
  try {
    const health = await fetch(`${base}/api/health`).then(response => response.json())
    assert.equal(health.ok, true)
    assert.equal(health.accounts[0].mode, 'mock')
    const themes = await fetch(`${base}/api/themes`).then(response => response.json())
    assert.equal(themes.themes[0].id, 'tech-blue')
    assert.doesNotMatch(JSON.stringify(health), /secret|accessToken/i)
  }
  finally { server.close() }
})

test('render API validates input and returns renderer output', async () => {
  const { server, base } = await setup()
  try {
    const invalid = await fetch(`${base}/api/render`, { method: 'POST', body: '{}' })
    assert.equal(invalid.status, 400)
    const response = await fetch(`${base}/api/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: '# 测试', themeId: 'editorial-red' }),
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.themeId, 'editorial-red')
    assert.equal(result.plainText, '测试')
  }
  finally { server.close() }
})

test('delivery API supports submit and get by key', async () => {
  const { server, base } = await setup()
  try {
    const submitted = await fetch(`${base}/api/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: { markdown: '# 测试' } }),
    })
    assert.equal(submitted.status, 202)
    const { record } = await submitted.json()
    const fetched = await fetch(`${base}/api/delivery/${record.key}`).then(response => response.json())
    assert.equal(fetched.record.status, 'completed')
    const missing = await fetch(`${base}/api/delivery/missing`)
    assert.equal(missing.status, 404)
  }
  finally { server.close() }
})
