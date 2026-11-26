import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { compileColorMix, compileModernColors, replaceTaskInputsWithStaticSymbols } from '../server/article-transforms.mjs'

const requireCore = createRequire(path.resolve('upstream/doocs-md/packages/core/package.json'))
const { JSDOM } = requireCore('jsdom')

test('task inputs become accessible static symbols without input tags', () => {
  const document = new JSDOM('<ul><li><input type="checkbox" checked>完成</li><li><input type="checkbox">待办</li></ul>').window.document
  assert.equal(replaceTaskInputsWithStaticSymbols(document), 2)
  assert.equal(document.querySelectorAll('input').length, 0)
  assert.equal(document.querySelector('[data-task-status="checked"]').textContent, '☑')
  assert.equal(document.querySelector('[data-task-status="unchecked"]').textContent, '☐')
  assert.match(document.body.textContent, /完成/)
  assert.match(document.body.textContent, /待办/)
})

test('color-mix compiles hex and percentage to rgba', () => {
  assert.equal(compileColorMix('background: color-mix(in srgb, #0F4C81 8%, transparent)'), 'background: rgba(15, 76, 129, 0.08)')
  assert.equal(compileColorMix('border: 1px solid color-mix(in srgb, #FFFFFF 20%, transparent)'), 'border: 1px solid rgba(255, 255, 255, 0.2)')
})

test('modern color compilation only rewrites matching declarations', () => {
  const document = new JSDOM('<p style="background: color-mix(in srgb, #0F4C81 8%, transparent)">A</p><p style="color: red">B</p>').window.document
  assert.equal(compileModernColors(document), 1)
  assert.match(document.querySelector('p').getAttribute('style'), /rgba\(15, 76, 129, 0.08\)/)
  assert.equal(document.querySelectorAll('p')[1].getAttribute('style'), 'color: red')
})
