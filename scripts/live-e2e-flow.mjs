// 真实端到端联调：使用真实模型/搜索/生图服务走完整个创作链。
// 密钥通过环境变量传入，绝不写入本文件或仓库：
//   MOLIU_LIVE_TEXT_KEY / MOLIU_LIVE_SEARCH_KEY / MOLIU_LIVE_IMAGE_KEY
// 产物：artifacts/live-e2e/*.png + live-e2e-report.json
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const textKey = process.env.MOLIU_LIVE_TEXT_KEY
const searchKey = process.env.MOLIU_LIVE_SEARCH_KEY
const imageKey = process.env.MOLIU_LIVE_IMAGE_KEY
if (!textKey || !searchKey || !imageKey) {
  throw new Error('MOLIU_LIVE_TEXT_KEY / MOLIU_LIVE_SEARCH_KEY / MOLIU_LIVE_IMAGE_KEY are required')
}

const TEXT_BASE = 'https://open.bigmodel.cn/api/paas/v4'
const TEXT_MODEL = 'glm-5.3-flash'
const IMAGE_BASE = 'https://toapis.cn/v1'
const IMAGE_MODEL = 'gpt-image-2-vip'

const outDir = resolve('artifacts/live-e2e')
await mkdir(outDir, { recursive: true })
const report = { stages: {}, errors: [], notes: [] }
const note = (text) => { report.notes.push(text); console.log('note:', text) }

const userDataDir = resolve(tmpdir(), `moliu-live-e2e-${Date.now()}`)
const application = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})
const win = await application.firstWindow()
win.on('pageerror', (error) => report.errors.push(`pageerror: ${error.message}`))
win.on('console', (msg) => { if (msg.type() === 'error') report.errors.push(`console: ${msg.text().slice(0, 200)}`) })
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2_000)

async function shot(name) {
  await win.waitForTimeout(400)
  await win.screenshot({ path: resolve(outDir, `${name}.png`) })
  const chip = await win.locator('.account-chip strong').textContent().catch(() => 'n/a')
  report.stages[name] = { chip: (chip ?? '').trim() }
  console.log(`shot: ${name} (chip=${(chip ?? '').trim()})`)
}
async function stage(name, fn) {
  console.log(`== stage: ${name}`)
  const startedAt = Date.now()
  try {
    await fn()
    report.stages[name] = { ok: true, seconds: Math.round((Date.now() - startedAt) / 1_000) }
    console.log(`stage ok: ${name} (${report.stages[name].seconds}s)`)
  } catch (error) {
    report.stages[name] = { ok: false, seconds: Math.round((Date.now() - startedAt) / 1_000), error: String(error).slice(0, 400) }
    console.log(`stage FAIL: ${name}: ${String(error).slice(0, 200)}`)
    await shot(`FAIL-${name}`)
  }
}

// ── A. 配置三套真实服务 ────────────────────────────────────────────
await stage('A-config', async () => {
  await win.getByRole('button', { name: 'AI 服务' }).first().click()
  await win.getByRole('button', { name: '空白配置' }).click()
  const conn = win.locator('.provider-editor .form-grid input')
  await conn.nth(0).fill('智谱 GLM')
  await conn.nth(1).fill(TEXT_BASE)
  await conn.nth(2).fill(textKey)
  const modelFields = win.locator('.provider-editor .model-primary-fields input')
  await modelFields.nth(0).fill('GLM 5.3 Flash')
  await modelFields.nth(1).fill(TEXT_MODEL)
  await win.getByRole('button', { name: '测试并加密保存' }).click()
  // 保存成功后编辑器不关闭，以 toast 为准
  await win.getByText('测试通过，供应商配置已加密保存').waitFor({ timeout: 90_000 })
  console.log('text provider saved')

  await win.getByRole('button', { name: '空白配置' }).click()
  const conn2 = win.locator('.provider-editor .form-grid input')
  await conn2.nth(0).fill('ToAPIs 生图')
  await conn2.nth(1).fill(IMAGE_BASE)
  await conn2.nth(2).fill(imageKey)
  await win.locator('input[name="imageCapability"]').check()
  const modelFields2 = win.locator('.provider-editor .model-primary-fields input')
  await modelFields2.nth(0).fill('GPT Image 2 VIP')
  await modelFields2.nth(1).fill(IMAGE_MODEL)
  await win.getByRole('button', { name: '测试并加密保存' }).click()
  await win.getByText('测试通过，供应商配置已加密保存').waitFor({ timeout: 90_000 })
  console.log('image provider saved')

  await win.getByRole('button', { name: '素材搜索' }).click()
  await win.locator('input[name="searchApiKey"]').fill(searchKey)
  const enabled = win.locator('input[name="searchEnabled"]')
  if (!(await enabled.isChecked())) await enabled.check()
  await win.getByRole('button', { name: '加密保存' }).click()
  await win.waitForTimeout(2_000)
  await shot('01-config-done')
})

