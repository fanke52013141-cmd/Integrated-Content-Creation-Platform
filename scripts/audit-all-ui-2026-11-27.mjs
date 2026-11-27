import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './lib/electron-test.mjs'
import { capture } from './lib/evidence.mjs'

const OUT = resolve('artifacts', 'ui-audit-2026-11-27')
await mkdir(OUT, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'moliu-all-ui-audit-'))
const routes = ['home', 'accounts', 'providers', 'platforms', 'hotspots', 'topics', 'frameworks', 'articles', 'materials', 'visuals', 'reviews', 'layouts', 'publishing', 'prompts', 'data']
const nav = { home: '创作台', accounts: '账号定位', providers: 'AI 服务', platforms: '平台授权', hotspots: '热点洞察', topics: '选题生成', frameworks: '内容框架', articles: '文章创作', materials: '素材库', visuals: '智能配图', reviews: '内容评审', layouts: '文章排版', publishing: '发布管理', prompts: '提示词', data: '数据与备份' }
const actions = ['导入', '导入方案', '导入 HTML', '导入 DOCX/HTML', '导入现成稿', '新建账号', '开始定位', '场景式配置', '空白配置', '调用日志', '手动新建', '编辑模板', '配置选题字段', '手动添加', '平台设置', '智能筛选', '添加文字素材', '创建配图风格', '新建草稿', '开始写作', '评审角色', '新建连接', '立即备份', '新建提示词', '任务中心', '下载标准模板']
const records = []
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...process.env, MOLIU_USER_DATA_DIR: root } })
const page = await app.firstWindow()
page.setDefaultTimeout(15_000)
page.on('pageerror', (error) => records.push({ type: 'pageerror', message: error.message }))
await page.waitForLoadState('domcontentloaded')
await page.evaluate(() => localStorage.setItem('moliu:first-creation-guide:v1', 'done'))
await page.evaluate(async () => {
  const provider = await window.moliu.providers.save({ displayName: '审查模型', protocol: 'openai-compatible', baseUrl: 'https://example.invalid/v1', defaultModel: 'audit-model', enabled: true, isRelay: false, capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false }, models: [{ modelId: 'audit-model', displayName: '审查模型', kind: 'text', reasoningVariants: [], isDefault: true, enabled: true }], apiKey: 'audit-key' })
  void provider
  const account = await window.moliu.accounts.save({ fields: [{ id: crypto.randomUUID(), name: '账号名称', value: '审查账号', isDefault: true }, { id: crypto.randomUUID(), name: '目标受众', value: '内容创作者', isDefault: true }, { id: crypto.randomUUID(), name: '写作风格', value: '简洁克制', isDefault: true }], wizardAnswers: [], status: 'locked', source: 'manual' })
  await window.moliu.accounts.setCurrent(account.id)
  const topic = await window.moliu.topics.save({ seedKeyword: '审查选题', accountIds: [account.id], relatedHotIds: [], status: 'locked', source: 'manual', fields: { '选题主题': '审查选题', '切入角度': '真实使用流程', '目标读者': '内容创作者', '核心观点': '界面应该服务创作，而不是打断创作' } })
  await window.moliu.frameworks.save({ topicId: topic.id, accountId: account.id, materialIds: [], manualTopic: '审查框架', status: 'locked', source: 'manual', sections: [{ name: '开头', content: '从真实使用问题开始' }, { name: '论证', content: '检查遮挡和冗余说明' }, { name: '结尾', content: '给出清晰的下一步' }] })
  const article = await window.moliu.articles.save({ accountId: account.id, materialIds: [], manualOutline: '', status: 'locked', source: 'manual', rawMarkdown: '# 全页面审查样稿\n\n这是一篇用于检查界面遮挡、下拉框样式和冗余文字的文章。\n\n## 第一部分\n\n- 清晰的操作入口\n- 合适的提示密度\n- 不互相遮挡的下拉框\n\n> 提示只在需要时出现。' })
  await window.moliu.visuals.createManualPack(article.id)
  await window.moliu.layouts.create({ articleId: article.id, platform: 'wechat' })
  await window.moliu.materials.addManual({ title: '审查素材一', summary: '用于检查素材列表与导入弹窗。' })
  await window.moliu.materials.addManual({ title: '审查素材二', summary: '用于检查长文本截断与操作区遮挡。' })
  await window.moliu.publishing.saveWechatChannel({ appId: 'wx1234567890abcdef', appSecret: 'secret-audit-0123456789abcdef', enabled: false })
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)

