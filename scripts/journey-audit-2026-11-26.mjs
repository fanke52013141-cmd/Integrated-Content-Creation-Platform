import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const OUT = resolve('artifacts/journey-2026-11-26')
await mkdir(OUT, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'moliu-journey-2026-11-26-'))
const report = { startedAt: new Date().toISOString(), stages: {}, errors: [], notes: [], calls: {} }
const note = (text) => { report.notes.push(text); console.log('NOTE', text) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

const ACCOUNT = {
  账号名称: '热点观察室', 简介: '用克制、可核查的方式解读社会热点与公共议题。', 领域: '社会热点与公共议题',
  目标受众: '关心时事、希望获得理性视角的公众号读者', 写作风格: '理性克制，先摆事实再给观点，避免情绪化站队',
  IP人设: '冷静的热点观察者朋友', 差异化定位: '多方信源对照，不消费灾难情绪，不急于下结论',
  价值主张: '每篇帮读者看清热点背后的结构与各方立场'
}
const TOPIC = {
  选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎', 切入角度: '用三个失败案例反推落地条件',
  目标读者: '正在把 AI 引入团队的负责人', 核心观点: 'Agent 落地是流程改造，不是工具采购',
  情绪基调: '冷静、反常识', 拟标题方向: '别再急着买工具：AI Agent 落地的三道坎', 备注: '',
  评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: '失败视角比工具罗列更有差异化' }
}
const FRAMEWORK = '<框架><标题>AI Agent 落地前，先跨过这三道业务坎</标题><开头>从一次失败的自动化试点切入。</开头><论点一>先梳理流程，再决定哪些环节交给 Agent。</论点一><论点二>数据边界与权限设计决定它能走多远。</论点二><论点三>人工复核节点必须写进流程，而不是事后补。</论点三><结尾>用一份可执行的试点清单收束。</结尾></框架>'
const ARTICLE = `# AI Agent 落地前，先跨过这三道业务坎

很多团队第一次引入 AI Agent，都是从“买一个更强工具”开始。但真正让试点失败的，往往不是模型不够聪明，而是流程没有准备好。

## 一、先梳理流程，再谈自动化

Agent 擅长在明确规则下完成步骤。如果输入口径、责任人和异常分支都没说清，再强的模型也只会在错误的方向上跑得更快。

先画出当前流程，标出重复劳动、判断节点和人工交接点，再选择边界清晰、结果可验证的环节做试点。

## 二、数据边界决定它能走多远

哪些数据可以读取，哪些操作可以执行，失败后如何回滚，这些不是技术细节，而是业务设计。

最小权限、审计日志和敏感信息脱敏应当从一开始就进入方案，而不是上线前再补。

## 三、把人工复核写进流程

高风险动作不能只靠一句“请模型注意”。复核点、触发条件和接管方式必须成为流程的一部分。

更稳妥的做法是先让 Agent 产出建议，由人确认后再执行。等稳定性数据积累起来，再逐步扩大自动化范围。

## 结语

AI Agent 的价值不在于替团队做所有事，而在于帮助团队重新理解流程。先跨过流程、数据和复核这三道坎，工具投入才可能变成可复用的生产力。`
const VISUAL = '<配图方案><封面><主视觉>一盏台灯照亮复杂流程图</主视觉><封面文案>先跨过三道坎</封面文案><提示词>editorial illustration, warm desk lamp illuminating a complex workflow diagram, clean composition, soft light, ample negative space, no text, no watermark</提示词></封面><文内配图><图><位置>开头后</位置><用途>建立阅读情绪</用途><比例>16:9</比例><提示词>minimal editorial illustration, notebook and lamp, warm light, no text</提示词><替代文本>台灯与笔记本</替代文本></图><图><位置>小标题后</位置><用途>支撑论点</用途><比例>16:9</比例><提示词>flat illustration, desk with coffee and laptop, soft daylight, no text</提示词><替代文本>桌面与电脑</替代文本></图></文内配图><发布配图><图><位置>公众号头图</位置><用途>公众号发布</用途><比例>21:9</比例><提示词>editorial cover, warm desk scene, clean workflow motif, no text</提示词><替代文本>温暖书桌封面</替代文本></图></发布配图></配图方案>'

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const server = createServer(async (req, res) => {
  const url = req.url ?? ''
  if (req.method === 'GET' && url === '/reference.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return
  }
  if (req.method === 'POST' && url === '/search') {
    await readBody(req)
    report.calls.search = (report.calls.search ?? 0) + 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ResponseMetadata: { RequestId: `search-${Date.now()}` }, Result: { LogId: 'log', WebResults: [{
      Id: 'web-1', Title: 'AI Agent 在企业工作流中的实践', Url: 'https://example.com/agent-workflow', SiteName: '研究示例站',
      Summary: '企业采用 AI Agent 时，应先梳理业务流程、数据边界与人工复核节点。', Snippet: '流程、数据边界与人工复核是试点前提。',
      PublishTime: '2026-11-20T00:00:00+08:00', RankScore: 0.91, AuthInfoDes: '正常权威', Content: '全文不应进入素材库。'
    }] } }))
    return
  }
  if (req.method === 'POST' && url === '/v1/images/generations') {
    await readBody(req)
    report.calls.image = (report.calls.image ?? 0) + 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ model: 'journey-image', data: [{ b64_json: PNG.toString('base64') }] }))
    return
  }
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    const body = await readBody(req)
    let content = 'OK'
    if (body.includes('账号定位向导') || body.includes('资深自媒体账号定位顾问')) { report.calls.account = (report.calls.account ?? 0) + 1; content = JSON.stringify(ACCOUNT) }
    else if (body.includes('选题策划助手') || body.includes('<热搜关键词>')) { report.calls.topic = (report.calls.topic ?? 0) + 1; content = JSON.stringify(TOPIC) }
    else if (body.includes('生成任务')) { report.calls.framework = (report.calls.framework ?? 0) + 1; content = FRAMEWORK }
    else if (body.includes('<写作任务>')) { report.calls.article = (report.calls.article ?? 0) + 1; content = ARTICLE }
    else if (body.includes('中文内容视觉总监')) { report.calls.visual = (report.calls.visual ?? 0) + 1; content = VISUAL }
    else { report.calls.other = (report.calls.other ?? 0) + 1 }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ model: 'journey-model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `unhandled ${req.method} ${url}` }))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
