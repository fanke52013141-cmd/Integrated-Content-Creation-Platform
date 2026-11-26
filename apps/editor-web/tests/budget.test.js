import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetLevel, calculateBudget, DOCUMENT_LIMITS } from '../lib/budget.js'

test('budget follows 80% warning, 90% critical and hard limit', () => {
  assert.equal(budgetLevel(15_999, 20_000), 'ok')
  assert.equal(budgetLevel(16_000, 20_000), 'warning')
  assert.equal(budgetLevel(18_000, 20_000), 'critical')
  assert.equal(budgetLevel(20_000, 20_000), 'error')
  assert.equal(DOCUMENT_LIMITS.htmlBytes, 1_000_000)
})

test('budget reports HTML characters, UTF-8 bytes and metadata fields', () => {
  const result = calculateBudget({ html: '中'.repeat(100), title: 'a'.repeat(33), author: '作者', summary: '摘要' })
  assert.equal(result.htmlCharacters, 100)
  assert.equal(result.htmlBytes, 300)
  assert.equal(result.fields.find(field => field.id === 'title').level, 'error')
  assert.equal(result.level, 'error')
})

test('brand blocked words are local warning evidence, not server quality success', () => {
  const result = calculateBudget({ markdown: '包含 Foobar 文案', blockedWords: ['foobar'] })
  assert.deepEqual(result.wordHits, ['foobar'])
  assert.equal(result.level, 'warning')
})
