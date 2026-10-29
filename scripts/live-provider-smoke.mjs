import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { electron } from './lib/electron-test.mjs'

const apiKey = process.env.MOLIU_LIVE_API_KEY
const baseUrl = process.env.MOLIU_LIVE_BASE_URL
const model = process.env.MOLIU_LIVE_MODEL || 'gpt-5.4-mini'

if (!apiKey || !baseUrl) {
  throw new Error('MOLIU_LIVE_API_KEY and MOLIU_LIVE_BASE_URL are required')
}

const executablePath = process.env.MOLIU_EXECUTABLE
  ? resolve(process.env.MOLIU_EXECUTABLE)
  : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-live-provider-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })

const application = await electron.launch({
  executablePath,
  args: applicationArgs,
  env: {
    ...process.env,
    MOLIU_USER_DATA_DIR: userDataDir
  }
})

try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByText('需要 AI 写作时，连接文本模型').waitFor()

  await window.getByRole('button', { name: 'AI 服务' }).first().click()
  await window.getByRole('button', { name: '空白配置' }).click()
  const connectionInputs = window.locator('.provider-editor .form-grid input')
  await connectionInputs.nth(0).fill('真实联调中转站')
  await connectionInputs.nth(1).fill(baseUrl)
  await connectionInputs.nth(2).fill(apiKey)
  const modelInputs = window.locator('.provider-editor .model-primary-fields input')
  await modelInputs.nth(0).fill('联调模型')
  await modelInputs.nth(1).fill(model)
  await window.getByRole('button', { name: '添加模型' }).click()
  await modelInputs.nth(2).fill('备用推理模型')
  await modelInputs.nth(3).fill('gpt-5.2')
  await window.getByRole('button', { name: '加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()

  const providerCard = window.locator('.provider-card').filter({ hasText: '真实联调中转站' })
  await providerCard.getByText('2 个模型').waitFor()
  await window.screenshot({ path: resolve(artifactDir, 'live-provider-multi-model.png') })
  await providerCard.locator('button[title="测试连接"]').click()
  await providerCard.getByText(/连接成功/).waitFor({ timeout: 90_000 })

  await window.getByRole('button', { name: '账号定位' }).click()
  await window.getByRole('button', { name: '新建账号' }).first().click()

  // 现行向导：第 1 问是整句想法，其余 6 问可留空跳过，全部答完出现「生成账号定位」汇总
  const idea = window.getByPlaceholder('在这里写下你的想法…')
  await idea.waitFor({ timeout: 15_000 })
  await idea.fill('量子观察者：人工智能与前沿科技科普，写给没有专业背景的职场人，清晰克制、善用生活化类比')
  await window.getByRole('button', { name: '保存并继续' }).click()
  let skipped = 0
  while (skipped < 8 && await window.getByRole('button', { name: '跳过这一问' }).count()) {
    await window.getByRole('button', { name: '跳过这一问' }).click()
    skipped += 1
    await window.waitForTimeout(200)
  }
  if (skipped !== 6) throw new Error(`Expected to skip 6 wizard questions, skipped ${skipped}`)

  await window.getByRole('button', { name: '生成账号定位' }).waitFor({ timeout: 15_000 })
  // 生成模型是自定义 Select：展开后应同时看到两个已配置模型（外加「请选择模型」占位项），并选中主联调模型
  await window.getByRole('button', { name: '生成模型' }).click()
  const modelOptions = window.getByRole('option')
  const configuredModelOptions = modelOptions.filter({ hasText: '联调模型' })
  if (await configuredModelOptions.count() !== 1) {
    throw new Error(`Expected the primary live model in the generator, got ${await configuredModelOptions.count()}`)
  }
  await configuredModelOptions.first().click()
  await window.getByRole('button', { name: '生成账号定位' }).click()
  await window.locator('.wizard-actions-panel').waitFor({ timeout: 240_000 })

  const generatedFields = window.locator('.generated-field')
  const fieldCount = await generatedFields.count()
  if (fieldCount !== 8) {
    throw new Error(`Expected 8 generated fields, received ${fieldCount}`)
  }
  for (let index = 0; index < fieldCount; index += 1) {
    const value = await generatedFields.nth(index).locator('textarea').inputValue()
    if (!value.trim()) throw new Error(`Generated field ${index + 1} is empty`)
  }

  await window.screenshot({ path: resolve(artifactDir, 'live-account-generation.png') })
  await window.getByRole('button', { name: '保存并锁定' }).click()
  await window.getByRole('button', { name: '解锁编辑' }).waitFor()

  await window.getByRole('button', { name: '热点洞察' }).click()
  await window.locator('.hot-item-list').first().waitFor({ timeout: 90_000 })
  await window.getByRole('button', { name: '智能筛选', exact: true }).first().click()
  const filterDialog = window.locator('.hotspot-filter-dialog')
  await filterDialog.waitFor()
  await filterDialog.locator('input[type="number"]').fill('10')
  const sourceCheckboxes = filterDialog.locator('.filter-source-options input[type="checkbox"]')
  let keptSource = false
  for (let index = 0; index < await sourceCheckboxes.count(); index += 1) {
    const checkbox = sourceCheckboxes.nth(index)
    if (await checkbox.isChecked()) {
      if (!keptSource) keptSource = true
      else await checkbox.uncheck()
    }
  }
  await filterDialog.getByRole('button', { name: '开始筛选' }).click()
  await window.getByText('筛选结果 · 待人工采纳').waitFor({ timeout: 240_000 })

  const assessmentRows = window.locator('.filter-assessment-row')
  const assessmentCount = await assessmentRows.count()
  if (!assessmentCount) throw new Error('Live hotspot filter returned no assessments')
  const firstAssessment = assessmentRows.first()
  await firstAssessment.getByRole('button', { name: '采纳', exact: true }).click()
  await firstAssessment.getByRole('button', { name: '已采纳', exact: true }).waitFor()
  await window.screenshot({
    path: resolve(artifactDir, 'live-hotspot-filter.png'),
    animations: 'disabled',
    timeout: 90_000
  })

  console.log(`Live provider and hotspot filter smoke passed with model ${model}: ${assessmentCount} assessments`)
} catch (error) {
  const windows = application.windows()
  if (windows[0]) {
    try {
      await windows[0].screenshot({
        path: resolve(artifactDir, 'live-provider-failure.png'),
        animations: 'disabled',
        timeout: 15_000
      })
    } catch (screenshotError) {
      console.error(`failure:screenshot: ${screenshotError.message}`)
    }
    console.error(`renderer:body: ${(await windows[0].locator('body').innerText()).slice(0, 1_500)}`)
  }
  throw error
} finally {
  await application.close()
}

const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const secretRow = database.prepare('SELECT encrypted_key FROM provider_secrets LIMIT 1').get()
const accountRow = database.prepare('SELECT status FROM account_profiles LIMIT 1').get()
const modelRow = database.prepare('SELECT COUNT(*) AS model_count FROM provider_models').get()
const favoriteRow = database.prepare('SELECT COUNT(*) AS favorite_count FROM hot_favorites').get()
database.close()

if (!secretRow || Buffer.from(secretRow.encrypted_key).toString('utf8').includes(apiKey)) {
  throw new Error('Live API Key was not encrypted at rest')
}
if (accountRow?.status !== 'locked') {
  throw new Error('Generated account was not persisted as locked')
}
if (modelRow?.model_count !== 2) {
  throw new Error('Expected two provider models to persist under one connection')
}
if (favoriteRow?.favorite_count !== 1) {
  throw new Error('Adopted hotspot was not persisted as a locked favorite')
}

const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) {
  throw new Error('Refusing to clean an unexpected smoke-test directory')
}
await rm(userDataDir, { recursive: true, force: true })
