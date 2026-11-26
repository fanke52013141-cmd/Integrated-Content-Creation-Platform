import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertWeChatSafeCss,
  compareThemeVersions,
  compileRegisteredTheme,
  compileTheme,
  createThemeRegistry,
  getTheme,
  listThemes,
  themes
} from '../index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('registry exposes exactly three original themes with stable metadata', () => {
  assert.deepEqual(listThemes().map(theme => theme.id), ['editorial-red', 'jade-notes', 'tech-blue'])
  assert.deepEqual(listThemes().map(theme => theme.name), ['编辑红', '翡翠笔记', '科技蓝'])
  assert.deepEqual(new Set(themes.map(theme => theme.tokens.color.primary)).size, 3)
  for (const theme of themes) {
    assert.equal(theme.version, '1.0.0')
    assert.equal(theme.schemaVersion, '1.0.0')
    assert.ok(theme.rules.length >= 30, `${theme.id} should be a rich theme, not a palette-only draft`)
  }
})

test('compilation is deterministic and declaration insertion order does not matter', () => {
  for (const theme of themes) {
    const first = compileTheme(theme)
    const second = compileTheme(theme)
    assert.equal(first, second)
    assert.ok(first.length > 6000, `${theme.id} output should contain substantive component styling`)
    const reordered = structuredClone(theme)
    reordered.rules = reordered.rules.map(rule => ({
      ...rule,
      declarations: Object.fromEntries(Object.entries(rule.declarations).reverse())
    }))
    assert.equal(compileTheme(reordered), first)
    assert.match(first, new RegExp(`Theme ${theme.version.replaceAll('.', '\\.')}`))
  }
})

test('final CSS covers the doocs/WeChat component contract and passes safety checks', () => {
  for (const theme of themes) {
    const css = compileTheme(theme)
    assert.equal(assertWeChatSafeCss(css), true)
    for (const selector of [
      '#output h1', '#output h2', '#output p', '#output blockquote',
      '#output table', '#output th', '#output td', '#output pre',
      '#output .wechat-card', '#output .wechat-note', '#output img'
    ]) {
      assert.ok(css.includes(selector), `${theme.id} misses ${selector}`)
    }
    assert.doesNotMatch(css, /var\s*\(|url\s*\(|@font-face|@import|@keyframes|javascript:/i)
    assert.doesNotMatch(css, /\bposition\s*:\s*(?:absolute|fixed|sticky)|\bfloat\s*:|\bdisplay\s*:\s*(?:inline-)?grid/i)
  }
})

test('committed dist artifacts exactly match deterministic compiler output', async () => {
  for (const theme of listThemes()) {
    const artifact = await readFile(path.join(root, 'dist', `${theme.id}.css`), 'utf8')
    assert.equal(artifact, compileRegisteredTheme(theme.id, theme.version))
  }
  const registryArtifact = JSON.parse(await readFile(path.join(root, 'dist', 'registry.json'), 'utf8'))
  assert.deepEqual(registryArtifact, listThemes())
})

test('registry supports id@version coexistence and numeric latest resolution', () => {
  const registry = createThemeRegistry([getTheme('tech-blue')])
  const newer = structuredClone(getTheme('tech-blue'))
  newer.version = '1.10.0'
  registry.register(newer)
  assert.equal(registry.resolve('tech-blue').version, '1.10.0')
  assert.equal(registry.resolve('tech-blue', '1.0.0').version, '1.0.0')
  assert.equal(compareThemeVersions('1.10.0', '1.2.0') > 0, true)
  assert.throws(() => registry.register(newer), /already registered/)
  assert.throws(() => registry.resolve('missing'), /not found/)
})

test('compiler rejects unknown tokens, unsupported schema and unscoped selectors', () => {
  const unknown = structuredClone(getTheme('tech-blue'))
  unknown.rules[0].declarations.color = '{color.not_registered}'
  assert.throws(() => compileTheme(unknown), /Unknown token/)

  const schema = structuredClone(getTheme('tech-blue'))
  schema.schemaVersion = '2.0.0'
  assert.throws(() => compileTheme(schema), /Unsupported theme schema/)

  const unscoped = structuredClone(getTheme('tech-blue'))
  unscoped.rules[0].selectors = ['body']
  assert.throws(() => compileTheme(unscoped), /#output scoped/)
})

test('compiler and standalone guard reject forbidden final CSS', () => {
  const grid = structuredClone(getTheme('tech-blue'))
  grid.rules[0].declarations.display = 'grid'
  assert.throws(() => compileTheme(grid), /Grid layout/)

  const variableToken = structuredClone(getTheme('tech-blue'))
  variableToken.tokens.color.primary = 'var(--brand)'
  assert.throws(() => compileTheme(variableToken), /var\(\)/)

  assert.throws(() => assertWeChatSafeCss('#output p { position: absolute; }'), /position/)
  assert.throws(() => assertWeChatSafeCss('#output p { float: left; }'), /Float/)
  assert.throws(() => assertWeChatSafeCss('#output p { transition: color 1s; }'), /declarations/)
  assert.throws(() => assertWeChatSafeCss('#output p { background: url(https://example.com/a.png); }'), /External/)
})
