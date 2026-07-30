import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts')
await mkdir(artifactDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-electron-smoke-${Date.now()}`)
const executablePath = process.env.MOLIU_EXECUTABLE
  ? resolve(process.env.MOLIU_EXECUTABLE)
  : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']

async function launchApplication() {
  return electron.launch({
    executablePath,
    args: applicationArgs,
    env: {
      ...process.env,
      MOLIU_USER_DATA_DIR: userDataDir
    }
  })
}

let application = await launchApplication()

try {
  const window = await application.firstWindow()
  window.on('console', (message) => console.log(`renderer:${message.type()}: ${message.text()}`))
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1_000)
  console.log(`renderer:url: ${window.url()}`)
  console.log(`renderer:body: ${(await window.locator('body').innerText()).slice(0, 500)}`)
  await window.screenshot({ path: resolve(artifactDir, 'smoke-debug.png') })
  await window.getByRole('heading', { name: '开始创作' }).waitFor({ timeout: 10_000 })
  await window.screenshot({ path: resolve(artifactDir, 'dashboard.png') })

  await window.getByRole('button', { name: '模型网关' }).first().click()
  await window.getByRole('heading', { name: '服务配置' }).waitFor()
  await window.getByRole('button', { name: 'DeepSeek' }).click()
  await window.locator('.provider-editor').locator('input[type="password"]').fill('sk-smoke-secret')
  await window.locator('.provider-editor').getByRole('button', { name: '加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()

  await window.getByRole('button', { name: '账号定位' }).click()
  await window.getByRole('heading', { name: '账号定位' }).waitFor()
  await window.getByRole('button', { name: '开始定位' }).click()
  await window.getByText('建立账号基线').waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'account-wizard.png') })

  await window.getByPlaceholder('在这里写下你的想法…').fill('心流验收号')
  await window.getByRole('button', { name: '保存并继续' }).click()
  for (let index = 0; index < 6; index += 1) {
    await window.getByRole('button', { name: '跳过这一问' }).click()
  }
  await window.getByRole('button', { name: '手动填写字段' }).click()
  await window.getByRole('button', { name: '保存为草稿' }).click()
  await window.getByRole('heading', { name: '心流验收号' }).waitFor()
  await window.getByRole('button', { name: '保存并锁定' }).click()
  await window.getByRole('button', { name: '解锁编辑' }).waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'account-locked.png') })
} finally {
  await application.close()
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const secretRow = database.prepare('SELECT encrypted_key FROM provider_secrets LIMIT 1').get()
database.close()
if (!secretRow || Buffer.from(secretRow.encrypted_key).toString('utf8').includes('sk-smoke-secret')) {
  throw new Error('Encrypted provider secret verification failed')
}

application = await launchApplication()
try {
  const window = await application.firstWindow()
  await window.getByText('心流验收号').first().waitFor()
  console.log('Electron smoke test passed: account persisted after restart')
} finally {
  await application.close()
}
