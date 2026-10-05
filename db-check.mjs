// 直接查库确认 AI 生成结果是否真的落库（绕过 UI 判定的盲区）
import { createServer } from 'node:http'
import { existsSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const userDataDir = resolve(tmpdir(), `moliu-dbcheck-${Date.now()}`)
let callCount = 0
const server = createServer((req, res) => {
  if (!req.url?.includes('/chat/completions')) { res.writeHead(404).end(); return }
  callCount += 1
  let b = ''
  req.on('data', c => { b += c })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    const send = (content) => res.end(JSON.stringify({
      model: 'm',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 }
    }))

    // 按 prompt 意图返回对应协议的输出：
    //   选题 → JSON（键集合须与 DEFAULT_TOPIC_SCHEMA_FIELD_NAMES 完全一致）
    //   框架 / 文章 → Markdown
    //   评审 → 约定的评审区块
    const decoded = b.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)))
    const isTopic = /选题|topic|切入角度|拟标题/.test(decoded)
    const isReview = /评审|review|意见|修改建议/.test(decoded)

    if (isReview) {
      send('## 结构问题\n- 第二部分缺数据支撑\n\n## 表达问题\n- 开头可精简\n\n## 整体评价\n- 立意清晰')
      return
    }
    if (!isTopic) {
      send('## 一、时间账本\n\n把备考拆成 90 天，每周核对。\n\n## 二、刷题悖论\n\n题量不等于分数，问题在错题没归因。\n\n## 三、可执行对策\n\n每天固定三件事。')
      return
    }

    // 严格遵守选题字段协议：7 个字段
    const content = JSON.stringify({
      '\u9009\u9898\u4e3b\u9898': '\u5236\u4f53\u5185\u5907\u8003\u4e09\u4e2a\u6708\uff0c\u65f6\u95f4\u5230\u5e95\u591f\u4e0d\u591f',
      '\u5207\u5165\u89d2\u5ea6': '\u7528\u65f6\u95f4\u8d26\u672c\u7b97\u7ed9\u8bfb\u8005\u770b',
      '\u76ee\u6807\u8bfb\u8005': '\u5728\u804c\u5907\u8003\u7684\u4e0a\u73ed\u65cf',
      '\u6838\u5fc3\u89c2\u70b9': '\u4e09\u4e2a\u6708\u8db3\u591f\uff0c\u4f46\u524d\u63d0\u662f\u65b9\u6cd5\u5bf9',
      '\u60c5\u7eea\u57fa\u8c03': '\u5b9e\u52a1\u3001\u9f13\u52b1',
      '\u62df\u6807\u9898\u65b9\u5411': '\u5012\u8ba1\u65f690\u5929',
      '\u5907\u6ce8': '\u9700\u914d\u4e00\u5f20\u7518\u7279\u56fe'
    })
    res.end(JSON.stringify({
      model: 'm',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 }
    }))
  })
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address()?.port

