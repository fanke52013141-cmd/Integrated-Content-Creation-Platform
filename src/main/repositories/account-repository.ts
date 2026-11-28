import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_ACCOUNT_FIELD_NAMES,
  type AccountField,
  type AccountMemory,
  type AccountPlatformBinding,
  type AccountProfile,
  type AccountProfileSummary,
  type AccountRedline,
  type AccountRedlineKind,
  type AccountStatus,
  type AccountStyleSample,
  type AccountVersion,
  type AddAccountMemoryInput,
  type AddAccountPlatformInput,
  type AddAccountRedlineInput,
  type ContentImportSource,
  type SaveAccountInput,
  type SaveAccountStyleSampleInput,
  type WizardAnswer
} from '../../shared/contracts.js'

/**
 * 账号域仓储（沿用 MaterialRepository 模式）：
 * AppDatabase 保留同名门面方法委托到这里，调用点（服务/IPC/单测）零改动。
 */

interface AccountSummaryRow {
  id: string
  name: string
  intro: string
  domain: string
  status: AccountStatus
  is_current: number
  version_count: number
  created_at: string
  updated_at: string
  fields_json?: string
}

interface AccountRow extends AccountSummaryRow {
  current_version_id: string
  fields_json: string
  wizard_answers_json: string
}

interface VersionRow {
  id: string
  profile_id: string
  version_number: number
  source: 'ai' | 'manual' | 'restore'
  provider_id: string | null
  model: string | null
  fields_json: string
  wizard_answers_json: string
  created_at: string
}

interface AccountRedlineRow {
  id: string
  profile_id: string
  kind: AccountRedlineKind
  content: string
  created_at: string
}

interface AccountPlatformRow {
  id: string
  profile_id: string
  platform: string
  handle: string
  note: string
  created_at: string
}

interface AccountMemoryRow {
  id: string
  profile_id: string
  memory_date: string
  source: string
  insight: string
  action: string
  created_at: string
}

