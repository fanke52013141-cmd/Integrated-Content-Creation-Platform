import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

const REVIEW_XML = '<评审意见>位置：开头｜严重程度：中｜问题：钩子偏弱｜建议：用反问强化冲突\n总体建议：强化开头。</评审意见>'
const REVISED_MARKDOWN = '# 改稿标题\n\n这是改稿后的正文。'

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += chunk
  const content = body.includes('审稿并使用') ? REVIEW_XML : REVISED_MARKDOWN
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ model: 'review-smoke', choices: [{ message: { content } }] }))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const address = server.address()
const smokeRoot = resolve(tmpdir(), 'moliu-review-smoke')
const root = resolve(smokeRoot, String(Date.now()))
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
await mkdir(root, { recursive: true })
const app = await electron.launch({
  executablePath,
  args: process.env.MOLIU_EXECUTABLE ? [] : ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: root }
})
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'AI 服务' }).first().click()
  await page.getByRole('button', { name: /空白配置/ }).click()
  await page.getByLabel('显示名称').fill('Review')
  await page.getByLabel('接口地址').fill(`http://127.0.0.1:${address.port}/v1`)
  await page.locator('.provider-editor').getByLabel(/访问密钥/).fill('x')
  await page.getByLabel('显示别名').fill('Review')
  await page.getByLabel('模型标识').fill('review-smoke')
  await page.locator('.provider-editor').getByRole('button', { name: '测试并加密保存' }).click()
  await page.getByText('供应商配置已加密保存').waitFor()
  const data = await page.evaluate(async () => {
    const provider = (await window.moliu.providers.list())[0]
    const model = 'review-smoke'
    const article = await window.moliu.articles.save({
      materialIds: [], manualOutline: 'x', status: 'draft', rawMarkdown: '# 原稿\n\n正文', source: 'manual'
    })
    const role = await window.moliu.reviews.saveRole({
      name: '审稿人', systemPrompt: '审稿并使用 <评审意见> 输出',
      extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: ['可读性'], sortOrder: 0
    })
    const offline = await window.moliu.providers.save({
      displayName: '断链供应商', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1',
      defaultModel: 'unreachable-model', enabled: true, isRelay: false,
      capabilities: { chat: true, jsonMode: false, streaming: false, vision: false, image: false },
      models: [{ modelId: 'unreachable-model', displayName: 'Unreachable', reasoningVariants: [], isDefault: true, enabled: true }],
      apiKey: 'x'
    })
    const brokenRole = await window.moliu.reviews.saveRole({
      name: '接了断链供应商的审稿人', systemPrompt: '审稿并使用 <评审意见> 输出',
      providerId: offline.id, model: 'unreachable-model',
      extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: ['可读性'], sortOrder: 1
    })
    const saveVersion = (markdown) => window.moliu.articles.save({
      id: article.id, materialIds: [], manualOutline: 'x', status: 'draft', rawMarkdown: markdown, source: 'manual'
    })

    // 1. 正常评审并应用
    const started = await window.moliu.reviews.start({
      articleId: article.id, roleIds: [role.id], fallbackProviderId: provider.id, fallbackModel: model
    })
    const applied = await window.moliu.reviews.apply(started.task.id, provider.id, model)
    const appliedTask = (await window.moliu.reviews.listTasks(article.id)).find((task) => task.id === started.task.id)

    // 2. 评审基线绑定版本：文章改版后旧意见不得静默应用，显式确认才可以
    const second = await window.moliu.reviews.start({
      articleId: article.id, roleIds: [role.id], fallbackProviderId: provider.id, fallbackModel: model
    })
    const beforeStale = second.task.articleVersionNumber
    await saveVersion('# 手工改成的新版本\n\n已经是另一版正文了。')
    let staleRejected = ''
    try {
      await window.moliu.reviews.apply(second.task.id, provider.id, model)
    } catch (error) {
      staleRejected = error instanceof Error ? error.message : String(error)
    }
    const forced = await window.moliu.reviews.apply(second.task.id, provider.id, model, true)

    // 3. 部分角色失败记 partial，全部失败记 failed；failed 的任务不能被应用
    const partial = await window.moliu.reviews.start({
      articleId: article.id, roleIds: [role.id, brokenRole.id], fallbackProviderId: provider.id, fallbackModel: model
    })
    const allFailed = await window.moliu.reviews.start({
      articleId: article.id, roleIds: [brokenRole.id], fallbackProviderId: provider.id, fallbackModel: model
    })
    let failedApplyRejected = ''
    try {
      await window.moliu.reviews.apply(allFailed.task.id, provider.id, model)
    } catch (error) {
      failedApplyRejected = error instanceof Error ? error.message : String(error)
    }
    return {
      opinions: started.task.opinions.length,
      problems: started.task.opinions[0]?.problems.length ?? 0,
      appliedStatus: appliedTask?.status,
      appliedMarkdown: applied.rawMarkdown,
      boundVersionNumber: started.task.articleVersionNumber,
      baselineVersionId: started.task.articleVersionId,
      staleRejected,
      staleVersionNumber: beforeStale,
      forcedVersionId: forced.currentVersionId,
      partialStatus: partial.task.status,
      partialOpinions: partial.task.opinions.length,
      partialFailedCount: partial.failed.length,
      allFailedStatus: allFailed.task.status,
      allFailedCount: allFailed.failed.length,
      allFailedRoleName: allFailed.failed[0]?.roleName,
      failedApplyRejected
    }
  })
  if (data.opinions !== 1 || data.problems !== 1) throw new Error('Review opinion not parsed')
  if (data.appliedStatus !== 'applied') throw new Error(`Applied task status is ${data.appliedStatus}`)
  if (!data.appliedMarkdown.includes('改稿标题')) throw new Error('Applied review did not rewrite the article')
  if (!data.baselineVersionId || data.boundVersionNumber !== 1) throw new Error(`Review task is not bound to the reviewed version: ${JSON.stringify(data)}`)
  if (!/第\s*\d+\s*版/.test(data.staleRejected)) throw new Error(`Stale review apply was not rejected: ${data.staleRejected}`)
  if (data.forcedVersionId === data.baselineVersionId) throw new Error('Forced apply did not create a new version')
  if (data.allFailedStatus !== 'failed') throw new Error(`All-failed review reported status ${data.allFailedStatus}`)
  if (data.allFailedCount !== 1 || !data.allFailedRoleName) throw new Error('Failed roles are not reported per role')
  if (data.partialStatus !== 'partial') throw new Error(`Partial review run reported status ${data.partialStatus}`)
  if (data.partialOpinions !== 1 || data.partialFailedCount !== 1) throw new Error('Partial review run lost the successful opinion or the failure')
  if (!data.failedApplyRejected) throw new Error('A fully failed review task was still applied')
  await page.getByRole('button', { name: '内容评审' }).first().click()
  await page.waitForTimeout(800)
  await capture(page, { path: resolve('artifacts', 'review-history.png'), animations: 'disabled' })
  console.log('Review smoke passed: version binding, stale baseline rejection, forced apply, partial/failed statuses')
} finally {
  await app.close()
  await new Promise((r) => server.close(r))
}
const db = new DatabaseSync(resolve(root, 'moliu.db'))
const rows = db.prepare('SELECT status, article_version_id, failures_json FROM review_tasks').all()
db.close()
if (rows.length < 4) throw new Error(`Expected at least 4 persisted review tasks, got ${rows.length}`)
if (!rows.some((row) => row.status === 'failed' && String(row.failures_json).includes('断链'))) throw new Error('Failed review task did not persist which role failed')
if (!rows.every((row) => row.article_version_id)) throw new Error('Review task without article version binding')
if (!root.startsWith(`${smokeRoot}${sep}`)) throw new Error('Unexpected cleanup target')
await rm(root, { recursive: true, force: true })
