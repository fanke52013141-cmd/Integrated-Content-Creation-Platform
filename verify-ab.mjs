/**
 * 优化前后 A/B 对比验证脚本
 *
 * 同一套场景分别跑在「优化前构建」「优化后构建」「0.1.0 安装版」上，量化输出：
 *   1) 账号定位字段数 / 「选题方向」残留 / AI 填充数 / 完整度
 *   2) 自定义位置备份是否出现在备份列表 / 是否可恢复
 *   3) 配置类失败（生图能力未开启）是否在任务台账留下 failed 记录
 *   4) 热点榜单序号渲染（list-style-type / 排名配色 / 是否双重序号）
 *
 * 用法: node verify-ab.mjs <label> <exePath> <appDirOrEmpty> [ui-only]
 * 环境变量 AB_KEEP=1 保留 userData 目录。
 */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { respondToChat } from './walkthrough-content-bank.mjs'

const [label, exePath, appDir, uiOnly] = process.argv.slice(2)
if (!label || !exePath) { console.error('用法: node verify-ab.mjs <label> <exePath> [appDir] [ui-only]'); process.exit(2) }

const artifactDir = resolve('artifacts/walkthrough/ab')
await mkdir(artifactDir, { recursive: true })
const userDataDir = await mkdtemp(join(tmpdir(), `moliu-ab-${label}-`))

/* mock 模型网关：内容来自内容库（与走查同一份格式化响应） */
const modelServer = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) { res.writeHead(404).end(); return }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let parsed; try { parsed = JSON.parse(body) } catch { res.writeHead(400).end(); return }
    const reply = respondToChat(parsed)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: reply.model, choices: [{ message: { content: reply.content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
  })
})
await new Promise((done) => modelServer.listen(0, '127.0.0.1', done))
const modelPort = modelServer.address().port

const app = await electron.launch({
  executablePath: resolve(exePath),
  args: appDir ? [resolve(appDir)] : [],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})
