import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  if (req.method === 'POST' && req.url === '/search') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ResponseMetadata: { RequestId: 'wizard-search' }, Result: { LogId: 'log', WebResults: [{ Id: '1', Title: ' wizard ', Url: 'https://example.com', SiteName: '示例', Summary: '摘要', Snippet: '摘要', PublishTime: '2026-11-26', RankScore: 1, AuthInfoDes: '正常', Content: '' }] } }))
    return
  }
  if (req.method === 'POST' && req.url === '/v1/images/generations') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
    return
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const root = await mkdtemp(join(tmpdir(), 'moliu-provider-wizard-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) => console.error('renderer:error:', error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
  if (await guide.isVisible().catch(() => false)) await guide.click()
  await page.getByRole('button', { name: 'AI 服务', exact: true }).click()
  await page.getByRole('button', { name: '场景式配置' }).click()
  const wizard = page.locator('.provider-wizard')
  await wizard.getByRole('heading', { name: '场景式配置向导' }).waitFor()
  await wizard.getByRole('button', { name: /^完整创作/ }).click()
  await wizard.getByRole('button', { name: '下一步' }).click()

  await wizard.getByLabel('接口地址').fill(`http://127.0.0.1:${port}/v1`)
  await wizard.getByLabel('API Key').fill('wizard-text-key')
  await wizard.getByRole('button', { name: '下一步' }).click()

  await wizard.getByLabel('接口地址').fill(`http://127.0.0.1:${port}/search`)
  await wizard.getByLabel('API Key').fill('wizard-search-key')
  await wizard.getByRole('button', { name: '下一步' }).click()

  await wizard.getByLabel('接口地址').fill(`http://127.0.0.1:${port}/v1`)
  await wizard.getByLabel('API Key').fill('wizard-image-key')
  await wizard.getByRole('button', { name: '下一步' }).click()

  await wizard.getByRole('button', { name: '测试并保存全部' }).click()
  await page.getByText('场景式配置完成，所需模型已测试并加密保存').waitFor({ timeout: 90_000 })
  const providers = await page.evaluate(async () => (await window.moliu.providers.list()).map((provider) => ({ name: provider.displayName, kinds: provider.models.map((model) => model.kind) })))
  if (providers.length !== 3) throw new Error(`向导应保存 3 个供应商，实际 ${providers.length}`)
  await capture(page, { path: resolve('artifacts/journey-2026-11-26/provider-wizard.png'), animations: 'disabled' })
  console.log('Provider wizard smoke passed:', JSON.stringify(providers))
} finally {
  await app.close().catch(() => {})
  await new Promise((done) => server.close(done))
  if (!root.startsWith(join(tmpdir(), 'moliu-provider-wizard-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
