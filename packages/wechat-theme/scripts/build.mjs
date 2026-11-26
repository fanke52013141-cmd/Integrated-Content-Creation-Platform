import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileRegisteredTheme, listThemes } from '../index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'dist')
await mkdir(output, { recursive: true })

for (const theme of listThemes()) {
  const filename = `${theme.id}.css`
  await writeFile(path.join(output, filename), compileRegisteredTheme(theme.id, theme.version), 'utf8')
  console.log(`built dist/${filename}`)
}
await writeFile(path.join(output, 'registry.json'), `${JSON.stringify(listThemes(), null, 2)}\n`, 'utf8')
console.log('built dist/registry.json')
