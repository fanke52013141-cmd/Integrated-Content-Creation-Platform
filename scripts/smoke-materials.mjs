import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/reference.jpg') {
    response.writeHead(204).end()
    return
  }
  if (request.method !== 'POST' || request.url !== '/search') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk
  const payload = JSON.parse(body)
  response.setHeader('Content-Type', 'application/json')
  if (payload.SearchType === 'image') {
    response.end(JSON.stringify({
      ResponseMetadata: { RequestId: 'image-request' },
      Result: { LogId: 'image-log', ImageResults: [{
        Id: 'image-1', Title: 'AI 工作流插图参考', Url: 'https://example.com/image-source', SiteName: '素材示例站',
        Image: { Url: `http://127.0.0.1:${server.address().port}/reference.jpg`, Width: 1200, Height: 800, Shape: '横长方形', Watermark: '1' }
      }] }
    }))
    return
  }
  response.end(JSON.stringify({
    ResponseMetadata: { RequestId: 'web-request' },
    Result: { LogId: 'web-log', WebResults: [{
      Id: 'web-1', Title: 'AI Agent 在企业工作流中的实践', Url: 'https://example.com/agent', SiteName: '研究示例站',
      Summary: '企业采用 AI Agent 时，应先梳理业务流程、数据边界与人工复核节点。', Snippet: '短摘要',
      PublishTime: '2026-07-28T00:00:00+08:00', RankScore: 0.91, AuthInfoDes: '正常权威', Content: '这段全文不得进入素材库。'
    }] }
  }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Mock material server did not start')

const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-material-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })

const application = await electron.launch({
  executablePath,
  args: applicationArgs,
  env: {
    ...process.env,
    MOLIU_USER_DATA_DIR: userDataDir,
    MOLIU_DOUBAO_SEARCH_ENDPOINT: `http://127.0.0.1:${address.port}/search`
  }
})

try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '模型网关' }).first().click()
  const searchPanel = window.locator('.search-service-panel')
  await searchPanel.scrollIntoViewIfNeeded()
  await searchPanel.getByLabel(/API Key/).fill('material-smoke-key')
  await searchPanel.getByRole('button', { name: '加密保存' }).click()
  await window.getByText('豆包搜索 API Key 已加密保存').waitFor()

  await window.getByRole('button', { name: '素材库' }).first().click()
  await window.getByText('为创作积累可验证的资料。').waitFor()
  await window.getByPlaceholder('输入一个主题、人物、案例或事实关键词').fill('AI Agent 工作流')
  await window.getByRole('button', { name: '开始搜索' }).click()
  await window.getByText('AI Agent 在企业工作流中的实践').waitFor()
  await window.getByRole('button', { name: '加入素材' }).click()
  await window.getByText('已加入可复用素材集合').waitFor()

  await window.getByRole('button', { name: '图片' }).click()
  await window.getByPlaceholder('输入一个图片参考关键词').fill('科技办公桌')
  await window.getByRole('button', { name: '开始搜索' }).click()
  await window.getByText('AI 工作流插图参考').waitFor()
  await window.getByRole('button', { name: '保存参考' }).click()
  await window.getByText('已加入可复用素材集合').waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'material-search.png'), fullPage: false, animations: 'disabled' })

  await window.getByRole('button', { name: '添加文字素材' }).click()
  const dialog = window.locator('.manual-material-dialog')
  await dialog.getByLabel('标题').fill('访谈摘录')
  await dialog.getByLabel('供 AI 使用的摘要 / 摘录').fill('创作者应该先定义问题，再让 AI 帮助整理材料。')
  await dialog.getByLabel('来源说明（可选）').fill('个人访谈整理')
  await dialog.getByRole('button', { name: '加入素材库' }).click()
  await window.getByText('文字素材已加入可复用集合').waitFor()
  await window.getByRole('button', { name: /我的素材/ }).click()
  await window.getByText('访谈摘录').waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'material-collection.png'), fullPage: false, animations: 'disabled' })
  console.log('Material smoke test passed: encrypted search service, web/image snapshot and manual text import')
} finally {
  await application.close()
  await new Promise((resolve) => server.close(resolve))
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const materialRows = database.prepare('SELECT kind, title, summary FROM materials ORDER BY created_at ASC').all()
const secretRow = database.prepare('SELECT encrypted_key FROM search_service_secrets WHERE service_id = ?').get('doubao-custom')
database.close()
if (materialRows.length !== 3 || !materialRows.some((row) => row.title === '访谈摘录') || JSON.stringify(materialRows).includes('这段全文不得进入素材库。') || !secretRow) {
  throw new Error('Material snapshots or encrypted search key were not persisted as expected')
}

const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
await rm(userDataDir, { recursive: true, force: true })
