import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// 一条命令跑完整端到端回归：逐个执行冒烟脚本，任一失败则以非零码退出。
const suites = ['electron', 'hotspots', 'topics', 'materials', 'frameworks', 'articles', 'reviews', 'visuals', 'layouts', 'publishing', 'workspace']
// 单个套件超过这个时间即判失败，避免脚本泄漏句柄（未关的 mock 服务、未 close 的应用）把整轮回归挂住
const SUITE_TIMEOUT_MS = 5 * 60 * 1_000

const failed = []
for (const suite of suites) {
  console.log(`\n=== smoke:${suite} ===`)
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [resolve('scripts', `smoke-${suite}.mjs`)], { stdio: 'inherit' })
    const timer = setTimeout(() => {
      console.error(`TIMEOUT smoke:${suite} 超过 ${Math.round(SUITE_TIMEOUT_MS / 1000)}s 未结束`)
      child.kill('SIGTERM')
    }, SUITE_TIMEOUT_MS)
    child.on('close', (exitCode) => { clearTimeout(timer); done(exitCode ?? 1) })
  })
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} smoke:${suite}${code === 0 ? '' : ` (exit ${code})`}`)
  if (code !== 0) failed.push(suite)
}

if (failed.length) {
  console.error(`\nSmoke suites failed: ${failed.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`\nAll ${suites.length} smoke suites passed`)
}
