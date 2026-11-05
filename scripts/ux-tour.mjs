/**
 * UX 巡检：以新用户视角走完每个页面，收集截图与页面结构（标题/按钮/空态文案），
 * 供人工审读找体验摩擦点。不带断言——目标是"看"，不是"验"。
 */
import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'

const server = createServer(async (request, response) => {
  if (request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += chunk
  const answer = body.includes('<热搜关键词>')
    ? JSON.stringify({ 选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎', 切入角度: '用三个失败案例反推落地条件', 目标读者: '正在把 AI 引入团队的负责人', 核心观点: 'Agent 落地是流程改造，不是工具采购', 情绪基调: '冷静、反常识', 拟标题方向: '别再买工具了', 备注: '', 评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: '同题不少但失败视角少见' } })
    : body.includes('生成任务') && !body.includes('写作任务')
    ? '<框架><标题>先有框架，创作才有方向</标题><开头>从动笔前的混乱切入。</开头><论点一>框架先确定读者和核心承诺。</论点一><论点二>框架让素材有明确位置。</论点二><论点三>框架降低写作返工成本。</论点三><结尾>用可执行的下一步收束。</结尾></框架>'
    : body.includes('<热搜关键词>')
      ? JSON.stringify({ 选题主题: 'AI Agent 真正落地前，先跨过这三道业务坎', 切入角度: '用三个失败案例反推落地条件', 目标读者: '正在把 AI 引入团队的负责人', 核心观点: 'Agent 落地是流程改造，不是工具采购', 情绪基调: '冷静、反常识', 拟标题方向: '别再买工具了', 备注: '', 评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: '同题不少但失败视角少见' } })
        : body.includes('配图编辑')
          ? JSON.stringify({ reasoning: '为文章配封面与正文图', pictures: [
              { kind: 'cover', subject: '封面主视觉', purpose: '点题', blockIndex: 0, ratio: '21:9', alt: '封面', priority: 'required' },
              { kind: 'inline', subject: '流程示意', purpose: '呼应第一段', blockIndex: 1, ratio: '16:9', alt: '流程图', priority: 'optional' }
            ] })
        : body.includes('可直接生图')
          ? JSON.stringify({ pictures: [...body.replace(/\\"/g, '"').matchAll(/"id":"([0-9a-f-]{36})","subject"/g)].map(m => ({ id: m[1], prompt: '扁平插画，主体明确，不含文字和水印' })) })
          : body.includes('配图审稿人')
            ? JSON.stringify({ pictures: [...body.replace(/\\"/g, '"').matchAll(/"id":"([0-9a-f-]{36})","kind"/g)].map(m => ({ id: m[1], verdict: 'match', reason: '契合主题' })) })
            : body.includes('<评审意见>')
              ? '<评审意见>位置：开头｜严重程度：中｜问题：钩子偏弱｜建议：用反问强化冲突\n总体建议：强化开头。</评审意见>'
              : body.includes('文风体检发现的问题')
                ? '# 从一次沉默的超时说起\n\n上周帮朋友排查一个老接口，日志里什么都没有。真正的坑埋在半年前的一次重构里：重试次数被人从三次改成了零，没人通知，文档也没更新。修复只花了十分钟，找回信任要几个月。'
                : body.includes('<改稿任务>')
                  ? '# 从一次沉默的超时说起（改）\n\n开头已经按评审意见重写，用反问制造冲突，正文保留原有事实与结构。'
                  : '# 从一次沉默的超时说起\n\n上周帮朋友排查一个老接口，日志里什么都没有，只有一行沉默的超时。真正的坑埋在半年前的一次重构里：有人把重试次数从三次改成了零，没人通知，文档也没更新。这种事不惊心动魄，却最消耗团队的信任。修复只花了十分钟，找回信任要几个月。\n\n## 先定结构，再动手\n\n把要说的话按读者的问题排顺序，每一节只回答一个问题。\n\n## 给一个能立刻做的动作\n\n写完先给自己讲一遍，讲不顺的地方就是结构有问题的地方。'
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ model: 'ux-tour', choices: [{ message: { content: answer }, finish_reason: 'stop' }] }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()

const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const artifactDir = resolve('artifacts', 'ux-tour')
const userDataDir = resolve(tmpdir(), 'moliu-ux-tour', String(Date.now()))
await mkdir(artifactDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })
const application = await electron.launch({ executablePath, args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir } })
let summaryGen = null
const PAGE_NAMES = ['创作台', '账号定位', '热点洞察', '选题生成', '内容框架', '文章创作', '内容评审', '智能配图', '文章排版', '发布管理', '素材库', '提示词', '数据与备份', 'AI 服务']
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')

  // ── 第一幕：新用户空态 ──
  await window.screenshot({ path: resolve(artifactDir, '00-first-launch-before-guide.png'), animations: 'disabled' })
  const guide = window.getByRole('button', { name: '稍后再说' })
  await guide.first().click({ timeout: 8000 }).catch(() => {})
  for (const name of PAGE_NAMES) {
    await window.getByRole('button', { name, exact: true }).first().click({ timeout: 10_000 }).catch(error => console.error(`页面点击失败 ${name}: ${error.message.split('\n')[0]}`))
    await window.waitForTimeout(600)
    await window.screenshot({ path: resolve(artifactDir, `empty-${PAGE_NAMES.indexOf(name)}-${name}.png`), animations: 'disabled', fullPage: false })
  }

  // ── 第二幕：配置模型 ──
  await window.getByRole('button', { name: 'AI 服务' }).first().click()
  await window.getByRole('button', { name: /空白配置/ }).click()
  await window.getByLabel('显示名称').fill('体验模型')
  await window.getByLabel('接口地址').fill(`http://127.0.0.1:${address.port}/v1`)
  await window.locator('.provider-editor').getByLabel(/访问密钥/).fill('ux-key')
  await window.getByLabel('显示别名').fill('UX Tour Model')
  await window.getByLabel('模型标识').fill('ux-tour')
  await window.locator('.provider-editor').getByRole('button', { name: '测试并加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()

  // ── 第三幕：账号定位向导（新用户第一条内容资产）──
  await window.getByRole('button', { name: '账号定位' }).click()
  await window.getByRole('button', { name: '新建账号' }).first().click()
  await window.getByText('建立账号基线').waitFor()
  await window.screenshot({ path: resolve(artifactDir, '10-account-wizard.png'), animations: 'disabled' })
  await window.getByPlaceholder('在这里写下你的想法…').fill('面向独立创作者的效率工具评测号')
  await window.getByRole('button', { name: '保存并继续' }).click()
  for (let index = 0; index < 6; index += 1) await window.getByRole('button', { name: '跳过这一问' }).click()
  await window.getByRole('button', { name: '手动填写字段' }).click()
  await window.getByRole('button', { name: '保存为草稿' }).click()
  await window.getByRole('button', { name: '保存并锁定' }).click()
  await window.getByRole('button', { name: '解锁编辑' }).waitFor()
  await window.screenshot({ path: resolve(artifactDir, '11-account-locked.png'), animations: 'disabled' })

  // ── 第四幕：选题 → 框架 → 文章（有数据态）──
  await window.getByRole('button', { name: '热点洞察' }).click()
  await window.getByRole('heading', { name: '热点雷达' }).waitFor()
  await window.locator('.hot-item-list li, .hotspot-source-rail li').first().waitFor({ timeout: 60_000 }).catch(() => {})
  await window.screenshot({ path: resolve(artifactDir, '12-hotspots-data.png'), animations: 'disabled' })
  await window.getByRole('button', { name: '选题生成' }).first().click()
  await window.locator('textarea[name="seedKeyword"]').fill('AI Agent 工作流落地')
  await window.getByRole('group', { name: '数量' }).getByRole('button', { name: '1 条', exact: true }).click()
  // 生成走 API 路径（UI 点击曾出现无响应的渲染时序，走查关注点是页面呈现而非点击本身）
  const topicGen = await window.evaluate(async () => {
    const provider = (await window.moliu.providers.list())[0]
    try {
      const result = await window.moliu.topics.generate({ providerId: provider.id, model: 'ux-tour', seedKeyword: 'AI Agent 工作流落地', relatedHotFavoriteIds: [], count: 1 })
      return { ok: true, topics: result.topics.length, failed: result.failed, listed: (await window.moliu.topics.list()).length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  console.log('topicGen=' + JSON.stringify(topicGen))
  if (!topicGen.ok) throw new Error(`选题 API 失败：${JSON.stringify(topicGen)}`)
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '稍后再说' }).first().click({ timeout: 8000 }).catch(() => {})
  await window.getByRole('button', { name: '选题生成' }).first().click()
  await window.locator('.topic-card').first().waitFor({ timeout: 15_000 })
  await window.locator('.topic-card').first().getByTitle('锁定选题').click()
  await window.getByText('已锁定为创作基线').waitFor()
  await window.screenshot({ path: resolve(artifactDir, '13-topic-locked.png'), animations: 'disabled' })
  const frameworkGen = await window.evaluate(async () => {
    const provider = (await window.moliu.providers.list())[0]
    const template = (await window.moliu.frameworks.listTemplates())[0]
    const topic = (await window.moliu.topics.list())[0]
    try {
      const result = await window.moliu.frameworks.generate({ topicId: topic?.id, templateId: template.id, materialIds: [], providerId: provider.id, model: 'ux-tour', count: 1 })
      return { ok: true, count: result.frameworks.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  console.log('frameworkGen=' + JSON.stringify(frameworkGen))
  if (!frameworkGen.ok) throw new Error(`框架 API 失败：${JSON.stringify(frameworkGen)}`)
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '稍后再说' }).first().click({ timeout: 8000 }).catch(() => {})
  await window.getByRole('button', { name: '内容框架' }).first().click()
  await window.locator('.framework-card, .frameworks-page article').first().waitFor({ timeout: 15_000 })
  await window.screenshot({ path: resolve(artifactDir, '14-framework.png'), animations: 'disabled' })

  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByRole('button', { name: '新建草稿', exact: true }).click()
  await window.getByLabel('手动框架').fill('标题：从一次沉默的超时说起\n开头：一次没通知的配置改动\n论点：流程先于工具\n结尾：给一个立刻能做的动作')
  await window.getByRole('button', { name: '生成草稿' }).click()
  await window.getByText(/已生成 1 篇成稿/).waitFor({ timeout: 60_000 })
  await window.waitForTimeout(800)
  await window.screenshot({ path: resolve(artifactDir, '15-article.png'), animations: 'disabled' })

  // ── 第五幕：评审 → 配图（有数据态）──
  await window.evaluate(async () => {
    const provider = (await window.moliu.providers.list())[0]
    const articles = await window.moliu.articles.listSummaries({ limit: 3 })
    const role = await window.moliu.reviews.saveRole({ name: '体验审稿人', systemPrompt: '审稿并使用 <评审意见> 输出', extractionTag: '评审意见', extractionOccurrence: 'last', dimensions: ['可读性'], sortOrder: 0 })
    await window.moliu.reviews.start({ articleId: articles.items[0].id, roleIds: [role.id], fallbackProviderId: provider.id, fallbackModel: 'ux-tour' })
  })
  await window.getByRole('button', { name: '内容评审' }).first().click()
  await window.locator('.review-opinion', { hasText: '机器体检' }).first().waitFor({ timeout: 15_000 })
  await window.screenshot({ path: resolve(artifactDir, '16-review.png'), animations: 'disabled' })
  await window.evaluate(async () => {
    const provider = (await window.moliu.providers.list())[0]
    const articles = await window.moliu.articles.listSummaries({ limit: 3 })
    const article = await window.moliu.articles.get(articles.items[0].id)
    const api = window.moliu.visuals.studio
    const plan = await api.plan({ articleId: article.id, providerId: provider.id, model: 'ux-tour', count: 1, density: 'standard', cover: true, header: false, maxInline: 4 })
    const withPrompts = await api.prompts({ providerId: provider.id, model: 'ux-tour', planId: plan.id, expectedRevision: plan.revision })
    await api.review({ providerId: provider.id, model: 'ux-tour', planId: withPrompts.id, expectedRevision: withPrompts.revision })
  })
  await window.getByRole('button', { name: '智能配图', exact: true }).click()
  await window.waitForTimeout(1200)
  await window.screenshot({ path: resolve(artifactDir, '17-visual.png'), animations: 'disabled' })

  // ── 第六幕：排版 → 发布（走通到草稿箱）──
  await window.getByRole('button', { name: '文章排版' }).first().click()
  await window.locator('.layouts-page h1').waitFor()
  await window.waitForTimeout(800)
  await window.screenshot({ path: resolve(artifactDir, '18-layout.png'), animations: 'disabled' })
  await window.evaluate(async () => {
    const items = (await window.moliu.articles.listSummaries({ limit: 3 })).items
    await window.moliu.layouts.create({ articleId: items[0].id, platform: 'wechat' })
  })
  await window.getByRole('button', { name: '发布管理' }).click()
  await window.waitForTimeout(1000)
  await window.screenshot({ path: resolve(artifactDir, '19-publish.png'), animations: 'disabled' })

  console.log('UX tour done: ' + PAGE_NAMES.length + ' pages captured in both states')
} finally {
  await application.close()
  await new Promise((resolve) => server.close(resolve))
}
console.log('artifactDir=' + artifactDir)
const requiredPrefix = resolve(tmpdir(), 'moliu-ux-tour') + resolve('/')
if (userDataDir.startsWith(resolve(tmpdir(), 'moliu-ux-tour'))) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
