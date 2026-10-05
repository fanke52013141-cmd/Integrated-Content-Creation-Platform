// 目标审查取证：真实 Electron + 临时工作区 + 本地 mock 模型服务。
// 覆盖：13 个页面空态 → 种子数据 → 有数据态 → 关键交互态 / 暗色 / 窄屏。
// 用法：node scripts/goal-audit.mjs   （需先 npm run build）
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const outDir = resolve('artifacts/goal-review')
const root = await mkdtemp(join(tmpdir(), 'moliu-goal-audit-'))

// ---------------- mock 模型服务 ----------------
const TOPIC_PAYLOAD = {
  选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎',
  切入角度: '从工具热闹转向具体工作流的业务价值',
  目标读者: '正在尝试把 AI 用进日常工作的职场人',
  核心观点: '决定成败的不是模型能力，而是流程重构',
  情绪基调: '理性、鼓励',
  拟标题方向: '别急着上 AI Agent：先看懂它最容易卡住的三件事',
  备注: ''
}
const FRAMEWORK_XML = '<框架><标题>先有框架，创作才有方向</标题><开头>从动笔前的混乱切入，点出多数人卡住的真实原因。</开头><论点一>框架先确定读者和核心承诺，避免自嗨。</论点一><论点二>框架让每份素材有明确位置，检索即写作。</论点二><论点三>框架降低返工成本，改稿只动局部。</论点三><结尾>用可执行的下一步收束，给出今天就能做的动作。</结尾></框架>'
const ARTICLE_MD = `# 先搭框架，再写文章

很多创作者不是不会写，而是太早开始写。

## 框架先决定什么

它先帮助我们确定**读者、承诺与推进顺序**。没有这三样，写得越多，离题越远。

## 素材的位置感

- 框架让素材有明确位置
- 检索素材时就知道它要去哪一节
- 不再囤积「以后可能有用」的收藏

## 返工成本对比

| 方式 | 平均返工次数 | 说明 |
| --- | --- | --- |
| 直接开写 | 4 次 | 整段推倒重来 |
| 先搭框架 | 1 次 | 只调整局部段落 |

> 框架不是限制表达，而是把表达留给真正重要的句子。

## 一个最小可用的框架模板

\`\`\`text
标题 → 开头钩子 → 三个论点 → 行动收尾
\`\`\`

## 结尾

从下一篇文章开始，先写下结构，再投入表达。`
const REVISED_MD = '# 更锋利的开头：别急着写\n\n创作者最常见的浪费，是在没有结构时就急着堆字。\n\n## 框架先决定什么\n\n它帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n先搭结构，再投入表达。'
const REVIEW_XML = `<评审意见>
位置：标题｜严重程度：中｜问题：标题偏平，缺少具体承诺｜建议：加入数字或结果词，例如「3 个动作」
位置：开头｜严重程度：低｜问题：开头铺垫略长，第三句才进入主题｜建议：第一句直接给出核心观点
位置：论点二｜严重程度：高｜问题：论点二与论点三存在重叠，都在讲返工｜建议：合并或把论点三改为「如何检验框架质量」
总体建议：整体结构清晰，先解决标题与论点重叠即可进入排版。
</评审意见>`
const VISUAL_XML = '<配图方案><封面><主视觉>一盏台灯照亮书桌</主视觉><封面文案>把复杂事讲明白</封面文案><提示词>editorial illustration, warm desk lamp, clean composition, soft light, ample negative space, no text, no watermark</提示词></封面><文内配图><图><位置>开头后</位置><用途>建立阅读情绪</用途><比例>16:9</比例><提示词>minimal editorial illustration, notebook and lamp, warm light, no text</提示词><替代文本>台灯与笔记本</替代文本></图><图><位置>小标题后</位置><用途>支撑论点</用途><比例>16:9</比例><提示词>flat illustration, desk with coffee and laptop, soft daylight, no text</提示词><替代文本>桌面与电脑</替代文本></图></文内配图><发布配图><图><位置>公众号头图</位置><用途>公众号发布</用途><比例>2.35:1</比例><提示词>editorial cover, warm desk scene, no text</提示词><替代文本>温暖书桌封面</替代文本></图></发布配图></配图方案>'

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    return response.writeHead(404).end()
  }
  const body = await readBody(request)
  let content
  if (/只回复\s*OK/.test(body)) content = 'OK'
  else if (body.includes('选题策划助手')) content = JSON.stringify(TOPIC_PAYLOAD)
  else if (body.includes('视觉总监')) content = VISUAL_XML
  else if (body.includes('改稿任务')) content = REVISED_MD
  else if (body.includes('评审意见')) content = REVIEW_XML
  else if (body.includes('独立框架')) content = FRAMEWORK_XML
  else content = ARTICLE_MD
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ model: 'goal-audit-model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
console.log('mock model server on', port)

