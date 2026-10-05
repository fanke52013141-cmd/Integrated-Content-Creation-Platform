/**
 * 全流程走查 · Phase C（UI 视角）
 * 复用 Phase B 的数据目录重启应用（验证跨重启持久化），
 * 逐页打开创作主链路页面，断言关键内容可见并截图取证。
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts/walkthrough')
await mkdir(artifactDir, { recursive: true })
const smokeRoot = resolve(tmpdir(), 'moliu-walkthrough-b-')
// 找到 Phase B 留下的数据目录
const { readdir } = await import('node:fs/promises')
const candidates = (await readdir(tmpdir())).filter((name) => name.startsWith('moliu-walkthrough-b-')).sort()
if (!candidates.length) throw new Error('未找到 Phase B 数据目录，请先运行 walkthrough-phase-b.mjs')
const userDataDir = resolve(tmpdir(), candidates.at(-1))
console.log(`复用数据目录：${userDataDir}`)

const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const app = await electron.launch({ executablePath, args: process.env.MOLIU_EXECUTABLE ? [] : ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir } })
const rendererErrors = []
const shots = []
const problems = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => rendererErrors.push(e.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '创作台', exact: true }).waitFor()

  const visit = async (navName, shotName, assertions) => {
    await page.getByRole('button', { name: navName }).first().click()
    await page.waitForTimeout(600)
    for (const assertion of assertions) {
      try { await assertion() } catch (e) { problems.push(`页面「${navName}」断言失败：${e.message.split('\n')[0]}`) }
    }
    const path = join(artifactDir, `ui-${shotName}.png`)
    await page.screenshot({ path, fullPage: false, animations: 'disabled' })
    shots.push(path)
  }

  await visit('热点洞察', 'hotspots', [
    () => page.getByText('华为与高通宣布达成广泛专利许可协议', { exact: false }).first().waitFor({ timeout: 20_000 }),
    () => page.getByText('已锁定源数据并加入收藏', { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => problems.push('热点页未见收藏标记（可能需切到收藏夹）'))
  ])
  await visit('选题生成', 'topics', [
    () => page.getByText('华为与高通互相点头', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('内容框架', 'frameworks', [
    () => page.getByText('华为与高通互相点头', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('文章创作', 'articles', [
    () => page.getByText('华为与高通互相点头', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('内容评审', 'reviews', [
    () => page.getByText('结构编辑', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('智能配图', 'visuals', [
    () => page.getByText('封面', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('文章排版', 'layouts', [
    () => page.getByText('华为与高通', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('发布管理', 'publishing', [
    () => page.getByText('已发布', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('AI 服务', 'providers', [
    () => page.getByText('走查本地模型', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])
  await visit('提示词', 'prompts', [
    () => page.getByText('账号定位生成', { exact: false }).first().waitFor({ timeout: 10_000 })
  ])

  // 文章列表里确认 v3 与发布状态
  const articleState = await page.evaluate(async () => {
    const list = await window.moliu.articles.listSummaries({ limit: 10 })
    return list.items.map((a) => ({ title: a.title, versionCount: a.versionCount, status: a.status, publicationStatus: a.publicationStatus, layoutStale: a.layoutStale }))
  })
  console.log('文章摘要：', JSON.stringify(articleState, null, 1))
  const target = articleState.find((a) => a.title.includes('华为与高通'))
  if (!target) problems.push('文章列表未找到走查文章')
  else {
    if (target.versionCount !== 3) problems.push(`重启后版本数异常：${target.versionCount}（期望 3）`)
    if (target.publicationStatus !== 'published') problems.push(`重启后发布状态异常：${target.publicationStatus}`)
  }
  const memories = await page.evaluate(async (id) => (await window.moliu.accounts.listMemories(id)).map((m) => m.insight), (await page.evaluate(async () => (await window.moliu.accounts.list())[0].id)))
  if (!memories.some((m) => m.includes('标题打开率'))) problems.push('重启后账号记忆丢失')
} finally {
  await app.close().catch(() => {})
}

console.log(`截图 ${shots.length} 张 → ${artifactDir}`)
if (rendererErrors.length) problems.push(`渲染层 pageerror：${rendererErrors.join(' | ')}`)
await writeFile(join(artifactDir, 'phase-c-summary.json'), JSON.stringify({ shots, problems, rendererErrors }, null, 2), 'utf8')
if (problems.length) {
  console.log('发现问题：')
  for (const p of problems) console.log(`  [问题] ${p}`)
}
console.log(problems.length ? `PHASE-C FINISHED WITH ${problems.length} FINDING(S)` : 'PHASE-C ALL GREEN')
process.exitCode = problems.length ? 2 : 0
