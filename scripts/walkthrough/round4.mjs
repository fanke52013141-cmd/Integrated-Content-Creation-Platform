// R4：导入专项（粘贴/文件/DOCX/CSV/JSON/非法输入）+ 素材库 + 提示词 + 数据备份
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { startApp, userDataPath, copyUserData, waitText, mockOpenDialog, mockSaveDialog } from './lib.mjs'

copyUserData(userDataPath('base'), userDataPath('round4'))
const ctx = await startApp({ round: 'round4', userDataDir: userDataPath('round4') })
const { page, app, shot, nav, step, finish } = ctx

// 准备测试文件
const importDir = resolve('artifacts/walkthrough/fixtures')
mkdirSync(importDir, { recursive: true })
const MD_ARTICLE = '# 人力车夫与算法\n\n这是**外部导入**的一篇 Markdown 文章，用于验证导入链路。\n\n## 观点\n\n平台抽成变化影响收入。\n'
const DOCX_PATH = resolve('tests/fixtures/optimization.docx')
const topicJson = JSON.stringify({ topics: [
  { title: 'AI 时代的时间管理', fields: { '核心观点': '工具不省时间，省的是注意力', '读者价值': '3 个可执行做法' } },
  { title: '普通人用 AI 的三个误区', fields: { '核心观点': '把 AI 当搜索用是最大误区', '读者价值': '避开踩坑' } }
] }, null, 2)
const topicCsv = '选题主题,切入角度,核心观点\nAI 副业,实操指南,先跑通最小闭环再谈规模化\n职场焦虑,数据叙事,70% 的焦虑来自信息过载\n'
const badJson = '{ "topics": [ { "title": "缺字段" '

async function importPaste(content, { format } = {}) {
  await page.getByRole('tab', { name: '粘贴内容' }).click()
  await page.waitForTimeout(300)
  if (format) {
    await page.getByRole('button', { name: '内容格式' }).click()
    await page.waitForTimeout(300)
    await page.locator('[role="option"]', { hasText: format }).first().click()
    await page.waitForTimeout(200)
  }
  await page.locator('textarea[name="importContent"]').fill(content)
  await page.getByRole('button', { name: '解析预览' }).click()
  await page.waitForTimeout(1200)
}

async function openImport(headerBtn, emptyBtn) {
  const btn = page.getByRole('button', { name: headerBtn }).first()
  if (await btn.count() && await btn.isVisible().catch(() => false)) await btn.click()
  else await page.getByRole('button', { name: emptyBtn }).first().click()
  await page.locator('.import-dialog-body, [class*="import"]').first().waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForTimeout(400)
}

await step('素材库：空态 + 添加文字素材', async () => {
  await nav('素材库')
  await page.waitForTimeout(1000)
  await shot('materials-empty')
  await page.getByRole('button', { name: '添加文字素材' }).first().click()
  await page.waitForTimeout(600)
  await shot('materials-add-dialog')
  const title = page.locator('input[placeholder*="标题"], input[placeholder*="摘录"]').first()
  await title.fill('访谈摘录：网约车司机的一天')
  const body = page.locator('textarea').first()
  await body.fill('司机王师傅每天在线 11 小时，实际流水 420 元，平台抽成约 23%。他说最大的压力是房租和充电成本。')
  await page.getByRole('button', { name: /加入素材库|保存|添加/ }).last().click()
  await page.waitForTimeout(1200)
  await shot('materials-text-added')
})

await step('素材库：联网搜索未配置密钥时的引导', async () => {
  const search = page.getByRole('button', { name: '搜索素材' })
  if (await search.count()) {
    const kw = page.locator('input[placeholder*="筛选"], input[placeholder*="搜索"]').first()
    await kw.fill('网约车')
    await search.click()
    await page.waitForTimeout(2500)
  }
  await shot('materials-search-nokey')
})