const page = await app.firstWindow()
page.setDefaultTimeout(30_000)
page.on('pageerror', (error) => { report.errors.push(`pageerror: ${error.message}`); console.error('PAGEERROR', error.message) })
page.on('console', (msg) => { if (msg.type() === 'error') { report.errors.push(`console: ${msg.text().slice(0, 300)}`); console.error('CONSOLE', msg.text().slice(0, 300)) } })
await page.waitForLoadState('domcontentloaded')
await page.locator('.first-creation-modal').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
const guide = page.getByRole('button', { name: /稍后再说|先随便看看/ }).first()
if (await guide.isVisible().catch(() => false)) await guide.click()
await page.waitForTimeout(300)

async function shot(name) { await capture(page, { path: join(OUT, `${name}.png`), animations: 'disabled' }) }
async function stage(name, fn) {
  const started = Date.now()
  console.log(`\n== ${name} ==`)
  try {
    const detail = await fn()
    report.stages[name] = { ok: true, seconds: Math.round((Date.now() - started) / 1000), ...(detail ? { detail } : {}) }
    console.log(`PASS ${name}`)
  } catch (error) {
    const message = error?.message ?? String(error)
    report.stages[name] = { ok: false, seconds: Math.round((Date.now() - started) / 1000), error: message }
    report.errors.push(`${name}: ${message}`)
    console.error(`FAIL ${name}: ${message}`)
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      text: document.querySelector('.page')?.textContent?.slice(0, 1200) ?? document.body.innerText.slice(0, 1200),
      toasts: [...document.querySelectorAll('.toast-body')].map((node) => node.textContent)
    })).catch(() => null)
    if (diagnostic) { report.stages[name].diagnostic = diagnostic; console.error('DIAGNOSTIC', JSON.stringify(diagnostic)) }
    await shot(`FAIL-${name}`).catch(() => {})
    throw error
  }
}
async function nav(name) { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(350) }

