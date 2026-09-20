import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { capture } from './lib/evidence.mjs'

const IMPORTED_BODY = '这个月把三篇拖了很久的稿子发完了，才发现卡住我的从来不是文笔，而是没有先想清楚要写给谁。'
const NOTE = '本地交付与工作台验收'
const TASK_LABEL = { running: '进行中', succeeded: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', interrupted: '中断' }
const userDataDir = resolve(resolve(tmpdir(), 'moliu-workspace-smoke'), String(Date.now()))
const cleanRoot = resolve(resolve(tmpdir(), 'moliu-workspace-clean'), String(Date.now()))
const freshDir = resolve(cleanRoot, 'userData')
const bundleDir = resolve(freshDir, 'restore-bundle')
const artifactDir = resolve('artifacts')
await mkdir(userDataDir, { recursive: true }); await mkdir(artifactDir, { recursive: true })

const executablePath = process.env.MOLIU_EXECUTABLE ? resolve(process.env.MOLIU_EXECUTABLE) : resolve('node_modules/electron/dist/electron.exe')
const application = await electron.launch({
  executablePath,
  args: process.env.MOLIU_EXECUTABLE ? [] : ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})

/** 导出/备份路径必须留在应用数据目录内，越界要给出可读错误而不是静默写盘 */
function inside(root, candidate) {
  const rel = relative(root, resolve(candidate))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

let backupBundle = ''
try {
  const window = await application.firstWindow()
  window.on('pageerror', (error) => console.error(`renderer:error: ${error.message}`))
  await window.waitForLoadState('domcontentloaded')

  // F09 创作台：未配置模型时先教「连一个文本模型」，且导入不依赖模型
  await window.getByRole('button', { name: '创作台' }).first().click()
  await window.getByText('第一步：连接一个文本模型').waitFor()
  await window.getByText('先连上 AI 服务，然后开始第一篇。').waitFor()
  await capture(window, { path: resolve(artifactDir, 'home-setup.png'), animations: 'disabled', timeout: 90_000 })

  // F16：导入 .md 文件即成本地草稿，缺标题时自动补出可辨认的名字
  await writeFile(resolve(userDataDir, `${NOTE}.md`), IMPORTED_BODY, 'utf8')
  await window.getByRole('button', { name: /导入现成文章/ }).click()
  await window.getByRole('dialog').waitFor()
  await window.locator('.file-pick input[type="file"]').setInputFiles({ name: `${NOTE}.md`, mimeType: 'text/markdown', buffer: Buffer.from(IMPORTED_BODY, 'utf8') })
  await window.getByText(`已读取文件：${NOTE}.md`).waitFor()
  await window.getByRole('button', { name: /导入粘贴内容/ }).click()
  await window.getByText('粘贴稿已保存为本地草稿').waitFor({ timeout: 15_000 })
  await window.getByRole('button', { name: NOTE }).first().waitFor()

  // F10：作品条把这篇文章带到后续阶段，切阶段仍是同一篇
  await window.locator('.work-bar').waitFor()
  await window.getByRole('button', { name: '收起作品栏' }).waitFor()
  await window.locator('.work-bar-title').click()
  await window.getByText('文章工作台').first().waitFor()
  await window.getByLabel('创作阶段').getByRole('button', { name: '排版' }).click()
  if (!window.url().includes('layouts')) throw new Error(`作品条阶段跳转失败：${window.url()}`)
  await window.getByRole('button', { name: '创作台' }).first().click()
  await window.getByText('继续上次作品').waitFor()
  await window.getByText(NOTE).first().waitFor()
  await capture(window, { path: resolve(artifactDir, 'home-resume.png'), animations: 'disabled', timeout: 90_000 })

  const articleId = await window.evaluate(async () => (await window.moliu.articles.list())[0]?.id)
  if (!articleId) throw new Error('导入的成稿未出现在列表里')

  // F12：导出落在数据目录内，越界目录必须被拒绝（原生目录框的取消路径由单元测试覆盖，这里不弹真框）
  const exported = await window.evaluate(async ({ dir, outside, id }) => {
    const markdown = await window.moliu.app.exportArticle({ articleId: id, format: 'markdown', targetDir: `${dir}/out` })
    const html = await window.moliu.app.exportArticle({ articleId: id, format: 'html', targetDir: `${dir}/out` })
    let escaped = ''
    try { await window.moliu.app.exportArticle({ articleId: id, format: 'markdown', targetDir: outside }) } catch (error) { escaped = error instanceof Error ? error.message : String(error) }
    return { markdown: markdown.path, html: html.path, escaped }
  }, { dir: userDataDir, outside: resolve(tmpdir()), id: articleId })
  if (!exported.markdown || !exported.html) throw new Error('导出未返回文件路径')
  if (!inside(userDataDir, exported.markdown) || !inside(userDataDir, exported.html)) throw new Error('导出写到了数据目录之外')
  if (!(await readFile(exported.markdown, 'utf8')).includes(IMPORTED_BODY)) throw new Error('导出的 Markdown 内容不完整')
  const htmlBody = await readFile(exported.html, 'utf8')
  if (!htmlBody.includes(IMPORTED_BODY)) throw new Error('导出的 HTML 缺少正文')
  if (!/<p[\s>]/.test(htmlBody)) throw new Error('导出的 HTML 未渲染成段落')
  if (!exported.escaped.includes('只能写入应用数据目录')) throw new Error(`越界导出未被拒绝：${exported.escaped}`)

  // F18：一键备份 → 继续写 → 恢复回到备份时点
  const backup = await window.evaluate(async () => {
    const created = await window.moliu.app.createBackup()
    await window.moliu.articles.save({ materialIds: [], manualOutline: '', status: 'draft', rawMarkdown: '# 备份之后新增的稿子\n\n内容', source: 'manual' })
    const before = (await window.moliu.articles.list()).length
    const restored = await window.moliu.app.restoreBackup({ bundleDir: created.path })
    return { path: created.path, before, after: (await window.moliu.articles.list()).length, restored: restored.restoredImages, bundles: await window.moliu.app.listBackups() }
  })
  if (!inside(userDataDir, backup.path)) throw new Error('备份写到了数据目录之外')
  backupBundle = backup.path
  if (backup.before !== 2 || backup.after !== 1) throw new Error(`恢复未回到备份时点：${backup.before} → ${backup.after}`)
  if (!backup.bundles.includes(backup.path)) throw new Error('备份列表里没有刚创建的备份包')
  if (!(await readFile(resolve(backup.path, 'manifest.json'), 'utf8')).includes('"checksum"')) throw new Error('备份缺少校验清单')

  // F15/F20：没有模型可用时生成必须记入任务台账并如实显示，而不是静默无响应
  const attempt = await window.evaluate(async () => {
    let error = ''
    try { await window.moliu.articles.generate({ manualOutline: '标题：测试', materialIds: [], providerId: '00000000-0000-4000-8000-000000000000', model: 'missing-model', count: 2 }) } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    return { error, tasks: await window.moliu.generation.list(10) }
  })
  const failedTask = attempt.tasks.find((task) => task.domain === 'articles' && task.status !== 'succeeded')
  if (!failedTask) throw new Error(`生成失败没有记入任务台账（调用误差：${attempt.error || '无'}；台账：${JSON.stringify(attempt.tasks)}）`)
  await window.reload()
  await window.getByRole('button', { name: '任务中心' }).click()
  const taskDialog = window.getByRole('dialog')
  await taskDialog.getByText('任务中心').waitFor()
  const expectedLabel = TASK_LABEL[failedTask.status]
  await taskDialog.getByText(expectedLabel).first().waitFor()
  await capture(window, { path: resolve(artifactDir, 'task-center.png'), animations: 'disabled', timeout: 90_000 })
  await window.keyboard.press('Escape')

  // F02/F09：未保存的本地草稿要在创作台被数出来并给回去的入口
  await window.evaluate(({ id, body }) => localStorage.setItem(`moliu:work-draft:${id}`, `${body}\n\n未保存的段落`), { id: articleId, body: IMPORTED_BODY })
  await window.getByRole('button', { name: '文章创作' }).first().click()
  await window.getByText('有未保存修改').first().waitFor()
  await window.getByRole('button', { name: '创作台' }).first().click()
  await window.getByText('篇有未保存的本地修改').waitFor()
  await window.getByText(/个生成任务未全部成功/).waitFor()

  console.log('Workspace smoke passed: home setup card, import to draft, work bar stages, export inside data dir, backup/restore, failure ledger, unsaved draft count')
} finally {
  await application.close()
}

// 阶段 D：干净环境恢复 —— 备份包搬进全新数据目录后，作品要原样回来
await mkdir(freshDir, { recursive: true })
await cp(backupBundle, bundleDir, { recursive: true })
const freshApplication = await electron.launch({
  executablePath,
  args: process.env.MOLIU_EXECUTABLE ? [] : ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: freshDir }
})
try {
  const window = await freshApplication.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  const restored = await window.evaluate(async (bundle) => {
    const result = await window.moliu.app.restoreBackup({ bundleDir: bundle })
    const articles = await window.moliu.articles.list()
    return { images: result.restoredImages, count: articles.length, body: articles[0]?.rawMarkdown ?? '' }
  }, bundleDir)
  if (restored.count !== 1 || !restored.body.includes(IMPORTED_BODY)) throw new Error(`干净环境恢复结果不对：${restored.count} 篇，正文 ${restored.body.slice(0, 40)}`)
  if (restored.images !== 0) throw new Error(`这次备份没有图片，恢复数应为 0，实际 ${restored.images}`)
  console.log('Workspace smoke passed: backup restored into a clean environment')
} finally {
  await freshApplication.close()
  await window_cleanup(userDataDir)
  await window_cleanup(cleanRoot)
}

async function window_cleanup(dir) {
  const requiredPrefix = `${resolve(tmpdir())}${sep}`
  if (!resolve(dir).startsWith(requiredPrefix)) throw new Error('Refusing to clean an unexpected smoke-test directory')
  await rm(dir, { recursive: true, force: true })
}
