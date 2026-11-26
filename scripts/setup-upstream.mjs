import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const upstream = path.join(root, 'upstream/doocs-md')
const patch = path.join(root, 'patches/doocs-md/0001-explicit-runtime-imports.patch')
if (!existsSync(upstream) || !existsSync(patch)) throw new Error('先执行 git submodule update --init --recursive')

function git(args) {
  const result = spawnSync('git', ['-C', upstream, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (git(['apply', '--check', patch]) === 0) {
  console.log('[setup-upstream] Applying doocs runtime import patch')
  if (git(['apply', patch]) !== 0) throw new Error('Failed to apply doocs patch')
}
else {
  const changed = git(['diff', '--quiet', '--',
    'apps/web/src/App.vue',
    'apps/web/src/composables/useAccountSyncBootstrap.ts',
    'apps/web/src/composables/useDeepLinkImport.ts',
  ])
  if (changed !== 1) {
    throw new Error('doocs patch does not apply cleanly and target files are not already patched; resolve upstream state manually')
  }
  console.log('[setup-upstream] Patch already applied; skipping')
}
