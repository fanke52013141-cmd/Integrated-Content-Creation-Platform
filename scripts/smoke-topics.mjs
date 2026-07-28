import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const topicPayload = {
  选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎',
  切入角度: '从工具热闹转向具体工作流的业务价值',
  目标读者: '正在尝试把 AI 用进日常工作的职场人',
  核心观点: '决定成败的不是模型能力，而是流程重构',
  情绪基调: '理性、鼓励',
  拟标题方向: '别急着上 AI Agent：先看懂它最容易卡住的三件事',
  备注: ''
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk
  const parsed = JSON.parse(body)
  const isTopic = JSON.stringify(parsed.messages).includes('选题策划助手')
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    model: 'moliu-smoke',
    choices: [{ message: { content: JSON.stringify(isTopic ? topicPayload : { ok: true }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 100 }
  }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Mock model server did not start')

const executablePath = process.env.MOLIU_EXECUTABLE
  ? resolve(process.env.MOLIU_EXECUTABLE)
  : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-topic-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })

const application = await electron.launch({
  executablePath,
  args: applicationArgs,
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})

try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')

  await window.getByRole('button', { name: '模型网关' }).first().click()
  await window.getByRole('button', { name: /空白配置/ }).click()
  await window.getByLabel('显示名称').fill('本地验收模型')
  await window.getByLabel('Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
  await window.locator('.provider-editor').getByLabel(/API Key/).fill('smoke-key')
  await window.getByLabel('显示别名').fill('Smoke Topic Model')
  await window.getByLabel('API 模型 ID').fill('moliu-smoke')
  await window.locator('.provider-editor').getByRole('button', { name: '加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()

  await window.getByRole('button', { name: '账号定位' }).click()
  await window.getByRole('button', { name: /开始定位/ }).click()
  await window.getByPlaceholder('在这里写下你的想法…').fill('选题验收账号')
  await window.getByRole('button', { name: '保存并继续' }).click()
  for (let index = 0; index < 6; index += 1) {
    await window.getByRole('button', { name: '跳过这一问' }).click()
  }
  await window.getByRole('button', { name: '跳过 AI，手动填写字段' }).click()
  await window.getByRole('button', { name: '保存为草稿' }).click()
  await window.getByRole('button', { name: '保存并锁定' }).click()
  await window.getByRole('button', { name: '解锁编辑' }).waitFor()

  await window.getByRole('button', { name: '选题生成' }).first().click()
  await window.getByText('让热点成为你自己的内容方向。').waitFor()
  await window.getByLabel('热点关键词 / 手动主题').fill('AI Agent 工作流落地')
  await window.getByLabel('生成数量').selectOption('2')
  await window.getByRole('button', { name: '生成 2 条选题' }).click()
  await window.getByText('已生成 2 条选题草稿').waitFor({ timeout: 30_000 })
  await window.getByText('AI Agent 真正落地前，先跨过这三道业务坎').first().waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'topic-generation.png'), fullPage: false, animations: 'disabled' })

  const card = window.locator('.topic-card').first()
  await card.getByTitle('加入选题库').click()
  await window.getByText('已加入选题库').waitFor()
  await window.getByRole('button', { name: /我的选题库/ }).click()
  const libraryCard = window.locator('.topic-card').first()
  await libraryCard.getByTitle('锁定选题').click()
  await window.getByText('已锁定为创作基线').waitFor()
  await libraryCard.locator('[title="编辑"]').click()
  await window.getByText('打磨选题草稿').waitFor()
  await window.locator('.topic-editor-dialog textarea').first().fill('编辑后的 AI Agent 选题主题')
  await window.getByRole('button', { name: '保存新版本' }).click()
  await window.getByText('选题已保存为新版本').waitFor()

  await window.getByRole('button', { name: /配置选题字段/ }).click()
  await window.getByRole('button', { name: '添加字段' }).click()
  const schemaDialog = window.locator('.topic-schema-dialog')
  await schemaDialog.locator('.topic-schema-row').last().locator('input').first().fill('系列栏目')
  await schemaDialog.getByRole('button', { name: '保存字段' }).click()
  await window.getByText('新字段已成为后续生成的全局默认').waitFor()
  console.log('Topic smoke test passed: batch generation, versions, library, lock, schema persistence')
} finally {
  await application.close()
  await new Promise((resolve) => server.close(resolve))
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const topicRow = database.prepare(`
  SELECT t.status, COUNT(v.id) AS version_count, EXISTS(SELECT 1 FROM topic_library l WHERE l.topic_id = t.id) AS in_library
  FROM topics t JOIN topic_versions v ON v.topic_id = t.id
  GROUP BY t.id ORDER BY version_count DESC LIMIT 1
`).get()
const schemaRow = database.prepare("SELECT name FROM topic_schema_fields WHERE name = '系列栏目'").get()
database.close()
if (topicRow?.status !== 'locked' || topicRow.version_count < 2 || topicRow.in_library !== 1 || !schemaRow) {
  throw new Error('Topic state, version history, library, or schema was not persisted')
}

const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
await rm(userDataDir, { recursive: true, force: true })