const executablePath = resolve('node_modules/electron/dist/electron.exe')

// 微信公众号 API mock：让「推送草稿」在审查环境里可走通
const wxServer = createServer(async (req, res) => {
  if (req.url?.startsWith('/cgi-bin/token')) return res.end(JSON.stringify({ access_token: 'audit-token' }))
  if (req.url?.startsWith('/cgi-bin/draft/add')) return res.end(JSON.stringify({ media_id: 'audit-draft-id' }))
  if (req.url?.startsWith('/cgi-bin/material/add_material')) {
    let body = ''
    for await (const chunk of req) body += chunk
    return res.end(JSON.stringify({ media_id: 'audit-thumb-media' }))
  }
  res.statusCode = 404
  res.end()
})
await new Promise((done) => wxServer.listen(0, '127.0.0.1', done))
const wxPort = wxServer.address().port

const app = await electron.launch({
  executablePath, args: ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: root, MOLIU_WECHAT_API_BASE: `http://127.0.0.1:${wxPort}` }
})
const page = await app.firstWindow()
page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`))
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 200)}`) })
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)

const ROUTES = [
  ['home', '创作台'],
  ['accounts', '账号定位'],
  ['hotspots', '热点洞察'],
  ['topics', '选题生成'],
  ['frameworks', '内容框架'],
  ['articles', '文章创作'],
  ['reviews', '内容评审'],
  ['visuals', '智能配图'],
  ['layouts', '文章排版'],
  ['publishing', '发布管理'],
  ['materials', '素材库'],
  ['providers', '模型网关'],
  ['prompts', '提示词']
]

async function goto(hash) {
  await page.evaluate((h) => { window.location.hash = h }, hash)
  await page.waitForTimeout(1300)
}
async function shot(name) {
  const file = join(outDir, `${name}.png`)
  try {
    await page.screenshot({ path: file, animations: 'disabled', timeout: 30000 })
    console.log(`✓ ${name}`)
  } catch (e) {
    console.log(`✗ ${name}: ${e.message.slice(0, 100)}`)
  }
}
async function tryStep(label, fn) {
  try {
    await fn()
    console.log(`· ${label} ok`)
  } catch (e) {
    console.log(`· ${label} FAILED: ${e.message.slice(0, 140)}`)
  }
}

await mkdir(outDir, { recursive: true })

// ---------------- Phase A: 空态 ----------------
console.log('\n== Phase A: 空态（全新工作区）==')
for (const [route] of ROUTES) {
  await goto(`#/${route}`)
  await shot(`A-empty-${route}`)
}

