import { ApiClient } from './lib/api.js'
import { calculateBudget, DOCUMENT_LIMITS } from './lib/budget.js'
import { DeliveryController } from './lib/delivery.js'
import { escapeHtml, renderMarkdownPreview } from './lib/markdown.js'
import { createDocument, EditorSession } from './lib/store.js'

const $ = id => document.getElementById(id)
const clone = value => JSON.parse(JSON.stringify(value))
const BUNDLED_THEMES = [
  { id: 'tech-blue', name: '科技蓝', version: '1.0.0', description: '海军蓝刊头、青色信号线与深色代码台', swatches: ['#0B3B75', '#175CD3', '#08A8C7', '#E8F1FF'] },
  { id: 'editorial-red', name: '编辑红', version: '1.0.0', description: '朱砂刊头、暖纸留白与金色书腰线', swatches: ['#7D211C', '#C63C35', '#B8892D', '#F5E9DF'] },
  { id: 'jade-notes', name: '翡翠笔记', version: '1.0.0', description: '翡翠边线、手账卡片与嫩叶色标记', swatches: ['#075A47', '#0D8A6A', '#C79A2B', '#E3F3EA'] }
]

const api = new ApiClient()
const cssCache = new Map()
let availableThemes = BUNDLED_THEMES
let health = null
let accounts = []
let serverRendererReady = false
let serverRender = null
let renderError = null
let renderTimer = null
let previewSequence = 0
let selectedVersion = null
let commentBusy = false
let suppressAutoSync = false
let lastAutoSavedAt = null
let latestSessionState = null

const controller = new DeliveryController({ client: api, onChange: renderDeliveryState })
let storage = null
try { storage = window.localStorage } catch { storage = null }
const session = new EditorSession({ storage, onChange: renderSessionState })
session.load()
let doc = createDocument({
  ...session.document,
  brand: { ...createDocument().brand, ...(session.document.brand || {}) }
})
session.document = clone(doc)
lastAutoSavedAt = session.lastSavedAt

function announce(message, error = false) {
  $('notice').textContent = message
  $('notice').className = `notice${error ? ' error' : ''}`
  $('notice').hidden = false
}

function safeRemoteUrl(value) {
  return /^https?:\/\//i.test(value || '') ? value : ''
}

function formatTime(value) {
  if (!value) return '未知时间'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function documentPayload() {
  return {
    id: doc.id,
    markdown: doc.markdown,
    themeId: doc.themeId,
    themeVersion: doc.themeVersion,
    metadata: { title: doc.title, author: doc.author, summary: doc.summary, cover: doc.cover },
    brand: clone(doc.brand)
  }
}

function renderInput() {
  return {
    markdown: doc.markdown,
    themeId: doc.themeId,
    themeVersion: doc.themeVersion,
    metadata: { title: doc.title, author: doc.author, summary: doc.summary, cover: doc.cover }
  }
}

function currentSignature() { return JSON.stringify(renderInput()) }

async function themeCss(id) {
  if (cssCache.has(id)) return cssCache.get(id)
  const response = await fetch(`assets/themes/${id}.css`, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`主题 CSS 加载失败：${id}（HTTP ${response.status}）`)
  const css = await response.text()
  cssCache.set(id, css)
  return css
}

function updateCoverPreview() {
  const url = safeRemoteUrl(doc.cover)
  const container = $('cover-preview')
  const image = container.querySelector('img')
  container.hidden = !url
  if (url) {
    image.src = url
    image.onerror = () => { container.hidden = true }
  }
  else image.removeAttribute('src')
}

function renderThemeCards() {
  $('theme-list').replaceChildren()
  for (const theme of availableThemes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `theme-option${doc.themeId === theme.id ? ' active' : ''}`
    button.setAttribute('aria-pressed', String(doc.themeId === theme.id))
    const head = document.createElement('div')
    head.className = 'theme-option-head'
    const name = document.createElement('strong')
    name.textContent = theme.name
    const version = document.createElement('small')
    version.textContent = `v${theme.version}`
    head.append(name, version)
    const description = document.createElement('p')
    description.textContent = theme.description || '版本化主题'
    const swatches = document.createElement('div')
    swatches.className = 'swatches'
    for (const color of theme.swatches || BUNDLED_THEMES.find(item => item.id === theme.id)?.swatches || []) {
      const swatch = document.createElement('i')
      swatch.style.backgroundColor = color
      swatches.append(swatch)
    }
    button.append(head, description, swatches)
    button.addEventListener('click', () => {
      doc.themeId = theme.id
      doc.themeVersion = theme.version
      renderThemeCards()
      documentEdited()
    })
    $('theme-list').append(button)
  }
}

function renderVersionList(state) {
  const versions = state?.versions || []
  $('version-count').textContent = String(versions.length)
  $('version-list').replaceChildren()
  if (!versions.length) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = '首次自动保存后生成版本快照。'
    $('version-list').append(empty)
  }
  for (const version of versions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `version-item${selectedVersion === version.id ? ' active' : ''}`
    const title = document.createElement('strong')
    title.textContent = version.document.title || '无标题文档'
    const time = document.createElement('span')
    time.textContent = formatTime(version.createdAt)
    button.append(title, time)
    button.addEventListener('click', () => {
      selectedVersion = version.id
      $('restore-version').disabled = false
      renderVersionList(latestSessionState)
    })
    $('version-list').append(button)
  }
  $('restore-version').disabled = !selectedVersion || !versions.some(version => version.id === selectedVersion)
}