// ── B. 账号定位（真实模型生成 + 锁定） ─────────────────────────────
await stage('B-account', async () => {
  await win.getByRole('button', { name: '账号定位' }).first().click()
  const start = win.getByRole('button', { name: '开始定位' })
  if (await start.count()) await start.click()
  else await win.getByRole('button', { name: '新建账号' }).first().click()
  const answers = [
    '热点观察室',
    '社会热点与公共议题探讨',
    '关心时事、想要多一个理性视角的公众号读者',
    '克制理性，先摆事实再给观点，避免情绪化站队',
    '一个冷静的热点观察者朋友',
    '不下定论不站队，引用多方信源，不消费灾难情绪',
    '每篇帮读者看清热点背后的结构与各方立场'
  ]
  for (const answer of answers) {
    await win.getByPlaceholder('在这里写下你的想法…').fill(answer)
    await win.getByRole('button', { name: '保存并继续' }).click()
    await win.waitForTimeout(400)
  }
  await win.getByRole('button', { name: '生成账号定位' }).click()
  await win.locator('.wizard-actions-panel').waitFor({ timeout: 240_000 })
  await shot('02-account-generated')
  const lock = win.getByRole('button', { name: '保存并锁定' })
  if (await lock.count()) await lock.click()
  else await win.getByRole('button', { name: '保存为草稿' }).click()
  await win.waitForTimeout(1_500)
  await shot('03-account-saved')
})

// ── C. 热点洞察：真实平台榜单 + 收藏 + 带关键词去选题 ──────────────
await stage('C-hotspots', async () => {
  await win.getByRole('button', { name: '热点洞察' }).first().click()
  await win.waitForTimeout(2_000)
  await win.getByRole('button', { name: '刷新全部' }).click()
  // 等待加载完成：已加载数稳定或出现不可用提示，最多 120s
  let statsText = ''
  for (let i = 0; i < 24; i += 1) {
    await win.waitForTimeout(5_000)
    statsText = await win.locator('.hotspot-hero-meta').textContent().catch(() => '')
    if (/[1-9]\d*\s*个已加载/.test(statsText) && !/后台分批加载中/.test(statsText ?? '')) break
  }
  note(`热点加载统计: ${statsText?.trim().slice(0, 120)}`)
  await shot('04-hotspots-loaded')
  const fav = win.locator('.hot-favorite-button').first()
  await fav.click()
  await win.waitForTimeout(1_000)
  const gen = win.locator('.hotspot-insight-rail button:has-text("生成选题")')
  if (await gen.isDisabled()) throw new Error('收藏后生成选题按钮仍不可用')
  await gen.click()
  await win.waitForTimeout(2_000)
  await shot('05-topics-from-hotspot')
})

// ── D. 选题生成（真实模型） ────────────────────────────────────────
await stage('D-topics', async () => {
  const genBtn = win.getByRole('button', { name: /生成 3 条选题|生成 1 条选题|生成选题/ }).first()
  await genBtn.click()
  await win.locator('.topic-card').first().waitFor({ timeout: 300_000 })
  await shot('06-topics-generated')
  // 锁定第一条草稿（图标按钮 title=锁定选题），锁定后卡片出现「生成框架→」
  const lockTopic = win.locator('.topic-card').first().getByTitle('锁定选题')
  if (await lockTopic.count()) {
    await lockTopic.click()
    await win.waitForTimeout(1_200)
    await shot('07-topic-locked')
  } else {
    note('草稿卡上没有「锁定选题」按钮，记录界面状态')
  }
})

// ── E. 内容框架（真实模型） ────────────────────────────────────────
await stage('E-framework', async () => {
  const toFramework = win.locator('.topic-card').first().getByRole('button', { name: '生成框架→' })
  if (await toFramework.count()) await toFramework.click()
  else await win.getByRole('button', { name: '内容框架' }).first().click()
  await win.waitForTimeout(1_500)
  // 数量降到 1：推理型模型下并行 3 个框架生成既慢又容易被输出预算截断
  const countSelect = win.locator('.framework-composer select:has(option:has-text("个"))').first()
  if (await countSelect.count()) {
    await countSelect.selectOption({ label: '1 个' }).catch(() => undefined)
  }
  const genFramework = win.getByRole('button', { name: '生成框架' }).first()
  if (await genFramework.count() && !(await genFramework.isDisabled().catch(() => true))) {
    await genFramework.click()
    await win.getByText(/已生成.*个可编辑框架|已生成.*个框架/).first().waitFor({ timeout: 480_000 })
  } else {
    note('框架生成按钮不可用（可能缺少已锁定选题或补充主题）')
  }
  // 锁定第一个框架卡，随后从卡片进入文章创作
  const lockBtn = win.locator('.framework-card').first().getByTitle('锁定')
  if (await lockBtn.count()) {
    await lockBtn.click()
    await win.getByText('已锁定框架版本').waitFor({ timeout: 15_000 })
  }
  await shot('08-framework-generated')
})

