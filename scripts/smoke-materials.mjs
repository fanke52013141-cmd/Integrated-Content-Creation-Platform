import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

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
  // F17：搜索能力单独分层在「素材搜索」视图里
  await window.getByRole('button', { name: '素材搜索' }).click()
  const searchPanel = window.locator('.search-service-panel')
  await searchPanel.scrollIntoViewIfNeeded()
  await searchPanel.getByLabel(/访问密钥/).fill('material-smoke-key')
  await searchPanel.getByRole('button', { name: '加密保存' }).click()
  await window.getByText('豆包搜索密钥已加密保存').waitFor()

  await window.getByRole('button', { name: '素材库' }).first().click()
  await window.getByRole('heading', { name: '素材库' }).waitFor()
  await window.getByRole('button', { name: '搜索素材' }).waitFor()
  await window.getByPlaceholder('输入一个主题、人物、案例或事实关键词').fill('AI Agent 工作流')
  await window.getByRole('button', { name: '开始搜索' }).click()
  await window.getByText('AI Agent 在企业工作流中的实践').waitFor()
  await window.getByRole('button', { name: '加入素材' }).click()
  await window.getByRole('button', { name: '已入库' }).first().waitFor()

  await window.getByRole('button', { name: '图片' }).click()
  await window.getByPlaceholder('输入一个图片参考关键词').fill('科技办公桌')
  await window.getByRole('button', { name: '开始搜索' }).click()
  await window.getByText('AI 工作流插图参考').waitFor()
  await window.locator('.image-material-result').getByRole('button', { name: '保存参考' }).first().click()
  await window.locator('.image-material-result').getByRole('button', { name: '已入库' }).first().waitFor()
  await capture(window, { path: resolve(artifactDir, 'material-search.png'), fullPage: false, animations: 'disabled' })

  await window.getByRole('button', { name: '添加文字素材' }).click()
  const dialog = window.locator('.manual-material-dialog')
  await dialog.getByLabel('标题').fill('访谈摘录')
  await dialog.getByLabel('摘要 / 摘录').fill('创作者应该先定义问题，再让 AI 帮助整理材料。')
  await dialog.getByLabel('来源说明（可选）').fill('个人访谈整理')
  await dialog.getByRole('button', { name: '加入素材库' }).click()
  await window.getByText('文字素材已加入可复用集合').waitFor()
  await window.getByRole('button', { name: /我的素材/ }).click()
  await window.getByText('访谈摘录').waitFor()
  await capture(window, { path: resolve(artifactDir, 'material-collection.png'), fullPage: false, animations: 'disabled' })

  // F17：素材堆到十几条时，写作处仍要能搜到并勾上第 11 条
  await window.evaluate(async () => {
    for (let index = 4; index <= 13; index += 1) {
      await window.moliu.materials.addManual({ title: `长列表素材 ${String(index).padStart(2, '0')}`, summary: `第 ${index} 条素材，用于验证长列表可检索。` })
    }
  })
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.getByRole('button', { name: '开始写作' }).click()
  const picker = window.locator('.material-picker')
  const pickerSearch = picker.locator('input[name="materialPickerQuery"]')
  await pickerSearch.waitFor()
  if (await picker.locator('.material-picker-list label').count() <= 8) throw new Error('素材选择器没有展示全量素材')
  await pickerSearch.fill('长列表素材 11')
  if (await picker.locator('.material-picker-list label').count() !== 1) throw new Error('素材搜索没有收窄到 1 条')
  await picker.locator('.material-picker-list label').first().getByRole('checkbox').check()
  await picker.getByText('引用素材（已选 1）').waitFor()
  await pickerSearch.fill('')
  if (!(await picker.locator('.material-picker-list label').first().innerText()).includes('长列表素材 11')) throw new Error('已选素材没有置顶，长列表仍会选不到')
  await capture(window, { path: resolve(artifactDir, 'material-picker-long-list.png'), fullPage: false, animations: 'disabled' })

  // §10 任务 1 / F08：写到一半去素材库补两条素材再回来，手动框架和勾选都必须还在
  async function pickByTitle(title) {
    await pickerSearch.fill(title)
    const row = picker.locator('.material-picker-list label').filter({ hasText: title })
    if (await row.count() !== 1) throw new Error(`素材「${title}」搜不到唯一一条`)
    await row.first().getByRole('checkbox').check()
    await pickerSearch.fill('')
  }
  const OUTLINE = '开场：创作者卡在选题，不是不会写\n中段：三条可复用的判断'
  const outlineField = window.locator('textarea[name="manualOutline"]')
  await outlineField.fill(OUTLINE)
  await pickByTitle('访谈摘录')
  await pickByTitle('长列表素材 06')
  await picker.getByText('引用素材（已选 3）').waitFor()

  await window.getByRole('button', { name: '素材库', exact: true }).click()
  for (const title of ['中途补的素材甲', '中途补的素材乙']) {
    await window.getByRole('button', { name: '添加文字素材' }).click()
    const dialog = window.locator('.manual-material-dialog')
    await dialog.getByLabel('标题').fill(title)
    await dialog.getByLabel('摘要 / 摘录').fill(`${title}：用于验证跨页保留勾选。`)
    await dialog.getByRole('button', { name: '加入素材库' }).click()
    await window.getByText(title).first().waitFor()
  }

  await window.getByRole('button', { name: '文章创作', exact: true }).click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.getByRole('button', { name: '开始写作' }).click()
  if (await outlineField.inputValue() !== OUTLINE) throw new Error('去素材库转一圈，手动框架丢了')
  await picker.getByText('引用素材（已选 3）').waitFor()
  for (const title of ['访谈摘录', '长列表素材 06']) {
    await pickerSearch.fill(title)
    const box = picker.locator('.material-picker-list label').filter({ hasText: title }).first().getByRole('checkbox')
    if (!(await box.isChecked())) throw new Error(`回到文章页后「${title}」的勾选没有保持`)
    await pickerSearch.fill('')
  }
  await capture(window, { path: resolve(artifactDir, 'material-selection-preserved.png'), fullPage: false, animations: 'disabled' })

  // 勾选可以跨页保留，但被删掉的素材必须自动从勾选里剔除，否则点生成会整批报「部分素材不存在」
  await window.evaluate(async () => {
    const list = await window.moliu.materials.list()
    await window.moliu.materials.remove(list.find((material) => material.title === '访谈摘录').id)
  })
  await window.getByRole('button', { name: '素材库', exact: true }).click()
  await window.getByRole('button', { name: '文章创作', exact: true }).click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.getByRole('button', { name: '开始写作' }).click()
  await picker.getByText('引用素材（已选 2）').waitFor()
  console.log('Material smoke test passed: encrypted search service, web/image snapshot and manual text import, long-list search, selection kept across a trip to the library, deleted material dropped from the selection')
} finally {
  await application.close()
  await new Promise((resolve) => server.close(resolve))
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const materialRows = database.prepare('SELECT kind, title, summary FROM materials ORDER BY created_at ASC').all()
const secretRow = database.prepare('SELECT encrypted_key FROM search_service_secrets WHERE service_id = ?').get('doubao-custom')
database.close()
if (materialRows.length !== 14
  || materialRows.some((row) => row.title === '访谈摘录')
  || !['中途补的素材甲', '中途补的素材乙'].every((title) => materialRows.some((row) => row.title === title))
  || JSON.stringify(materialRows).includes('这段全文不得进入素材库。') || !secretRow) {
  throw new Error('Material snapshots or encrypted search key were not persisted as expected')
}

const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
await rm(userDataDir, { recursive: true, force: true })