async function goto(route) {
  await page.evaluate((id) => { location.hash = `#/${id}` }, route)
  await page.waitForTimeout(650)
}
async function shot(name) {
  await capture(page, { path: join(OUT, `${name}.png`), animations: 'disabled' })
}
async function metrics(kind, route, name) {
  const result = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
    const visible = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0 }
    const horizontalOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    const popovers = [...document.querySelectorAll('.select-popover')].filter(visible).map((el) => {
      const r = rect(el), s = getComputedStyle(el)
      return { rect: r, zIndex: s.zIndex, background: s.backgroundColor, border: s.border, borderRadius: s.borderRadius, fontSize: s.fontSize, outOfBounds: r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1 }
    })
    const dialogs = [...document.querySelectorAll('.modal-overlay [role="dialog"], .modal-overlay .modal, .modal-overlay .import-dialog, .modal-overlay .manual-topic-dialog')].filter(visible).map((el) => {
      const r = rect(el)
      return { rect: r, outOfBounds: r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1 }
    })
    const optionOverflow = [...document.querySelectorAll('.select-option')].filter(visible).filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => ({ text: el.innerText.slice(0, 160), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    const interactive = [...document.querySelectorAll('button,input,textarea,summary,[role="button"]')].filter((el) => visible(el) && !el.closest('[inert], .select-popover') && getComputedStyle(el).position !== 'fixed')
    const outsideX = interactive.map((el) => ({ el, r: rect(el) })).filter(({ r }) => r.left < -2 || r.right > vw + 2).slice(0, 12).map(({ el, r }) => ({ text: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('name') || '').trim().slice(0, 100), rect: r }))
    const overlaps = []
    for (let i = 0; i < interactive.length; i++) for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i], b = interactive[j]
      if (a.contains(b) || b.contains(a) || a.closest('.segmented') === b.closest('.segmented')) continue
      const ar = rect(a), br = rect(b)
      const x = Math.min(ar.right, br.right) - Math.max(ar.left, br.left), y = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top)
      if (x > 2 && y > 2) overlaps.push({ a: (a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 70), b: (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 70), x, y })
    }
    const text = document.querySelector('#main')?.innerText ?? ''
    return { viewport: { width: vw, height: vh }, horizontalOverflow, popovers, dialogs, optionOverflow, outsideX, overlaps: overlaps.slice(0, 15), textLength: text.length }
  })
  return { type: kind, route, name, ...result }
}
async function record(kind, route, name, screenshot = true) {
  const result = await metrics(kind, route, name)
  const text = await page.locator('#main').innerText().catch(() => '')
  const dialogText = await page.locator('.modal-overlay').last().innerText().catch(() => '')
  result.pageText = text
  if (dialogText) result.dialogText = dialogText
  records.push(result)
  if (screenshot) await shot(name)
  console.log(`${result.horizontalOverflow > 1 || result.outsideX.length || result.overlaps.length || result.optionOverflow.length || result.popovers.some(p => p.outOfBounds) || result.dialogs.some(d => d.outOfBounds) ? 'WARN' : 'OK  '} ${name}`)
}
async function closeOverlays() {
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('.modal-overlay').count()) && !(await page.locator('.select-popover').count())) return
    await page.keyboard.press('Escape').catch(() => {})
    if (await page.locator('.modal-overlay [aria-label="关闭"], .modal-overlay .modal-close').count()) {
      await page.locator('.modal-overlay [aria-label="关闭"], .modal-overlay .modal-close').last().click({ timeout: 800 }).catch(() => {})
    }
    if (await page.locator('.modal-overlay button:has-text("取消")').count()) {
      await page.locator('.modal-overlay button:has-text("取消")').last().click({ timeout: 800 }).catch(() => {})
    }
    await page.waitForTimeout(180)
  }
  if (await page.locator('.modal-overlay').count()) await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(el => el.remove()))
}
async function auditSelect(route, width) {
  const triggers = page.locator('[aria-haspopup="listbox"]:visible:not(:disabled)')
  if (!(await triggers.count())) return
  const trigger = triggers.first()
  const name = `${route}-select-${width}`
  try {
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    await page.locator('.select-popover').first().waitFor({ state: 'visible', timeout: 3000 })
    await page.waitForTimeout(120)
    await record('select', route, name)
    await page.keyboard.press('Escape')
  } catch (error) {
    records.push({ type: 'select-error', route, name, message: error.message })
  }
}
async function auditDialog(route, label, width) {
  const button = page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), exact: false }).first()
  if (!(await button.count()) || !(await button.isEnabled().catch(() => false))) return
  const name = `${route}-dialog-${label.replace(/[\\/:*?"<>|]/g, '-')}-${width}`
  try {
    await button.scrollIntoViewIfNeeded()
    await button.click({ timeout: 2500 })
    await page.waitForTimeout(400)
    if (label === '下载标准模板') return
    const hasModal = await page.locator('.modal-overlay').count()
    if (!hasModal && label === '导入') {
      const sub = page.getByRole('button', { name: /导入 DOCX\/HTML|导入现成稿/ }).first()
      if (await sub.count()) { await sub.click({ timeout: 1000 }).catch(() => {}); await page.waitForTimeout(350) }
    }
    await record('dialog', route, name)
  } catch (error) {
    records.push({ type: 'dialog-error', route, name, message: error.message })
  } finally {
    await closeOverlays()
    await goto(route)
  }
}

try {
  for (const width of [1440, 1180, 960]) {
    await page.setViewportSize({ width, height: width === 960 ? 760 : 900 })
    for (const route of routes) {
      await goto(route)
      await record('page', route, `${route}-base-${width}`)
      await auditSelect(route, width)
      if (width === 1440) {
        for (const label of actions) await auditDialog(route, label, width)
      }
    }
  }
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(records, null, 2))
  console.log(`AUDIT COMPLETE: ${records.length} records, ${OUT}`)
} finally {
  await app.close().catch(() => {})
  if (!root.startsWith(join(tmpdir(), 'moliu-all-ui-audit-'))) throw new Error('Refusing to clean unexpected directory')
  await rm(root, { recursive: true, force: true })
}