function renderSessionState(state) {
  latestSessionState = state
  $('save-status').textContent = state.message || '本地状态已更新'
  $('save-status').title = state.message || ''
  renderVersionList(state)
  if (state.status === 'saved' && state.lastSavedAt && state.lastSavedAt !== lastAutoSavedAt) {
    lastAutoSavedAt = state.lastSavedAt
    if (controller.state.enabled && !suppressAutoSync) void submitCurrent({ fromAuto: true })
  }
}

function renderDeliveryState(state) {
  const labels = {
    idle: '未启用', enabled: '等待本地保存', submitting: '正在提交', submitted: '已提交，待确认',
    received: '后端已接收', completed: '后端记录：已完成', failed: '任务失败', blocked: '需要人工处理',
    error: '同步错误', unknown: '状态未知', checking: '正在查询'
  }
  const running = ['submitting', 'submitted', 'received', 'checking', 'rendered', 'inspected', 'assets_uploaded', 'draft_upserted', 'readback_verified'].includes(state.status)
  $('sync-badge').textContent = labels[state.status] || state.status
  $('sync-badge').className = `status-badge ${state.status === 'completed' ? 'success' : running ? 'pending' : ['failed', 'blocked', 'error', 'unknown'].includes(state.status) ? 'error' : 'neutral'}`
  $('sync-refresh').disabled = !state.key || controller.busy
  $('sync-detail').textContent = JSON.stringify({
    autoSubmit: state.enabled,
    status: state.status,
    taskKey: state.key,
    error: state.error,
    backendRecord: state.record
  }, null, 2)
}

async function submitCurrent({ fromAuto = false } = {}) {
  if (!accounts.length) {
    announce('无法同步：/api/health 未返回可用公众号账号。', true)
    return
  }
  if (!fromAuto && session.status === 'dirty') {
    suppressAutoSync = true
    const saved = session.flush()
    suppressAutoSync = false
    if (saved.error) return
  }
  await controller.submit(documentPayload(), $('account').value)
}