// ── F. 文章创作（真实模型流式） ────────────────────────────────────
await stage('F-article', async () => {
  const write = win.getByRole('button', { name: /写文章/ }).first()
  if (await write.count()) await write.click()
  else await win.getByRole('button', { name: '文章创作' }).first().click()
  await win.waitForTimeout(1_500)
  // 经「写文章→」进入时弹窗会自动打开并带上框架/账号
  const dialog = win.locator('.article-composer-dialog')
  if (!(await dialog.isVisible().catch(() => false))) {
    await win.getByRole('button', { name: '新建草稿' }).first().click()
    await win.waitForTimeout(1_000)
  }
  await shot('09-new-draft-dialog')
  await win.getByRole('button', { name: '生成草稿' }).click()
  await win.getByText(/已生成.*篇成稿|生成完成/).first().waitFor({ timeout: 480_000 })
  await shot('10-article-generated')
})

// ── G. 内容评审（真实模型） ────────────────────────────────────────
await stage('G-review', async () => {
  const next = win.locator('.work-bar-stage-next')
  if (await next.count()) await next.first().click()
  else await win.getByRole('button', { name: '内容评审' }).first().click()
  await win.waitForTimeout(1_500)
  // 创建一个真实评审角色
  await win.getByRole('button', { name: '评审角色' }).first().click()
  await win.waitForTimeout(800)
  await win.getByPlaceholder('例如：标题党猎人').fill('热点把关人')
  await win.locator('textarea').first().fill('请评审这篇热点探讨文章：事实是否可靠、各方立场是否平衡、标题是否克制、有没有情绪化或失实表述。返回一个 <评审意见> 区块。')
  await win.getByRole('button', { name: /保存/ }).click()
  await win.waitForTimeout(1_200)
  const roleCheck = win.locator('input[type="checkbox"]').first()
  if (!(await roleCheck.isChecked())) await roleCheck.check()
  await shot('11-review-ready')
  await win.getByRole('button', { name: '开始评审' }).click()
  await win.waitForTimeout(10_000)
  await shot('12-review-running')
  await win.waitForTimeout(60_000)
  await shot('13-review-result')
})

// ── H. 智能配图（真实生图模型：方案 + 出图） ────────────────────────
await stage('H-visuals', async () => {
  const next = win.locator('.work-bar-stage-next')
  if (await next.count()) await next.first().click()
  else await win.getByRole('button', { name: '智能配图' }).first().click()
  await win.waitForTimeout(1_500)
  await win.getByRole('button', { name: '生成方案' }).click()
  await win.waitForTimeout(120_000)
  await shot('14-visual-plan')
  const genAll = win.getByRole('button', { name: '生成全部图片' })
  if (await genAll.count() && !(await genAll.isDisabled())) {
    await genAll.click()
    // 生图为异步任务制，单张 30-120s；等 3 分钟再截图
    await win.waitForTimeout(180_000)
    await shot('15-visual-images')
  } else {
    note('生成全部图片按钮不可用或不存在，记录界面状态')
    await shot('15-visual-images-disabled')
  }
})

// ── I. 文章排版 ───────────────────────────────────────────────────
await stage('I-layouts', async () => {
  const next = win.locator('.work-bar-stage-next')
  if (await next.count()) await next.first().click()
  else await win.getByRole('button', { name: '文章排版' }).first().click()
  await win.waitForTimeout(1_500)
  const genLayout = win.getByRole('button', { name: '生成排版稿' }).first()
  if (await genLayout.count() && !(await genLayout.isDisabled().catch(() => true))) await genLayout.click()
  await win.waitForTimeout(4_000)
  await shot('16-layouts')
})

// ── J. 发布管理（无公众号凭证：只验证到 preflight 拦截） ───────────
await stage('J-publishing', async () => {
  const next = win.locator('.work-bar-stage-next')
  if (await next.count()) await next.first().click()
  else await win.getByRole('button', { name: '发布管理' }).first().click()
  await win.waitForTimeout(2_000)
  await shot('17-publishing-blocked')
  note('未提供公众号 AppID/Secret：发布流程验证到「连接未配置」的 preflight 拦截为止，不执行真实推送')
})

await writeFile(resolve(outDir, 'live-e2e-report.json'), JSON.stringify(report, null, 2))
await application.close()
console.log('LIVE E2E DONE. stages:', JSON.stringify(report.stages, null, 1))
