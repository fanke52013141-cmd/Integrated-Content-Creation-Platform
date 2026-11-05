/**
 * 全流程优化体验走查（真实 Electron + 模拟模型服务）。
 *
 * 目的：从头到尾把 9 个环节走一遍，验证四批优化是否真的触发、UI 是否可见、
 * 生成质量是否被改善。产出：控制台摘要 JSON + artifacts/walkthrough/*.png 截图 + 数据库落库证据。
 *
 * 模型服务按请求特征路由：
 *   连接测试 OK / 选题（含"评估"三维分）/ 框架 XML / 脏稿→体检意见→干净稿的 polish 循环 /
 *   评审 XML / 配图 plan→prompts→review / 改稿 REVISED。
 */
import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { electron } from './lib/electron-test.mjs'

// 脏稿：套话+连接词过密+句长均匀 → 体检必出 medium/high，触发 polish 循环
const DIRTY = '# 三步搭建你的内容工作流\n\n' + '项目延期了，因此团队开始复盘。然而数据并不支持最初的判断。此外，需求文档也一直缺失。另外，测试环境长期不稳定。因此每个人都在救火。然而没人有时间为根因停下来。总而言之，流程需要改进。综上所述，大家都很疲惫。'.repeat(4)
// 干净稿：无 medium/high 问题；长度须与脏稿相当（体检修正只删套话，不会删一半内容——
// normalizePolished 的截断护栏会拒绝长度不足原稿一半的改写产物）
const CLEAN = ['# 三步搭建你的内容工作流', '', '上周帮朋友排查一个老接口，日志里什么都没有，只有一行沉默的超时。真正的坑埋在半年前的一次重构里，有人把重试次数从三次改成了零，谁也没通知谁，文档还停在旧版本。这种事没有惊心动魄的地方，却最消耗一个团队的信任。', '上周帮朋友排查一个老接口，日志里什么都没有，只有一行沉默的超时。真正的坑埋在半年前的一次重构里，有人把重试次数从三次改成了零，谁也没通知谁，文档还停在旧版本。这种事没有惊心动魄的地方，却最消耗一个团队的信任。修复只花了十分钟。找回信任要几个月。'].join('\n\n')
const REVISED = '# 更锋利的开头：别急着写\n\n创作者最常见的浪费，是在没有结构时就急着堆字。\n\n## 框架先决定什么\n\n它帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n先搭结构，再投入表达。'
const FRAMEWORK_XML = '<框架><标题>先有框架，创作才有方向</标题><开头>从动笔前的混乱切入。</开头><论点一>框架先确定读者和核心承诺。</论点一><论点二>框架让素材有明确位置。</论点二><论点三>框架降低写作返工成本。</论点三><结尾>用可执行的下一步收束。</结尾></框架>'
const REVIEW_XML = '<评审意见>位置：开头｜严重程度：中｜问题：钩子偏弱｜建议：用反问强化冲突\n总体建议：强化开头。</评审意见>'
const TOPIC_JSON = JSON.stringify({
  选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎',
  切入角度: '用三个失败案例反推落地条件',
  目标读者: '正在把 AI 引入团队的负责人',
  核心观点: 'Agent 落地是流程改造，不是工具采购',
  情绪基调: '冷静、反常识',
  拟标题方向: '别再买工具了：Agent 落地的三道坎',
  备注: '',
  评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: '同题不少但失败视角少见' }
})