const result = { label, exePath, appDir: appDir ?? '(packaged)', measures: {}, rendererErrors: [], screenshots: [], stepErrors: [] }
const guard = async (name, fn) => {
  try { result.measures[name] = await fn() } catch (error) {
    result.stepErrors.push(`${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }
}

try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => result.rendererErrors.push(e.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '创作台', exact: true }).waitFor({ timeout: 30_000 })

  /* ① 热点榜单渲染（三种构建通用，选择器做新旧兼容） */
  await guard('hotlist', async () => {
    await page.getByRole('button', { name: '热点洞察' }).click()
    const listSel = (await page.locator('.hot-item-list').count()) ? '.hot-item-list' : '.hotspot-feed ol'
    const list = page.locator(listSel).first()
    await list.locator('li').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(800)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(300)
    const m = await page.evaluate((sel) => {
      const ol = document.querySelector(sel)
      const li = ol.querySelector('li')
      const rank = li.querySelector('[class*="hot-rank"]')
      return {
        listStyleType: getComputedStyle(ol).listStyleType,
        firstRowText: (li.textContent || '').trim().slice(0, 30),
        duplicateMarker: /^\d+\s*\.\s*\d/.test((li.textContent || '').trim()) || /^\d+\.\d/.test((li.textContent || '').trim()),
        rank1Color: rank ? getComputedStyle(rank).color : null,
        rowCount: ol.querySelectorAll('li').length
      }
    }, listSel)
    const shot = join(artifactDir, `ab-${label}-hotlist.png`)
    await page.screenshot({ path: shot, animations: 'disabled' })
    result.screenshots.push(shot)
    return m
  })

  if (uiOnly !== 'ui-only') {
    /* 公共前置：保存供应商（chat 开、image 关）并测试连通 */
    const provider = await page.evaluate(async (port) => {
      const saved = await window.moliu.providers.save({
        displayName: 'AB验证模型', protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'zcode-walkthrough-1',
        enabled: true, isRelay: false,
        capabilities: { chat: true, jsonMode: true, streaming: true, vision: false, image: false },
        models: [{ modelId: 'zcode-walkthrough-1', displayName: 'AB模型', reasoningVariants: [], isDefault: true, enabled: true }],
        apiKey: 'ab-key'
      })
      const test = await window.moliu.providers.test(saved.id)
      if (!test.ok) throw new Error(`连接测试失败: ${test.message}`)
      return saved.id
    }, modelPort)

    /* ② 账号定位：AI 生成 → 字段数 / 选题方向 / AI 填充 / 完整度 */
    await guard('account', async () => {
      const answers = [
        { questionId: 'name', question: '这个账号叫什么？', answer: '芯流观察' },
        { questionId: 'domain', question: '主要做哪个领域？', answer: '半导体与通信产业分析' },
        { questionId: 'audience', question: '写给谁看？', answer: '关注科技产业的职场人与投资者' },
        { questionId: 'style', question: '希望是什么写作风格或语气？', answer: '理性克制、信息密度高' },
        { questionId: 'persona', question: '这个账号扮演什么 IP 角色？', answer: '前芯片工程师' },
        { questionId: 'difference', question: '和同类账号相比，有什么不同？', answer: '只讲证据链' },
        { questionId: 'value', question: '关注后能给读者带来什么？', answer: '看懂技术与生意逻辑' }
      ]
      return page.evaluate(async ({ providerId, answers }) => {
        const MODEL = 'zcode-walkthrough-1'
        const gen = await window.moliu.accounts.generate({ providerId, model: MODEL, answers })
        const saved = await window.moliu.accounts.save({ fields: gen.fields, wizardAnswers: answers, status: 'locked', source: 'ai', providerId, model: MODEL })
        return {
          fieldsCount: gen.fields.length,
          hasTopicDirection: gen.fields.some((f) => f.name === '选题方向'),
          aiFilled: gen.fields.filter((f) => f.value.trim()).length,
          completeness: saved.completeness
        }
      }, { providerId: provider, answers })
    })

    /* ③ 自定义位置备份：可见性 + 可恢复（备份与生成/暂存互斥，撞闸时等待重试） */
    await guard('backup', async () => {
      let lastError
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          return await page.evaluate(async () => {
            const dataPath = await window.moliu.app.getDataPath()
            const backup = await window.moliu.app.createBackup({ targetDir: `${dataPath}/ab-custom-backups` })
            const listed = await window.moliu.app.listBackups()
            const visible = listed.some((p) => p.replace(/\\/g, '/').endsWith(backup.path.replace(/\\/g, '/').split('/').pop()))
            const restored = await window.moliu.app.restoreBackup({ bundleDir: backup.path })
            return { customVisibleInList: visible, restoreOk: typeof restored.restoredImages === 'number', listSize: listed.length }
          })
        } catch (error) {
          lastError = error
          await new Promise((r) => setTimeout(r, 1_200))
        }
      }
      throw lastError
    })

    /* ④ 配置类失败是否污染任务台账 */
    await guard('ledger', async () => {
      return page.evaluate(async (providerId) => {
        const MODEL = 'zcode-walkthrough-1'
        const article = await window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'locked', rawMarkdown: '# AB台账验证\n\n正文。', source: 'manual' })
        const pack = await window.moliu.visuals.generate({ articleId: article.id, providerId, model: MODEL, inlineCount: 1 })
        let imageError = ''
        try { await window.moliu.visuals.generateImage({ packId: pack.id, kind: 'cover', slot: 0, prompt: pack.cover.prompt, providerId, model: MODEL }) } catch (e) { imageError = e instanceof Error ? e.message : String(e) }
        await new Promise((r) => setTimeout(r, 600))
        const tasks = await window.moliu.generation.list(50)
        const failed = tasks.filter((t) => t.status === 'failed')
        return {
          configErrorShown: /图片生成/.test(imageError),
          failedTaskRows: failed.length,
          failedDomains: failed.map((t) => `${t.domain}:${t.detail.slice(0, 30)}`),
          totalTaskRows: tasks.length
        }
      }, provider)
    })
  }
} catch (error) {
  result.stepErrors.push(`fatal: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await app.close().catch(() => {})
  await new Promise((r) => modelServer.close(r))
}

await writeFile(join(artifactDir, `ab-${label}.json`), JSON.stringify(result, null, 2), 'utf8')
console.log(JSON.stringify({ label, measures: result.measures, stepErrors: result.stepErrors, rendererErrors: result.rendererErrors }, null, 2))
if (!process.env.AB_KEEP) {
  const { rm } = await import('node:fs/promises')
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}