// ---------------- Phase B: 种子数据 ----------------
console.log('\n== Phase B: 种子数据 ==')
const seed = await page.evaluate(async ({ port }) => {
  const r = {}
  const provider = await window.moliu.providers.save({
    displayName: '本地审查模型', protocol: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'goal-audit-model',
    enabled: true, isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: 'goal-audit-model', displayName: '审查模型', reasoningVariants: [], isDefault: true, enabled: true }],
    apiKey: 'audit-key'
  })
  r.providerId = provider.id

  const FIELDS = [
    ['账号名称', '心流示例号'],
    ['简介', '专注科技与生活方式的内容创作者'],
    ['领域', 'AI 效率工具'],
    ['目标受众', '25-35 岁一线城市职场人'],
    ['写作风格', '理性克制，偶尔幽默'],
    ['IP人设', '用过 100 款效率工具的产品经理'],
    ['差异化定位', '只讲亲测有效的工作流'],
    ['价值主张', '帮你把 AI 真正用进日常工作'],
    ['选题方向', 'AI 工作流 / 效率工具实测 / 信息管理']
  ]
  const account = await window.moliu.accounts.save({
    fields: FIELDS.map(([name, value]) => ({ id: crypto.randomUUID(), name, value, isDefault: true })),
    wizardAnswers: [], status: 'locked', source: 'manual'
  })
  const accountDraft = await window.moliu.accounts.save({
    fields: FIELDS.slice(0, 3).map(([name, value]) => ({ id: crypto.randomUUID(), name, value: name === '账号名称' ? '草稿小号' : value, isDefault: true })),
    wizardAnswers: [], status: 'draft', source: 'manual'
  })
  r.accountId = account.id
  r.accountDraftId = accountDraft.id
  await window.moliu.accounts.setCurrent(account.id)
  await window.moliu.accounts.addRedline({ profileId: account.id, kind: 'dont', content: '不做没有亲测过的工具推荐' })
  await window.moliu.accounts.addMemory({ profileId: account.id, insight: '带具体数字的标题打开率更高', action: '标题尽量带数字', source: '用户自述' })

  const topic = await window.moliu.topics.save({
    seedKeyword: 'AI 工作流', accountIds: [account.id], relatedHotIds: [],
    status: 'locked', source: 'ai',
    fields: {
      选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎',
      切入角度: '从工具热闹转向具体工作流的业务价值',
      目标读者: '正在尝试把 AI 用进日常工作的职场人',
      核心观点: '决定成败的不是模型能力，而是流程重构',
      情绪基调: '理性、鼓励',
      拟标题方向: '别急着上 AI Agent：先看懂它最容易卡住的三件事'
    },
    providerId: provider.id, model: 'goal-audit-model'
  })
  const topicDraft = await window.moliu.topics.save({
    seedKeyword: '效率工具', accountIds: [account.id], relatedHotIds: [],
    status: 'draft', source: 'ai',
    fields: { 选题主题: '我用的 5 个效率工具，砍掉了 3 个', 切入角度: '少即是多' },
    providerId: provider.id, model: 'goal-audit-model'
  })
  r.topicId = topic.id
  r.topicDraftId = topicDraft.id

  const m1 = await window.moliu.materials.addManual({ title: 'AI Agent 落地调研笔记', summary: '三个失败案例与一个成功案例的共同点。' })
  const m2 = await window.moliu.materials.addManual({ title: '工作流重构方法论', summary: '先画现状流程图，再找 AI 可插入的节点。' })
  r.materialIds = [m1.id, m2.id]

  const framework = await window.moliu.frameworks.save({
    topicId: topic.id, accountId: account.id, materialIds: [m1.id],
    manualTopic: '', status: 'locked',
    sections: [
      { name: '标题', content: '先有框架，创作才有方向' },
      { name: '开头', content: '从动笔前的混乱切入，点出多数人卡住的真实原因。' },
      { name: '论点一', content: '框架先确定读者和核心承诺，避免自嗨。' },
      { name: '论点二', content: '框架让每份素材有明确位置，检索即写作。' },
      { name: '论点三', content: '框架降低返工成本，改稿只动局部。' },
      { name: '结尾', content: '用可执行的下一步收束。' }
    ],
    providerId: provider.id, model: 'goal-audit-model'
  })
  r.frameworkId = framework.id

  const article = await window.moliu.articles.save({
    frameworkId: framework.id, accountId: account.id, materialIds: [m1.id, m2.id],
    manualOutline: '', status: 'locked', source: 'generate',
    rawMarkdown: `# 先搭框架，再写文章\n\n很多创作者不是不会写，而是太早开始写。\n\n## 框架先决定什么\n\n它先帮助我们确定**读者、承诺与推进顺序**。没有这三样，写得越多，离题越远。\n\n## 素材的位置感\n\n- 框架让素材有明确位置\n- 检索素材时就知道它要去哪一节\n- 不再囤积「以后可能有用」的收藏\n\n## 返工成本对比\n\n| 方式 | 平均返工次数 | 说明 |\n| --- | --- | --- |\n| 直接开写 | 4 次 | 整段推倒重来 |\n| 先搭框架 | 1 次 | 只调整局部段落 |\n\n> 框架不是限制表达，而是把表达留给真正重要的句子。\n\n## 结尾\n\n从下一篇文章开始，先写下结构，再投入表达。`,
    providerId: provider.id, model: 'goal-audit-model'
  })
  const articleDraft = await window.moliu.articles.save({
    manualOutline: '', accountId: account.id, materialIds: [], status: 'draft', source: 'manual',
    rawMarkdown: '# 未完成的草稿\n\n这一篇还在进行中……'
  })
  r.articleId = article.id
  r.articleDraftId = articleDraft.id

  const role = await window.moliu.reviews.saveRole({
    name: '主编审稿', systemPrompt: '你是挑剔但建设性的主编，审稿并使用 <评审意见> 输出',
    extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: ['可读性', '结构'], sortOrder: 0
  })
  r.roleId = role.id
  const started = await window.moliu.reviews.start({
    articleId: article.id, roleIds: [role.id],
    fallbackProviderId: provider.id, fallbackModel: 'goal-audit-model'
  })
  r.reviewTaskId = started.task.id

  const pack = await window.moliu.visuals.generate({
    articleId: article.id, providerId: provider.id, model: 'goal-audit-model', inlineCount: 2
  })
  r.visualPackId = pack.id

  const layout = await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat', themeId: 'magazine' })
  r.layoutId = layout.id

  await window.moliu.publishing.saveWechatChannel({ appId: 'wx-audit', appSecret: 'audit-secret', enabled: true })
  const draft = await window.moliu.publishing.pushWechatDraft({
    articleId: article.id, layoutId: layout.id, thumbMediaId: 'thumb-audit', digest: '先搭框架，再写文章'
  })
  const published = await window.moliu.publishing.update({
    id: draft.id, status: 'published', publishedUrl: 'https://mp.weixin.qq.com/s/audit'
  })
  r.publishRecordId = published.id
  return r
}, { port })
console.log('seed:', JSON.stringify(seed, null, 2).slice(0, 800))