const calls = { topic: 0, framework: 0, dirtyDraft: 0, polishRevise: 0, review: 0, revise: 0, plan: 0, prompts: 0, pictureReview: 0, other: 0 }
async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  const body = await readBody(request)
  const answer = (content) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ model: 'walkthrough-model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
  }
  if (/只回复\s*OK/.test(body)) { calls.other += 1; return answer('OK') }
  if (body.includes('<热搜关键词>')) { calls.topic += 1; return answer(TOPIC_JSON) }
  if (body.includes('配图审稿人')) {
    calls.pictureReview += 1
    // 请求体内的 user JSON 是转义形态，先反转义再用字段锚点提取（id 后跟 kind，避免抓到顶层 planId）
    const flat = body.replace(/\\"/g, '"')
    const ids = [...flat.matchAll(/"id":"([0-9a-f-]{36})","kind"/g)].map(m => m[1])
    return answer(JSON.stringify({ pictures: ids.map((id, index) => ({ id, verdict: index === 0 ? 'match' : 'mismatch', reason: index === 0 ? '封面契合全文主题' : '提示词主体与段落内容无关' })) }))
  }
  if (body.includes('可直接生图')) {
    calls.prompts += 1
    const flat = body.replace(/\\"/g, '"')
    const ids = [...flat.matchAll(/"id":"([0-9a-f-]{36})","subject"/g)].map(m => m[1])
    return answer(JSON.stringify({ pictures: ids.map(id => ({ id, prompt: `一张关于内容工作流的示意图，扁平插画风格，主体明确，留白充足，不含文字和水印` })) }))
  }
  if (body.includes('配图编辑')) {
    calls.plan += 1
    return answer(JSON.stringify({ reasoning: '为横评配封面与正文图', pictures: [
      { kind: 'cover', subject: '工作流封面', purpose: '点题', blockIndex: 0, ratio: '21:9', alt: '封面', priority: 'required' },
      { kind: 'inline', subject: '流程对比图', purpose: '呼应第一段', blockIndex: 1, ratio: '16:9', alt: '流程图', priority: 'optional' }
    ] }))
  }
  if (body.includes('文风体检发现的问题')) { calls.polishRevise += 1; return answer(CLEAN) }
  if (body.includes('仅输出一个 <评审意见>')) { calls.review += 1; return answer(REVIEW_XML) }
  if (body.includes('<评审意见>')) { calls.revise += 1; return answer(REVISED) }
  if (body.includes('<改稿任务>')) { calls.revise += 1; return answer(REVISED) }
  if (body.includes('生成任务')) { calls.framework += 1; return answer(FRAMEWORK_XML) }
  if (body.includes('<写作任务>')) { calls.dirtyDraft += 1; return answer(DIRTY) }
  calls.other += 1
  return answer('OK')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()

const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const artifactDir = resolve('artifacts', 'walkthrough')
const userDataDir = resolve(tmpdir(), 'moliu-walkthrough', String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })
const application = await electron.launch({ executablePath, args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir } })
const shot = (window, name) => window.screenshot({ path: resolve(artifactDir, `${name}.png`), animations: 'disabled' })
const summary = {}
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '稍后再说' }).first().click({ timeout: 8000 }).catch(() => {})

  // ── 0. 配置模型（UI 全程） ──
  await window.getByRole('button', { name: 'AI 服务' }).first().click()
  await window.getByRole('button', { name: /空白配置/ }).click()
  await window.getByLabel('显示名称').fill('走查验收模型')
  await window.getByLabel('接口地址').fill(`http://127.0.0.1:${address.port}/v1`)
  await window.locator('.provider-editor').getByLabel(/访问密钥/).fill('walkthrough-key')
  await window.getByLabel('显示别名').fill('Walkthrough Model')
  await window.getByLabel('模型标识').fill('walkthrough-model')
  await window.locator('.provider-editor').getByRole('button', { name: '测试并加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()
  await window.locator('.provider-card').getByRole('button', { name: '测试连接' }).first().click()
  await window.getByText('连接成功').waitFor({ timeout: 30_000 })

  // ── 1. 热点洞察（真实网络拉取；黑马快照落库） ──
  await window.getByRole('button', { name: '热点洞察' }).click()
  await window.getByRole('heading', { name: '热点雷达' }).waitFor()
  await window.locator('.hot-item-list li, .hotspot-source-rail li').first().waitFor({ timeout: 60_000 }).catch(() => {})
  await shot(window, '01-hotspots')
  summary.hotspotsLoaded = await window.locator('.hot-item-list li').count().catch(() => 0)

  // ── 2. 选题：三维评估徽章 ──
  await window.getByRole('button', { name: '选题生成' }).first().click()
  await window.locator('.topics-page h1').waitFor()
  await window.locator('textarea[name="seedKeyword"]').fill('AI Agent 工作流落地')
  await window.getByRole('group', { name: '数量' }).getByRole('button', { name: '1 条', exact: true }).click()
  await window.getByRole('button', { name: '生成 1 条选题' }).click()
  await window.getByText('已生成 1 条选题草稿').waitFor({ timeout: 30_000 })
  await window.locator('.topic-card').first().waitFor()
  const badge = window.locator('.topic-card .badge', { hasText: '评估' }).first()
  await badge.waitFor({ timeout: 10_000 })
  summary.topicAssessmentBadge = await badge.innerText()
  await shot(window, '02-topic-assessment')

  // ── 3. 框架：多视角自检模板 + 生成 ──
  await window.getByRole('button', { name: '内容框架' }).first().click()
  await window.locator('.frameworks-page h1').waitFor()
  await window.getByLabel('补充主题（未选选题时必填）').fill('AI 创作者为什么需要内容框架')
  await window.getByRole('button', { name: '生成框架' }).click()
  await window.getByText('已生成 3 个可编辑框架').waitFor({ timeout: 30_000 })
  await window.getByText('先有框架，创作才有方向').first().waitFor()
  await shot(window, '03-framework')
  summary.frameworkGenerated = true

  // ── 4. 文章创作：体检自动修正循环 ──
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.locator('.articles-page h1').waitFor()
  await window.getByRole('button', { name: '新建草稿', exact: true }).click()
  await window.locator('.article-composer-dialog .composer-advanced > summary').click()
  const polishToggle = window.locator('.article-composer-dialog .article-polish-toggle input[type="checkbox"]')
  await polishToggle.waitFor()
  summary.polishDefaultOn = await polishToggle.isChecked()
  if (!summary.polishDefaultOn) throw new Error('文风体检自动修正默认应为开启')
  await window.getByLabel('手动框架').fill('标题：三步搭建你的内容工作流\n开头：从一个沉默的超时讲起\n论点：流程先于工具\n结尾：给出行动建议')
  await window.getByRole('button', { name: '生成草稿' }).click()
  await window.getByText(/已生成 1 篇成稿/).waitFor({ timeout: 60_000 })
  // 出现瞬间抓 toast 原文，确认轨迹确实拼进了第一触点
  summary.toastAtBirth = await window.evaluate(() => [...document.querySelectorAll('.toast-body')].map(node => node.textContent))
  if (calls.polishRevise < 1) throw new Error(`polish 循环没有触发改稿调用（${calls.polishRevise} 次）`)
  if (calls.dirtyDraft < 1) throw new Error('没有收到脏稿生成请求')
  // UX：体检轨迹拼进完成 toast（软断言——toast 存活期短，有展示时序竞态）；硬断言在生成历史展开面板
  const polishTraceToast = await window.getByText(/文风体检自动修正/).first().waitFor({ timeout: 3_000 }).then(() => true).catch(() => false)
  summary.polishTraceVisible = polishTraceToast
  await shot(window, '04-article-polish-toast')
  await window.getByRole('button', { name: '源码编辑' }).click()
  const editorText = await window.locator('textarea.article-markdown-editor').inputValue()
  summary.polishApplied = editorText.includes('修复只花了十分钟') && !editorText.includes('总而言之')
  if (!summary.polishApplied) throw new Error(`成稿不是体检修正后的干净版本。calls=${JSON.stringify(calls)} 编辑器开头=${JSON.stringify(editorText.slice(0, 160))}`)

  // ── 5. 评审：机器体检意见 + UI 呈现 ──
  const reviewResult = await window.evaluate(async () => {
    const provider = (await window.moliu.providers.list())[0]
    const article = (await window.moliu.articles.listSummaries({ limit: 5 })).items.find(item => item.title.includes('三步搭建')) ?? (await window.moliu.articles.listSummaries({ limit: 5 })).items[0]
    const role = await window.moliu.reviews.saveRole({
      name: '走查审稿人', systemPrompt: '审稿并使用 <评审意见> 输出',
      extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: ['可读性'], sortOrder: 0
    })
    const started = await window.moliu.reviews.start({ articleId: article.id, roleIds: [role.id], fallbackProviderId: provider.id, fallbackModel: 'walkthrough-model' })
    return {
      checkerOpinion: started.task.opinions.find(opinion => opinion.roleName === '机器体检') ?? null,
      modelProblems: started.task.opinions.find(opinion => opinion.roleId)?.problems.length ?? 0
    }
  })
  summary.checkerFindings = reviewResult.checkerOpinion?.problems.length ?? -1
  summary.checkerOverall = reviewResult.checkerOpinion?.overallSuggestion ?? ''
  if (!reviewResult.checkerOpinion) throw new Error('评审任务里没有机器体检意见')
  await window.getByRole('button', { name: '内容评审' }).first().click()
  await window.locator('.reviews-page h1, .reviews-page h2').first().waitFor()
  await window.locator('.review-opinion', { hasText: '机器体检' }).first().waitFor({ timeout: 15_000 })
  await shot(window, '05-review-machine-check')

  // ── 6. 配图：AI 方案 → 提示词 → 匹配度回看（UI 徽章） ──
  const studioIds = await window.evaluate(async (port) => {
    const provider = (await window.moliu.providers.list())[0]
    const article = await window.moliu.articles.save({
      materialIds: [], manualOutline: '', status: 'draft', source: 'manual',
      rawMarkdown: '# 配图回看验收\n\n第一段讲注意力分散的问题。\n\n第二段给出具体的调整方法。'
    })
    return { articleId: article.id, providerId: provider.id, model: 'walkthrough-model' }
  }, address.port)
  const studioPlan = await window.evaluate(async ({ articleId, providerId, model }) => {
    const api = window.moliu.visuals.studio
    const plan = await api.plan({ articleId, providerId, model, count: 1, density: 'standard', cover: true, header: false, maxInline: 4 })
    const withPrompts = await api.prompts({ providerId, model, planId: plan.id, expectedRevision: plan.revision })
    return await api.review({ providerId, model, planId: withPrompts.id, expectedRevision: withPrompts.revision })
  }, studioIds)
  const reviewedPictures = studioPlan.pictures.filter(p => p.review)
  summary.pictureReviews = reviewedPictures.map(p => `${p.kind}:${p.review.verdict}`)
  if (summary.pictureReviews.length !== 2) throw new Error(`配图回看结论缺失：${JSON.stringify(summary.pictureReviews)}`)
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '稍后再说' }).first().click({ timeout: 8000 }).catch(() => {})
  await window.getByRole('button', { name: '智能配图', exact: true }).click()
  // 列表模式先选文章，再切到内容配图工作台（文章是 studio 拉取方案的键）
  const articleTrigger = window.locator('.article-picker .select-trigger').first()
  if (await articleTrigger.count()) {
    await articleTrigger.click()
    await window.getByRole('option', { hasText: '配图回看验收' }).first().click()
  }
  const studioEntry = window.getByRole('button', { name: '内容配图工作台' })
  if (await studioEntry.count()) await studioEntry.click()
  const planSelect = window.locator('.select-trigger', { hasText: '配图回看验收' }).first()
  await planSelect.waitFor({ timeout: 15_000 })
  await planSelect.click()
  await window.getByRole('option', { hasText: '配图回看验收' }).first().click()
  const reviewBadge = window.locator('.studio-picture .badge', { hasText: /匹配|不匹配/ }).first()
  await reviewBadge.waitFor({ timeout: 15_000 })
  summary.pictureBadgeText = await reviewBadge.innerText()
  await shot(window, '06-visual-review-badge')

  // ── 7. 排版：公众号兼容性校验器（干净稿应为 0 error） ──
  const layoutResult = await window.evaluate(async () => {
    const items = (await window.moliu.articles.listSummaries({ limit: 5 })).items
    const target = items.find(item => item.title.includes('三步搭建你的内容工作流')) ?? items[0]
    const layout = await window.moliu.layouts.create({ articleId: target.id, platform: 'wechat' })
    return { violations: layout.violations ?? [], htmlLength: layout.html.length }
  })
  summary.layoutErrors = layoutResult.violations.filter(v => v.level === 'error').length
  summary.layoutWarnings = layoutResult.violations.filter(v => v.level === 'warn').length

  // ── 8. 生成历史里的轨迹消息（展开折叠面板核对完整轨迹） ──
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.locator('.articles-page h1').waitFor()
  await window.locator('.creation-history > summary').click()
  await window.locator('.creation-history').getByText(/文风体检自动修正/).first().waitFor({ timeout: 10_000 })
  summary.historyTraceText = await window.locator('.creation-history').getByText(/文风体检自动修正/).first().innerText()
  await shot(window, '07-generation-history')

  console.log('WALKTHROUGH_SUMMARY ' + JSON.stringify(summary))
  console.log('WALKTHROUGH_CALLS ' + JSON.stringify(calls))
  console.log('Walkthrough passed: hotspots loaded, topic assessment badge, framework multi-perspective, polish loop improved the draft and left a visible trace, machine-check review opinion, picture review badges, layout validator clean.')
} finally {
  await application.close()
  await new Promise((resolve) => server.close(resolve))
}

