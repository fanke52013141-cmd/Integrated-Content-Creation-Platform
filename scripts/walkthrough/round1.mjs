// R1：全新用户首启 → 首创引导 → 供应商配置（真实 Key）→ 账号定位向导 + 真实生成
// Key 从环境变量注入（MOLIU_LIVE_API_KEY），禁止写入仓库
import { startApp, userDataPath, waitText } from './lib.mjs'

const KEY = process.env.MOLIU_LIVE_API_KEY ?? ''
if (!KEY) { console.error('请先设置 MOLIU_LIVE_API_KEY'); process.exit(1) }
const BASE_URL = 'https://tokenrhythm.studio/v1'
const MODEL_ID = 'deepseek-v4.1-flash-1017'

const ctx = await startApp({ round: 'round1', userDataDir: userDataPath('round1') })
const { page, shot, nav, step, finish } = ctx

await step('首启：首页渲染 + 首创引导弹出', async () => {
  await page.waitForTimeout(800)
  await shot('home-first-boot')
  await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 8000 })
  await shot('first-creation-guide')
})

await step('引导选「我只有一个想法」（未配置→应去 AI 服务页）', async () => {
  await page.locator('.first-creation-option', { hasText: '我只有一个想法' }).click()
  await page.waitForTimeout(900)
  await shot('providers-empty-state')
})

await step('供应商页：展开服务商预设', async () => {
  await page.locator('.provider-presets summary').click()
  await page.waitForTimeout(400)
  await shot('provider-presets-open')
  await page.locator('.provider-presets summary').click()
})

await step('新建连接：填写 TokenRhythm + DeepSeek 模型', async () => {
  await page.locator('input[name="displayName"]').fill('TokenRhythm 中转')
  await page.locator('input[name="baseUrl"]').fill(BASE_URL)
  await page.locator('input[name="apiKey"]').fill(KEY)
  const card = page.locator('.model-editor-card').first()
  await card.locator('input[name="modelDisplayName"]').fill('DeepSeek V4.1 Flash')
  await card.locator('input[name="modelId"]').fill(MODEL_ID)
  await card.locator('input[name="contextLimit"]').fill('128000')
  await page.waitForTimeout(300)
  await shot('provider-form-filled')
})

await step('测试并加密保存（真实连通性测试）', async () => {
  await page.getByRole('button', { name: '测试并加密保存' }).click()
  await waitText(page, '测试通过', 120_000)
  await page.waitForTimeout(800)
  await shot('provider-saved-verified')
})

await step('供应商卡片状态：应显示「已验证」', async () => {
  await waitText(page, '已验证', 10_000)
})

await step('进入账号定位 → 新建账号向导', async () => {
  await nav('账号定位')
  await shot('accounts-empty')
  await page.getByRole('button', { name: '新建账号' }).first().click()
  await page.waitForTimeout(600)
  await shot('wizard-question-1')
})

const answers = [
  ['量子观察者', null],
  ['科技科普，聚焦 AI 与普通人生活的交叉点', null],
  ['25-40 岁的城市上班族，对 AI 好奇但没时间研究，想用 AI 提效又怕被误导', null],
  ['轻松幽默，讲人话，例子接地气，不端着', null],
  ['一个陪你一起好奇的朋友：帮你试坑，再把结论讲明白', null],
  ['别人追新闻，我负责「这对你意味着什么」；只写亲自验证过的用法', null],
  ['每周 3 条，看完就能上手一个 AI 用法，少踩坑', null]
]

await step('向导 7 问逐题作答', async () => {
  for (let i = 0; i < answers.length; i++) {
    const textarea = page.locator('textarea[name="wizardAnswer"]')
    await textarea.fill(answers[i][0])
    if (i === 1) await shot('wizard-question-2-filled')
    await page.getByRole('button', { name: answers[i][0] ? '保存并继续' : '跳过这一问' }).click()
    await page.waitForTimeout(350)
  }
  await shot('wizard-step8-summary')
})

await step('选择生成模型（下拉）', async () => {
  await page.getByRole('button', { name: '生成模型', exact: true }).click()
  await page.waitForTimeout(400)
  await shot('wizard-model-select-open')
  await page.locator('[role="option"]', { hasText: 'DeepSeek' }).first().click()
  await page.waitForTimeout(300)
})

await step('生成账号定位（真实 AI 调用）', async () => {
  await page.getByRole('button', { name: '生成账号定位' }).click()
  await page.locator('.generated-fields, .wizard-actions-panel').first().waitFor({ state: 'visible', timeout: 240_000 })
  await page.waitForTimeout(1000)
  await shot('account-generated-fields')
})

await step('保存并锁定账号', async () => {
  await page.getByRole('button', { name: '保存并锁定' }).click()
  await waitText(page, '账号已保存并锁定', 20_000)
  await page.waitForTimeout(800)
  await shot('account-saved-locked')
})

await step('回到首页查看就绪状态', async () => {
  await nav('总览')
  await page.waitForTimeout(600)
  await shot('home-after-setup')
})

await finish()
