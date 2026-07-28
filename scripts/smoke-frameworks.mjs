import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    model: 'moliu-framework-smoke',
    choices: [{ message: { content: '<框架><标题>先有框架，创作才有方向</标题><开头>从动笔前的混乱切入。</开头><论点一>框架先确定读者和核心承诺。</论点一><论点二>框架让素材有明确位置。</论点二><论点三>框架降低写作返工成本。</论点三><结尾>用可执行的下一步收束。</结尾></框架>' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 100 }
  }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Mock model server did not start')

const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-framework-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })

const application = await electron.launch({
  executablePath, args: applicationArgs, env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '模型网关' }).first().click()
  await window.getByRole('button', { name: /空白配置/ }).click()
  await window.getByLabel('显示名称').fill('本地框架验收模型')
  await window.getByLabel('Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
  await window.locator('.provider-editor').getByLabel(/API Key/).fill('framework-smoke-key')
  await window.getByLabel('显示别名').fill('Smoke Framework Model')
  await window.getByLabel('API 模型 ID').fill('moliu-framework-smoke')
  await window.locator('.provider-editor').getByRole('button', { name: '加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()

  await window.getByRole('button', { name: '内容框架' }).first().click()
  await window.getByText('先把文章想清楚，再开始写。').waitFor()
  await window.getByLabel('补充主题（未选选题时必填）').fill('AI 创作者为什么需要内容框架')
  await window.getByRole('button', { name: '生成内容框架' }).click()
  await window.getByText('已生成 3 个可编辑框架').waitFor({ timeout: 30_000 })
  await window.getByText('先有框架，创作才有方向').first().waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'framework-generation.png'), fullPage: false, animations: 'disabled' })

  const card = window.locator('.framework-card').first()
  await card.getByTitle('锁定').click()
  await window.getByText('已锁定框架版本').waitFor()
  await card.getByTitle('编辑').click()
  await window.getByText('打磨内容框架').waitFor()
  await window.locator('.framework-editor-dialog textarea').first().fill('编辑后的框架标题')
  await window.getByRole('button', { name: '保存新版本' }).click()
  await window.getByText('已保存为框架新版本').waitFor()
  console.log('Framework smoke test passed: template generation, lock, and version persistence')
} finally {
  await application.close()
  await new Promise((resolve) => server.close(resolve))
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const frameworkRow = database.prepare(`
  SELECT f.status, COUNT(v.id) AS version_count FROM frameworks f
  JOIN framework_versions v ON v.framework_id = f.id GROUP BY f.id
  ORDER BY version_count DESC LIMIT 1
`).get()
database.close()
if (frameworkRow?.status !== 'locked' || frameworkRow.version_count < 2) {
  throw new Error('Framework lock or version history was not persisted')
}
const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
await rm(userDataDir, { recursive: true, force: true })
