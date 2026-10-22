import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { StyleReference, VisualPlan, VisualStyle, VisualStyleInput, VisualPlanDraft, VisualImageJob, StyleSampleTask } from '../../shared/visual-studio.js'

export class VisualStudioRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS visual_style_versions (
        version_id TEXT PRIMARY KEY, style_id TEXT NOT NULL, version INTEGER NOT NULL,
        data_json TEXT NOT NULL, UNIQUE(style_id,version));
      CREATE TABLE IF NOT EXISTS visual_style_heads (
        id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES visual_style_versions(version_id), archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS visual_style_references (id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_visual_styles (
        account_id TEXT PRIMARY KEY REFERENCES account_profiles(id) ON DELETE CASCADE,
        style_id TEXT NOT NULL REFERENCES visual_style_heads(id));
      CREATE TABLE IF NOT EXISTS visual_studio_plans (
        id TEXT PRIMARY KEY REFERENCES visual_packs(id) ON DELETE CASCADE,
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visual_studio_generations (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES visual_studio_plans(id) ON DELETE CASCADE,
        picture_id TEXT NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visual_studio_applications (
        plan_id TEXT PRIMARY KEY REFERENCES visual_studio_plans(id) ON DELETE CASCADE,
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        before_markdown TEXT NOT NULL, after_version_id TEXT NOT NULL, previous_form_json TEXT);
      CREATE TABLE IF NOT EXISTS visual_studio_drafts (
        plan_id TEXT PRIMARY KEY REFERENCES visual_studio_plans(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visual_studio_jobs (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES visual_studio_plans(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visual_asset_specs (
        asset_id TEXT PRIMARY KEY REFERENCES visual_assets(id) ON DELETE CASCADE,
        signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visual_style_sample_tasks (id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
    `)
  }
  styles(): VisualStyle[] {
    return this.db.prepare('SELECT v.data_json,h.archived FROM visual_style_heads h JOIN visual_style_versions v ON v.version_id=h.version_id ORDER BY v.rowid DESC').all()
      .map(row => ({ ...JSON.parse(String(row.data_json)), archived: Boolean(row.archived) }))
  }
  style(id: string): VisualStyle | undefined { return this.styles().find(style => style.id === id) }
  saveStyle(input: VisualStyleInput): VisualStyle {
    const current = input.id ? this.style(input.id) : undefined
    if (input.id && (!current || current.versionId !== input.expectedVersionId)) throw new Error('风格已有新版本，请重新加载')
    for (const ref of input.references) if (this.reference(ref.id)?.fileName !== ref.fileName) throw new Error('风格参考图不存在')
    const style: VisualStyle = { ...input, references: input.references.map(ref => this.reference(ref.id)!), id: current?.id ?? randomUUID(), versionId: randomUUID(), version: (current?.version ?? 0) + 1, archived: current?.archived ?? false, createdAt: new Date().toISOString() }
    this.db.prepare('INSERT INTO visual_style_versions VALUES(?,?,?,?)').run(style.versionId, style.id, style.version, JSON.stringify(style))
    this.db.prepare('INSERT INTO visual_style_heads(id,version_id) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET version_id=excluded.version_id').run(style.id, style.versionId)
    return style
  }
  archive(id: string, archived: boolean): void { if (!this.style(id)) throw new Error('风格不存在'); this.db.prepare('UPDATE visual_style_heads SET archived=? WHERE id=?').run(archived ? 1 : 0, id) }
  history(id: string): VisualStyle[] { return this.db.prepare('SELECT data_json FROM visual_style_versions WHERE style_id=? ORDER BY version DESC').all(id).map(row => JSON.parse(String(row.data_json))) }
  reference(id: string): StyleReference | null { const row = this.db.prepare('SELECT data_json FROM visual_style_references WHERE id=?').get(id); return row ? JSON.parse(String(row.data_json)) : null }
  addReference(reference: StyleReference): void { this.db.prepare('INSERT INTO visual_style_references VALUES(?,?)').run(reference.id, JSON.stringify(reference)) }
  defaultStyle(accountId: string): VisualStyle | null { const row = this.db.prepare('SELECT style_id FROM account_visual_styles WHERE account_id=?').get(accountId); return row ? this.style(String(row.style_id)) ?? null : null }
  bind(accountId: string, styleId: string | null): void {
    if (styleId === null) { this.db.prepare('DELETE FROM account_visual_styles WHERE account_id=?').run(accountId); return }
    if (!this.style(styleId) || this.style(styleId)?.archived) throw new Error('请选择可用的风格')
    this.db.prepare('INSERT INTO account_visual_styles VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET style_id=excluded.style_id').run(accountId, styleId)
  }
  plans(articleId: string): VisualPlan[] { return this.db.prepare('SELECT data_json FROM visual_studio_plans WHERE article_id=? ORDER BY rowid DESC').all(articleId).map(row => JSON.parse(String(row.data_json))) }
  plan(id: string): VisualPlan { const row = this.db.prepare('SELECT data_json FROM visual_studio_plans WHERE id=?').get(id); if (!row) throw new Error('配图方案不存在'); return JSON.parse(String(row.data_json)) }
  create(plan: VisualPlan): VisualPlan { this.db.prepare('INSERT INTO visual_studio_plans VALUES(?,?,?,?)').run(plan.id, plan.articleId, plan.revision, JSON.stringify(plan)); return plan }
  save(plan: VisualPlan): VisualPlan {
    const next = { ...plan, revision: plan.revision + 1 }
    const changed = this.db.prepare('UPDATE visual_studio_plans SET revision=?,data_json=? WHERE id=? AND revision=?').run(next.revision, JSON.stringify(next), plan.id, plan.revision)
    if (Number(changed.changes) !== 1) throw new Error('方案已在另一处更新，请重新加载')
    return next
  }
  recordGeneration(id: string, planId: string, pictureId: string, data: unknown): void { this.db.prepare('INSERT OR REPLACE INTO visual_studio_generations VALUES(?,?,?,?)').run(id, planId, pictureId, JSON.stringify(data)) }
  application(planId: string): { beforeMarkdown: string; afterVersionId: string; previousForm: string | null } | null {
    const row = this.db.prepare('SELECT * FROM visual_studio_applications WHERE plan_id=?').get(planId)
    return row ? { beforeMarkdown: String(row.before_markdown), afterVersionId: String(row.after_version_id), previousForm: row.previous_form_json === null ? null : String(row.previous_form_json) } : null
  }
  applied(planId: string, articleId: string, before: string, after: string, previousForm: unknown): void { this.db.prepare('INSERT OR REPLACE INTO visual_studio_applications VALUES(?,?,?,?,?)').run(planId, articleId, before, after, previousForm ? JSON.stringify(previousForm) : null) }
  clearApplication(planId: string): void { this.db.prepare('DELETE FROM visual_studio_applications WHERE plan_id=?').run(planId) }
  draft(planId: string): VisualPlanDraft | null { const row = this.db.prepare('SELECT data_json FROM visual_studio_drafts WHERE plan_id=?').get(planId); return row ? JSON.parse(String(row.data_json)) : null }
  saveDraft(plan: VisualPlan, expectedRevision: number): VisualPlanDraft {
    if (this.plan(plan.id).revision !== plan.revision) throw new Error('方案已有新版本，本地草稿保留，请重新载入并检查差异')
    if ((this.draft(plan.id)?.revision ?? 0) !== expectedRevision) throw new Error('草稿已在其他窗口更新，请先载入草稿')
    const draft: VisualPlanDraft = { planId: plan.id, revision: expectedRevision + 1, baseRevision: plan.revision, plan, updatedAt: new Date().toISOString() }
    this.writeDraft(draft); return draft
  }
  clearDraft(planId: string, revision: number): void {
    const current = this.draft(planId)
    if (!current || current.revision !== revision) throw new Error('草稿已更新，请先载入最新草稿')
    this.writeDraft({ ...current, revision: revision + 1, plan: null, updatedAt: new Date().toISOString() })
  }
  private writeDraft(draft: VisualPlanDraft): void { this.db.prepare('INSERT INTO visual_studio_drafts VALUES(?,?,?) ON CONFLICT(plan_id) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json').run(draft.planId,draft.revision,JSON.stringify(draft)) }
  assetSignature(assetId: string): string | undefined { const row = this.db.prepare('SELECT signature FROM visual_asset_specs WHERE asset_id=?').get(assetId); return row ? String(row.signature) : undefined }
  stampAsset(assetId: string, signature: string): void { this.db.prepare('INSERT OR REPLACE INTO visual_asset_specs VALUES(?,?)').run(assetId,signature) }
  jobs(planId?: string): VisualImageJob[] { return this.db.prepare(`SELECT data_json FROM visual_studio_jobs ${planId ? 'WHERE plan_id=?' : ''} ORDER BY rowid`).all(...(planId ? [planId] : [])).map(row => JSON.parse(String(row.data_json))) }
  job(id: string): VisualImageJob { const row = this.db.prepare('SELECT data_json FROM visual_studio_jobs WHERE id=?').get(id); if (!row) throw new Error('图片任务不存在'); return JSON.parse(String(row.data_json)) }
  saveJob(job: VisualImageJob): void { this.db.prepare('INSERT INTO visual_studio_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(job.id,job.planId,JSON.stringify({...job,updatedAt:new Date().toISOString()})) }
  samples(): StyleSampleTask[] { return this.db.prepare('SELECT data_json FROM visual_style_sample_tasks ORDER BY rowid DESC').all().map(row=>JSON.parse(String(row.data_json))) }
  saveSample(task: StyleSampleTask): void { this.db.prepare('INSERT OR REPLACE INTO visual_style_sample_tasks VALUES(?,?)').run(task.id,JSON.stringify(task)) }
  restoreForm(articleId: string, previous: string | null): void { if (previous) this.db.prepare('INSERT OR REPLACE INTO publish_form_drafts VALUES(?,?)').run(articleId, previous); else this.db.prepare('DELETE FROM publish_form_drafts WHERE article_id=?').run(articleId) }
}
