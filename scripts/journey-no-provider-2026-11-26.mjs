import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const OUT = resolve('artifacts/journey-2026-11-26')
await mkdir(OUT, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'moliu-no-provider-2026-11-26-'))
const report = { startedAt: new Date().toISOString(), checks: {}, errors: [] }
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
const page = await app.firstWindow()
page.setDefaultTimeout(20_000)
page.on('pageerror', (error) => report.errors.push(error.message))
await page.waitForLoadState('domcontentloaded')
await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
if (await guide.isVisible().catch(() => false)) await guide.click()
async function nav(name) { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(250) }
async function shot(name) { await capture(page, { path: join(OUT, name), animations: 'disabled' }) }
try {
  report.checks.home = await page.locator('.page').innerText()
  await nav('AI 服务')
  report.checks.providersEmpty = await page.getByText('暂无供应商').isVisible().catch(() => false)

  await nav('账号定位')
  await page.getByRole('button', { name: '新建账号' }).first().click()
  for (let i = 0; i < 7; i += 1) await page.getByRole('button', { name: '跳过这一问' }).click()
  await page.getByRole('button', { name: '手动填写字段' }).click()
  await page.getByLabel('账号名称内容').fill('手动降级账号')
  await page.getByLabel('目标受众内容').fill('需要手动创作的读者')
  await page.getByLabel('写作风格内容').fill('简洁、克制')
  await page.getByRole('button', { name: '保存为草稿' }).click()
  await page.getByText('草稿已保存').waitFor()
  report.checks.manualAccountSaved = true
  await shot('no-provider-account-manual.png')

  await nav('热点洞察')
  await page.getByRole('button', { name: '手动添加' }).click()
  await page.locator('input[name="manualHotTitle"]').fill('手动热点降级验证')
  await page.getByRole('button', { name: '加入收藏' }).click()
  await page.getByText('已收藏 1 条热点').waitFor()
  report.checks.manualHotspotSaved = true

  await nav('选题生成')
  const topicGenerate = page.getByRole('button', { name: /生成.*选题/ }).first()
  report.checks.topic = { disabled: await topicGenerate.isDisabled(), title: await topicGenerate.getAttribute('title'), text: (await page.locator('.page').innerText()).slice(0, 500) }

  await nav('内容框架')
  const frameworkGenerate = page.getByRole('button', { name: '生成框架' }).first()
  report.checks.framework = { disabled: await frameworkGenerate.isDisabled(), title: await frameworkGenerate.getAttribute('title'), text: (await page.locator('.page').innerText()).slice(0, 500) }

  await nav('素材库')
  const search = page.getByRole('button', { name: '开始搜索' }).first()
  report.checks.materials = { disabled: await search.isDisabled().catch(() => null), text: (await page.locator('.page').innerText()).slice(0, 700) }

  await nav('文章创作')
  await page.getByRole('button', { name: /开始写作|新建草稿/ }).first().click()
  const articleGenerate = page.getByRole('button', { name: '生成草稿' }).first()
  report.checks.article = { disabled: await articleGenerate.isDisabled(), title: await articleGenerate.getAttribute('title'), text: (await page.locator('.article-composer-dialog').innerText()).slice(0, 700) }
  await shot('no-provider-article-composer.png')
  await page.getByRole('button', { name: '取消', exact: true }).click()

  await nav('智能配图')
  report.checks.visuals = (await page.locator('.page').innerText()).slice(0, 500)
  await nav('文章排版')
  report.checks.layouts = (await page.locator('.page').innerText()).slice(0, 500)

  report.finishedAt = new Date().toISOString()
  report.ok = report.errors.length === 0
  await writeFile(join(OUT, 'no-provider-report.json'), JSON.stringify(report, null, 2))
  console.log('NO_PROVIDER_SUMMARY', JSON.stringify(report, null, 2))
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-no-provider-2026-11-26-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
