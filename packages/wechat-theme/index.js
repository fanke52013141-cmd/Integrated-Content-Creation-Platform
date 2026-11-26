import editorialRed from './tokens/editorial-red.json' with { type: 'json' }
import jadeNotes from './tokens/jade-notes.json' with { type: 'json' }
import techBlue from './tokens/tech-blue.json' with { type: 'json' }
import { compileTheme } from './compiler.js'
import { createThemeRegistry } from './registry.js'

export { assertWeChatSafeCss, compileTheme, THEME_SCHEMA_VERSION, validateTheme } from './compiler.js'
export { compareThemeVersions, createThemeRegistry } from './registry.js'

export const themes = Object.freeze([techBlue, editorialRed, jadeNotes])
export const themeRegistry = createThemeRegistry(themes)

export function listThemes() {
  return themeRegistry.list()
}

export function getTheme(id, version = 'latest') {
  return themeRegistry.resolve(id, version)
}

export function registerTheme(theme) {
  return themeRegistry.register(theme)
}

export function compileRegisteredTheme(id, version = 'latest') {
  return compileTheme(getTheme(id, version))
}