function updateBudget(html, serverEvidence) {
  const budget = calculateBudget({
    html,
    markdown: doc.markdown,
    title: doc.title,
    author: doc.author,
    summary: doc.summary,
    blockedWords: doc.brand.blockedWords || []
  })
  $('title-count').textContent = `${doc.title.length}/${DOCUMENT_LIMITS.title}`
  $('author-count').textContent = `${doc.author.length}/${DOCUMENT_LIMITS.author}`
  $('summary-count').textContent = `${doc.summary.length}/${DOCUMENT_LIMITS.summary}`
  $('markdown-count').textContent = `${doc.markdown.length} 字符`
  $('html-budget-text').textContent = `${budget.htmlCharacters.toLocaleString()} / 20,000 · 余量 ${budget.htmlCharactersRemaining.toLocaleString()}`
  $('byte-budget-text').textContent = `${budget.htmlBytes.toLocaleString()} / 1,000,000 B`
  $('html-budget-meter').style.width = `${Math.min(100, budget.htmlCharacters / DOCUMENT_LIMITS.htmlCharacters * 100)}%`
  $('byte-budget-meter').style.width = `${Math.min(100, budget.htmlBytes / DOCUMENT_LIMITS.htmlBytes * 100)}%`
  $('html-budget-meter').className = budget.characterLevel
  $('byte-budget-meter').className = budget.byteLevel
  $('budget-source').textContent = serverEvidence ? '服务端返回 HTML 实测' : '本地 HTML 估算（非微信最终字符数）'
  const messages = []
  for (const field of budget.fields) if (field.level !== 'ok') messages.push(`${field.label} ${field.value}/${field.limit}`)
  if (budget.characterLevel !== 'ok') messages.push(`HTML 字符已达 ${Math.round(budget.htmlCharacters / 20000 * 100)}%`)
  if (budget.byteLevel !== 'ok') messages.push(`UTF-8 大小已达 ${Math.round(budget.htmlBytes / 1000000 * 100)}%`)
  if (budget.wordHits.length) messages.push(`本地品牌禁用词：${budget.wordHits.join('、')}`)
  $('budget-message').textContent = messages.length ? messages.join('；') : '80% 提醒 · 90% 严重提醒 · 达到上限阻断'
  $('budget-message').className = `budget-message ${budget.level}`
}

async function updatePreview() {
  const sequence = ++previewSequence
  const signature = currentSignature()
  const matchingServer = serverRender?.signature === signature
  const html = matchingServer && typeof serverRender.result.html === 'string'
    ? serverRender.result.html
    : renderMarkdownPreview(doc.markdown)
  let css = ''
  let cssError = null
  try { css = await themeCss(doc.themeId) }
  catch (error) { cssError = error.message }
  if (sequence !== previewSequence) return

  const cover = safeRemoteUrl(doc.cover)
  const context = `
    <section class="article-context">
      ${cover ? `<img class="cover" src="${escapeHtml(cover)}" alt="封面">` : ''}
      <div class="kicker">${escapeHtml(doc.brand.name || '内容创作')}</div>
      <div class="byline">${escapeHtml(doc.author || '未署名')} · 版本 ${escapeHtml(doc.themeVersion)}</div>
      ${doc.summary ? `<p class="summary">${escapeHtml(doc.summary)}</p>` : ''}
    </section>`
  $('preview').srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#fff}.page{max-width:677px;margin:0 auto;padding:18px 12px}.article-context{margin:0 8px 22px;color:#657185;font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.article-context .cover{display:block;width:100%;height:auto;margin:0 0 14px}.kicker{color:#233a56;font-size:11px;font-weight:700;letter-spacing:.12em}.byline{margin-top:5px}.summary{margin:8px 0 0;color:#687688}</style><style>${css}</style></head><body><main class="page">${context}<article id="output">${html}</article></main></body></html>`

  if (cssError) {
    $('render-status').textContent = `${cssError}；当前仅显示正文结构。`
    $('render-status').className = 'render-status error'
  }
  else if (matchingServer) {
    $('render-status').textContent = '服务端 /api/render 已返回 HTML · 质量和读回仍以实际字段为准'
    $('render-status').className = 'render-status server'
  }
  else if (renderError) {
    $('render-status').textContent = `服务端渲染失败，当前为本地预览：${renderError}`
    $('render-status').className = 'render-status error'
  }
  else {
    $('render-status').textContent = '本地轻量预览 · 未执行服务端渲染/微信校验'
    $('render-status').className = 'render-status'
  }

  if (!matchingServer) {
    $('quality-output').textContent = '本地模式：未运行服务端渲染、官方检查或真实读回。'
  }
  else {
    const evidence = {}
    for (const key of ['quality', 'inspection', 'lint', 'readback', 'warnings', 'degradations']) {
      if (serverRender.result[key] !== undefined) evidence[key] = serverRender.result[key]
    }
    $('quality-output').textContent = Object.keys(evidence).length
      ? JSON.stringify(evidence, null, 2)
      : '服务端已返回 HTML，但响应未包含质量或读回字段；不能据此认定校验通过。'
  }
  updateBudget(html, matchingServer)
}

