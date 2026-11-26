import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocument, EditorSession } from '../lib/store.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), data }
}

function sessionWith(storage, timeStart = Date.parse('2026-11-27T00:00:00Z')) {
  let tick = timeStart
  return new EditorSession({ storage, debounceMs: 60_000, now: () => new Date(++tick).toISOString() })
}

test('autosave flush creates a browser-local version and reload restores it', () => {
  const storage = memoryStorage()
  const session = sessionWith(storage)
  const document = createDocument({ id: 'doc-test', title: '新版本' })
  session.updateDocument(document)
  assert.equal(session.status, 'dirty')
  const saved = session.flush()
  assert.equal(saved.saved, true)
  assert.equal(session.versions.length, 1)
  const restored = sessionWith(storage)
  assert.equal(restored.load(), true)
  assert.equal(restored.document.title, '新版本')
  restored.dispose()
  session.dispose()
})

test('restore creates a new dirty state without deleting history', () => {
  const storage = memoryStorage()
  const session = sessionWith(storage)
  const first = createDocument({ title: '第一版' })
  session.updateDocument(first)
  session.flush()
  session.updateDocument({ ...first, title: '第二版' })
  session.flush()
  const versionId = session.versions[1].id
  assert.equal(session.restore(versionId), true)
  assert.equal(session.document.title, '第一版')
  assert.equal(session.status, 'dirty')
  assert.equal(session.versions.length, 2)
  session.flush()
  assert.equal(session.versions.length, 3)
  session.dispose()
})

test('history is capped at 20 snapshots', () => {
  const session = sessionWith(memoryStorage())
  const base = createDocument()
  for (let index = 0; index < 24; index += 1) {
    session.updateDocument({ ...base, title: `版本 ${index}` })
    session.flush()
  }
  assert.equal(session.versions.length, 20)
  assert.equal(session.versions[0].document.title, '版本 23')
  session.dispose()
})

test('storage failure never reports local success or appends a fake version', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  const session = sessionWith(storage)
  session.updateDocument(createDocument({ title: '无法保存' }))
  const result = session.flush()
  assert.equal(result.saved, false)
  assert.equal(session.status, 'error')
  assert.equal(session.versions.length, 0)
})
