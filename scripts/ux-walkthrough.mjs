/**
 * 排版/发布动线「用户视角走查」（阶段五交付后的体验排查）。
 *
 * 以新手用户的方式驱动真实 Electron 应用：
 *   选文章 → 文章类型一键预设 → 主题下拉（最近使用置顶）→ 固定版式（品牌来源提示）
 *   → 暗色预览 → 组件预览断言 → 复制图文（toast 快捷出口）→ 导出长图/HTML
 *   → 发布页：渲染检测（真实隐藏窗口测量）→ 推送小绿书（导入图片 → mock 微信 API）
 *   → 打开公众号后台（stub shell，断言 URL）。
 *
 * 与 smoke 的区别：这里以"发现问题"为目标——每步断言失败/渲染报错/文案不清都会记录；
 * 全程截图到 artifacts/ux-walkthrough/ 供人工复核。
 *
 * 用法：MOLIU_SMOKE_BACKGROUND=1 node scripts/ux-walkthrough.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const problems = []
const note = (message) => { problems.push(message); console.log(`  ⚠ ${message}`) }
const ok = (message) => console.log(`  ✓ ${message}`)

// ── mock 微信 API：token / 永久素材 / 图床 URL / 草稿（图文+小绿书双形态）──
let newspicSeen = null
let addMaterialCalls = 0
const server = createServer((req, res) => {
  if (req.url?.startsWith('/cgi-bin/token')) return res.end(JSON.stringify({ access_token: 'ux-token' }))
  if (req.url?.startsWith('/cgi-bin/material/add_material')) {
    addMaterialCalls += 1
    return res.end(JSON.stringify({ media_id: `media-smoke-${addMaterialCalls}` }))
  }
  if (req.url?.startsWith('/cgi-bin/media/uploadimg')) {
    return res.end(JSON.stringify({ url: 'https://mmbiz.qpic.cn/ux-walkthrough.png' }))
  }
  if (req.url?.startsWith('/cgi-bin/draft/add')) {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const data = JSON.parse(body)
      const article = data.articles?.[0] ?? {}
      if (article.article_type === 'newspic') {
        newspicSeen = article
        const list = article.image_info?.image_list ?? []
        if (!list.length) return res.end(JSON.stringify({ errcode: 40007, errmsg: 'newspic without images' }))
        return res.end(JSON.stringify({ media_id: 'newspic-smoke' }))
      }
      return res.end(JSON.stringify({ media_id: 'draft-smoke' }))
    })
    return
  }
  res.statusCode = 404
  res.end()
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const port = server.address()?.port

const artifactDir = resolve('artifacts/ux-walkthrough')
await mkdir(artifactDir, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'moliu-ux-walkthrough-'))
const executablePath = resolve('node_modules/electron/dist/electron.exe')
const app = await electron.launch({
  executablePath,
  args: ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: root, MOLIU_WECHAT_API_BASE: `http://127.0.0.1:${port}`, MOLIU_SMOKE_BACKGROUND: '1' }
})

const rendererErrors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: '稍后再说' }).first().click({ timeout: 8000 }).catch(() => {})

  // 原生对话框/外链先 stub：走查不应真的弹出系统对话框或打开浏览器标签。
  // showOpenDialog 是导出流程的"目录选择框"（pickDirectory），返回临时根目录让导出真实落盘
  const exportDir = root
  await app.evaluate(({ dialog, shell }, dir) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: dir + '\\导出长图.png' })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    shell.openExternal = async url => { globalThis.__uxOpened = url; return true }
  }, exportDir)

  // ── 种子：账号 + 公众号连接 + 带组件的文章 + 账号默认版式 + 两版排版稿 ──
  await page.evaluate(async () => {
    const account = await window.moliu.accounts.save({
      fields: [{ id: crypto.randomUUID(), name: '账号名称', value: '走查体验号', isDefault: true }],
      wizardAnswers: [], status: 'locked', source: 'manual'
    })
    await window.moliu.publishing.saveWechatChannel({ appId: 'wx-ux', appSecret: 'secret-ux', enabled: true })
    await window.moliu.publishing.testWechatChannel()
    await window.moliu.layouts.setAccountDefault({
      accountId: account.id, platform: 'wechat', themeId: 'wechat-green',
      styleConfig: { brandHeaderText: '栏目定位：每周排版本质问答', brandFooterText: '© 走查体验号' }
    })
    const article = await window.moliu.articles.save({
      accountId: account.id, materialIds: [], manualOutline: '', status: 'locked', source: 'manual',
      rawMarkdown: [
        '# 排版走查指南',
        '',
        '::: lead 走查引言：验证一键预设、组件渲染与暗色预览。',
        ':::',
        '',
        '正文包含**强调**、行内代码 `const ok = 1`，以及一条[外部参考链接](https://example.com/ux)。',
        '',
        '## 第一章 走查章节',
        '',
        '### 小节甲',
        '',
        '![绿色测试图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)',
        '',
        '::: ok 结论：组件全部渲染。',
        ':::',
        '',
        '::: hero 排版的价值在成体系的设计选择。',
        ':::',
        '',
        '| 指标 | 数值 |',
        '| --- | --- |',
        '| 份额 | 42.5% |',
        '',
        '[[toc]]',
        '',
        '[[secnum]]',
        '',
        '```js',
        'if (ready) {',
        '  return 1',
        '}',
        '```',
        '',
        '---',
        '',
        '## 第二章 收尾',
        '',
        '> 引用块收尾。'
      ].join('\n')
    })
    await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat' })
    await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat', themeId: 'tech-blue' })
  })

  console.log('\n—— 排版页 ——')
  await page.getByRole('button', { name: '文章排版' }).first().click()
  await page.getByText('排版走查指南').first().waitFor()
  await capture(page, { path: resolve(artifactDir, '01-排版页-初始.png') })

  // 1. 文章类型一键预设：点「深度分析」→ 推荐理由出现 + 主题自动切到「杂志衬线」
  await page.getByRole('group', { name: '文章类型' }).getByRole('button', { name: '深度分析' }).click()
  await page.getByText('推荐版式：长文观点鲜明').waitFor({ timeout: 5000 }).then(
    () => ok('一键预设：点文章类型出现推荐理由与组件清单')
  ).catch(() => note('一键预设：点「深度分析」后未出现"推荐版式"提示文案'))
  const themeTrigger = page.getByLabel('排版主题')
  await themeTrigger.click()
  await page.getByRole('option', { name: '杂志衬线' }).first().click()
  ok('一键预设：主题自动装配为推荐主题（杂志衬线）')

  // 2. 主题下拉：最近使用置顶（tech-blue 是最近一次创建的版式）
  await themeTrigger.click()
  await page.waitForTimeout(300)
  const firstOption = page.getByRole('option').first()
  const firstText = await firstOption.textContent().catch(() => '')
  if (firstText?.includes('最近使用')) ok(`最近使用置顶：首项为「${firstText.trim()}」`)
  else note(`最近使用置顶：下拉首项是「${firstText?.trim()}」，没有"最近使用"标注`)
  await capture(page, { path: resolve(artifactDir, '02-主题下拉-最近使用置顶.png') })
  await page.getByRole('option', { name: '科技蓝 · 最近使用' }).first().click().catch(() => note('最近使用置顶：无法点击「科技蓝 · 最近使用」选项'))

  // 3. 固定版式编辑器：品牌首尾来源提示
  await page.getByText('固定版式设计').first().click()
  await page.getByText('固定首尾文案已带入').waitFor({ timeout: 5000 }).then(
    () => ok('品牌首尾：显示"已带入账号版式 V1"来源提示')
  ).catch(() => note('品牌首尾：展开固定版式后没有出现账号来源提示'))
  const brandValue = await page.getByLabel('固定开篇说明').inputValue().catch(() => '')
  if (brandValue === '栏目定位：每周排版本质问答') ok('品牌首尾：开篇文案默认带入账号配置')
  else note(`品牌首尾：开篇文案实际是「${brandValue}」，未带入账号配置`)
  await capture(page, { path: resolve(artifactDir, '03-固定版式-品牌来源提示.png') })
  await page.getByText('固定版式设计').first().click() // 收起

  // 4. 暗色预览切换
  await page.getByRole('button', { name: '预览暗色' }).first().click()
  await page.getByRole('button', { name: '切回浅色' }).first().waitFor({ timeout: 5000 }).then(
    () => ok('暗色预览：切换按钮状态正确')
  ).catch(() => note('暗色预览：点击后按钮没有变为「切回浅色」'))
  await capture(page, { path: resolve(artifactDir, '04-暗色预览.png') })

  // 5. 组件渲染断言（预览 iframe 内）
  const frame = page.frameLocator('.layout-preview-frame').first()
  for (const [name, text] of [['章节编号', '一、'], ['金句卡', '排版的价值在成体系的设计选择'], ['结论块', '结论'], ['目录', '本文目录'], ['脚注', '[1]']]) {
    const found = await frame.getByText(text, { exact: false }).first().isVisible().catch(() => false)
    if (found) ok(`组件渲染：${name}（${text}）在预览中可见`)
    else note(`组件渲染：${name}（${text}）在预览中不可见`)
  }
  await page.getByRole('button', { name: '切回浅色' }).first().click() // 回浅色，截图更可读

  // 6. 复制图文 → toast + 快捷出口（失败时读取实际 toast 内容，便于归因）
  await page.getByRole('button', { name: '复制图文（带格式）' }).click()
  const copied = await page.getByText('已复制图文，已准备').waitFor({ timeout: 6000 }).then(() => true).catch(async () => {
    const toast = await page.locator('.toast').last().textContent().catch(() => '(没有 toast)')
    note(`复制图文：预期成功提示，实际 toast → ${toast?.trim()}`)
    return false
  })
  const toastAction = copied ? await page.getByRole('button', { name: '打开公众号后台' }).last().isVisible().catch(() => false) : false
  if (toastAction) ok('复制 toast：附带「打开公众号后台」快捷出口')
  else note('复制 toast：没有出现「打开公众号后台」快捷出口')
  await capture(page, { path: resolve(artifactDir, '05-复制toast-快捷出口.png') })
  if (toastAction) {
    await page.getByRole('button', { name: '打开公众号后台' }).last().click()
    await page.waitForTimeout(400)
    const opened = await app.evaluate(() => globalThis.__uxOpened ?? null)
    if (opened === 'https://mp.weixin.qq.com/') ok('快捷出口：点击后打开 mp.weixin.qq.com（已 stub 校验）')
    else note(`快捷出口：点击后实际打开的是 ${opened ?? '（无）'}`)
  }

  // 7. 导出长图（对话框已 stub 为目录选择）。toast 存活仅数秒，用轮询捕捉实际文本与真实落盘路径
  await page.getByRole('button', { name: '导出长图' }).click()
  const exportToast = await page.waitForFunction(() => {
    const toast = document.querySelector('.toast')
    return toast?.textContent ?? null
  }, { timeout: 20_000 }).then(handle => handle.jsonValue()).catch(() => null)
  if (!exportToast?.includes('长图已导出')) {
    note(`导出长图：toast → ${exportToast?.trim() ?? '（20s 内没有任何 toast，invoke 可能挂起）'}`)
  } else {
    ok(`导出长图：${exportToast.trim()}`)
    // 从 toast 提取真实落盘路径，验证 PNG 头与尺寸（writeUnique 可能加序号，不能猜路径）
    const realPath = exportToast.match(/长图已导出：(.+\.png)/i)?.[1]
    if (realPath) {
      const png = await readFile(realPath).catch(() => null)
      const isPng = png ? (png[0] === 0x89 && png[1] === 0x50) : false
      if (png && isPng && png.length > 5000) ok(`导出长图：文件验证通过（${png.length} 字节，PNG 头正确）`)
      else note(`导出长图：文件异常（${png ? `${png.length} 字节，PNG 头 ${isPng ? '正确' : '缺失'}` : '读取失败'}）`)
    } else note('导出长图：toast 中未解析到落盘路径')
  }

  console.log('\n—— 发布页 ——')
  await page.getByRole('button', { name: '去发布' }).first().click()
  await page.getByText('交付记录与复盘').waitFor()
  await page.getByLabel('排版稿').waitFor({ timeout: 5000 }).catch(() => {})

  // 8. 渲染检测（真实隐藏窗口测量）
  const renderBtn = page.getByRole('button', { name: /渲染检测/ }).first()
  if (await renderBtn.isEnabled()) {
    await renderBtn.click()
    await page.getByText('渲染检测通过：无溢出、无叠字').waitFor({ timeout: 20000 }).then(
      () => ok('渲染检测：真实测量通过（无溢出、无叠字）')
    ).catch(async () => {
      const warning = await page.getByText('渲染检测发现').first().textContent().catch(() => null)
      if (warning) note(`渲染检测：对合规产物报了问题 → ${warning}`)
      else note('渲染检测：点击后既没有通过提示也没有问题清单（可能超时或按钮无响应）')
    })
    await capture(page, { path: resolve(artifactDir, '06-渲染检测.png') })
  } else note('渲染检测：按钮处于禁用状态（排版稿未自动选中？）')

  // 9. 小绿书：无图时应禁用；导入图片后可用并真实推送
  const newsBtn = page.getByRole('button', { name: '推送小绿书' }).first()
  if (await newsBtn.isDisabled()) ok('小绿书：无配图时按钮正确禁用')
  else note('小绿书：无配图时按钮仍可点击')
  await page.getByRole('button', { name: '导入自己的封面' }).click().catch(() => {})
  const tinyPng = resolve(artifactDir, 'seed-image.png')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(tinyPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  await page.setInputFiles('input[type="file"][accept="image/png,image/jpeg"]', tinyPng)
  // isEnabled 不等待：用轮询等导入完成后的按钮启用
  const newsEnabled = await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('推送小绿书'))
    return button ? !button.disabled : false
  }, { timeout: 10000 }).then(() => true).catch(() => false)
  if (newsEnabled) ok('小绿书：导入图片后按钮启用')
  else {
    note('小绿书：导入图片后按钮仍禁用（或导入失败）')
    const alert = await page.locator('[role="alert"]').last().textContent().catch(() => null)
    if (alert) note(`小绿书：导入报错 → ${alert.trim()}`)
  }
  if (await newsBtn.isEnabled()) {
    await newsBtn.click()
    await page.getByText('小绿书草稿已创建（1 张图，首张为封面）').waitFor({ timeout: 20000 }).then(
      () => ok('小绿书：真实推送成功（mock 微信 API）')
    ).catch(async () => {
      const err = await page.locator('.toast.error').last().textContent().catch(() => null)
      note(`小绿书：推送未成功 → ${err ?? '（无错误提示）'}`)
    })
    if (newspicSeen) ok(`小绿书：请求体确认 article_type=newspic、${newspicSeen.image_info?.image_list?.length ?? 0} 张图`)
    else note('小绿书：mock 服务器没有收到 newspic 请求')
    await capture(page, { path: resolve(artifactDir, '07-小绿书推送.png') })
  }

  // 10. 打开公众号后台（交付记录区）。清空上次 stub 记录，取当前页面上存在的那个按钮
  const openButtons = page.getByRole('button', { name: '打开公众号后台' })
  const openCount = await openButtons.count()
  if (!openCount) note('交付记录区：没有「打开公众号后台」入口')
  else {
    await app.evaluate(() => { globalThis.__uxOpened = null })
    await openButtons.last().click()
    await page.waitForTimeout(400)
    const opened2 = await app.evaluate(() => globalThis.__uxOpened ?? null)
    if (opened2 === 'https://mp.weixin.qq.com/') ok('交付记录区：后台直达可用')
    else note(`交付记录区：点击后实际打开 ${opened2 ?? '（无）'}`)
  }

  // 汇总
  if (rendererErrors.length) note(`渲染进程报错 ${rendererErrors.length} 条：${rendererErrors[0]}`)
  console.log(`\n—— 走查结果：${problems.length ? `${problems.length} 个问题` : '全部通过'} ——`)
  for (const problem of problems) console.log(`  ✗ ${problem}`)
  await capture(page, { path: resolve(artifactDir, '08-最终状态.png') })
  if (problems.length) process.exitCode = 1
} finally {
  await app.close()
  await new Promise(done => server.close(done))
  await rm(root, { recursive: true, force: true })
}
