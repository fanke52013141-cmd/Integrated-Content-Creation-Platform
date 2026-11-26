const clone = value => JSON.parse(JSON.stringify(value))

export function createDocument(overrides = {}) {
  return {
    id: `doc-${Date.now().toString(36)}`,
    title: '一体化内容创作工作台',
    author: '',
    summary: '从 Markdown、原创主题到可追踪草稿任务的一体化创作体验。',
    cover: '',
    markdown: `# 一体化内容创作工作台\n\n> 源文档、主题版本与交付状态彼此独立；本地预览不会冒充微信验收。\n\n## 清晰的内容层次\n\n在一个工作区完成 **写作、排版、版本恢复** 与团队协作。支持 [安全链接](https://example.com)、行内 \`code\` 和 ==重点标注==。\n\n### 为真实交付而设计\n\n- 三套版本化原创主题\n- 字符预算与品牌禁用词提醒\n- 自动保存到当前浏览器\n- 服务端确认后才展示同步成功\n\n| 能力 | 当前状态 |\n| --- | --- |\n| 本地编辑 | 可用 |\n| 后端渲染 | 按实际响应 |\n\n\`\`\`js\nconst sourceOfTruth = 'document + themeVersion'\n\`\`\`\n\n### 可复用的内容卡片\n\n<section class="wechat-card"><p>原始 HTML 在本地安全预览中会被转义；请通过受控组件生成卡片。</p></section>\n\n---\n\n*移动预览仅用于快速检查，不替代真机回归。*`,
    themeId: 'tech-blue',
    themeVersion: '1.0.0',
    brand: {
      name: '集成内容平台',
      color: '#175CD3',
      defaultAuthor: '',
      logoUrl: '',
      blockedWords: []
    },
    ...overrides
  }
}

/** Browser-local autosave and snapshots. No server success is implied by this store. */
export class EditorSession {
  constructor({ storage, key = 'integrated-editor.session.v1', debounceMs = 800, now = () => new Date().toISOString(), onChange = () => {} } = {}) {
    this.storage = storage
    this.key = key
    this.debounceMs = debounceMs
    this.now = now
    this.onChange = onChange
    this.document = createDocument()
    this.versions = []
    this.status = 'clean'
    this.lastSavedAt = null
    this.message = ''
    this.timer = null
    this.sequence = 0
  }

  snapshot() {
    return clone({
      document: this.document,
      versions: this.versions,
      status: this.status,
      lastSavedAt: this.lastSavedAt,
      message: this.message
    })
  }

  notify() { this.onChange(this.snapshot()) }

  load() {
    if (!this.storage) return false
    try {
      const raw = this.storage.getItem(this.key)
      if (!raw) return false
      const saved = JSON.parse(raw)
      if (typeof saved.document?.markdown !== 'string') throw new Error('本地草稿格式无效')
      this.document = saved.document
      this.versions = Array.isArray(saved.versions) ? saved.versions : []
      this.lastSavedAt = saved.lastSavedAt || null
      this.status = 'saved'
      this.message = '已恢复此浏览器中的本地草稿'
      this.notify()
      return true
    }
    catch (error) {
      this.status = 'error'
      this.message = `本地草稿读取失败：${error.message}`
      this.notify()
      return false
    }
  }

  updateDocument(document) {
    if (JSON.stringify(document) === JSON.stringify(this.document)) return false
    this.document = clone(document)
    this.status = 'dirty'
    this.message = '有尚未保存到本地的修改'
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
    this.notify()
    return true
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = null
    if (this.status !== 'dirty') return { saved: false }
    if (!this.storage) {
      this.status = 'error'
      this.message = '当前环境不支持本地存储'
      this.notify()
      return { saved: false, error: this.message }
    }
    const createdAt = this.now()
    const currentSignature = JSON.stringify(this.document)
    const latest = this.versions[0]
    const version = latest && JSON.stringify(latest.document) === currentSignature ? null : {
      id: `version-${Date.parse(createdAt)}-${++this.sequence}`,
      createdAt,
      document: clone(this.document)
    }
    const nextVersions = (version ? [version, ...this.versions] : [...this.versions]).slice(0, 20)
    try {
      this.storage.setItem(this.key, JSON.stringify({ document: this.document, versions: nextVersions, lastSavedAt: createdAt }))
      this.versions = nextVersions
      this.lastSavedAt = createdAt
      this.status = 'saved'
      this.message = '已保存到此浏览器（未代表服务端已保存）'
      this.notify()
      return { saved: true, version }
    }
    catch (error) {
      this.status = 'error'
      this.message = `本地保存失败：${error.message}`
      this.notify()
      return { saved: false, error: this.message }
    }
  }

  restore(versionId) {
    const version = this.versions.find(item => item.id === versionId)
    if (!version) return false
    return this.updateDocument(version.document)
  }

  dispose() { clearTimeout(this.timer) }
}