async function renderFromServer() {
  if (!serverRendererReady) return
  const signature = currentSignature()
  const input = renderInput()
  try {
    const result = await api.render(input)
    if (typeof result.html !== 'string') throw new Error('渲染响应缺少 html 字符串')
    if (signature !== currentSignature()) return
    serverRender = { signature, result }
    renderError = null
  }
  catch (error) {
    if (signature !== currentSignature()) return
    serverRender = null
    renderError = error.message
  }
  await updatePreview()
}

function scheduleServerRender() {
  clearTimeout(renderTimer)
  if (serverRendererReady) renderTimer = setTimeout(renderFromServer, 700)
}

function documentEdited() {
  session.updateDocument(doc)
  updateCoverPreview()
  $('brand-heading').textContent = doc.brand.name || '集成内容平台'
  document.documentElement.style.setProperty('--accent', doc.brand.color || '#175CD3')
  void updatePreview()
  scheduleServerRender()
}

function bindField(id, key) {
  $(id).addEventListener('input', event => {
    doc[key] = event.target.value
    documentEdited()
  })
}

function bindBrandField(id, key, transform = value => value) {
  $(id).addEventListener('input', event => {
    doc.brand[key] = transform(event.target.value)
    documentEdited()
  })
}

function fillForm() {
  for (const [id, key] of [['title', 'title'], ['author', 'author'], ['summary', 'summary'], ['cover', 'cover'], ['markdown', 'markdown']]) $(id).value = doc[key] || ''
  $('brand-name').value = doc.brand.name || ''
  $('brand-color').value = doc.brand.color || '#175CD3'
  $('brand-default-author').value = doc.brand.defaultAuthor || ''
  $('brand-logo').value = doc.brand.logoUrl || ''
  $('brand-blocked-words').value = (doc.brand.blockedWords || []).join('，')
  $('brand-heading').textContent = doc.brand.name || '集成内容平台'
  document.documentElement.style.setProperty('--accent', doc.brand.color || '#175CD3')
  renderThemeCards()
  updateCoverPreview()
}

function populateAccounts() {
  const select = $('account')
  select.replaceChildren()
  if (!accounts.length) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = '服务端未返回可用账号'
    select.append(option)
  }
  for (const account of accounts) {
    const option = document.createElement('option')
    option.value = account.id
    option.textContent = `${account.name || account.id}${account.mode ? ` · ${account.mode}` : ''}`
    select.append(option)
  }
  select.disabled = !accounts.length
  $('manual-sync').disabled = !accounts.length
  $('auto-sync').disabled = !accounts.length
}

function configureWorkspace() {
  const enabled = health?.workspace?.enabled === true
  $('workspace-status').textContent = enabled
    ? '团队评论接口已配置。评论列表仅显示本次会话获得服务端接收回执的内容。'
    : '团队工作区未配置或健康检查不可用；评论不可提交，不会伪造审核结果。'
  for (const id of ['comment-author', 'comment-body', 'comment-submit']) $(id).disabled = !enabled
}

async function loadBackend() {
  const [healthResult, themesResult] = await Promise.allSettled([api.health(), api.themes()])
  if (healthResult.status === 'fulfilled') {
    health = healthResult.value
    accounts = Array.isArray(health.accounts) ? health.accounts.filter(account => account?.id) : []
    serverRendererReady = health.renderer === 'ready'
    $('backend-badge').textContent = '/api 已连接'
    $('backend-badge').className = 'status-badge success'
    if (!serverRendererReady) announce('后端健康检查已返回，但 renderer 未就绪；当前使用本地预览。')
    populateAccounts()
    configureWorkspace()
    scheduleServerRender()
  }
  else {
    health = null
    accounts = []
    serverRendererReady = false
    $('backend-badge').textContent = '后端不可用 · 本地模式'
    $('backend-badge').className = 'status-badge error'
    populateAccounts()
    configureWorkspace()
    announce(`${healthResult.reason.message} 自动保存仍仅保存在此浏览器。`, true)
  }

  if (themesResult.status === 'fulfilled' && Array.isArray(themesResult.value.themes)) {
    const serverThemes = themesResult.value.themes
    availableThemes = BUNDLED_THEMES.map(local => {
      const remote = serverThemes.find(theme => theme.id === local.id)
      return { ...local, ...(remote || {}) }
    })
    $('theme-source').textContent = '主题元数据已与 GET /api/themes 合并；本地补齐未返回项。'
  }
  else {
    availableThemes = BUNDLED_THEMES
    $('theme-source').textContent = '主题 API 不可用，使用随前端打包的三套元数据与 CSS；不代表后端已确认。'
  }
  renderThemeCards()
}

