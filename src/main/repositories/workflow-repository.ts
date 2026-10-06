import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { ArticleListQuery, ArticleListResult, ArticleSummary, CreationRequest, CreationResult, GenerationTask, PublicationSnapshot, PublishFormDraft, SaveWorkDraftInput, WorkDraft } from '../../shared/contracts.js'

interface DraftRow { article_id: string; base_version_id: string; content: string; revision: number; updated_at: string }

/** 作品级持久状态：草稿、交付快照、远端图片映射与任务结果。 */
export class WorkflowRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_drafts (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        base_version_id TEXT NOT NULL, content TEXT NOT NULL,
        revision INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publish_form_drafts (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE, data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publication_snapshots (
        publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE, data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wechat_asset_uploads (
        asset_id TEXT NOT NULL REFERENCES visual_assets(id) ON DELETE CASCADE,
        app_id TEXT NOT NULL, kind TEXT NOT NULL, remote_value TEXT NOT NULL,
        PRIMARY KEY(asset_id, app_id, kind)
      );
      CREATE TABLE IF NOT EXISTS channel_verification (
        channel_id TEXT PRIMARY KEY, status TEXT NOT NULL, tested_at TEXT NOT NULL, error TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generation_results (
        task_id TEXT PRIMARY KEY REFERENCES generation_tasks(id) ON DELETE CASCADE,
        article_id TEXT, result_ids_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_articles_account_updated ON articles(account_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_status_updated ON articles(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS creation_requests (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, article_id TEXT,
        title TEXT NOT NULL, input_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creation_results (
        request_id TEXT NOT NULL REFERENCES creation_requests(id) ON DELETE CASCADE,
        candidate_index INTEGER NOT NULL, data_json TEXT NOT NULL,
        PRIMARY KEY(request_id,candidate_index)
      );
      CREATE TABLE IF NOT EXISTS publication_resolutions (
        publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE, data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_candidates (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS material_documents (
        material_id TEXT PRIMARY KEY REFERENCES materials(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL, content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_evidence (
        version_id TEXT PRIMARY KEY, data_json TEXT NOT NULL
      );
    `)
    for (const row of this.db.prepare("SELECT request_id,data_json FROM creation_results WHERE json_extract(data_json,'$.status')='running'").all()) {
      const result = JSON.parse(String(row.data_json)) as CreationResult
      this.saveCreationResult(String(row.request_id), { ...result, status: 'failed', completion: 'interrupted', message: '上次运行已中断，已保留收到的内容' })
    }
  }

  saveDocument(materialId: string, versionId: string, content: string): void {
    this.db.prepare('INSERT OR REPLACE INTO material_documents VALUES(?,?,?)').run(materialId, versionId, content)
  }

  getDocument(materialId: string): { versionId: string; content: string } | null {
    const row = this.db.prepare('SELECT version_id,content FROM material_documents WHERE material_id=?').get(materialId)
    return row ? { versionId: String(row.version_id), content: String(row.content) } : null
  }

  saveEvidence(versionId: string, evidence: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO content_evidence VALUES(?,?)').run(versionId, JSON.stringify(evidence))
  }

  getEvidence<T>(versionId: string): T | null {
    const row = this.db.prepare('SELECT data_json FROM content_evidence WHERE version_id=?').get(versionId)
    return row ? JSON.parse(String(row.data_json)) as T : null
  }

  getResolution(id: string): import('../../shared/contracts.js').PublicationResolution | undefined {
    const row = this.db.prepare('SELECT data_json FROM publication_resolutions WHERE publication_id=?').get(id)
    return row ? JSON.parse(String(row.data_json)) : undefined
  }

  saveResolution(id: string, value: unknown): void {
    this.db.prepare('INSERT INTO publication_resolutions VALUES(?,?) ON CONFLICT(publication_id) DO UPDATE SET data_json=excluded.data_json').run(id, JSON.stringify(value))
  }

  linkReviewCandidate(articleId: string, taskId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO review_candidates VALUES(?,?)').run(articleId, taskId)
  }

  adoptReviewCandidate(articleId: string): void {
    const row = this.db.prepare('SELECT task_id FROM review_candidates WHERE article_id=?').get(articleId)
    if (row) this.db.prepare("UPDATE review_tasks SET status='applied',updated_at=? WHERE id=?").run(new Date().toISOString(), row.task_id)
  }

  createRequest<T>(kind: CreationRequest['kind'], input: T, title: string, count: number, articleId?: string): string {
    const id = crypto.randomUUID()
    this.db.exec('SAVEPOINT create_request')
    try {
      this.db.prepare('INSERT INTO creation_requests VALUES(?,?,?,?,?,?)').run(id, kind, articleId ?? null, title, JSON.stringify(input), new Date().toISOString())
      for (let index = 1; index <= count; index++) this.saveCreationResult(id, { index, status: 'pending', content: '', message: '' })
      this.db.exec('RELEASE create_request')
      return id
    } catch (error) {
      this.db.exec('ROLLBACK TO create_request; RELEASE create_request')
      throw error
    }
  }

  getRequestInput<T>(id: string): T {
    const row = this.db.prepare('SELECT input_json FROM creation_requests WHERE id=?').get(id)
    if (!row) throw new Error('生成请求不存在')
    return JSON.parse(String(row.input_json)) as T
  }

  saveCreationResult(id: string, result: CreationResult): void {
    this.db.prepare('INSERT INTO creation_results VALUES(?,?,?) ON CONFLICT(request_id,candidate_index) DO UPDATE SET data_json=excluded.data_json')
      .run(id, result.index, JSON.stringify(result))
  }

  getCreationRequest(id: string): CreationRequest | null {
    return this.listCreationRequests(id)[0] ?? null
  }

  listCreationRequests(id?: string): CreationRequest[] {
    return this.db.prepare(`SELECT * FROM creation_requests ${id ? 'WHERE id=?' : ''} ORDER BY created_at DESC,rowid DESC LIMIT 50`).all(...(id ? [id] : [])).map(row => ({
      id: String(row.id), kind: row.kind as CreationRequest['kind'], articleId: row.article_id ? String(row.article_id) : undefined,
      title: String(row.title), createdAt: String(row.created_at),
      results: this.db.prepare('SELECT data_json FROM creation_results WHERE request_id=? ORDER BY candidate_index').all(String(row.id)).map(item => JSON.parse(String(item.data_json)) as CreationResult)
    }))
  }

  getDraft(articleId: string): WorkDraft | null {
    const row = this.db.prepare('SELECT * FROM work_drafts WHERE article_id=?').get(articleId) as unknown as DraftRow | undefined
    return row ? { articleId: row.article_id, baseVersionId: row.base_version_id, content: row.content, revision: row.revision, updatedAt: row.updated_at } : null
  }

  saveDraft(input: SaveWorkDraftInput): WorkDraft {
    const article = this.db.prepare('SELECT current_version_id FROM articles WHERE id=?').get(input.articleId)
    if (!article) throw new Error('文章不存在，无法暂存')
    if (!this.db.prepare('SELECT id FROM article_versions WHERE id=? AND article_id=?').get(input.baseVersionId, input.articleId)) throw new Error('草稿基础版本不属于当前文章')
    const current = this.getDraft(input.articleId)
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) {
      throw new Error('工作草稿已在另一处更新，请重新加载后继续编辑')
    }
    const revision = (current?.revision ?? 0) + 1
    this.db.prepare(`INSERT INTO work_drafts(article_id,base_version_id,content,revision,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(article_id) DO UPDATE SET base_version_id=excluded.base_version_id,content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at`)
      .run(input.articleId, input.baseVersionId, input.content, revision, new Date().toISOString())
    return this.getDraft(input.articleId)!
  }

  discardDraft(articleId: string, revision?: number): void {
    if (revision !== undefined && this.getDraft(articleId)?.revision !== revision) return
    this.db.prepare('DELETE FROM work_drafts WHERE article_id=?').run(articleId)
  }

  assertSaved(articleId: string): void {
    const draft = this.getDraft(articleId)
    if (!draft) return
    const version = this.db.prepare('SELECT v.raw_markdown FROM articles a JOIN article_versions v ON v.id=a.current_version_id WHERE a.id=?').get(articleId)
    if (draft.content !== version?.raw_markdown) throw new Error('正文还有本地暂存修改，请保存为版本后继续')
  }

  saveForm(input: PublishFormDraft): void {
    this.db.prepare('INSERT INTO publish_form_drafts(article_id,data_json) VALUES(?,?) ON CONFLICT(article_id) DO UPDATE SET data_json=excluded.data_json').run(input.articleId, JSON.stringify(input))
  }

  getForm(articleId: string): PublishFormDraft | null {
    const row = this.db.prepare('SELECT data_json FROM publish_form_drafts WHERE article_id=?').get(articleId)
    return row ? JSON.parse(String(row.data_json)) as PublishFormDraft : null
  }

  saveSnapshot(publicationId: string, snapshot: PublicationSnapshot): void {
    this.db.prepare('INSERT INTO publication_snapshots(publication_id,data_json) VALUES(?,?)').run(publicationId, JSON.stringify(snapshot))
  }

  getSnapshot(publicationId: string): PublicationSnapshot | undefined {
    const row = this.db.prepare('SELECT data_json FROM publication_snapshots WHERE publication_id=?').get(publicationId)
    return row ? JSON.parse(String(row.data_json)) as PublicationSnapshot : undefined
  }

  getUpload(assetId: string, appId: string, kind: 'cover' | 'inline'): string | undefined {
    const row = this.db.prepare('SELECT remote_value FROM wechat_asset_uploads WHERE asset_id=? AND app_id=? AND kind=?').get(assetId, appId, kind)
    return row ? String(row.remote_value) : undefined
  }

  saveUpload(assetId: string, appId: string, kind: 'cover' | 'inline', value: string): void {
    this.db.prepare('INSERT INTO wechat_asset_uploads VALUES(?,?,?,?) ON CONFLICT(asset_id,app_id,kind) DO UPDATE SET remote_value=excluded.remote_value').run(assetId, appId, kind, value)
  }

  clearVerification(): void { this.db.prepare('DELETE FROM channel_verification').run() }
  recordVerification(status: 'success' | 'failure', error = ''): void {
    this.db.prepare(`INSERT INTO channel_verification VALUES('wechat-official',?,?,?) ON CONFLICT(channel_id) DO UPDATE SET status=excluded.status,tested_at=excluded.tested_at,error=excluded.error`)
      .run(status, new Date().toISOString(), error)
  }
  getVerification(): { lastTestStatus?: 'success' | 'failure'; lastTestAt?: string; lastTestError?: string } {
    const row = this.db.prepare("SELECT * FROM channel_verification WHERE channel_id='wechat-official'").get()
    return row ? { lastTestStatus: row.status as 'success' | 'failure', lastTestAt: String(row.tested_at), lastTestError: String(row.error) || undefined } : {}
  }

  saveTaskResults(taskId: string, articleId: string | undefined, resultIds: string[]): void {
    this.db.prepare('INSERT INTO generation_results VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET article_id=excluded.article_id,result_ids_json=excluded.result_ids_json').run(taskId, articleId ?? null, JSON.stringify(resultIds))
  }
  getTaskResults(taskId: string): Pick<GenerationTask, 'articleId' | 'resultIds'> {
    const row = this.db.prepare('SELECT * FROM generation_results WHERE task_id=?').get(taskId)
    return row ? { articleId: row.article_id ? String(row.article_id) : undefined, resultIds: JSON.parse(String(row.result_ids_json)) as string[] } : {}
  }

  isAssetReferenced(fileName: string): boolean {
    const url = `moliu-asset://assets/${encodeURIComponent(fileName)}`
    return Boolean(this.db.prepare(`SELECT 1 FROM article_versions WHERE instr(raw_markdown,?)>0
      UNION ALL SELECT 1 FROM work_drafts WHERE instr(content,?)>0
      UNION ALL SELECT 1 FROM article_layouts WHERE instr(html,?)>0
      UNION ALL SELECT 1 FROM publication_snapshots s LEFT JOIN visual_assets a ON a.id=json_extract(s.data_json,'$.input.coverAssetId') WHERE instr(s.data_json,?)>0 OR a.file_name=? LIMIT 1`).get(url, url, url, url, fileName))
  }

  getSummary(id: string): ArticleSummary | null { return this.listSummaries({ limit: 1 }, id).items[0] ?? null }

  listSummaries(query: ArticleListQuery = {}, id?: string): ArticleListResult {
    const clauses: string[] = []
    const params: SQLInputValue[] = []
    if (id) { clauses.push('a.id=?'); params.push(id) }
    if (query.search?.trim()) { clauses.push('instr(lower(v.raw_markdown),lower(?))>0'); params.push(query.search.trim()) }
    if (query.status) { clauses.push('a.status=?'); params.push(query.status) }
    if (query.accountId) { clauses.push('a.account_id=?'); params.push(query.accountId) }
    if (query.dirtyOnly) clauses.push('d.article_id IS NOT NULL AND d.content<>v.raw_markdown')
    const from = `FROM articles a JOIN article_versions v ON v.id=a.current_version_id LEFT JOIN work_drafts d ON d.article_id=a.id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params)?.total ?? 0)
    const rows = this.db.prepare(`SELECT a.*,v.raw_markdown,v.provider_id,v.model,v.version_number AS version_count,
      (d.article_id IS NOT NULL AND d.content<>v.raw_markdown) AS has_draft,
      (EXISTS(SELECT 1 FROM article_layouts l WHERE l.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM article_layouts l WHERE l.article_id=a.id AND l.article_version_id=a.current_version_id)) AS layout_stale,
      (SELECT p.status FROM publications p WHERE p.article_id=a.id ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1) AS publication_status
      ${from} ORDER BY a.updated_at DESC,a.rowid DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.min(500, Math.max(1, query.limit ?? 50)), Math.max(0, query.offset ?? 0))
    const items: ArticleSummary[] = rows.map(row => ({
      id: String(row.id), title: String(row.raw_markdown).match(/^#\s+(.+)$/m)?.[1]?.trim() || '未命名文章',
      frameworkId: row.framework_id ? String(row.framework_id) : undefined, accountId: row.account_id ? String(row.account_id) : undefined,
      materialIds: JSON.parse(String(row.material_ids_json)) as string[], manualOutline: String(row.manual_outline),
      status: row.status as ArticleSummary['status'], currentVersionId: String(row.current_version_id), versionCount: Number(row.version_count),
      excerpt: String(row.raw_markdown).slice(0, 180), providerId: row.provider_id ? String(row.provider_id) : undefined, model: row.model ? String(row.model) : undefined,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), hasWorkDraft: Boolean(row.has_draft), layoutStale: Boolean(row.layout_stale),
      publicationStatus: row.publication_status as ArticleSummary['publicationStatus']
    }))
    return { items, total }
  }
}
