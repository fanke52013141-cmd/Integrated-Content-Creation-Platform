import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Material, MaterialOrigin, SaveManualMaterialInput } from '../../shared/contracts.js'
import type { WorkflowRepository } from './workflow-repository.js'

/**
 * 素材域仓储（批次 5 database.ts 拆分先例）：
 * AppDatabase 保留同名门面方法（materialUsage/listMaterials/…）委托到这里，
 * 调用点（服务/IPC/渲染层）零改动。后续域按同模式渐进拆出。
 */

interface MaterialRow {
  id: string
  kind: string
  origin: string
  external_id: string | null
  title: string
  summary: string
  source_url: string | null
  source_name: string | null
  source_note: string | null
  query: string | null
  related_topic_id: string | null
  published_at: string | null
  authority: string | null
  relevance_score: number | null
  image_url: string | null
  image_width: number | null
  image_height: number | null
  image_shape: string | null
  watermark: string | null
  created_at: string
  updated_at: string
}

function mapMaterial(row: MaterialRow): Material {
  return {
    id: row.id, kind: row.kind as Material['kind'], origin: row.origin as Material['origin'],
    externalId: row.external_id ?? undefined, title: row.title, summary: row.summary,
    sourceUrl: row.source_url ?? undefined, sourceName: row.source_name ?? undefined, sourceNote: row.source_note ?? undefined,
    query: row.query ?? undefined, relatedTopicId: row.related_topic_id ?? undefined,
    publishedAt: row.published_at ?? undefined, authority: row.authority ?? undefined, relevanceScore: row.relevance_score ?? undefined,
    imageUrl: row.image_url ?? undefined, imageWidth: row.image_width ?? undefined, imageHeight: row.image_height ?? undefined,
    imageShape: row.image_shape ?? undefined, watermark: row.watermark ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

export class MaterialRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly workflow: WorkflowRepository
  ) {}

  /** 素材被哪些文章引用：素材选择器与素材库按此展示真实用量（已删除的素材不再计入） */
  usage(): Record<string, Array<{ id: string; title: string }>> {
    const rows = this.db.prepare(
      'SELECT a.id AS id, a.material_ids_json AS material_ids_json, v.raw_markdown AS raw_markdown FROM articles a JOIN article_versions v ON v.id = a.current_version_id'
    ).all() as unknown as Array<{ id: string; material_ids_json: string; raw_markdown: string }>
    const existing = new Set((this.db.prepare('SELECT id FROM materials').all() as unknown as Array<{ id: string }>).map((row) => row.id))
    const usage: Record<string, Array<{ id: string; title: string }>> = {}
    for (const row of rows) {
      let ids: string[] = []
      try { ids = JSON.parse(row.material_ids_json) as string[] } catch { ids = [] }
      const title = row.raw_markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '未命名文章'
      for (const id of new Set(ids)) if (existing.has(id)) (usage[id] ??= []).push({ id: row.id, title })
    }
    return usage
  }

  /** 文件上传素材：以 file_upload 来源入库，全文进 workflow 文档存储（不作为 AI 上下文） */
  addFile(input: { fileName: string; content: string; relatedTopicId?: string; formatNote: string }): Material {
    const title = input.fileName.replace(/.[^.]+$/, '').slice(0, 500) || '未命名文档'
    const material = this.addManual({
      title,
      summary: input.content.slice(0, 2000),
      sourceNote: `文件上传 · ${input.formatNote} · 全文 ${input.content.length} 字符（未保留原件）`,
      relatedTopicId: input.relatedTopicId
    }, 'file_upload')
    this.workflow.saveDocument(material.id, createHash('sha256').update(input.content).digest('hex'), input.content)
    return material
  }

  /** 素材行不含大字段（summary ≤3000 字符），全量返回可接受；LIMIT 只是防异常膨胀的底线 */
  list(): Material[] {
    const rows = this.db.prepare('SELECT * FROM materials ORDER BY created_at DESC LIMIT 500').all() as unknown as MaterialRow[]
    return rows.map(mapMaterial)
  }

  addSearch(input: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): { material: Material; created: boolean } {
    if (input.externalId) {
      const existing = this.db.prepare('SELECT * FROM materials WHERE origin = ? AND external_id = ?')
        .get(input.origin, input.externalId) as MaterialRow | undefined
      if (existing) return { material: mapMaterial(existing), created: false }
    }
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO materials(
        id, kind, origin, external_id, title, summary, source_url, source_name, source_note,
        query, related_topic_id, published_at, authority, relevance_score, image_url,
        image_width, image_height, image_shape, watermark, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.kind, input.origin, input.externalId ?? null, input.title, input.summary,
      input.sourceUrl ?? null, input.sourceName ?? null, input.sourceNote ?? null,
      input.query ?? null, input.relatedTopicId ?? null, input.publishedAt ?? null,
      input.authority ?? null, input.relevanceScore ?? null, input.imageUrl ?? null,
      input.imageWidth ?? null, input.imageHeight ?? null, input.imageShape ?? null,
      input.watermark ?? null, now, now
    )
    const material = this.get(id)
    if (!material) throw new Error('素材保存失败')
    return { material, created: true }
  }

  addManual(input: SaveManualMaterialInput, origin: MaterialOrigin = 'manual_text'): Material {
    return this.addSearch({
      kind: 'text',
      origin,
      title: input.title.trim(),
      summary: input.summary.trim(),
      sourceUrl: input.sourceUrl?.trim() || undefined,
      sourceNote: input.sourceNote?.trim() || undefined,
      relatedTopicId: input.relatedTopicId
    }).material
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM materials WHERE id = ?').run(id)
  }

  get(id: string): Material | null {
    const row = this.db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as MaterialRow | undefined
    return row ? mapMaterial(row) : null
  }
}