await step('提示词：列表 + 编辑保存新版本', async () => {
  await nav('提示词')
  await page.waitForTimeout(1000)
  await shot('prompts-list')
  await page.locator('[aria-label="提示词列表"] button, .prompt-list button').first().click()
  await page.waitForTimeout(600)
  await shot('prompts-detail')
  const area = page.locator('textarea').first()
  await area.fill(await area.inputValue() + '\n\n（走查追加：结尾必须给一句可执行建议。）')
  await page.getByRole('button', { name: '保存为新版本' }).click()
  await waitText(page, '已|成功', 15_000)
  await page.waitForTimeout(800)
  await shot('prompts-new-version')
})

await step('提示词：导出 JSON（mock 保存对话框）', async () => {
  await mockSaveDialog(app, join(importDir, 'prompt-export.json'))
  await page.getByRole('button', { name: '导出 JSON' }).click()
  await page.waitForTimeout(1500)
  await shot('prompts-exported')
})

await step('选题导入：粘贴 JSON → 预览 → 导入 2 条', async () => {
  await nav('选题生成')
  await page.waitForTimeout(800)
  await openImport('导入', '导入')
  await shot('topic-import-dialog')
  await importPaste(topicJson)
  await shot('topic-import-preview')
  await page.getByRole('button', { name: /导入/ }).last().click()
  await waitText(page, '导入成功|已导入', 20_000)
  await page.waitForTimeout(1200)
  await shot('topic-imported')
})

await step('选题导入：非法 JSON 的报错体验', async () => {
  await openImport('导入', '导入')
  await importPaste(badJson)
  await shot('topic-import-error')
  const alert = page.locator('[role="alert"]')
  const visible = await alert.count()
  if (!visible) throw new Error('非法输入没有出现错误提示')
  await page.locator('button[aria-label="关闭导入"]').click()
  await page.waitForTimeout(400)
})

await step('热点导入：粘贴 CSV（带字段映射）', async () => {
  await nav('热点洞察')
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '导入', exact: true }).first().click()
  await page.waitForTimeout(600)
  await importPaste(topicCsv, { format: 'CSV' })
  await shot('hot-import-preview')
  await page.getByRole('button', { name: /导入/ }).last().click()
  await waitText(page, '导入成功|已导入', 20_000)
  await page.waitForTimeout(800)
  await shot('hot-imported')
})

await step('文章导入：粘贴 Markdown（轻量导入弹窗）', async () => {
  await nav('文章创作')
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '导入现成稿' }).first().click()
  await page.waitForTimeout(600)
  await shot('article-import-dialog')
  const area = page.locator('textarea').first()
  await area.fill(MD_ARTICLE)
  await page.getByRole('button', { name: '导入粘贴内容' }).click()
  await waitText(page, '已保存为本地草稿|导入成功|草稿', 20_000)
  await page.waitForTimeout(1500)
  await shot('article-imported-md')
})

await step('文章导入：真实 DOCX 文件（通用导入弹窗 + mock 打开对话框）', async () => {
  await page.getByRole('button', { name: '导入 DOCX/HTML' }).first().click()
  await page.waitForTimeout(800)
  await mockOpenDialog(app, DOCX_PATH)
  await page.locator('.import-file-picker').click()
  await page.waitForTimeout(2500)
  await shot('article-import-docx-picked')
  await page.getByRole('button', { name: /导入/ }).last().click()
  await waitText(page, '导入成功|已导入', 30_000)
  await page.waitForTimeout(1500)
  await shot('article-imported-docx')
})

await step('数据与备份：创建备份并检查', async () => {
  await page.keyboard.press('Escape')
  await nav('数据与备份')
  await page.waitForTimeout(1000)
  await shot('data-initial')
  await page.getByRole('button', { name: '创建第一份备份' }).click()
  await page.waitForTimeout(3000)
  await shot('data-backup-created')
  const check = page.getByRole('button', { name: '检查', exact: true }).first()
  if (await check.count()) {
    await check.click()
    await page.waitForTimeout(3000)
    await shot('data-checked')
  }
})

await step('数据与备份：导出到外部目录（mock）', async () => {
  const btn = page.getByRole('button', { name: '导出到外部目录' })
  if (await btn.count()) {
    await mockOpenDialog(app, importDir)
    await btn.click()
    await page.waitForTimeout(3000)
    await shot('data-exported')
  }
})

await finish()