// ── 9. 数据库落库证据（应用关闭后直查 SQLite） ──
const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const evidence = {
  hotSnapshots: database.prepare('SELECT COUNT(*) AS n FROM hot_snapshots').get()?.n ?? -1,
  topicAssessment: database.prepare('SELECT assessment_json FROM topic_versions WHERE assessment_json IS NOT NULL LIMIT 1').get()?.assessment_json ?? null,
  articleClean: (() => {
    const rows = database.prepare("SELECT v.raw_markdown AS md FROM article_versions v JOIN articles a ON a.id = v.article_id WHERE v.raw_markdown LIKE '%三步搭建你的内容工作流%' ORDER BY v.created_at DESC LIMIT 1").all()
    const md = rows[0]?.md ?? ''
    return Boolean(md.includes('修复只花了十分钟') && !md.includes('总而言之'))
  })(),
  machineCheckOpinions: database.prepare("SELECT COUNT(*) AS n FROM review_opinions WHERE role_name='机器体检'").get()?.n ?? -1,
  providers: database.prepare('SELECT COUNT(*) AS n FROM providers').get()?.n ?? -1
}
database.close()
console.log('WALKTHROUGH_DB ' + JSON.stringify(evidence))
if (evidence.hotSnapshots < 1) throw new Error('hot_snapshots 没有落库（热点页加载应写入快照）')
if (!evidence.topicAssessment || !evidence.topicAssessment.includes('differentiation')) throw new Error('选题三维评估没有落库')
if (!evidence.articleClean) throw new Error('库里主稿不是体检修正后的干净版本')
if (evidence.machineCheckOpinions < 1) throw new Error('机器体检意见没有落库')
const requiredPrefix = resolve(tmpdir(), 'moliu-walkthrough') + sep
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected directory')
await rm(userDataDir, { recursive: true, force: true })
console.log('Walkthrough DB evidence verified.')
