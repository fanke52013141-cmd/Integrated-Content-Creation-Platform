/**
 * 全流程走查 · Phase A（探测）
 * 用临时数据目录启动真实应用，抓取真实热点榜 + 导出各阶段默认配置，
 * 供「模型侧」（走查者）选择热点并按项目格式准备各阶段生成内容。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts/walkthrough')
await mkdir(artifactDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-walkthrough-a-${Date.now()}`)

const executablePath = process.env.MOLIU_EXECUTABLE
  ? resolve(process.env.MOLIU_EXECUTABLE)
  : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']

const app = await electron.launch({ executablePath, args: applicationArgs, env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir } })
const rendererErrors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => rendererErrors.push(e.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '创作台', exact: true }).waitFor()

  const probe = await page.evaluate(async () => {
    const out = {}
    out.bootstrap = await window.moliu.app.bootstrap()
    out.templates = await window.moliu.frameworks.listTemplates()
    out.topicSchema = await window.moliu.topics.getSchema()
    out.reviewRoles = (await window.moliu.reviews.listRoles()).map((r) => ({ id: r.id, name: r.name, extractionTag: r.extractionTag, dimensions: r.dimensions, systemPrompt: r.systemPrompt.slice(0, 120) }))
    out.layoutThemes = await window.moliu.layouts.themes()
    out.layoutGenres = await window.moliu.layouts.genres()
    try {
      const hs = await window.moliu.hotspots.bootstrap()
      out.hotspotService = hs.service
      out.hotspotSourceCount = hs.sources.length
      // 覆盖科技/资讯类主源，也带一个微博验证登录态要求
      const wanted = ['36kr', 'zhihu', 'ithome', 'toutiao', 'juejin', 'weibo', 'baidu']
      out.hotResults = await window.moliu.hotspots.refresh(hs.sources.map(s => s.id).filter(id => wanted.includes(id)))
      out.hotResults = out.hotResults.map((r) => ({
        source: r.source.id, status: r.status, error: r.error,
        itemCount: r.items.length,
        top: r.items.slice(0, 10).map((i) => ({ rank: i.rank, title: i.title, desc: (i.desc || '').slice(0, 80), hotValue: i.hotValue, url: i.url }))
      }))
    } catch (e) {
      out.hotspotError = e instanceof Error ? e.message : String(e)
    }
    return out
  })

  await writeFile(join(artifactDir, 'phase-a-probe.json'), JSON.stringify(probe, null, 2), 'utf8')
  const ready = (probe.hotResults ?? []).filter(r => r.status === 'ready')
  console.log(`Phase A done: sources=${probe.hotspotSourceCount} ready=${ready.map(r => r.source).join(',') || '无'}`)
  for (const r of probe.hotResults ?? []) {
    console.log(`  ${r.source}: ${r.status}${r.error ? ` (${r.error})` : ''} items=${r.itemCount}`)
    for (const t of (r.top ?? []).slice(0, 3)) console.log(`    #${t.rank} ${t.title}${t.hotValue ? ` [${t.hotValue}]` : ''}`)
  }
  if (rendererErrors.length) console.log(`renderer errors: ${rendererErrors.join(' | ')}`)
} finally {
  await app.close().catch(() => {})
}
