export const THEME_SCHEMA_VERSION = '1.0.0'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_PROPERTY_PATTERN = /^[a-z][a-z-]*$/
const TOKEN_PATTERN = /\{([a-zA-Z0-9_.-]+)\}/g
const FORBIDDEN_TOKEN_PATHS = new Set(['__proto__', 'prototype', 'constructor'])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function assertSafeDeclaration(property, rawValue) {
  const name = property.toLowerCase()
  const value = String(rawValue)
  invariant(!name.startsWith('--'), `CSS custom properties are forbidden: ${property}`)
  invariant(!/var\s*\(/i.test(value), `CSS var() is forbidden in final output: ${value}`)
  invariant(!/(?:url\s*\(|javascript:|expression\s*\()/i.test(value), `External/executable CSS value is forbidden: ${value}`)
  invariant(!(name === 'position' && /^(?:absolute|fixed|sticky)$/i.test(value.trim())), `Forbidden position: ${value}`)
  invariant(!(name === 'display' && /^(?:inline-)?grid$/i.test(value.trim())), 'Grid layout is forbidden')
  invariant(name !== 'float', 'Float layout is forbidden')
  invariant(!/^grid(?:-|$)/.test(name), `Grid property is forbidden: ${property}`)
  invariant(!/^(?:animation|transition)(?:-|$)/.test(name), `Animation/transition is forbidden: ${property}`)
}

/** Validate the final CSS independently from the JSON compiler. */
export function assertWeChatSafeCss(css) {
  invariant(typeof css === 'string' && css.trim(), 'CSS must be a non-empty string')
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  invariant(!/@(?:import|font-face|keyframes)\b/i.test(source), '@import/@font-face/@keyframes are forbidden')
  invariant(!/(?:url\s*\(|javascript:|expression\s*\(|var\s*\()/i.test(source), 'External/executable/variable CSS is forbidden')
  invariant(!/--[a-z0-9_-]+\s*:/i.test(source), 'CSS variable declarations are forbidden')
  invariant(!/\bposition\s*:\s*(?:absolute|fixed|sticky)\b/i.test(source), 'Absolute/fixed/sticky positioning is forbidden')
  invariant(!/\bdisplay\s*:\s*(?:inline-)?grid\b/i.test(source), 'Grid layout is forbidden')
  invariant(!/\bfloat\s*:/i.test(source), 'Float layout is forbidden')
  invariant(!/(?:^|[;{])\s*(?:grid|animation|transition)(?:-[a-z-]+)?\s*:/im.test(source), 'Grid/animation/transition declarations are forbidden')
  return true
}

function tokenAt(tokens, path) {
  const parts = path.split('.')
  invariant(parts.every(part => !FORBIDDEN_TOKEN_PATHS.has(part)), `Unsafe token path: ${path}`)
  let value = tokens
  for (const part of parts) {
    invariant(value && typeof value === 'object' && Object.hasOwn(value, part), `Unknown token: ${path}`)
    value = value[part]
  }
  invariant(typeof value === 'string' || typeof value === 'number', `Token must resolve to a string/number: ${path}`)
  return String(value)
}

function resolveTokens(value, tokens) {
  return String(value).replace(TOKEN_PATTERN, (_, path) => tokenAt(tokens, path))
}

export function validateTheme(theme) {
  invariant(theme && typeof theme === 'object', 'Theme must be an object')
  invariant(typeof theme.id === 'string' && ID_PATTERN.test(theme.id), 'Invalid theme id')
  invariant(typeof theme.name === 'string' && theme.name.trim(), 'Theme name is required')
  invariant(typeof theme.description === 'string' && theme.description.trim(), 'Theme description is required')
  invariant(VERSION_PATTERN.test(theme.version), 'Theme version must be major.minor.patch')
  invariant(VERSION_PATTERN.test(theme.schemaVersion), 'Theme schemaVersion must be major.minor.patch')
  invariant(theme.schemaVersion.split('.')[0] === THEME_SCHEMA_VERSION.split('.')[0], `Unsupported theme schema: ${theme.schemaVersion}`)
  invariant(theme.tokens && typeof theme.tokens === 'object' && !Array.isArray(theme.tokens), 'Theme tokens must be an object')
  invariant(Array.isArray(theme.rules) && theme.rules.length > 0, 'Theme rules are required')

  const ruleNames = new Set()
  for (const rule of theme.rules) {
    invariant(rule && typeof rule === 'object', 'Every rule must be an object')
    invariant(ID_PATTERN.test(rule.name), `Invalid rule name: ${rule.name}`)
    invariant(!ruleNames.has(rule.name), `Duplicate rule name: ${rule.name}`)
    ruleNames.add(rule.name)
    invariant(Array.isArray(rule.selectors) && rule.selectors.length > 0, `Rule ${rule.name} needs selectors`)
    for (const selector of rule.selectors) {
      invariant(typeof selector === 'string' && /^#output(?:$|\s)/.test(selector), `Selector must be #output scoped: ${selector}`)
      invariant(!selector.includes(','), `Use separate selector array entries instead of comma text: ${selector}`)
    }
    invariant(rule.declarations && typeof rule.declarations === 'object' && !Array.isArray(rule.declarations), `Rule ${rule.name} needs declarations`)
    const entries = Object.entries(rule.declarations)
    invariant(entries.length > 0, `Rule ${rule.name} has no declarations`)
    for (const [property, value] of entries) {
      invariant(SAFE_PROPERTY_PATTERN.test(property), `Invalid CSS property: ${property}`)
      invariant(typeof value === 'string' || typeof value === 'number', `CSS value must be string/number: ${rule.name}.${property}`)
      assertSafeDeclaration(property, resolveTokens(value, theme.tokens))
    }
  }
  return true
}

/** Compile JSON tokens/rules to stable #output CSS. No time/random/environment input. */
export function compileTheme(theme) {
  validateTheme(theme)
  const lines = [
    '/*',
    ` * ${theme.name} (${theme.id})`,
    ` * Theme ${theme.version} · Schema ${theme.schemaVersion}`,
    ` * ${theme.description}`,
    ' * Original token-driven WeChat theme; deterministic build; no external assets.',
    ' */'
  ]

  for (const rule of theme.rules) {
    lines.push(`${rule.selectors.join(',\n')} {`)
    const declarations = Object.entries(rule.declarations)
      .map(([property, value]) => [property, resolveTokens(value, theme.tokens)])
      .sort(([a], [b]) => a.localeCompare(b))
    for (const [property, rawValue] of declarations) {
      assertSafeDeclaration(property, rawValue)
      lines.push(`  ${property}: ${rawValue};`)
    }
    lines.push('}')
  }

  const css = `${lines.join('\n')}\n`
  assertWeChatSafeCss(css)
  return css
}
