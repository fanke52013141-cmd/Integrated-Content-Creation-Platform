/**
 * 全流程走查 · Phase B（端到端）
 *
 * 按项目创作主链路（src/shared/creation-flow.ts）完整走一遍：
 *   AI 服务 → 账号定位 → 热点洞察(筛选/收藏) → 素材库 → 选题 → 框架 → 正文(草稿/提交)
 *   → 评审(三角色+应用) → 配图(方案+资产) → 排版(预览+双平台) → 发布(预检/推送/复盘) → 导出/备份
 *
 * 模型调用由本地 mock 网关承载，响应内容全部来自 walkthrough-content-bank.mjs
 * （走查者按项目各阶段格式预先生成），输入侧仍由项目管道真实生成。
 * 公众号接口用本地 mock（MOLIU_WECHAT_API_BASE），不触达真实微信。
 */
import { createServer } from 'node:http'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { _electron as electron } from 'playwright-core'
import { respondToChat } from './walkthrough-content-bank.mjs'

const artifactDir = resolve('artifacts/walkthrough')
const exportDir = join(artifactDir, 'export')
const backupDir = join(artifactDir, 'backup')
for (const dir of [artifactDir, exportDir, backupDir]) await mkdir(dir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-walkthrough-b-${Date.now()}`)
const findings = []

/* ---------- 最小 PNG 生成（用于封面导入） ---------- */
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8bit RGB
  const rowSize = width * 3
  const raw = Buffer.alloc((rowSize + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowSize + 1)] = 0
    for (let x = 0; x < width; x += 1) {
      const o = y * (rowSize + 1) + 1 + x * 3
      raw[o] = 0x1c; raw[o + 1] = 0x2b; raw[o + 2] = 0x5a
    }
  }
  const idat = deflateSync(raw)
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
const coverPng = makePng(64, 40)

/* ---------- Mock 模型网关（OpenAI 兼容，支持流式与非流式） ---------- */
let seenRequests = []
const modelServer = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) { res.writeHead(404).end(); return }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let parsed
    try { parsed = JSON.parse(body) } catch { res.writeHead(400).end(); return }
    seenRequests.push({ at: Date.now(), stream: Boolean(parsed.stream), system: parsed.messages?.find((m) => m.role === 'system')?.content?.slice(0, 60) ?? '' })
    const reply = respondToChat(parsed)
    res.setHeader('Content-Type', 'application/json')
    if (parsed.stream) {
      res.setHeader('Cache-Control', 'no-cache')
      const pieces = reply.content.match(/[\s\S]{1,120}/g) ?? []
      for (const piece of pieces) {
        res.write(`data: ${JSON.stringify({ model: reply.model, choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ model: reply.model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 700 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    } else {
      res.end(JSON.stringify({
        model: reply.model,
        choices: [{ message: { content: reply.content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 900, completion_tokens: 700 }
      }))
    }
  })
})
await new Promise((done) => modelServer.listen(0, '127.0.0.1', done))
const modelPort = modelServer.address().port

/* ---------- Mock 公众号 API ---------- */
const wechatServer = createServer((req, res) => {
  const url = req.url ?? ''
  res.setHeader('Content-Type', 'application/json')
  if (url.startsWith('/cgi-bin/token')) { res.end(JSON.stringify({ access_token: 'mock-token', expires_in: 7200 })); return }
  if (url.startsWith('/cgi-bin/material/add_material')) { res.end(JSON.stringify({ media_id: 'mock-thumb-001', url: 'https://mmbiz.qpic.cn/mock-cover.png' })); return }
  if (url.startsWith('/cgi-bin/media/uploadimg')) { res.end(JSON.stringify({ url: 'https://mmbiz.qpic.cn/mock-inline.png' })); return }
  if (url.startsWith('/cgi-bin/draft/add')) {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const article = data.articles?.[0]
        if (!article?.thumb_media_id || !article?.content || article.content.length < 100) {
          res.end(JSON.stringify({ errcode: 40007, errmsg: 'invalid media or content' }))
          return
        }
        res.end(JSON.stringify({ media_id: 'mock-draft-001' }))
      } catch { res.end(JSON.stringify({ errcode: 40007, errmsg: 'bad json' })) }
    })
    return
  }
  res.writeHead(404).end()
})
await new Promise((done) => wechatServer.listen(0, '127.0.0.1', done))
const wechatPort = wechatServer.address().port