bindField('title', 'title')
bindField('author', 'author')
bindField('summary', 'summary')
bindField('cover', 'cover')
bindField('markdown', 'markdown')
bindBrandField('brand-name', 'name')
bindBrandField('brand-color', 'color')
bindBrandField('brand-default-author', 'defaultAuthor')
bindBrandField('brand-logo', 'logoUrl')
bindBrandField('brand-blocked-words', 'blockedWords', value => value.split(/[，,\n]/).map(item => item.trim()).filter(Boolean))

$('apply-author').addEventListener('click', () => {
  if (!doc.brand.defaultAuthor) return announce('请先在品牌设置中填写默认作者。')
  doc.author = doc.brand.defaultAuthor
  $('author').value = doc.author
  documentEdited()
})

$('save-now').addEventListener('click', () => {
  const result = session.flush()
  if (!result.saved && !result.error) announce('没有新的本地修改需要保存。')
})

$('manual-sync').addEventListener('click', () => submitCurrent())
$('sync-refresh').addEventListener('click', () => {
  if (controller.busy) return announce('当前任务正在查询，无需重复刷新。')
  if (controller.state.key) void controller.poll(controller.state.key)
})
$('auto-sync').addEventListener('change', event => {
  if (event.target.checked && !accounts.length) {
    event.target.checked = false
    return announce('服务端没有返回账号，不能开启自动同步。', true)
  }
  controller.setEnabled(event.target.checked)
  if (event.target.checked) void submitCurrent()
})

$('restore-version').addEventListener('click', async () => {
  const version = session.versions.find(item => item.id === selectedVersion)
  if (!version) return
  if (!window.confirm(`恢复「${version.document.title || '无标题'}」在 ${formatTime(version.createdAt)} 的本地版本？`)) return
  if (!session.restore(selectedVersion)) return
  doc = clone(session.document)
  fillForm()
  await updatePreview()
  scheduleServerRender()
  announce('已恢复所选本地快照；自动保存后将形成一个新的版本，不删除历史。')
})

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button))
    $('device').className = `device ${button.dataset.view}`
  })
})

$('comment-submit').addEventListener('click', async () => {
  if (commentBusy || health?.workspace?.enabled !== true) return
  const body = $('comment-body').value.trim()
  const author = $('comment-author').value.trim()
  if (!body || !author) return announce('请填写评论人和具体评论内容。')
  commentBusy = true
  $('comment-submit').disabled = true
  $('comment-submit').textContent = '正在提交到 /api…'
  try {
    const response = await api.comment({
      documentId: doc.id,
      revision: session.versions[0]?.id || 'unsaved-local',
      body,
      author
    })
    const comment = document.createElement('article')
    comment.className = 'comment'
    const heading = document.createElement('strong')
    heading.textContent = author
    const text = document.createElement('div')
    text.textContent = body
    const receipt = document.createElement('small')
    receipt.textContent = `服务端已接收${response.result?.id ? ` · ${response.result.id}` : ''}`
    comment.append(heading, text, receipt)
    $('comment-list').prepend(comment)
    $('comment-body').value = ''
    announce('评论已由服务端接收。此处不是完整团队评论列表。')
  }
  catch (error) {
    announce(`评论未提交：${error.message}`, true)
  }
  finally {
    commentBusy = false
    $('comment-submit').disabled = health?.workspace?.enabled !== true
    $('comment-submit').textContent = '提交评论到工作区'
  }
})

window.addEventListener('beforeunload', () => {
  suppressAutoSync = true
  session.flush()
  controller.setEnabled(false)
})

fillForm()
renderSessionState(session.snapshot())
renderDeliveryState(controller.state)
void updatePreview()
void loadBackend()