await page.reload()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)

// ---------------- Phase C: 有数据态 ----------------
console.log('\n== Phase C: 有数据态 ==')
for (const [route] of ROUTES) {
  await goto(`#/${route}`)
  await shot(`B-populated-${route}`)
}

// ---------------- Phase D: 细节 / 交互态 ----------------
console.log('\n== Phase D: 细节与交互态 ==')
await goto(`#/articles?articleId=${seed.articleId}`)
await page.waitForTimeout(800)
await shot('D-articles-editor')

await tryStep('文章导入模式', async () => {
  await goto(`#/articles?import=1`)
  await page.waitForTimeout(600)
})
await shot('D-articles-import')

await goto(`#/reviews?articleId=${seed.articleId}`)
await page.waitForTimeout(800)
await shot('D-reviews-detail')

await goto(`#/visuals?articleId=${seed.articleId}`)
await page.waitForTimeout(800)
await shot('D-visuals-detail')

await goto(`#/layouts?articleId=${seed.articleId}`)
await page.waitForTimeout(1000)
await shot('D-layouts-preview')
await tryStep('切换主题为科技蓝', async () => {
  await page.getByLabel('主题').click()
  await page.getByRole('option', { name: /科技蓝/ }).click()
  await page.waitForTimeout(900)
})
await shot('D-layouts-theme-techblue')

await goto(`#/publishing?articleId=${seed.articleId}`)
await page.waitForTimeout(800)
await shot('D-publishing-detail')
await tryStep('展开发布复盘', async () => {
  await page.locator('.publication-retro summary').click()
  await page.waitForTimeout(500)
})
await shot('D-publishing-retro')

await tryStep('打开模型网关编辑', async () => {
  await goto('#/providers')
  await page.getByRole('button', { name: /编辑/ }).first().click()
  await page.waitForTimeout(600)
})
await shot('D-providers-edit')

await tryStep('账号定位展开版本/红线区', async () => {
  await goto('#/accounts')
  await page.waitForTimeout(600)
})

// 窄屏（125% / 150% 缩放等效）
for (const width of [944, 787]) {
  await tryStep(`窄屏 ${width}px 文章页`, async () => {
    await page.setViewportSize({ width, height: 800 })
    await goto(`#/articles?articleId=${seed.articleId}`)
  })
  await shot(`D-articles-narrow-${width}`)
  await tryStep(`窄屏 ${width}px 排版页`, async () => {
    await goto(`#/layouts?articleId=${seed.articleId}`)
  })
  await shot(`D-layouts-narrow-${width}`)
}
await page.setViewportSize({ width: 1440, height: 900 })

// 暗色模式抽检
await tryStep('切换暗色主题', async () => {
  await page.locator('.theme-toggle').click()
  await page.waitForTimeout(500)
})
for (const hash of ['#/home', `#/articles?articleId=${seed.articleId}`, `#/layouts?articleId=${seed.articleId}`, '#/publishing', '#/providers']) {
  await goto(hash)
  await shot(`D-dark-${hash.replace(/^#\/|\?.*/g, '').replace('/', '-')}`)
}
await tryStep('切回亮色', async () => { await page.locator('.theme-toggle').click() })

await app.close()
await rm(root, { recursive: true, force: true }).catch(() => {})
server.close()
wxServer.close()
console.log('\ndone ->', outDir)
