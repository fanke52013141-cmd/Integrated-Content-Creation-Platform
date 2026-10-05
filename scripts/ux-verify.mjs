import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const artifactDir = resolve('artifacts/ui')
await mkdir(artifactDir, { recursive: true })
const userDataDir = resolve(tmpdir(), `moliu-ux-verify-${Date.now()}`)

const application = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.'],
  env: { ...process.env, MOLIU_USER_DATA_DIR: userDataDir }
})
const window = await application.firstWindow()
const errors = []
window.on('pageerror', (error) => errors.push(error.message))
await window.waitForLoadState('domcontentloaded')
await window.waitForTimeout(1_500)

let failed = 0
async function expectText(text, label) {
  try {
    await window.getByText(text, { exact: false }).first().waitFor({ timeout: 8_000 })
    console.log(`PASS: ${label}`)
  } catch {
    failed += 1
    console.error(`FAIL: ${label}（未找到文本「${text}」）`)
  }
}

// 1. 首启三步引导
await expectText('三步开始第一篇文章', 'P2-2 首启三步引导条')
await expectText('第一步 · 配置AI 服务', '引导步骤一')
await window.screenshot({ path: resolve(artifactDir, 'ux-accounts-guide.png') })

// 2. 离线创建并锁定账号（走手动向导，无 LLM）
await window.getByRole('button', { name: '新建账号' }).first().click()
await window.getByPlaceholder('在这里写下你的想法…').waitFor({ timeout: 8_000 })
await window.getByPlaceholder('在这里写下你的想法…').fill('交互验证号')
await window.getByRole('button', { name: '保存并继续' }).click()
for (let i = 0; i < 6; i += 1) await window.getByRole('button', { name: '跳过这一问' }).click()
await window.getByRole('button', { name: '手动填写字段' }).click()
await window.getByRole('button', { name: '保存并锁定' }).click()
await expectText('交互验证号', '离线创建并锁定账号')

// 3. 选题：Ctrl+Enter 接线 + 草稿持久化
await window.locator('.nav-item', { hasText: '选题生成' }).first().click()
await window.waitForTimeout(800)
const seedInput = window.locator('textarea[name="seedKeyword"]')
await seedInput.fill('交互验证关键词持久化')
await seedInput.press('Control+Enter')
// 无供应商 → 生成链路在「选择可用模型」处拦截，证明 Ctrl+Enter 已触发生成
await expectText('请选择可用模型', 'P0-4 Ctrl+Enter 触发生成校验链')
await window.locator('.nav-item', { hasText: '内容框架' }).first().click()
await window.waitForTimeout(600)
await window.locator('.nav-item', { hasText: '选题生成' }).first().click()
await window.waitForTimeout(600)
const value = await seedInput.inputValue()
if (value === '交互验证关键词持久化') console.log('PASS: P0-2 草稿跨页持久化')
else { failed += 1; console.error(`FAIL: P0-2 草稿持久化，当前值「${value}」`) }

// 4. 选题墙搜索框 + 发布三步
try {
  await window.getByPlaceholder('搜索选题…').waitFor({ timeout: 8_000 })
  console.log('PASS: P1-4 选题墙搜索框')
} catch {
  failed += 1
  console.error('FAIL: P1-4 选题墙搜索框')
}
await window.screenshot({ path: resolve(artifactDir, 'ux-topics-draft.png') })
await window.locator('.nav-item', { hasText: '发布管理' }).first().click()
await window.waitForTimeout(800)
await expectText('第一步 · 连接公众号', '发布三步结构保持')
await window.screenshot({ path: resolve(artifactDir, 'ux-publishing.png') })

if (errors.length) {
  failed += 1
  console.error('页面运行错误:', errors.join(' | '))
}
await application.close()

// 5. 评审默认角色：直接查库（页面侧需要先有文章才渲染角色区）
const db = new DatabaseSync(resolve(userDataDir, 'moliu.db'), { readOnly: true })
const roles = db.prepare('SELECT name FROM review_roles ORDER BY sort_order').all()
db.close()
const expected = ['结构编辑', '标题与开头', '事实核查']
const names = roles.map((row) => row.name)
for (const name of expected) {
  if (names.includes(name)) console.log(`PASS: P0-5 默认角色「${name}」已种子`)
  else { failed += 1; console.error(`FAIL: P0-5 缺少默认角色「${name}」，实际：${names.join('、') || '（空）'}`) }
}

console.log(failed ? `验证完成：${failed} 项失败` : '验证完成：全部通过')
process.exit(failed ? 1 : 0)