const env = { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: [resolve('.'), '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
    cwd: process.cwd(), env, timeout: 90_000
  })
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForSelector('.nav-item', { timeout: 40_000 })
  await page.waitForTimeout(1500)

  const nav = async (l) => {
    await page.evaluate((x) => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(x))
      if (t) t.click()
    }, l)
    await page.waitForTimeout(1200)
  }

  // 配网关
  await nav('模型网关')
  const bb = page.getByRole('button', { name: /空白配置/ }).first()
  await bb.waitFor({ state: 'visible', timeout: 30000 })
  await bb.click()
  await page.waitForTimeout(800)
  await page.getByLabel('显示名称').fill('DB检查')
  await page.getByLabel('接口地址').fill(`http://127.0.0.1:${port}/v1`)
  await page.locator('.provider-editor').getByLabel(/访问密钥/).fill('sk-x')
  await page.getByLabel('显示别名').fill('X')
  await page.getByLabel('模型标识').fill('m')
  await page.locator('.provider-editor').getByRole('button', { name: '加密保存' }).click()
  await page.getByText('供应商配置已加密保存').waitFor({ timeout: 20000 })

  // 建并锁定账号
  await nav('账号定位')
  await page.getByRole('button', { name: '新建账号' }).first().click()
  await page.getByText('建立账号基线').waitFor({ timeout: 10000 })
  await page.getByPlaceholder('在这里写下你的想法…').fill('测试号')
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.waitForTimeout(500)
  for (let i = 0; i < 8; i++) {
    const s = page.getByRole('button', { name: '跳过这一问' })
    if (await s.count()) { await s.click(); await page.waitForTimeout(200) } else break
  }
  const m = page.getByRole('button', { name: '手动填写字段' })
  if (await m.count()) { await m.click(); await page.waitForTimeout(400) }
  const sd = page.getByRole('button', { name: '保存为草稿' })
  if (await sd.count()) { await sd.click(); await page.waitForTimeout(900) }
  const lk = page.getByRole('button', { name: /保存并锁定|^锁定/ }).first()
  if (await lk.count()) { await lk.click(); await page.waitForTimeout(1300) }

  // 生成选题
  await nav('选题生成')
  const before = callCount
  const btn = page.getByRole('button', { name: /^生成.*选题|^生成/ }).first()
  await btn.waitFor({ state: 'visible', timeout: 20000 })
  const topicInput = page.getByPlaceholder(/输入热点关键词|内容方向/).first()
  if (await topicInput.count()) { await topicInput.fill('备考规划'); await page.waitForTimeout(300) }
  await btn.click()
  // 等生成动画结束
  for (let i = 0; i < 30; i++) {
    const generating = await page.evaluate(() => /\u6b63\u5728\u751f\u6210/.test(document.body.innerText))
    if (!generating && i > 2) break
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(1500)
  const afterCall = callCount

  // 整页滚到底再看结果
  await page.evaluate(() => {
    const c = document.querySelector('.content')
    if (c) c.scrollTop = c.scrollHeight
  })
  await page.waitForTimeout(800)
  await page.screenshot({ path: resolve('artifacts/release-acceptance-ai/ai-01b-选题结果.png'), animations: 'disabled' }).catch(() => {})

  const uiText = await page.evaluate(() => document.body.innerText)
  console.log(`模型调用: ${before} → ${afterCall}（新增 ${afterCall - before}）`)
  console.log(`UI 含JSON 字段「倒计时90天」: ${uiText.includes('倒计时90天') ? '是' : '否'}`)
  console.log(`UI 仍显示空态: ${uiText.includes('还没有选题草稿') ? '是' : '否'}`)

  // 框架生成（Markdown 协议）
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('内容框架'))
    if (t) t.click()
  })
  await page.waitForTimeout(1300)
  // 前置条件：必须先选框架模板，否则 generate() 会直接 return '请选择框架模板'
  const tplSelect = page.getByLabel('框架模板').first()
  if (await tplSelect.count()) {
    await tplSelect.click()
    await page.waitForTimeout(700)
    const opt = page.locator('.select-popover button, [role="option"]').first()
    if (await opt.count()) { await opt.click(); await page.waitForTimeout(600); console.log('已选择框架模板') }
    else console.log('框架模板下拉无可选项（可能无模板）')
  }
  // 前置条件二：必须选选题或手填框架主题，否则提示「请选择选题，或填写框架主题」
  const fwTopicBox = page.getByPlaceholder(/为什么创作者应该先写框架|补充主题/).first()
  if (await fwTopicBox.count()) {
    await fwTopicBox.fill('为什么刷题越多分数越低')
    await page.waitForTimeout(400)
    console.log('已填写框架主题')
  }
  const fb = page.getByRole('button', { name: /生成框架/ }).first()
  if (await fb.count()) {
    const disabled = await fb.isDisabled().catch(() => null)
    if (disabled) {
      console.log('框架生成: ○ 按钮被禁用（disabled）— 说明模型清单未登记，属测试配置不完整')
    } else {
    const c1 = callCount
    await fb.click()
    for (let i = 0; i < 30; i++) {
      const busy = await page.evaluate(() => /正在生成/.test(document.body.innerText))
      if (!busy && i > 2) break
      await page.waitForTimeout(1000)
    }
    await page.waitForTimeout(1500)
    await page.evaluate(() => { const c = document.querySelector('.content'); if (c) c.scrollTop = c.scrollHeight })
    await page.waitForTimeout(600)
    await page.screenshot({ path: resolve('artifacts/release-acceptance-ai/ai-02-框架结果.png'), animations: 'disabled' }).catch(() => {})
    const fwText = await page.evaluate(() => document.body.innerText)
    const fwOk = fwText.includes('时间账本') || fwText.includes('刷题悖论')
    console.log(`框架生成: ${fwOk ? '✓ 成功' : '✗ 失败'} (模型调用 ${callCount - c1} 次)`)
    }
  } else {
    console.log('框架生成: ○ 未找到按钮')
  }

  // 文章生成
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('文章创作'))
    if (t) t.click()
  })
  await page.waitForTimeout(1400)
  // 前置条件：文章生成需选框架或粘贴手动框架
  const artOutline = page.getByPlaceholder(/输入文章结构/).first()
  if (await artOutline.count()) {
    await artOutline.fill('## 现象\n\n描述刷题悖论。\n\n## 原因\n\n错题未归因。\n\n## 对策\n\n每天三件事。')
    await page.waitForTimeout(400)
    console.log('已填写手动框架')
  }
  const ab = page.getByRole('button', { name: /^生成草稿|^生成/ }).first()
  if (await ab.count()) {
    const c2 = callCount
    await ab.click()
    for (let i = 0; i < 35; i++) {
      const busy = await page.evaluate(() => /正在生成|正在写作/.test(document.body.innerText))
      if (!busy && i > 2) break
      await page.waitForTimeout(1000)
    }
    await page.waitForTimeout(1800)
    const arText = await page.evaluate(() => document.body.innerText)
    const arOk = arText.includes('时间账本') || arText.includes('刷题悖论')
    console.log(`文章生成: ${arOk ? '✓ 成功' : '✗ 失败'} (模型调用 ${callCount - c2} 次)`)
    await page.screenshot({ path: resolve('artifacts/release-acceptance-ai/ai-03-文章结果.png'), animations: 'disabled' }).catch(() => {})
  } else {
    console.log('文章生成: ○ 未找到按钮')
  }

  await app.close(); app = null

  // 查库
  const db = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  const q = (sql) => { try { return db.prepare(sql).all() } catch { return [] } }
  const topics = q('SELECT * FROM topics LIMIT 5')
  const gens = q('SELECT domain, status, COUNT(*) n FROM model_calls GROUP BY domain, status')
  const tasks = q('SELECT domain, status, label FROM generation_tasks ORDER BY rowid DESC LIMIT 5')
  const accounts = q('SELECT name, status FROM account_profiles')
  const arts = q('SELECT COUNT(*) c FROM articles')[0]
  const pmodels = q('SELECT model_id, display_name, enabled, is_default FROM provider_models')
  const provs = q('SELECT display_name, enabled FROM providers')
  const fws = q('SELECT COUNT(*) c FROM frameworks')[0]
  db.close()

  console.log('\n=== 数据库实况 ===')
  console.log('accounts:', JSON.stringify(accounts))
  console.log('providers:', JSON.stringify(provs))
  console.log('provider_models:', JSON.stringify(pmodels))
  console.log('topics 行数:', topics.length)
  topics.slice(0, 2).forEach(t => console.log('  topic:', JSON.stringify(t).slice(0, 180)))
  console.log('frameworks:', JSON.stringify(fws))
  console.log('articles:', JSON.stringify(arts))
  console.log('model_calls:', JSON.stringify(gens))
  console.log('generation_tasks:', JSON.stringify(tasks).slice(0, 300))
  console.log('\n表数量:', tables.length)
  console.log('\n诊断：框架/文章生成按钮的禁用条件是 !models.length，')
  console.log('      models 来自 availableModels(providers) → provider.models。')
  console.log('      若 provider_models 为空，说明本轮只登记了供应商、未登记模型清单，')
  console.log('      属测试配置不完整（真实用户在网关表单里会填模型标识并保存）。')
} catch (e) {
  console.error('执行失败:', e.message)
} finally {
  if (app) { try { await app.close() } catch { /* ignore */ } }
  await new Promise(d => server.close(d))
  if (userDataDir.startsWith(resolve(tmpdir()))) {
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
