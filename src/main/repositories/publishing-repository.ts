import type { DatabaseSync } from 'node:sqlite'
import type {
  Publication,
  PublicationMetrics,
  PublicationResolution,
  PublicationRetro,
  PublicationSnapshot,
  PublicationStatus,
  WechatPublishChannel
} from '../../shared/contracts.js'
import type { WorkflowRepository } from './workflow-repository.js'

/**
 * 发布域仓储（沿用 MaterialRepository 模式）：
 * AppDatabase 保留同名门面方法委托到这里，为批次 F 多公众号通道打好隔离基础。
 */

interface WechatChannelRow {
  id: 'wechat-official'
  display_name: string
  app_id: string
  enabled: number
  has_app_secret: number
  updated_at: string
}

interface PublicationRow {
  id: string
  article_id: string
  article_version_id: string
  layout_id: string
  channel_id: 'wechat-official'
  external_draft_id: string | null
  status: PublicationStatus
  title: string
  thumb_media_id: string
  published_url: string | null
  error_message: string | null
  retro_json: string | null
  publish_msgid: string | null
  created_at: string
  updated_at: string
}

function parseRetro(value: string | null): PublicationRetro | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<PublicationRetro>
    return {
      metrics: parsed.metrics,
      goal: parsed.goal ?? '',
      result: parsed.result ?? '',
      lesson: parsed.lesson ?? '',
      updatedAt: parsed.updatedAt ?? ''
    }
  } catch {
    return undefined
  }
}

function mapWechatChannel(row: WechatChannelRow): WechatPublishChannel {
  return {
    id: row.id,
    displayName: row.display_name,
    appId: row.app_id,
    enabled: Boolean(row.enabled),
    hasAppSecret: Boolean(row.has_app_secret),
    updatedAt: row.updated_at
  }
}