/* ---------- 启动真实应用 ---------- */
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const app = await electron.launch({
  executablePath,
  args: applicationArgs,
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir, MOLIU_WECHAT_API_BASE: `http://127.0.0.1:${wechatPort}` }
})
const rendererErrors = []
let summary
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => rendererErrors.push(e.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '创作台', exact: true }).waitFor()

  summary = await page.evaluate(async ({ modelPort, exportDir, backupDir, coverPngB64 }) => {
    const log = []
    const problems = []
    const step = (name, detail) => { log.push({ name, detail: detail ?? '' }) }
    const expect = (cond, name, detail) => { if (!cond) { problems.push(`${name}: ${detail ?? '条件不成立'}`); throw new Error(`${name}: ${detail ?? '断言失败'}`) } }
    const pngBytes = Uint8Array.from(atob(coverPngB64), (ch) => ch.charCodeAt(0))
    const MODEL = 'zcode-walkthrough-1'

    /* S0 提示词清单 + AI 服务配置与连接测试 */
    const prompts = await window.moliu.prompts.list()
    expect(prompts.length >= 7, 'S0 内置提示词', `期望至少 7 个，实际 ${prompts.length}`)
    const provider = await window.moliu.providers.save({
      displayName: '走查本地模型', protocol: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${modelPort}/v1`, defaultModel: MODEL,
      enabled: true, isRelay: false,
      capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false },
      models: [{ modelId: MODEL, displayName: '走查模型', reasoningVariants: [], isDefault: true, enabled: true }],
      apiKey: 'walkthrough-key'
    })
    const test = await window.moliu.providers.test(provider.id)
    expect(test.ok === true, 'S0 连接测试', test.message)
    step('S0 AI 服务', `provider=${provider.displayName}, 测试=${test.message}`)

    /* S1 账号定位（虚构账号，走 AI 生成） */
    const answers = [
      { questionId: 'name', question: '这个账号叫什么？', answer: '芯流观察' },
      { questionId: 'domain', question: '主要做哪个领域？', answer: '半导体与通信产业分析' },
      { questionId: 'audience', question: '写给谁看？', answer: '关注科技产业的职场人与长期投资者' },
      { questionId: 'style', question: '希望是什么写作风格或语气？', answer: '理性克制、信息密度高' },
      { questionId: 'persona', question: '这个账号扮演什么 IP 角色？', answer: '前芯片工程师，拆解产业新闻的朋友' },
      { questionId: 'difference', question: '和同类账号相比，有什么不同？', answer: '只讲证据链，给出可核查来源' },
      { questionId: 'value', question: '关注后能给读者带来什么？', answer: '看懂芯片新闻背后的技术与生意逻辑' }
    ]
    const accGen = await window.moliu.accounts.generate({ providerId: provider.id, model: MODEL, answers })
    const accNames = accGen.fields.map((f) => f.name)
    const coreFilled = ['账号名称', '简介', '领域', '目标受众', '写作风格', 'IP人设', '差异化定位', '价值主张'].every((name) => accGen.fields.find((f) => f.name === name)?.value.trim())
    expect(coreFilled, 'S1 账号八字段', JSON.stringify(accGen.fields.map((f) => `${f.name}:${f.value ? '有' : '空'}`)))
    if (accNames.includes('选题方向') && !accGen.fields.find((f) => f.name === '选题方向')?.value.trim()) {
      problems.push('S1 提示词与字段不一致：内置 account.generate 提示词只要求 8 字段，但应用默认含第 9 个字段「选题方向」，AI 永远不会填充它')
    }
    expect(accGen.fields.every((f) => f.source === 'ai'), 'S1 字段来源标注', '应全部为 ai')
    const account = await window.moliu.accounts.save({ fields: accGen.fields, wizardAnswers: answers, status: 'locked', source: 'ai', providerId: provider.id, model: MODEL })
    await window.moliu.accounts.setCurrent(account.id)
    step('S1 账号定位', `${account.name} 已锁定 v${account.versionCount}`)

    /* S2 热点洞察：真实拉榜 + AI 筛选 + 收藏 */
    const hs = await window.moliu.hotspots.bootstrap()
    expect(hs.service.state === 'ready', 'S2 热点服务', JSON.stringify(hs.service))
    const refresh = await window.moliu.hotspots.refresh(['zhihu', 'ithome'])
    const zhihu = refresh.find((r) => r.source.id === 'zhihu')
    const ithome = refresh.find((r) => r.source.id === 'ithome')
    expect(zhihu?.status === 'ready' && ithome?.status === 'ready', 'S2 拉榜', `zhihu=${zhihu?.status}/${zhihu?.error ?? ''}, ithome=${ithome?.status}/${ithome?.error ?? ''}`)
    const chosen = zhihu.items.find((i) => /华为与高通宣布达成广泛专利许可协议/.test(i.title))
    expect(Boolean(chosen), 'S2 选定热点', '知乎榜未找到华为高通条目')
    const filterItems = [...zhihu.items.slice(0, 6), ...ithome.items.slice(0, 4)]
    const filterRes = await window.moliu.hotspots.filter({ accountId: account.id, providerId: provider.id, model: MODEL, items: filterItems })
    expect(filterRes.assessments.length === filterItems.length, 'S2 热点筛选', `输入 ${filterItems.length} 条，返回 ${filterRes.assessments.length} 条`)
    const chosenAssessment = filterRes.assessments.find((a) => a.hotItem.id === chosen.id)
    expect(chosenAssessment?.fit === 'high', 'S2 目标热点契合度', JSON.stringify(chosenAssessment))
    const fav = await window.moliu.hotspots.addFavorite({ hotItem: chosen, tags: ['待选题'] })
    expect(fav.favorite.id, 'S2 收藏热点', '未生成收藏')
    const weiboRefresh = await window.moliu.hotspots.refresh(['weibo'])
    step('S2 负面·微博未登录', weiboRefresh[0]?.error ?? '无错误信息')
    step('S2 热点洞察', `筛选 ${filterItems.length} 条，目标热点 fit=${chosenAssessment.fit}，已收藏`)

    /* S3 素材库（走查者检索到的真实信息以手工素材入库）+ 豆包搜索负面 */
    const m1 = await window.moliu.materials.addManual({
      title: '华为官宣与高通达成多年期广泛专利许可协议',
      summary: '10月5日华为官宣：与高通达成多年期广泛专利许可协议，双方在5G、计算、人工智能和网络等领域实现专利组合交叉授权；高通还将购买华为在计算、AI、网络领域的部分美国专利。这是华为与高通首份涵盖5G技术的许可协议。',
      sourceUrl: 'https://www.huawei.com/cn/news', sourceNote: '华为官网媒体声明（观察者网转载核实）'
    })
    const m2 = await window.moliu.materials.addManual({
      title: '协议意义：5G 首次入池，华为知识产权累计收入超 69 亿美元',
      summary: '对比2020年7月上一份协议（华为为付费方，含约18亿美元追补款），本次5G进入交叉许可范围；交易完成后华为专利许可累计收入超69亿美元，知识产权业务形成正向循环。',
      sourceUrl: 'https://www.zaobao.com.sg', sourceNote: '联合早报/搜狐科技报道'
    })
    const m3 = await window.moliu.materials.addManual({
      title: '麒麟9050 Pro 裸片显微照首曝：双裸片垂直堆叠，密度提升55%',
      summary: 'IT之家曝光华为首款"韬定律逻辑折叠"芯片海思麒麟9050 Pro裸片显微照：双裸片垂直堆叠，晶体管密度提升55%而面积小于前代；同期高通与华为达成逻辑折叠芯片技术相关专利授权。',
      sourceUrl: 'https://www.ithome.com/0/100/9739.htm', sourceNote: 'IT之家'
    })
    const m4 = await window.moliu.materials.addManual({
      title: '逻辑折叠技术路线解读：不追制程的密度提升',
      summary: '逻辑折叠通过晶圆对晶圆混合键合把数字、模拟和存储电路垂直分层堆叠，密度提升不依赖最先进制程；媒体报道其密度约2.38亿颗/平方毫米（媒体口径），支持端侧300亿参数大模型，已随Mate 90系列规模量产。',
      sourceUrl: 'https://www.163.com', sourceNote: '网易科技等公开报道（未官方完整证实，需标注口径）'
    })
    const materials = [m1, m2, m3, m4]
    let doubaoError = ''
    try { await window.moliu.materials.search({ query: '华为 高通 专利', type: 'web', count: 3 }) } catch (e) { doubaoError = e instanceof Error ? e.message : String(e) }
    step('S3 负面·豆包搜索未配置', doubaoError || '竟然成功了（意外）')
    step('S3 素材库', `${materials.length} 条真实检索素材入库`)

    /* S4 选题生成（2 条并行） */
    const topicsRes = await window.moliu.topics.generate({
      accountId: account.id, providerId: provider.id, model: MODEL,
      seedKeyword: '华为 高通 专利许可协议', relatedHotFavoriteIds: [fav.favorite.id], count: 2
    })
    expect(topicsRes.topics.length === 2 && !topicsRes.failed.length, 'S4 选题生成', JSON.stringify(topicsRes.failed))
    const topic = topicsRes.topics[0]
    await window.moliu.topics.setLocked(topic.id, true)
    await window.moliu.topics.setInLibrary(topic.id, true)
    step('S4 选题', `「${topic.fields['选题主题']}」已锁定入库`)

    /* S5 内容框架 */
    const templates = await window.moliu.frameworks.listTemplates()
    const template = templates.find((t) => t.id === 'system-default') ?? templates[0]
    const fwRes = await window.moliu.frameworks.generate({
      topicId: topic.id, accountId: account.id, materialIds: materials.map((m) => m.id),
      templateId: template.id, count: 1, providerId: provider.id, model: MODEL
    })
    expect(fwRes.frameworks.length === 1, 'S5 框架生成', JSON.stringify(fwRes.failed))
    const framework = fwRes.frameworks[0]
    expect(framework.sections.length === template.sections.length && framework.sections.every((s) => s.content.trim()), 'S5 章节完整', JSON.stringify(framework.sections.map((s) => `${s.name}:${s.content.length}字`)))
    await window.moliu.frameworks.setLocked(framework.id, true)
    step('S5 框架', `${template.sections.join('/')} 全部非空`)

    /* S6 正文生成 + 工作草稿 + 提交 */
    const artRes = await window.moliu.articles.generate({
      frameworkId: framework.id, materialIds: materials.map((m) => m.id),
      accountSelection: { mode: 'inherit' }, count: 1, providerId: provider.id, model: MODEL
    })
    expect(artRes.articles.length === 1, 'S6 正文生成', JSON.stringify(artRes.failed))
    let article = artRes.articles[0]
    expect(/^#\s+\S/m.test(article.rawMarkdown), 'S6 成稿格式', '未以一级标题开始')
    const draft = await window.moliu.articles.saveDraft({ articleId: article.id, baseVersionId: article.currentVersionId, content: `${article.rawMarkdown}\n\n<!-- 走查手改：工作草稿 -->` })
    expect(draft.revision === 1, 'S6 工作草稿暂存', `revision=${draft.revision}`)
    article = await window.moliu.articles.commitDraft(article.id, draft.revision)
    expect(article.versionCount === 2, 'S6 提交版本', `versionCount=${article.versionCount}`)
    expect(!(await window.moliu.articles.getDraft(article.id)), 'S6 草稿清空', '提交后草稿仍存在')
    step('S6 正文', `生成→暂存→提交，当前 v${article.versionCount}，${article.rawMarkdown.length} 字`)

    /* S7 评审（3 角色）+ 应用意见改稿 */
    const roles = await window.moliu.reviews.listRoles()
    expect(roles.length >= 3, 'S7 评审角色', `实际 ${roles.length}`)
    const taskRes = await window.moliu.reviews.start({ articleId: article.id, roleIds: roles.map((r) => r.id), fallbackProviderId: provider.id, fallbackModel: MODEL })
    expect(taskRes.task.status === 'completed', 'S7 评审完成', JSON.stringify(taskRes.failed))
    expect(taskRes.task.opinions.length === roles.length, 'S7 意见数量', `${taskRes.task.opinions.length}/${roles.length}`)
    expect(taskRes.task.opinions.every((o) => o.problems.length > 0), 'S7 问题解析', '存在无问题的意见')
    const adopted = taskRes.task.opinions.flatMap((o) => o.problems).filter((p) => p.adopted).length
    const applied = await window.moliu.reviews.apply(taskRes.task.id, provider.id, MODEL)
    expect(applied.versionCount === 3, 'S7 应用意见', `改稿后 versionCount=${applied.versionCount}`)
    expect(applied.rawMarkdown !== article.rawMarkdown, 'S7 改稿生效', '正文未变化')
    article = applied
    step('S7 评审', `${roles.length} 角色完成，采纳 ${adopted} 条，改稿为 v${article.versionCount}`)

    /* S8 配图方案 + 资产 */
    const pack = await window.moliu.visuals.generate({ articleId: article.id, providerId: provider.id, model: MODEL, inlineCount: 2 })
    expect(pack.cover.prompt && pack.inlineImages.length === 2 && pack.releaseImages.length === 3, 'S8 配图方案', `封面=${Boolean(pack.cover.prompt)} 文内=${pack.inlineImages.length} 发布=${pack.releaseImages.length}`)
    let imageError = ''
    try { await window.moliu.visuals.generateImage({ packId: pack.id, kind: 'cover', slot: 0, prompt: '测试', providerId: provider.id, model: MODEL }) } catch (e) { imageError = e instanceof Error ? e.message : String(e) }
    expect(/图片生成/.test(imageError), 'S8 负面·生图能力未开启', imageError || '竟然成功了（意外）')
    const asset = await window.moliu.visuals.importImageData({ packId: pack.id, kind: 'cover', slot: 0, prompt: pack.cover.prompt, fileName: 'walkthrough-cover.png', data: pngBytes.buffer })
    expect(asset.url.startsWith('moliu-asset://'), 'S8 封面导入', asset.url)
    step('S8 配图', `方案完整，封面资产 ${asset.fileName} 已导入；生图能力关闭时错误提示：${imageError}`)

    /* S9 排版（预览 + 微信 + 小红书） */
    const themes = await window.moliu.layouts.themes()
    const genres = await window.moliu.layouts.genres()
    const theme = themes.find((t) => t.suitedFor.includes('analysis')) ?? themes[0]
    const preview = await window.moliu.layouts.renderPreview({ markdown: article.rawMarkdown, platform: 'wechat', themeId: theme.id })
    expect(preview.html.includes('华为与高通'), 'S9 实时预览', '预览未包含正文标题')
    const layoutW = await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat', themeId: theme.id })
    const layoutX = await window.moliu.layouts.create({ articleId: article.id, platform: 'xiaohongshu', themeId: theme.id })
    const layoutErrors = [...(layoutW.violations ?? []), ...(layoutX.violations ?? [])].filter((v) => v.level === 'error')
    expect(!layoutErrors.length, 'S9 排版合规', JSON.stringify(layoutErrors))
    expect(layoutW.html.includes('<section') || layoutW.html.includes('<p'), 'S9 微信结构', 'HTML 缺少区块结构')
    step('S9 排版', `主题=${theme.name}，预览+微信+小红书就绪，genres=${genres.length}`)

    /* S10 发布：连接 → 预检 → 表单 → 推送 → 登记 → 复盘 */
    const channel = await window.moliu.publishing.saveWechatChannel({ appId: 'wx-walkthrough-demo', appSecret: 'demo-secret', enabled: true })
    expect(channel.enabled && channel.hasAppSecret, 'S10 公众号配置', JSON.stringify({ appId: channel.appId, secret: channel.hasAppSecret }))
    const testRes = await window.moliu.publishing.testWechatChannel()
    expect(testRes.ok, 'S10 公众号连通', testRes.message)
    await window.moliu.publishing.saveForm({ articleId: article.id, appId: 'wx-walkthrough-demo', layoutId: layoutW.id, author: '芯流观察', digest: '5G 入池、专利出海、博弈换场：读懂这份协议的三层信号', coverAssetId: asset.id, thumbMediaId: '', contentSourceUrl: '' })
    const pre1 = await window.moliu.publishing.preflight({ articleId: article.id, layoutId: layoutW.id, coverAssetId: asset.id })
    expect(pre1.ready, 'S10 交付预检', JSON.stringify(pre1.issues))
    const pub = await window.moliu.publishing.pushWechatDraft({ articleId: article.id, layoutId: layoutW.id, coverAssetId: asset.id, author: '芯流观察', digest: '5G 入池、专利出海、博弈换场：读懂这份协议的三层信号' })
    expect(pub.status === 'draft' && pub.externalDraftId === 'mock-draft-001', 'S10 推送草稿箱', `${pub.status}/${pub.externalDraftId}/${pub.errorMessage ?? ''}`)
    const published = await window.moliu.publishing.update({ id: pub.id, status: 'published', publishedUrl: 'https://mp.weixin.qq.com/s/mock-walkthrough' })
    expect(published.status === 'published', 'S10 登记发布链接', published.publishedUrl)
    await window.moliu.publishing.saveRetro({ id: pub.id, goal: '验证"专利反向输出"角度是否能带来产业读者', result: '模拟数据：阅读 2400，完读率 46%，涨粉 21', lesson: '带具体数字与对手视角的标题打开率更高；技术类比段落完读率最好' })
    await window.moliu.accounts.addMemory({ profileId: account.id, insight: '带具体数字与对手视角的标题打开率更高', source: '发布复盘' })
    step('S10 发布', `预检通过→草箱 mock-draft-001→已登记链接→复盘+账号记忆`)

    /* S11 任务台账与调用日志健康度 */
    await new Promise((r) => setTimeout(r, 800))
    const tasks = await window.moliu.generation.list(50)
    const badTasks = tasks.filter((t) => t.status === 'failed' || t.status === 'interrupted')
    const logs = await window.moliu.providers.logs(provider.id)
    const failedLogs = logs.filter((l) => !l.success)
    step('S11 台账', `任务 ${tasks.length} 条（异常 ${badTasks.length}），模型调用 ${logs.length} 次（失败 ${failedLogs.length}）`)
    if (badTasks.length) problems.push(`S11 生成任务存在失败/中断：${badTasks.map((t) => `${t.domain}:${t.status}:${t.detail}`).join(' | ')}`)
    if (failedLogs.length) problems.push(`S11 模型调用存在失败记录：${failedLogs.map((l) => `${l.model}:${l.errorKind}:${l.errorMessage}`).slice(0, 5).join(' | ')}`)

    return { log, problems, ids: { account: account.id, topic: topic.id, framework: framework.id, article: article.id, pack: pack.id, layout: layoutW.id, publication: pub.id, provider: provider.id }, article: { title: article.rawMarkdown.split('\n')[0], versionCount: article.versionCount, chars: article.rawMarkdown.length }, filterFit: filterRes.assessments.filter((a) => a.fit === 'high').length, doubaoError, imageError, weiboError: weiboRefresh[0]?.error, taskCount: tasks.length, logCount: logs.length, failedLogCount: failedLogs.length }
  }, { modelPort, exportDir, backupDir, coverPngB64: coverPng.toString('base64') })

  /* S12 导出与备份（targetDir 出于安全只允许 userData 内，导出后由 Node 拷贝到 artifacts） */
  const page2 = (await app.windows())[0]
  const exports = await page2.evaluate(async ({ articleId }) => {
    const dataPath = await window.moliu.app.getDataPath()
    const exportDir = `${dataPath}/walkthrough-export`
    const backupDir = `${dataPath}/walkthrough-backup`
    const out = { dataPath }
    const md = await window.moliu.app.exportArticle({ articleId, format: 'markdown', targetDir: exportDir })
    const html = await window.moliu.app.exportArticle({ articleId, format: 'html', targetDir: exportDir })
    out.md = md.path; out.html = html.path
    const backup = await window.moliu.app.createBackup({ targetDir: backupDir })
    out.backup = backup.path
    out.backups = await window.moliu.app.listBackups()
    return out
  }, { articleId: summary.ids.article })
  summary.exports = exports
} catch (error) {
  findings.push(`Phase B 执行中断：${error instanceof Error ? error.message : String(error)}`)
  throw error
} finally {
  await app.close().catch(() => {})
  await new Promise((r) => modelServer.close(r))
  await new Promise((r) => wechatServer.close(r))
}

console.log('\n========== 全流程走查结果 ==========')
// 把 userData 内的导出产物拷贝到 artifacts，便于离线查看
for (const [label, source] of [['md', summary.exports.md], ['html', summary.exports.html], ['backup', summary.exports.backup]]) {
  if (source) {
    const fileName = source.split(/[\\/]/).pop()
    await copyFile(source, join(artifactDir, `export-${label}-${fileName}`)).catch(() => {})
  }
}
for (const entry of summary.log) console.log(`  ${entry.name} · ${entry.detail}`)
console.log(`\n导出：md=${summary.exports.md}`)
console.log(`导出：html=${summary.exports.html}`)
console.log(`备份：${summary.exports.backup}（清单 ${summary.exports.backups.length} 条）`)
if (summary.problems.length) {
  console.log('\n发现问题：')
  for (const p of summary.problems) console.log(`  [问题] ${p}`)
  findings.push(...summary.problems)
}
if (rendererErrors.length) {
  console.log('渲染层错误：', rendererErrors)
  findings.push(`渲染层 pageerror：${rendererErrors.join(' | ')}`)
}

await writeFile(join(artifactDir, 'phase-b-summary.json'), JSON.stringify({ summary, findings, seenRequests: seenRequests.slice(0, 50) }, null, 2), 'utf8')
console.log(`\n模型网关共收到 ${seenRequests.length} 次调用（含流式 ${seenRequests.filter((r) => r.stream).length} 次）`)
console.log(findings.length ? `PHASE-B FINISHED WITH ${findings.length} FINDING(S)` : 'PHASE-B ALL GREEN')
process.exitCode = findings.length ? 2 : 0
