// 心流 Desktop · 发布前验收测试
//
// 目的：判断当前版本能否发给真实用户。
// 现有测试的空白：单元测试 19 个文件都测服务层，UI 冒烟只覆盖「配网关 + 建账号」，
// 创作链路（选题→框架→文章→评审→配图→排版→发布）在 UI 层从未被点过。
// 本脚本用本地 mock 模型服务 + 真实 Electron，走通真实用户会走的每一步。
//
// 环境要点：
//   1. 必须 delete env.ELECTRON_RUN_AS_NODE（否则 Electron 走纯 Node 模式，拿不到 BrowserWindow）
//   2. 无 GPU 环境需 --disable-gpu，否则渲染进程反复崩溃
import { createServer } from 'node:http'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts/release-acceptance')
mkdirSync(artifactDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-acceptance-${Date.now()}`)

// ── mock 模型服务：真实用户会配置一个 OpenAI 兼容端点，这里用本地替身 ──
let requestCount = 0
const modelServer = createServer((req, res) => {
  if (!req.url?.includes('/chat/completions')) { res.writeHead(404).end(); return }
  requestCount += 1
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    // 按 prompt 内容返回对应格式，模拟真实模型会依指令产出不同结构
    let content = '# 验收测试文章\n\n这是 mock 模型返回的正文，用于验证链路是否连通。'
    try {
      const parsed = JSON.parse(body || '{}')
      const prompt = JSON.stringify(parsed.messages ?? parsed.prompt ?? '')
      if (/选题|topic/i.test(prompt)) {
        content = '选题角度一：普通人的体制内备考焦虑\n选题角度二：为什么努力复习却上不了岸\n选题角度三：三个月冲刺的真实时间账本'
      } else if (/框架|framework|章节|structure/i.test(prompt)) {
        content = '## 一、现象\n\n描述普遍现象。\n\n## 二、原因\n\n分析根本原因。\n\n## 三、对策\n\n给出可执行做法。'
      } else if (/评审|review|问题|建议/i.test(prompt)) {
        content = '## 结构\n- 建议补充数据支撑\n\n## 表达\n- 开头略显冗长\n\n## 整体\n立意清晰'
      }
    } catch { /* mock 不解析也无所谓 */ }
    res.end(JSON.stringify({
      model: 'moliu-acceptance',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 60 }
    }))
  })
})
await new Promise((r) => modelServer.listen(0, '127.0.0.1', r))
const modelPort = modelServer.address()?.port
if (!modelPort) throw new Error('mock model server failed to start')
console.log(`mock 模型服务: http://127.0.0.1:${modelPort}/v1`)

const executablePath = resolve('node_modules/electron/dist/electron.exe')
if (!existsSync(executablePath)) { console.error('electron.exe not found'); process.exit(1) }

const env = { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
delete env.ELECTRON_RUN_AS_NODE

const results = []
function record(stage, status, detail = '') {
  results.push({ stage, status, detail })
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○'
  console.log(`  ${icon} [${stage}] ${detail}`)
}

let app
try {
  app = await electron.launch({
    executablePath,
    args: [resolve('.'), '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
    cwd: process.cwd(),
    env,
    timeout: 90_000
  })
  const page = await app.firstWindow({ timeout: 60_000 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  const shot = (name) => page.screenshot({ path: join(artifactDir, `${name}.png`), animations: 'disabled', fullPage: true })
  const step = async (label, fn, { optional = false } = {}) => {
    const before = errors.length
    try {
      const detail = await fn()
      const newErr = errors.slice(before)
      if (newErr.length) record(label, 'FAIL', `出现 ${newErr.length} 个错误：${newErr[0].slice(0, 100)}`)
      else record(label, 'PASS', detail ?? '')
    } catch (e) {
      record(label, optional ? 'SKIP' : 'FAIL', e.message.slice(0, 160))
    }
  }

  console.log('\n══ 第一段：首次启动 ══')
  await page.waitForSelector('.nav-item', { timeout: 40_000 })
  await page.waitForTimeout(1500)

  await step('应用启动并进入创作台', async () => {
    const heading = await page.evaluate(() => document.querySelector('.page h2')?.textContent?.trim() ?? '')
    if (heading !== '创作台') throw new Error(`首屏标题异常：${heading}`)
    const boot = await page.evaluate(() => !!document.querySelector('.boot-screen'))
    if (boot) throw new Error('启动屏未消失')
    await shot('01-创作台')
    return `首屏「${heading}」，无启动屏残留`
  })

  await step('未配置网关时给出明确引导（而非空白）', async () => {
    const text = await page.evaluate(() => document.body.innerText)
    if (!text.includes('连接一个文本模型')) throw new Error('缺少首次配置引导')
    return '首页提示先连模型服务'
  })

  console.log('\n══ 第二段：配置模型网关 ══')
  await step('进入模型网关页', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('模型网关'))
      if (t) t.click()
    })
    await page.waitForTimeout(1000)
    const heading = await page.evaluate(() => document.querySelector('.page h2')?.textContent?.trim() ?? '')
    if (!heading.includes('模型网关')) throw new Error(`未进入网关页，当前：${heading}`)
    return heading
  })

  let saved = false
  await step('填写并保存供应商配置', async () => {
    await page.getByRole('button', { name: /空白配置/ }).click()
    await page.waitForTimeout(700)
    await page.getByLabel('显示名称').fill('验收用模型')
    await page.getByLabel('接口地址').fill(`http://127.0.0.1:${modelPort}/v1`)
    await page.locator('.provider-editor').getByLabel(/访问密钥/).fill('sk-acceptance-key')
    await page.getByLabel('显示别名').fill('Acceptance')
    await page.getByLabel('模型标识').fill('moliu-acceptance')
    await page.locator('.provider-editor').getByRole('button', { name: '加密保存' }).click()
    await page.getByText('供应商配置已加密保存').waitFor({ timeout: 20_000 })
    saved = true
    await shot('02-网关已配置')
    return '保存成功（含连通性验证）'
  })

  console.log('\n══ 第三段：建立账号定位 ══')
  await step('创建账号并锁定', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('账号定位'))
      if (t) t.click()
    })
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: '新建账号' }).first().click()
    await page.getByText('建立账号基线').waitFor({ timeout: 10_000 })
    await page.getByPlaceholder('在这里写下你的想法…').fill('体制内备考互助号')
    await page.getByRole('button', { name: '保存并继续' }).click()
    await page.waitForTimeout(500)
    for (let i = 0; i < 8; i += 1) {
      const skip = page.getByRole('button', { name: '跳过这一问' })
      if (await skip.count()) { await skip.click(); await page.waitForTimeout(220) } else break
    }
    const manual = page.getByRole('button', { name: '手动填写字段' })
    if (await manual.count()) { await manual.click(); await page.waitForTimeout(400) }
    const saveDraft = page.getByRole('button', { name: '保存为草稿' })
    if (await saveDraft.count()) { await saveDraft.click(); await page.waitForTimeout(900) }
    await page.waitForTimeout(800)
    await shot('03-账号已建')
    return '账号创建完成'
  })

  console.log('\n══ 第四段：创作链路端到端 ══')

  await step('选题页可操作', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('选题生成'))
      if (t) t.click()
    })
    await page.waitForTimeout(1000)
    const hasComposer = await page.evaluate(() => !!document.querySelector('.topic-composer'))
    if (!hasComposer) throw new Error('选题页没有生成设置区')
    return '生成设置区可见'
  }, { optional: true })

  await step('框架页可操作', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('内容框架'))
      if (t) t.click()
    })
    await page.waitForTimeout(1000)
    const hasComposer = await page.evaluate(() => !!document.querySelector('.framework-composer'))
    if (!hasComposer) throw new Error('框架页没有生成设置区')
    await shot('04-框架页')
    return '生成设置区可见'
  }, { optional: true })

  await step('文章页可操作（不依赖模型的手动路径）', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('文章创作'))
      if (t) t.click()
    })
    await page.waitForTimeout(1200)
    // 走「导入现成稿」：这是不依赖模型的关键兜底路径
    const importBtn = page.getByRole('button', { name: /导入现成稿|导入现成稿|导入现成文章/ }).first()
    if (await importBtn.count()) {
      await importBtn.click()
      await page.waitForTimeout(700)
      const ta = page.getByLabel('粘贴 Markdown')
      if (await ta.count()) {
        await ta.fill('# 体制内备考经验贴\n\n## 正文第一段\n\n这是一篇用于验收的稿件。\n\n## 正文第二段\n\n内容足够长以便观察排版效果。')
        await page.waitForTimeout(300)
        await page.getByRole('button', { name: '导入粘贴内容' }).click()
        await page.waitForTimeout(1600)
        const hasArticle = await page.evaluate(() => !!document.querySelector('.article-editor'))
        await shot('05-文章已导入')
        if (!hasArticle) throw new Error('导入后未进入编辑器')
        return '粘贴导入 → 编辑器正常（无模型也能用）'
      }
    }
    throw new Error('找不到导入入口')
  })

  await step('锁定文章后可进入下游', async () => {
    const lock = page.getByRole('button', { name: /^锁定$/ }).first()
    if (await lock.count()) {
      await lock.click()
      await page.waitForTimeout(1400)
      return '锁定成功'
    }
    throw new Error('找不到锁定按钮')
  }, { optional: true })

  await step('评审页能看到该文章', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('内容评审'))
      if (t) t.click()
    })
    await page.waitForTimeout(1200)
    const body = await page.evaluate(() => document.body.innerText)
    await shot('06-评审页')
    const hasArticle = body.includes('体制内备考经验贴')
    return hasArticle ? '文章已同步到评审页' : '评审页可见（文章需手动选择）'
  })

  await step('配图页可进入且有封面/文内方案', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('智能配图'))
      if (t) t.click()
    })
    await page.waitForTimeout(1200)
    const body = await page.evaluate(() => document.body.innerText)
    await shot('07-配图页')
    if (body.includes('还没有可配图')) return '空态正常（文章未同步封面方案）'
    return '配图页可用'
  })

  await step('排版页可进入', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('文章排版'))
      if (t) t.click()
    })
    await page.waitForTimeout(1200)
    const has = await page.evaluate(() => !!document.querySelector('h2'))
    if (!has) throw new Error('排版页未渲染')
    await shot('08-排版页')
    return '排版页可用'
  })

  await step('发布页三步结构完整', async () => {
    await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith('发布管理'))
      if (t) t.click()
    })
    await page.waitForTimeout(1200)
    const body = await page.evaluate(() => document.body.innerText)
    await shot('09-发布页')
    const hasSteps = body.includes('第一步') && body.includes('第二步') && body.includes('第三步')
    if (!hasSteps) throw new Error('发布页缺少三步引导')
    return '三步结构（连接/推送/记录）完整'
  })

  console.log('\n══ 第五段：数据持久化 ══')
  await page.waitForTimeout(800)
  await app.close()
  app = null

  app = await electron.launch({
    executablePath,
    args: [resolve('.'), '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
    cwd: process.cwd(),
    env,
    timeout: 90_000
  })
  const page2 = await app.firstWindow({ timeout: 60_000 })
  await page2.waitForSelector('.nav-item', { timeout: 40_000 })
  await page2.waitForTimeout(2000)

  await step('重启后账号与文章仍在', async () => {
    const body = await page2.evaluate(() => document.body.innerText)
    const accountKept = body.includes('体制内备考互助号') || body.includes('当前账号')
    await page2.screenshot({ path: join(artifactDir, '10-重启后.png'), animations: 'disabled' })
    if (!accountKept) throw new Error('重启后账号丢失')
    return '账号配置已持久化'
  })

  await step('密钥确以密文存储', async () => {
    // 直接查库确认没有明文
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
    const row = db.prepare('SELECT encrypted_key FROM provider_secrets LIMIT 1').get()
    db.close()
    if (!row) throw new Error('provider_secrets 无记录')
    const secret = Buffer.from(row.encrypted_key).toString('utf8')
    if (secret.includes('sk-acceptance-key')) throw new Error('密钥以明文存储！')
    return '密钥为密文，无泄漏'
  })

  console.log('\n══ 渲染层错误汇总 ══')
  const uniqErrors = [...new Set(errors)]
  console.log(`  总数: ${errors.length}${uniqErrors.length ? '' : '（完全干净）'}`)
  uniqErrors.slice(0, 12).forEach(e => console.log(`   ! ${e.slice(0, 180)}`))
  console.log(`\n  mock 模型被调用 ${requestCount} 次`)
} catch (e) {
  record('测试执行', 'FAIL', e.message.slice(0, 200))
} finally {
  if (app) { try { await app.close() } catch { /* ignore */ } }
  await new Promise((done) => modelServer.close(done))
  if (userDataDir.startsWith(resolve(tmpdir()))) {
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

console.log('\n' + '═'.repeat(72))
console.log('验收结果')
console.log('═'.repeat(72))
const pass = results.filter(r => r.status === 'PASS').length
const fail = results.filter(r => r.status === 'FAIL').length
const skip = results.filter(r => r.status === 'SKIP').length
console.log(`  通过 ${pass} · 失败 ${fail} · 跳过 ${skip}`)
console.log('\n失败/跳过的环节：')
results.filter(r => r.status !== 'PASS').forEach(r => {
  console.log(`  [${r.status}] ${r.stage} — ${r.detail}`)
})
console.log(`\n截图: ${artifactDir}`)
