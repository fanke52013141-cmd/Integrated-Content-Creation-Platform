import { compileTheme, validateTheme } from './compiler.js'

function parts(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid theme version: ${version}`)
  return version.split('.').map(Number)
}

export function compareThemeVersions(a, b) {
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

/** Isolated registry; multiple versions may coexist under one theme id. */
export function createThemeRegistry(initialThemes = []) {
  const records = new Map()

  function register(theme) {
    validateTheme(theme)
    compileTheme(theme)
    const key = `${theme.id}@${theme.version}`
    if (records.has(key)) throw new Error(`Theme already registered: ${key}`)
    records.set(key, theme)
    return theme
  }

  function resolve(id, version = 'latest') {
    if (version !== 'latest') {
      const theme = records.get(`${id}@${version}`)
      if (!theme) throw new Error(`Theme not found: ${id}@${version}`)
      return theme
    }
    const matches = [...records.values()]
      .filter(theme => theme.id === id)
      .sort((a, b) => compareThemeVersions(b.version, a.version))
    if (!matches.length) throw new Error(`Theme not found: ${id}`)
    return matches[0]
  }

  function list() {
    return [...records.values()]
      .sort((a, b) => a.id.localeCompare(b.id) || compareThemeVersions(b.version, a.version))
      .map(({ id, name, version, schemaVersion, description }) => ({ id, name, version, schemaVersion, description }))
  }

  for (const theme of initialThemes) register(theme)
  return Object.freeze({ register, resolve, list })
}
