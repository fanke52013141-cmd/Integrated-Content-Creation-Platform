import { createServer } from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

const DRAFT_MARKER = '未保存的本地草稿段落'
const ARTICLE = '# 先搭框架，再写文章\n\n很多创作者不是不会写，而是太早开始写。\n\n## 框架先决定什么\n\n它先帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n从下一篇文章开始，先写下结构。'
const REVISED = '# 更锋利的开头：别急着写\n\n创作者最常见的浪费，是在没有结构时就急着堆字。\n\n## 框架先决定什么\n\n它帮助我们确定读者、承诺与推进顺序。\n\n## 结尾\n\n先搭结构，再投入表达。'

let calls = 0
let reviseSawUnsavedDraft = false
let failSecondCandidate = false
async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  calls += 1
  const body = await readBody(request)
  const isRevise = body.includes('<改稿任务>')
  if (isRevise) reviseSawUnsavedDraft = body.includes(DRAFT_MARKER)
  // 每个候选的请求里都写着"第 N 个独立成稿候选"，只把第 2 个退化成没有一级标题的文本，
  // 主进程 normalizeMarkdown 就会单独判它失败，另一篇照常入库
  const content = failSecondCandidate && body.includes('第 2 个独立成稿候选')
    ? '抱歉，这一篇没有按要求输出。'
    : /只回复\s*OK/.test(body) ? 'OK' : isRevise ? REVISED : ARTICLE
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ model: 'moliu-article-smoke', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Mock model server did not start')
const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const applicationArgs = process.env.MOLIU_EXECUTABLE ? [] : ['.']
const artifactDir = resolve('artifacts')
const smokeRoot = resolve(tmpdir(), 'moliu-article-smoke')
const userDataDir = resolve(smokeRoot, String(Date.now()))
await mkdir(artifactDir, { recursive: true }); await mkdir(userDataDir, { recursive: true })
const application = await electron.launch({ executablePath, args: applicationArgs, env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir } })
const editorSelector = 'textarea.article-markdown-editor'
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')

  await window.getByRole('button', { name: '模型网关' }).first().click()
  await window.getByRole('button', { name: /空白配置/ }).click()
  await window.getByLabel('显示名称').fill('本地成稿验收模型')
  await window.getByLabel('接口地址').fill(`http://127.0.0.1:${address.port}/v1`)
  await window.locator('.provider-editor').getByLabel(/访问密钥/).fill('article-smoke-key')
  await window.getByLabel('显示别名').fill('Smoke Article Model')
  await window.getByLabel('模型标识').fill('moliu-article-smoke')
  await window.locator('.provider-editor').getByRole('button', { name: '测试并加密保存' }).click()
  await window.getByText('供应商配置已加密保存').waitFor()
  // F06：保存只等于"配置已保存但尚未验证"，跑过一次连接测试才算已连通
  await window.getByText('配置已保存但尚未验证连接').waitFor()
  await window.locator('.provider-card').getByRole('button', { name: '测试连接' }).first().click()
  await window.getByText('连接成功').waitFor({ timeout: 30_000 })
  await window.locator('.provider-card').getByText('已验证').first().waitFor()
  await capture(window, { path: resolve(artifactDir, 'provider-verified.png'), animations: 'disabled', timeout: 90_000 })

  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.getByLabel('手动框架').fill('标题：先搭框架，再写文章\n开头：创作者动笔前的混乱\n论点：结构决定叙述推进\n结尾：给出行动建议')
  await window.getByRole('button', { name: '生成草稿' }).click()
  await window.getByText('已生成 1 篇成稿').waitFor({ timeout: 30_000 })
  await window.getByText('先搭框架，再写文章').first().waitFor()
  await capture(window, { path: resolve(artifactDir, 'article-generation.png'), animations: 'disabled', timeout: 90_000 })

  // F02：编辑留下的未保存草稿，切页再回来必须还在
  await window.getByRole('button', { name: '源码编辑' }).click()
  await window.locator(editorSelector).fill(`${ARTICLE}\n\n${DRAFT_MARKER}：这一段没有保存，只存在于本地工作草稿。`)
  await window.getByText('未保存', { exact: true }).waitFor()
  await window.getByRole('button', { name: '素材库' }).first().click()
  // F10：切到别的页面，作品条依然跟着这篇稿子，并如实标出有未保存修改
  await window.locator('.work-bar').getByText('有未保存修改').waitFor()
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.getByRole('button', { name: '源码编辑' }).click()
  const restored = await window.locator(editorSelector).inputValue()
  if (!restored.includes(DRAFT_MARKER)) throw new Error('切换到其他页面后，未保存的本地草稿丢失')
  await window.getByText('未保存', { exact: true }).waitFor()
  await capture(window, { path: resolve(artifactDir, 'article-draft-kept.png'), animations: 'disabled', timeout: 90_000 })

  // F02：改稿必须以屏幕上的未保存草稿为原稿，而不是库里的旧版本
  await window.getByPlaceholder('输入改稿要求（Ctrl+Enter 生成改稿）').fill('把开头改得更犀利一些')
  await window.getByRole('button', { name: '生成改稿' }).click()
  await window.getByText('改稿新版本已保存').waitFor({ timeout: 30_000 })
  await window.getByText('更锋利的开头：别急着写').first().waitFor()
  if (!reviseSawUnsavedDraft) throw new Error('改稿请求未携带屏幕上的未保存草稿')

  // §7.4：历史版本要能命名——版本堆多之后，光靠"第 N 版"认不出哪一版是什么
  const firstVersionRow = window.locator('.article-history div').filter({ hasText: '第 1 版' })
  await firstVersionRow.getByRole('button', { name: '命名' }).click()
  const nameInput = window.locator('input[name="versionName-1"]')
  await nameInput.waitFor()
  await nameInput.fill('AI 初稿')
  await nameInput.press('Enter')
  await window.getByText('已把这一版命名为「AI 初稿」').last().waitFor()
  if (await window.locator('input[name="versionName-1"]').count() !== 0) throw new Error('回车保存后命名输入框没有收起')
  const namedRows = window.locator('.article-history div').filter({ hasText: 'AI 初稿' })
  if (await namedRows.count() !== 1) throw new Error(`命名后版本行没有显示自定义名称（命中 ${await namedRows.count()} 行）`)
  await namedRows.getByRole('button', { name: '改名' }).click()
  const renameInput = window.locator('input[name="versionName-1"]')
  await renameInput.waitFor()
  if (await renameInput.inputValue() !== 'AI 初稿') throw new Error('再次命名时输入框没有带回现有名称')
  await renameInput.press('Escape')
  if (await window.locator('input[name="versionName-1"]').count() !== 0) throw new Error('Esc 后命名输入框没有收起')
  if (await namedRows.count() !== 1) throw new Error('Esc 只是取消，却把版本名称弄丢了')

  // §7.4：改完得能先看清"这一版和上一版差在哪"，再决定要不要换回去（比较本身不改内容）
  await namedRows.getByText('对比').click()
  const diffDialog = window.getByRole('dialog')
  await diffDialog.getByText('AI 初稿 ↔ 屏幕上的正文').waitFor()
  const removedLines = await diffDialog.locator('.article-diff-row.removed').allInnerTexts()
  const addedLines = await diffDialog.locator('.article-diff-row.added').allInnerTexts()
  if (!removedLines.some((line) => line.includes('很多创作者不是不会写'))) throw new Error(`差异里没有旧稿被删的那句：${JSON.stringify(removedLines)}`)
  if (!addedLines.some((line) => line.includes('创作者最常见的浪费'))) throw new Error(`差异里没有新稿新增的那句：${JSON.stringify(addedLines)}`)
  await capture(window, { path: resolve(artifactDir, 'article-version-diff.png'), animations: 'disabled', timeout: 90_000 })
  await diffDialog.getByRole('button', { name: '关闭' }).click()
  if (await window.locator('.article-diff').count() !== 0) throw new Error('关闭后差异弹窗仍在')

  // 版本名称落在库里，不只是界面状态
  const namedArticleTitle = await window.locator('.article-editor-head h2').innerText()
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  if (await window.locator('.article-history').count() === 0) {
    await window.locator('.article-list-item', { hasText: namedArticleTitle }).first().click()
  }
  if (!(await window.locator('.article-history').innerText()).includes('AI 初稿')) throw new Error('重开应用后版本名称没有留住')
  await window.locator('.article-history').scrollIntoViewIfNeeded()
  await capture(window, { path: resolve(artifactDir, 'article-version-named.png'), animations: 'disabled', timeout: 90_000 })

  // 验收任务 2：比较改稿结果后撤销这次 AI 修改（恢复历史版本另起一版，不覆盖改稿记录）
  await window.locator('.article-history').getByRole('button', { name: '恢复' }).first().click()
  await window.getByText('已从历史版本创建新草稿').waitFor()
  await window.getByRole('heading', { name: '先搭框架，再写文章' }).first().waitFor()
  if (await window.locator('.article-history > div').count() !== 3) throw new Error('恢复历史版本没有另起新版本')
  await window.getByRole('button', { name: '源码编辑' }).click()
  const rolledBack = await window.locator(editorSelector).inputValue()
  if (!rolledBack.includes('很多创作者不是不会写') || rolledBack.includes('别急着写')) throw new Error('撤销 AI 修改后编辑器正文没有回到旧版本')
  await window.getByRole('button', { name: '预览' }).click()

  // 验收任务 9：1180 宽窗口 + 125%/150% 放大下，只用键盘也要能摸到导出、走进正文并保存
  await window.setViewportSize({ width: 1180, height: 800 })
  await window.getByRole('button', { name: '源码编辑' }).click()
  for (const zoom of ['1', '1.25', '1.5']) {
    await window.evaluate((factor) => { document.documentElement.style.zoom = factor }, zoom)
    const overflow = await window.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 1) throw new Error(`缩放 ${zoom} 后页面出现 ${overflow}px 横向滚动`)
    // 导出按钮走原生目录选择框，自动化里不激活；只验证放大后它仍在键盘顺序里
    await window.locator(editorSelector).evaluate((element) => element.blur())
    let onExport = false
    for (let index = 0; index < 80 && !onExport; index += 1) {
      await window.keyboard.press('Tab')
      onExport = await window.evaluate(() => {
        const element = document.activeElement
        return Boolean(element?.matches('button') && element.innerText.trim() === 'HTML')
      })
    }
    if (!onExport) throw new Error(`缩放 ${zoom} 下无法用 Tab 键走到 HTML 导出按钮`)
    let onEditor = false
    for (let index = 0; index < 6 && !onEditor; index += 1) {
      await window.keyboard.press('Tab')
      onEditor = await window.evaluate(() => document.activeElement?.matches('textarea.article-markdown-editor') ?? false)
    }
    if (!onEditor) throw new Error(`缩放 ${zoom} 下从导出按钮再按 Tab 走不到正文编辑器`)
    await window.keyboard.press('Control+End')
    await window.keyboard.type(`\n\n缩放 ${zoom} 下只用键盘补写的一段。`)
    await window.getByText('未保存', { exact: true }).waitFor()
    await window.keyboard.press('Control+s')
    // 上一轮的同类 toast 还在堆叠里，用 last() 避免 strict mode 误判成"没保存"
    const saved = await window.getByText('手动编辑已保存为新版本').last().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    if (!saved) {
      const state = await window.evaluate((selector) => ({
        focused: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : 'none',
        tail: (document.querySelector(selector)?.value.slice(-30) ?? '(无编辑器)').replace(/\n/g, '⏎'),
        toasts: [...document.querySelectorAll('.toast-body')].map((node) => node.textContent.slice(0, 120))
      }), editorSelector)
      throw new Error(`缩放 ${zoom} 下键盘 Ctrl+S 没有保存：焦点 ${state.focused}，正文末尾「${state.tail}」，当前提示 ${JSON.stringify(state.toasts)}`)
    }
    if (!(await window.locator(editorSelector).inputValue()).includes(`缩放 ${zoom} 下只用键盘补写的一段。`)) {
      throw new Error(`缩放 ${zoom} 下键盘保存后正文没有落库`)
    }
  }
  await window.evaluate(() => { document.documentElement.style.zoom = '' })
  await window.setViewportSize({ width: 1280, height: 900 })

  await window.getByRole('button', { name: '锁定', exact: true }).click()
  await window.getByText('已锁定成稿版本').waitFor()

  // 阶段 D：多账号不串稿 —— 「当前账号」筛选只列出这个账号自己的文章
  await window.evaluate(async () => {
    const makeAccount = async (name) => window.moliu.accounts.save({ fields: [{ id: crypto.randomUUID(), name: '账号名称', value: name, isDefault: true }], wizardAnswers: [], status: 'locked', source: 'manual' })
    const first = await makeAccount('甲号')
    const second = await makeAccount('乙号')
    await window.moliu.articles.save({ accountId: first.id, materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 甲号的文章\n\n正文。', source: 'manual' })
    await window.moliu.articles.save({ accountId: second.id, materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 乙号的文章\n\n正文。', source: 'manual' })
    await window.moliu.accounts.setCurrent(first.id)
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  if (await window.locator('.article-list-item').count() !== 3) throw new Error('文章列表未按全部账号展示 3 篇')
  await window.getByRole('group', { name: '账号筛选' }).getByRole('button', { name: '当前账号', exact: true }).click()
  let scoped = await window.locator('.article-list-item').allInnerTexts()
  if (scoped.length !== 1 || !scoped[0].includes('甲号的文章')) throw new Error('当前账号筛选串到了其他账号或无账号文章')
  await window.evaluate(async () => {
    const target = (await window.moliu.accounts.list()).find((account) => account.name === '乙号')
    await window.moliu.accounts.setCurrent(target.id)
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.getByRole('group', { name: '账号筛选' }).getByRole('button', { name: '当前账号', exact: true }).click()
  scoped = await window.locator('.article-list-item').allInnerTexts()
  if (scoped.length !== 1 || !scoped[0].includes('乙号的文章')) throw new Error('切换当前账号后列表没有跟上')
  await capture(window, { path: resolve(artifactDir, 'article-account-scoped.png'), animations: 'disabled', timeout: 90_000 })

  // 阶段 D 退出标准：作品堆到几十篇（列表已虚拟滚动）时，按标题搜和按状态筛仍要一击命中
  await window.evaluate(async () => {
    for (let index = 1; index <= 60; index += 1) {
      await window.moliu.articles.save({
        materialIds: [], manualOutline: '', status: 'draft',
        rawMarkdown: `# 批量作品 ${String(index).padStart(2, '0')}\n\n用于验证列表规模化后的检索。`, source: 'manual'
      })
    }
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  if (!(await window.locator('.article-list h3 small').innerText()).includes('63')) throw new Error('文章列表没有加载到 63 篇')
  const renderedRows = await window.locator('.article-list-item').count()
  if (renderedRows >= 63) throw new Error(`长列表没有走虚拟滚动（一次渲染 ${renderedRows} 行）`)
  // 截图要拍在未筛选的 63 篇上，才看得出列表是在自己框里滚动而不是把页面撑到几千像素
  await capture(window, { path: resolve(artifactDir, 'article-list-at-scale.png'), animations: 'disabled', timeout: 90_000 })
  // 虚拟化生效的另一半：滚到底要能换出末尾那篇，而不是永远只有开头那几行
  const scrolled = await window.evaluate(() => {
    const scroller = [...document.querySelectorAll('.article-list div')].find((element) => element.scrollHeight > element.clientHeight + 200 && element.querySelector('.article-list-item'))
    if (!scroller) return false
    scroller.scrollTop = scroller.scrollHeight
    return true
  })
  if (!scrolled) throw new Error('63 篇列表没有可滚动的容器（虚拟化没生效或被拉高）')
  await window.locator('.article-list-item', { hasText: '批量作品 01' }).waitFor({ timeout: 5_000 })
  const listSearch = window.locator('input[name="articleListQuery"]')
  await listSearch.fill('批量作品 57')
  const found = await window.locator('.article-list-item').allInnerTexts()
  if (found.length !== 1 || !found[0].includes('批量作品 57')) throw new Error(`63 篇里搜不到「批量作品 57」，实际 ${JSON.stringify(found)}`)
  await listSearch.fill('')
  await window.locator('.article-list-status').getByRole('button', { name: '已锁定', exact: true }).click()
  const lockedOnly = await window.locator('.article-list-item').allInnerTexts()
  if (lockedOnly.length !== 1 || !lockedOnly[0].includes('先搭框架，再写文章')) throw new Error(`状态筛选没有只留下锁定稿，实际 ${JSON.stringify(lockedOnly)}`)
  await capture(window, { path: resolve(artifactDir, 'article-list-status-filter.png'), animations: 'disabled', timeout: 90_000 })

  // 阶段 D 退出标准：几十篇作品时，别的页面里那个"选文章"的下拉框也要能一击命中
  await window.getByRole('button', { name: '文章排版' }).first().click()
  await window.getByText('把成稿渲染为平台格式，直接推送公众号草稿箱').waitFor()
  const articleTrigger = window.locator('.layout-composer .select-trigger').first()
  await articleTrigger.click()
  const pickerSearch = window.locator('input[name="selectSearch"]')
  await pickerSearch.waitFor({ timeout: 5_000 })
  await pickerSearch.fill('批量作品 57')
  const pickerOptions = await window.locator('.select-option').allInnerTexts()
  if (pickerOptions.length !== 1 || !pickerOptions[0].includes('批量作品 57')) throw new Error(`排版页文章下拉筛出了 ${pickerOptions.length} 项：${JSON.stringify(pickerOptions)}`)
  await window.keyboard.press('Enter')
  if (!(await articleTrigger.innerText()).includes('批量作品 57')) throw new Error(`排版页文章下拉键盘选中后没有回到触发器：${await articleTrigger.innerText()}`)
  // 选项本来就少的那个下拉不该出现搜索框
  await window.locator('.layout-composer .select-trigger').nth(1).click()
  if (await window.locator('input[name="selectSearch"]').count() !== 0) throw new Error('平台下拉只有几项，却出现了搜索框')
  await window.keyboard.press('Escape')
  if (await window.locator('.select-popover').count() !== 0) throw new Error('Esc 没有关掉焦点仍在触发器上的下拉')
  await capture(window, { path: resolve(artifactDir, 'picker-search-at-scale.png'), animations: 'disabled', timeout: 90_000 })

  // 阶段 B 退出标准"失败任务可单项恢复"：一批里坏掉一篇时，UI 上只补那一篇
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('按框架扩写成稿，改稿打磨后锁定进入评审与发布').waitFor()
  await window.locator('.composer-toggle').click()
  await window.locator('.article-composer .composer-advanced > summary').click()
  await window.getByRole('button', { name: '每批生成' }).click()
  await window.getByRole('option', { name: '2 篇' }).click()
  const articleCountBefore = Number(await window.locator('.article-list h3 small').innerText())
  failSecondCandidate = true
  await window.getByRole('button', { name: '生成草稿' }).click()
  const partialToast = await window.getByText('已生成 1 篇，1 篇失败').last().waitFor({ timeout: 40_000 }).then(() => true).catch(() => false)
  if (!partialToast) {
    const state = await window.evaluate(() => ({
      summary: document.querySelector('.composer-summary')?.textContent ?? '(展开)',
      count: document.querySelector('.article-count .select-value')?.textContent ?? '(未知)',
      toasts: [...document.querySelectorAll('.toast-body')].map((node) => node.textContent.slice(0, 120))
    }))
    throw new Error(`部分失败没有报出"已生成 1 篇，1 篇失败"：${JSON.stringify(state)}`)
  }
  await window.getByText('上批有 1 个候选未成功').waitFor()
  failSecondCandidate = false
  await window.getByRole('button', { name: /只补生成 1 篇/ }).click()
  await window.getByText('已生成 1 篇成稿').last().waitFor({ timeout: 40_000 })
  if (await window.getByText('上批有').count() !== 0) throw new Error('补生成成功后"上批有候选未成功"的提示没有消失')
  const articleCountAfter = Number(await window.locator('.article-list h3 small').innerText())
  if (articleCountAfter !== articleCountBefore + 2) throw new Error(`部分失败那批应净增 2 篇（补 1 坏 1），实际 ${articleCountBefore} → ${articleCountAfter}`)
  await capture(window, { path: resolve(artifactDir, 'article-partial-retry.png'), animations: 'disabled', timeout: 90_000 })
  console.log('Article smoke test passed: provider verification state, draft kept across pages, revise from unsaved draft, history versions named/reopened, AI revision compared line by line and undone from history as a new version, keyboard-only reach/save at 1180px under 100%/125%/150% zoom, lock persisted, per-account list scoping, 63-article list and article picker searchable, partially failed batch retried one by one')
} finally { await application.close(); await new Promise((resolve) => server.close(resolve)) }
if (calls < 3) throw new Error(`Expected at least 3 model calls (connection test, generate, revise), got ${calls}`)
const database = new DatabaseSync(resolve(userDataDir, 'moliu.db'))
const row = database.prepare("SELECT a.status AS status, COUNT(v.id) AS version_count FROM articles a JOIN article_versions v ON v.article_id=a.id WHERE a.status='locked' GROUP BY a.id").get()
const accountRow = database.prepare('SELECT COUNT(DISTINCT account_id) AS accounts FROM articles WHERE account_id IS NOT NULL').get()
const providerRow = database.prepare('SELECT last_test_status, last_test_at FROM providers LIMIT 1').get()
database.close()
if (row?.status !== 'locked' || row.version_count < 2) throw new Error('Article lock or revision version was not persisted')
if (accountRow?.accounts !== 2) throw new Error(`两篇文章应绑定 2 个账号，实际 ${accountRow?.accounts}`)
if (providerRow?.last_test_status !== 'success' || !providerRow.last_test_at) throw new Error('Provider connection test result was not persisted')
const requiredPrefix = `${smokeRoot}${sep}`
if (!userDataDir.startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
await rm(userDataDir, { recursive: true, force: true })