function mapPublication(row: PublicationRow): Publication {
  return {
    id: row.id,
    articleId: row.article_id,
    articleVersionId: row.article_version_id,
    layoutId: row.layout_id,
    channelId: row.channel_id,
    externalDraftId: row.external_draft_id ?? undefined,
    status: row.status,
    title: row.title,
    thumbMediaId: row.thumb_media_id,
    publishedUrl: row.published_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retro: parseRetro(row.retro_json),
    publishMsgid: row.publish_msgid ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class PublishingRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly workflow: WorkflowRepository,
    private readonly runInTransaction: <T>(operation: () => T) => T
  ) {}

  getWechatChannel(): WechatPublishChannel {
    const row = this.db.prepare(
      "SELECT c.id,c.display_name,c.app_id,c.enabled,EXISTS(SELECT 1 FROM publish_channel_secrets s WHERE s.channel_id=c.id) has_app_secret,c.updated_at FROM publish_channels c WHERE c.id='wechat-official'"
    ).get() as unknown as WechatChannelRow
    return { ...mapWechatChannel(row), ...this.workflow.getVerification() }
  }

  saveWechatChannel(input: { appId: string; enabled: boolean }, encryptedSecret?: Buffer): WechatPublishChannel {
    const previous = this.getWechatChannel()
    if (previous.appId && previous.appId !== input.appId && !encryptedSecret) {
      throw new Error('更换公众号时请同时填写新的 AppSecret')
    }
    const now = new Date().toISOString()
    this.runInTransaction(() => {
      this.workflow.clearVerification()
      this.db.prepare("UPDATE publish_channels SET app_id=?,enabled=?,updated_at=? WHERE id='wechat-official'")
        .run(input.appId, input.enabled ? 1 : 0, now)
      if (encryptedSecret) {
        this.db.prepare(
          "INSERT INTO publish_channel_secrets(channel_id,encrypted_secret,updated_at) VALUES('wechat-official',?,?) ON CONFLICT(channel_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,updated_at=excluded.updated_at"
        ).run(encryptedSecret, now)
      }
    })
    return this.getWechatChannel()
  }

  getEncryptedWechatSecret(): Buffer | null {
    const row = this.db.prepare("SELECT encrypted_secret FROM publish_channel_secrets WHERE channel_id='wechat-official'")
      .get() as { encrypted_secret: Buffer } | undefined
    return row?.encrypted_secret ?? null
  }

  createPublication(input: Omit<Publication, 'id' | 'createdAt' | 'updatedAt'>): Publication {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    this.runInTransaction(() => {
      this.db.prepare(
        'INSERT INTO publications(id,article_id,article_version_id,layout_id,channel_id,external_draft_id,status,title,thumb_media_id,published_url,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        id,
        input.articleId,
        input.articleVersionId,
        input.layoutId,
        input.channelId,
        input.externalDraftId ?? null,
        input.status,
        input.title,
        input.thumbMediaId,
        input.publishedUrl ?? null,
        input.errorMessage ?? null,
        now,
        now
      )
      if (input.snapshot) this.workflow.saveSnapshot(id, input.snapshot)
    })
    return this.getPublication(id)!
  }

  updatePublicationOutcome(
    id: string,
    status: Publication['status'],
    thumbMediaId: string,
    error?: string,
    externalDraftId?: string
  ): Publication {
    this.db.prepare(
      'UPDATE publications SET status=?,thumb_media_id=?,error_message=?,external_draft_id=?,updated_at=? WHERE id=?'
    ).run(status, thumbMediaId, error ?? null, externalDraftId ?? null, new Date().toISOString(), id)
    const publication = this.getPublication(id)
    if (!publication) throw new Error('交付记录不存在')
    return publication
  }

  setPublicationPublished(id: string, publishMsgid: string, publishedUrl?: string): Publication {
    this.db.prepare(
      "UPDATE publications SET status='published',publish_msgid=?,published_url=COALESCE(?,published_url),error_message=NULL,updated_at=? WHERE id=?"
    ).run(publishMsgid, publishedUrl ?? null, new Date().toISOString(), id)
    return this.getPublication(id)!
  }

  listPublications(): Publication[] {
    const rows = this.db.prepare('SELECT * FROM publications ORDER BY created_at DESC LIMIT 300')
      .all() as unknown as PublicationRow[]
    const snapshots = new Map(
      (this.db.prepare('SELECT publication_id,data_json FROM publication_snapshots').all() as unknown as Array<{ publication_id: string; data_json: string }>)
        .map((row) => [row.publication_id, JSON.parse(String(row.data_json)) as PublicationSnapshot])
    )
    const resolutions = new Map(
      (this.db.prepare('SELECT publication_id,data_json FROM publication_resolutions').all() as unknown as Array<{ publication_id: string; data_json: string }>)
        .map((row) => [row.publication_id, JSON.parse(String(row.data_json)) as PublicationResolution])
    )
    return rows.map((row) => {
      const snapshot = snapshots.get(row.id)
      return { ...mapPublication(row), snapshot, resolution: resolutions.get(row.id), retryOf: snapshot?.retryOf }
    })
  }

  getPublication(id: string): Publication | null {
    const row = this.db.prepare('SELECT * FROM publications WHERE id=?').get(id) as unknown as PublicationRow | undefined
    if (!row) return null
    const snapshot = this.workflow.getSnapshot(row.id)
    return { ...mapPublication(row), snapshot, resolution: this.workflow.getResolution(row.id), retryOf: snapshot?.retryOf }
  }

  markPublicationPublished(id: string, publishedUrl: string): Publication {
    this.db.prepare("UPDATE publications SET status='published',published_url=?,error_message=NULL,updated_at=? WHERE id=?")
      .run(publishedUrl, new Date().toISOString(), id)
    const row = this.getPublication(id)
    if (!row) throw new Error('发布记录不存在')
    return row
  }

  setPublicationPublishMsgid(id: string, msgid: string): Publication {
    this.db.prepare('UPDATE publications SET publish_msgid=?, updated_at=? WHERE id=?')
      .run(msgid.trim(), new Date().toISOString(), id)
    const publication = this.getPublication(id)
    if (!publication) throw new Error('发布记录不存在')
    return publication
  }

  updatePublicationMetrics(publicationId: string, metrics: PublicationMetrics): Publication {
    const current = this.getPublication(publicationId)
    if (!current) throw new Error('发布记录不存在')
    const retro: PublicationRetro = current.retro ?? { goal: '', result: '', lesson: '', updatedAt: '' }
    const updated: PublicationRetro = { ...retro, metrics, updatedAt: new Date().toISOString() }
    this.db.prepare('UPDATE publications SET retro_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(updated), new Date().toISOString(), publicationId)
    return this.getPublication(publicationId)!
  }

  savePublicationRetro(
    id: string,
    input: { goal: string; result: string; lesson: string; metrics?: PublicationMetrics }
  ): Publication {
    const trimmed = { goal: input.goal.trim(), result: input.result.trim(), lesson: input.lesson.trim() }
    const empty = !trimmed.goal && !trimmed.result && !trimmed.lesson
      && !Object.values(input.metrics ?? {}).some((value) => value !== undefined && value !== '')
    this.db.prepare('UPDATE publications SET retro_json=?,updated_at=? WHERE id=?')
      .run(empty ? null : JSON.stringify({ ...trimmed, metrics: input.metrics, updatedAt: new Date().toISOString() }), new Date().toISOString(), id)
    const row = this.getPublication(id)
    if (!row) throw new Error('发布记录不存在')
    return row
  }
}