interface AccountStyleSampleRow {
  id: string
  profile_id: string
  title: string
  excerpt: string
  tag: string
  note: string
  enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function fieldValue(fields: AccountField[], name: string): string {
  return fields.find((field) => field.name.trim() === name)?.value.trim() ?? ''
}

function accountCompleteness(fields: AccountField[]): number {
  const total = DEFAULT_ACCOUNT_FIELD_NAMES.length
  if (!total) return 0
  const filled = DEFAULT_ACCOUNT_FIELD_NAMES.filter((name) =>
    fields.some((field) => field.name.trim() === name && field.value.trim().length > 0)
  ).length
  return Math.round((filled / total) * 100)
}

function mapAccountSummary(row: AccountSummaryRow): AccountProfileSummary {
  const fields = row.fields_json ? parseJson<AccountField[]>(row.fields_json, []) : []
  return {
    id: row.id,
    name: row.name,
    intro: row.intro,
    domain: row.domain,
    status: row.status,
    isCurrent: Boolean(row.is_current),
    versionCount: Number(row.version_count),
    completeness: accountCompleteness(fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapVersion(row: VersionRow): AccountVersion {
  return {
    id: row.id,
    profileId: row.profile_id,
    versionNumber: row.version_number,
    source: row.source,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    fields: parseJson<AccountField[]>(row.fields_json, []),
    wizardAnswers: parseJson<WizardAnswer[]>(row.wizard_answers_json, []),
    createdAt: row.created_at
  }
}

export class AccountRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly runInTransaction: <T>(operation: () => T) => T,
    private readonly getImportSource: (artifactType: string, artifactId: string) => ContentImportSource | undefined
  ) {}

  list(): AccountProfileSummary[] {
    const rows = this.db.prepare(`
      SELECT
        p.*,
        v.fields_json,
        (SELECT COUNT(*) FROM account_profile_versions av WHERE av.profile_id = p.id) AS version_count
      FROM account_profiles p
      LEFT JOIN account_profile_versions v ON v.id = p.current_version_id
      ORDER BY p.is_current DESC, p.updated_at DESC
    `).all() as unknown as AccountSummaryRow[]
    return rows.map((row) => ({ ...mapAccountSummary(row), importSource: this.getImportSource('account', row.id) }))
  }

  get(id: string): AccountProfile | null {
    const row = this.db.prepare(`
      SELECT
        p.*,
        v.fields_json,
        v.wizard_answers_json,
        (SELECT COUNT(*) FROM account_profile_versions av WHERE av.profile_id = p.id) AS version_count
      FROM account_profiles p
      JOIN account_profile_versions v ON v.id = p.current_version_id
      WHERE p.id = ?
    `).get(id) as AccountRow | undefined

    if (!row) return null

    const versions = this.db.prepare(`
      SELECT * FROM account_profile_versions
      WHERE profile_id = ?
      ORDER BY version_number DESC
    `).all(id) as unknown as VersionRow[]

    return {
      ...mapAccountSummary(row),
      importSource: this.getImportSource('account', row.id),
      currentVersionId: row.current_version_id,
      fields: parseJson<AccountField[]>(row.fields_json, []),
      wizardAnswers: parseJson<WizardAnswer[]>(row.wizard_answers_json, []),
      versions: versions.map(mapVersion),
      redlines: this.listRedlines(id),
      platformAccounts: this.listPlatformAccounts(id),
      memories: this.listMemories(id),
      styleSamples: this.listStyleSamples(id)
    }
  }

  save(input: SaveAccountInput): AccountProfile {
    const profileId = input.id ?? crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const existing = input.id ? this.get(input.id) : null
    const versionNumber = existing ? existing.versionCount + 1 : 1
    const fields = input.fields.map((field) => ({ ...field, source: field.source ?? 'user' }))
    const fieldsJson = JSON.stringify(fields)
    const wizardJson = JSON.stringify(input.wizardAnswers)
    const name = fieldValue(input.fields, '账号名称') || '未命名账号'
    const intro = fieldValue(input.fields, '简介')
    const domain = fieldValue(input.fields, '领域')

    this.runInTransaction(() => {
      if (!existing) {
        const currentCount = (
          this.db.prepare('SELECT COUNT(*) AS count FROM account_profiles WHERE is_current = 1')
            .get() as { count: number }
        ).count
        this.db.prepare(`
          INSERT INTO account_profiles (
            id, name, intro, domain, status, current_version_id,
            is_current, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          profileId,
          name,
          intro,
          domain,
          input.status,
          versionId,
          currentCount === 0 ? 1 : 0,
          now,
          now
        )
      } else {
        this.db.prepare(`
          UPDATE account_profiles
          SET name = ?, intro = ?, domain = ?, status = ?,
              current_version_id = ?, updated_at = ?
          WHERE id = ?
        `).run(name, intro, domain, input.status, versionId, now, profileId)
      }

      this.db.prepare(`
        INSERT INTO account_profile_versions (
          id, profile_id, version_number, source, provider_id,
          model, fields_json, wizard_answers_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId,
        profileId,
        versionNumber,
        input.source,
        input.providerId ?? null,
        input.model ?? null,
        fieldsJson,
        wizardJson,
        now
      )
    })
    const saved = this.get(profileId)
    if (!saved) throw new Error('账号保存失败')
    return saved
  }

  setCurrent(id: string): void {
    if (!this.get(id)) throw new Error('账号不存在')
    this.runInTransaction(() => {
      this.db.prepare('UPDATE account_profiles SET is_current = 0').run()
      this.db.prepare('UPDATE account_profiles SET is_current = 1 WHERE id = ?').run(id)
    })
  }

  setLocked(id: string, locked: boolean): AccountProfile {
    const account = this.get(id)
    if (!account) throw new Error('账号不存在')
    this.db.prepare(`
      UPDATE account_profiles SET status = ?, updated_at = ? WHERE id = ?
    `).run(locked ? 'locked' : 'draft', new Date().toISOString(), id)
    const updated = this.get(id)
    if (!updated) throw new Error('账号状态更新失败')
    return updated
  }

  restoreVersion(profileId: string, versionId: string): AccountProfile {
    const version = this.db.prepare(`
      SELECT * FROM account_profile_versions WHERE id = ? AND profile_id = ?
    `).get(versionId, profileId) as VersionRow | undefined
    if (!version) throw new Error('版本不存在')

    return this.save({
      id: profileId,
      fields: parseJson<AccountField[]>(version.fields_json, []),
      wizardAnswers: parseJson<WizardAnswer[]>(version.wizard_answers_json, []),
      status: 'draft',
      source: 'restore',
      providerId: version.provider_id ?? undefined,
      model: version.model ?? undefined
    })
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM account_profiles WHERE id = ?').run(id)
  }

  listRedlines(profileId: string): AccountRedline[] {
    const rows = this.db.prepare(
      'SELECT * FROM account_redlines WHERE profile_id = ? ORDER BY created_at, id'
    ).all(profileId) as unknown as AccountRedlineRow[]
    return rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      kind: row.kind,
      content: row.content,
      createdAt: row.created_at
    }))
  }

  addRedline(input: AddAccountRedlineInput): AccountRedline {
    const content = input.content.trim()
    if (!content) throw new Error('红线内容不能为空')
    if (!this.get(input.profileId)) throw new Error('账号不存在')
    const now = new Date().toISOString()
    const row: AccountRedline = {
      id: crypto.randomUUID(),
      profileId: input.profileId,
      kind: input.kind,
      content,
      createdAt: now
    }
    this.db.prepare(`
      INSERT INTO account_redlines (id, profile_id, kind, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(row.id, row.profileId, row.kind, row.content, row.createdAt)
    return row
  }

  removeRedline(id: string): void {
    this.db.prepare('DELETE FROM account_redlines WHERE id = ?').run(id)
  }

  listPlatformAccounts(profileId: string): AccountPlatformBinding[] {
    const rows = this.db.prepare(
      'SELECT * FROM account_platform_accounts WHERE profile_id = ? ORDER BY created_at, id'
    ).all(profileId) as unknown as AccountPlatformRow[]
    return rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      platform: row.platform,
      handle: row.handle,
      note: row.note,
      createdAt: row.created_at
    }))
  }

  addPlatformAccount(input: AddAccountPlatformInput): AccountPlatformBinding {
    const handle = input.handle.trim()
    const platform = input.platform.trim()
    if (!platform) throw new Error('平台名不能为空')
    if (!handle) throw new Error('账号标识不能为空')
    if (!this.get(input.profileId)) throw new Error('账号不存在')
    const now = new Date().toISOString()
    const row: AccountPlatformBinding = {
      id: crypto.randomUUID(),
      profileId: input.profileId,
      platform,
      handle,
      note: input.note?.trim() ?? '',
      createdAt: now
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO account_platform_accounts (id, profile_id, platform, handle, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.id, row.profileId, row.platform, row.handle, row.note, row.createdAt)
    const existing = this.db.prepare(`
      SELECT * FROM account_platform_accounts WHERE profile_id = ? AND platform = ? AND handle = ?
    `).get(input.profileId, platform, handle) as AccountPlatformRow | undefined
    if (!existing) throw new Error('平台账号保存失败')
    return {
      id: existing.id,
      profileId: existing.profile_id,
      platform: existing.platform,
      handle: existing.handle,
      note: existing.note,
      createdAt: existing.created_at
    }
  }

  removePlatformAccount(id: string): void {
    this.db.prepare('DELETE FROM account_platform_accounts WHERE id = ?').run(id)
  }

  listMemories(profileId: string): AccountMemory[] {
    const rows = this.db.prepare(
      'SELECT * FROM account_memories WHERE profile_id = ? ORDER BY memory_date DESC, created_at DESC'
    ).all(profileId) as unknown as AccountMemoryRow[]
    return rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      memoryDate: row.memory_date,
      source: row.source,
      insight: row.insight,
      action: row.action,
      createdAt: row.created_at
    }))
  }

  addMemory(input: AddAccountMemoryInput): { memory: AccountMemory | null; created: boolean } {
    const insight = input.insight.trim()
    if (!insight) throw new Error('记忆内容不能为空')
    if (!this.get(input.profileId)) throw new Error('账号不存在')
    const action = input.action?.trim() ?? ''
    const hash = createHash('sha1').update(`${insight}\n${action}`).digest('hex')
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO account_memories (id, profile_id, memory_date, source, insight, action, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.profileId,
      input.memoryDate?.trim() || now.slice(0, 10),
      input.source?.trim() || '用户自述',
      insight,
      action,
      hash,
      now
    )
    if (result.changes === 0) return { memory: null, created: false }
    return {
      memory: {
        id,
        profileId: input.profileId,
        memoryDate: input.memoryDate?.trim() || now.slice(0, 10),
        source: input.source?.trim() || '用户自述',
        insight,
        action,
        createdAt: now
      },
      created: true
    }
  }

  removeMemory(id: string): void {
    this.db.prepare('DELETE FROM account_memories WHERE id = ?').run(id)
  }

  listStyleSamples(profileId: string): AccountStyleSample[] {
    const rows = this.db.prepare(
      'SELECT * FROM account_style_samples WHERE profile_id = ? ORDER BY sort_order ASC, created_at DESC'
    ).all(profileId) as unknown as AccountStyleSampleRow[]
    return rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      title: row.title,
      excerpt: row.excerpt,
      tag: row.tag,
      note: row.note,
      enabled: Boolean(row.enabled),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  saveStyleSample(input: SaveAccountStyleSampleInput): AccountStyleSample {
    const title = input.title.trim()
    const excerpt = input.excerpt.trim()
    if (!title) throw new Error('样文标题不能为空')
    if (!excerpt) throw new Error('样文摘录不能为空')
    const accountExists = this.db.prepare('SELECT 1 FROM account_profiles WHERE id = ?').get(input.profileId)
    if (!accountExists) throw new Error('账号不存在')
    const now = new Date().toISOString()
    const existing = input.id
      ? this.db.prepare('SELECT * FROM account_style_samples WHERE id = ? AND profile_id = ?').get(input.id, input.profileId) as AccountStyleSampleRow | undefined
      : undefined
    if (input.id && !existing) throw new Error('标杆样文不存在')
    if (!existing) {
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM account_style_samples WHERE profile_id = ?').get(input.profileId) as { n: number }).n
      if (count >= 10) throw new Error('单个账号最多保存 10 篇标杆样文，请先删除或编辑已有样文')
    }
    const id = existing?.id ?? crypto.randomUUID()
    const tag = input.tag?.trim() || existing?.tag || '全文语感'
    const note = input.note !== undefined ? input.note.trim() : existing?.note ?? ''
    const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing?.enabled ?? 1
    const sortOrder = input.sortOrder ?? existing?.sort_order ?? 0
    if (existing) {
      this.db.prepare(`
        UPDATE account_style_samples
        SET title = ?, excerpt = ?, tag = ?, note = ?, enabled = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(title, excerpt, tag, note, enabled, sortOrder, now, id)
    } else {
      this.db.prepare(`
        INSERT INTO account_style_samples (id, profile_id, title, excerpt, tag, note, enabled, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.profileId, title, excerpt, tag, note, enabled, sortOrder, now, now)
    }
    const saved = this.db.prepare('SELECT * FROM account_style_samples WHERE id = ?').get(id) as unknown as AccountStyleSampleRow
    return {
      id: saved.id,
      profileId: saved.profile_id,
      title: saved.title,
      excerpt: saved.excerpt,
      tag: saved.tag,
      note: saved.note,
      enabled: Boolean(saved.enabled),
      sortOrder: saved.sort_order,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at
    }
  }

  removeStyleSample(id: string): void {
    this.db.prepare('DELETE FROM account_style_samples WHERE id = ?').run(id)
  }
}
