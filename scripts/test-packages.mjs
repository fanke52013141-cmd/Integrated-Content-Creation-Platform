import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
let executed = 0
for (const group of ['packages', 'apps']) {
  const groupRoot = path.join(root, group)
  for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = path.join(groupRoot, entry.name)
    const manifestPath = path.join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.scripts?.test) continue
    console.log(`\n[test:packages] ${manifest.name ?? entry.name}`)
    const result = spawnSync(process.execPath, ['--test'], {
      cwd: directory,
      env: process.env,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
    executed += 1
  }
}
console.log(`\n[test:packages] ${executed} package(s) passed`)
