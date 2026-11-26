import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const root = await mkdtemp(join(tmpdir(), 'moliu-ux-fixes-'))
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) => console.error('renderer:error:', error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
  if (await guide.isVisible().catch(() => false)) await guide.click()
  await page.evaluate(async () => {
    const account = await window.moliu.accounts.save({ fields: [{ id: crypto.randomUUID(), name: '账号名称', value: '引导验收账号', isDefault: true }], wizardAnswers: [], status: 'locked', source: 'manual' })
    await window.moliu.accounts.setCurrent(account.id)
    await window.moliu.topics.save({ seedKeyword: '锁定选题自动带入', accountIds: [account.id], relatedHotIds: [], status: 'locked', source: 'manual', fields: { '选题主题': '锁定选题自动带入验收' } })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: '账号定位', exact: true }).click()
  await page.locator('.account-card').first().click()
  await page.getByRole('button', { name: '下一步：找热点' }).waitFor()
  await capture(page, { path: resolve('artifacts/journey-2026-11-26/account-next-step.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '下一步：找热点' }).click()
  await page.getByRole('heading', { name: '热点洞察' }).waitFor()
  if (await page.getByRole('button', { name: '去生成选题' }).count()) throw new Error('热点页仍存在重复的去生成选题 CTA')
  await page.getByRole('button', { name: /重试失败平台/ }).waitFor()
  await page.getByRole('button', { name: '手动添加' }).click()
  await page.locator('input[name="manualHotTitle"]').fill('引导验收热点')
  await page.getByRole('button', { name: '加入收藏' }).click()
  await page.getByText('1 条已收藏').waitFor()
  if (await page.getByRole('button', { name: '生成选题', exact: true }).count() !== 1) throw new Error('收藏后应只保留一个生成选题 CTA')

  await page.getByRole('button', { name: '内容框架', exact: true }).click()
  const topicSelect = page.getByLabel('选题', { exact: true })
  await topicSelect.waitFor()
  if (!(await topicSelect.innerText()).includes('锁定选题自动带入验收')) throw new Error('侧栏直接进入框架页未自动选中锁定选题')
  await capture(page, { path: resolve('artifacts/journey-2026-11-26/framework-locked-topic.png'), animations: 'disabled' })
  console.log('UX fixes smoke passed: account next step, hotspot CTA dedupe/retry, locked topic auto-selection')
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-ux-fixes-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
