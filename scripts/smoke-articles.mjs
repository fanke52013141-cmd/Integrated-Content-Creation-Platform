import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

let calls = 0
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  calls += 1
  response.setHeader('Content-Type', 'application/json')
  const content = calls === 1
    ? '# 先搭框架，再写文章\n\n很多创作者不是不会写，而是太早开始写。\n\n## 框架先决定什么\n\n它先帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n从下一篇文章开始，先写下结构。'
    : '# 更锋利的开头：别急着写\n\n创作者最常见的浪费，是在没有结构时就急着堆字。\n\n## 框架先决定什么\n\n它帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n先搭结构，再投入表达。'
  response.end(JSON.stringify({ model: 'moliu-article-smoke', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Mock model server did not start')
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-article-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true }); await mkdir(userDataDir, { recursive: true })
const application = await electron.launch({ executablePath, args: applicationArgs, env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir } })
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '模型网关' }).first().click()
  await window.getByRole('button', { name: /空白配置/ }).click()
  await window.getByLabel('显示名称').fill('本地成稿验收模型')
  await window.getByLabel('Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
  await window.locator('.provider-editor').getByLabel(/API Key/).fill('article-smoke-key')
  await window.getByLabel('显示别名').fill('Smoke Article Model')
  await window.getByLabel('API 模型 ID').fill('moliu-article-smoke')
  await window.locator('.provider-editor').getByRole('button', { name: '加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('从框架写成文章，再一轮轮打磨。').waitFor()
  await window.getByLabel('手动框架（未选框架时必填）').fill('标题：先搭框架，再写文章\n开头：创作者动笔前的混乱\n论点：结构决定叙述推进\n结尾：给出行动建议')
  await window.getByRole('button', { name: '生成文章草稿' }).click()
  await window.getByText('已生成 1 篇成稿').waitFor({ timeout: 30_000 })
  await window.getByText('先搭框架，再写文章').first().waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'article-generation.png'), fullPage: false, animations: 'disabled' })
  await window.getByPlaceholder('例如：把开头改得更犀利一些，删去没有来源的数据表述。').fill('把开头改得更犀利一些')
  await window.getByRole('button', { name: '生成改稿' }).click()
  await window.getByText('改稿新版本已保存').waitFor({ timeout: 30_000 })
  await window.getByText('更锋利的开头：别急着写').first().waitFor()
  await window.getByRole('button', { name: '锁定' }).click()
  await window.getByText('已锁定成稿版本').waitFor()
  console.log('Article smoke test passed: manual outline generation, revision, and lock persistence')
} finally { await application.close(); await new Promise((resolve) => server.close(resolve)) }
const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const row = database.prepare('SELECT a.status, COUNT(v.id) AS version_count FROM articles a JOIN article_versions v ON v.article_id=a.id GROUP BY a.id LIMIT 1').get()
database.close()
if (row?.status !== 'locked' || row.version_count < 2) throw new Error('Article lock or revision version was not persisted')
const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
await rm(userDataDir, { recursive: true, force: true })