try {
  await stage('00-provider-setup', async () => {
    await nav('AI 服务')
    await page.getByRole('button', { name: /空白配置/ }).click()
    await page.getByLabel('显示名称').fill('走查文本与生图')
    await page.getByLabel('接口地址').fill(`http://127.0.0.1:${port}/v1`)
    await page.locator('.provider-editor').getByLabel(/访问密钥/).fill('journey-key')
    await page.getByLabel('显示别名').fill('Journey Text')
    await page.getByLabel('模型标识').fill('journey-model')
    await page.getByRole('button', { name: '添加模型' }).click()
    await page.getByRole('group', { name: '第 2 个模型的类型' }).getByRole('button', { name: '生图', exact: true }).click()
    const imageCard = page.locator('.model-editor-card').nth(1)
    await imageCard.locator('input[name="modelDisplayName"]').fill('Journey Image')
    await imageCard.locator('input[name="modelId"]').fill('journey-image')
    await imageCard.locator('input[type="radio"]').check()
    await page.locator('.provider-editor').getByRole('button', { name: '测试并加密保存' }).click()
    await page.getByText('测试通过，供应商配置已加密保存').last().waitFor({ timeout: 60_000 })
    await shot('00-provider-text-image')

    await page.getByRole('button', { name: /空白配置/ }).click()
    await page.getByLabel('显示名称').fill('走查搜索')
    await page.getByLabel('接口地址').fill(`http://127.0.0.1:${port}/search`)
    await page.locator('.provider-editor').getByLabel(/访问密钥/).fill('journey-search-key')
    await page.getByRole('group', { name: '第 1 个模型的类型' }).getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByLabel('显示别名').fill('Journey Search')
    await page.getByLabel('模型标识').fill('journey-search')
    await page.locator('.provider-editor').getByRole('button', { name: '测试并加密保存' }).click()
    await page.getByText('测试通过，供应商配置已加密保存').last().waitFor({ timeout: 60_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    return { providers: await page.evaluate(async () => (await window.moliu.providers.list()).map(p => ({ name: p.displayName, models: p.models.map(m => `${m.kind}:${m.modelId}`) }))) }
  })

  await stage('01-account-create', async () => {
    await nav('账号定位')
    await page.getByRole('button', { name: '新建账号' }).first().click()
    const answers = ['热点观察室', '社会热点与公共议题探讨', '关心时事、想要理性视角的公众号读者', '克制理性，先摆事实再给观点', '冷静的热点观察者朋友', '多方信源对照，不消费灾难情绪', '帮读者看清热点背后的结构与各方立场']
    for (const answer of answers) {
      await page.locator('textarea[name="wizardAnswer"]').fill(answer)
      await page.getByRole('button', { name: '保存并继续' }).click()
    }
    await page.getByRole('button', { name: '生成账号定位' }).click()
    await page.locator('.wizard-actions-panel').waitFor({ timeout: 60_000 })
    await shot('01-account-generated')
    await page.getByRole('button', { name: '保存并锁定' }).click()
    await page.getByText('账号已保存并锁定').waitFor()
    await page.getByRole('button', { name: '解锁编辑' }).waitFor()
    await shot('01-account-locked')
    return { account: await page.evaluate(async () => (await window.moliu.accounts.list())[0]?.name) }
  })

  await stage('02-hotspots', async () => {
    await nav('热点洞察')
    await page.getByRole('button', { name: '刷新全部' }).click()
    let loaded = 0
    for (let i = 0; i < 18; i += 1) {
      await page.waitForTimeout(1000)
      loaded = await page.locator('.hot-item-list li').count()
      const meta = await page.locator('.hotspot-hero-meta').innerText().catch(() => '')
      if (loaded > 0 && !/后台分批加载中/.test(meta ?? '')) break
    }
    const meta = await page.locator('.hotspot-hero-meta').innerText().catch(() => '')
    await shot('02-hotspots-loaded')
    if (loaded === 0) note('真实热榜未加载出条目，使用手动添加热点继续验证后续链路。')
    await page.getByRole('button', { name: '手动添加' }).click()
    await page.locator('input[name="manualHotTitle"]').fill('AI Agent 在企业工作流中的落地难题')
    await page.locator('input[name="manualHotUrl"]').fill('https://example.com/agent-workflow')
    await page.locator('input[name="manualHotSource"]').fill('走查热榜')
    await page.locator('textarea[name="manualHotDesc"]').fill('从流程、数据边界与人工复核三个角度看 AI Agent 试点。')
    await page.getByRole('button', { name: '加入收藏' }).click()
    await page.getByText('已收藏 1 条热点').waitFor()
    await page.getByRole('button', { name: '生成选题', exact: true }).click()
    await page.locator('.topics-page h1').waitFor()
    return { loaded, meta: meta?.trim().slice(0, 160), seed: await page.locator('textarea[name="seedKeyword"]').inputValue() }
  })

  await stage('03-topic', async () => {
    await page.getByRole('group', { name: '数量' }).getByRole('button', { name: '1 条', exact: true }).click()
    await page.getByRole('button', { name: '生成 1 条选题' }).click()
    await page.getByText('已生成 1 条选题草稿').waitFor({ timeout: 60_000 })
    const card = page.locator('.topic-card').first()
    await card.getByTitle('加入选题库').click()
    await page.getByText('已加入选题库').waitFor()
    await page.getByRole('button', { name: /我的选题库/ }).click()
    const libraryCard = page.locator('.topic-card').first()
    await libraryCard.getByTitle('锁定选题').click()
    await page.getByText('已锁定为创作基线').waitFor()
    await shot('03-topic-locked')
    return { title: await libraryCard.locator('h3').innerText().catch(() => '') }
  })

  await stage('04-framework', async () => {
    await page.locator('.topic-card').first().getByRole('button', { name: '生成框架→' }).click()
    await page.locator('.frameworks-page h1').waitFor()
    await page.getByRole('group', { name: '生成数量' }).getByRole('button', { name: '1 个', exact: true }).click()
    await page.getByRole('button', { name: '生成框架' }).click()
    await page.getByText(/已生成\s*1\s*个可编辑框架/).waitFor({ timeout: 90_000 })
    const card = page.locator('.framework-card').first()
    await card.getByTitle('锁定').click()
    await page.getByText('已锁定框架版本').waitFor()
    await shot('04-framework-locked')
    return { title: await card.locator('h3').innerText(), materials: await card.locator('footer').innerText() }
  })

  await stage('05-materials', async () => {
    await nav('素材库')
    await page.getByPlaceholder('输入一个主题、人物、案例或事实关键词').fill('AI Agent 工作流')
    await page.getByRole('button', { name: '开始搜索' }).click()
    await page.getByText('AI Agent 在企业工作流中的实践').waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: '加入素材' }).click()
    await page.getByRole('button', { name: '已入库' }).first().waitFor()
    await page.getByRole('button', { name: '添加文字素材' }).click()
    const dialog = page.locator('.manual-material-dialog')
    await dialog.getByLabel('标题').fill('访谈摘录：先定义问题再让 AI 整理')
    await dialog.getByLabel('摘要 / 摘录').fill('创作者应该先定义问题，再让 AI 帮助整理材料；自动生成不能替代事实核查。')
    await dialog.getByLabel('来源说明（可选）').fill('走查访谈')
    await dialog.getByRole('button', { name: '加入素材库' }).click()
    await page.getByText('文字素材已加入可复用集合').waitFor()
    await page.getByRole('button', { name: /我的素材/ }).click()
    await page.getByText('访谈摘录：先定义问题再让 AI 整理').waitFor()
    await shot('05-materials-collected')
    return { count: await page.evaluate(async () => (await window.moliu.materials.list()).length) }
  })

  await stage('06-article', async () => {
    await nav('内容框架')
    const card = page.locator('.framework-card').first()
    await card.getByRole('button', { name: '写文章→' }).click()
    await page.waitForURL(/frameworkId=/)
    const dialog = page.locator('.article-composer-dialog')
    await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    if (!(await dialog.isVisible().catch(() => false))) {
      const start = page.getByRole('button', { name: /开始写作|新建草稿/ }).first()
      await start.click()
    }
    await dialog.waitFor()
    const frameworkTrigger = dialog.locator('.article-compose-grid .select-trigger').first()
    if ((await frameworkTrigger.innerText()).includes('不关联框架')) {
      await frameworkTrigger.click()
      await page.getByRole('option').filter({ hasText: '框架 ·' }).first().click()
    }
    const picker = dialog.locator('.material-picker')
    await picker.locator('.material-picker-list label').filter({ hasText: 'AI Agent 在企业工作流中的实践' }).getByRole('checkbox').check()
    await picker.locator('.material-picker-list label').filter({ hasText: '访谈摘录' }).getByRole('checkbox').check()
    await dialog.getByRole('button', { name: '生成草稿' }).click()
    await page.getByText('已生成 1 篇成稿').waitFor({ timeout: 90_000 })
    await page.getByText('AI Agent 落地前，先跨过这三道业务坎').first().waitFor()
    await shot('06-article-generated')
    return { title: await page.locator('.article-editor-head h2').innerText(), article: await page.evaluate(async () => (await window.moliu.articles.listSummaries({ limit: 5 })).items[0]) }
  })

  await stage('07-layout-before-visuals', async () => {
    await nav('文章排版')
    const generate = page.getByRole('button', { name: '生成排版稿' }).first()
    if (await generate.count()) await generate.click()
    await page.getByText(/来自《AI Agent 落地前/).first().waitFor({ timeout: 30_000 })
    await shot('07-layout-before-visuals')
    return { text: (await page.locator('.layout-workspace').innerText().catch(() => '')).slice(0, 300) }
  })

  await stage('08-visuals', async () => {
    await nav('智能配图')
    const original = page.getByRole('button', { name: '原有方案与图片', exact: true })
    if (await original.count()) await original.click()
    await page.getByRole('button', { name: '生成方案' }).click()
    await page.getByText('配图方案已生成，可逐张生成图片').waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: '生成全部图片' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.visual-slot .visual-asset').length >= 4, undefined, { timeout: 90_000 })
    await shot('08-visuals-generated')
    return { assets: await page.locator('.visual-slot .visual-asset').count(), imageCalls: report.calls.image ?? 0 }
  })

  await stage('09-insert-visuals-and-relayout', async () => {
    await nav('文章创作')
    await page.getByRole('button', { name: '源码编辑' }).click()
    const insertOptionLabels = []
    for (let i = 1; i <= 2; i += 1) {
      await page.locator('button[aria-label="插入配图"]').click()
      await page.locator('.select-popover').waitFor({ state: 'visible' })
      const options = page.locator('.select-popover .select-option')
      insertOptionLabels.push(await options.allInnerTexts())
      await options.filter({ hasText: '文内图' }).nth(i - 1).click()
    }
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByText('手动编辑已保存为新版本').waitFor()
    await page.getByRole('button', { name: '锁定', exact: true }).click()
    await page.getByText('已锁定成稿版本').waitFor()
    await nav('文章排版')
    const gate = page.locator('.saved-version-gate')
    const gateText = await gate.innerText().catch(() => '')
    const staleWarnings = await page.locator('.inline-alert').allInnerTexts()
    const generate = page.getByRole('button', { name: '生成排版稿' }).first()
    if (await generate.count()) await generate.click()
    await page.getByText(/来自《AI Agent 落地前/).first().waitFor({ timeout: 30_000 })
    await shot('09-layout-after-visuals')
    return { gateText, staleWarnings, insertOptionLabels, imagesInMarkdown: await page.evaluate(async () => {
      const items = (await window.moliu.articles.listSummaries({ limit: 5 })).items
      const article = await window.moliu.articles.get(items[0].id)
      return (article.rawMarkdown.match(/moliu-asset:\/\/assets\//g) ?? []).length
    }) }
  })

  report.finishedAt = new Date().toISOString()
  report.ok = Object.values(report.stages).every((s) => s.ok) && report.errors.length === 0
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log('\nJOURNEY_SUMMARY', JSON.stringify(report, null, 2))
} catch (error) {
  report.finishedAt = new Date().toISOString()
  report.ok = false
  report.fatal = error?.message ?? String(error)
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  throw error
} finally {
  await app.close().catch(() => {})
  await new Promise((done) => server.close(done))
  if (!root.startsWith(join(tmpdir(), 'moliu-journey-2026-11-26-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
