import { DatabaseSync } from 'node:sqlite'
import type {
  AccountField,
  AccountProfile,
  AccountProfileSummary,
  AccountStatus,
  AccountVersion,
  ArtifactReference,
  CapabilityFlags,
  CreateArtifactReferenceInput,
  HotFavorite,
  HotFavoriteTag,
  HotItem,
  HotSourcePreference,
  Material,
  ProviderModel,
  ProviderSummary,
  SaveAccountInput,
  SaveTopicInput,
  SaveProviderModelInput,
  SaveProviderInput,
  SaveManualMaterialInput,
  SearchServiceSummary,
  Framework,
  FrameworkSection,
  FrameworkStatus,
  FrameworkTemplate,
  SaveFrameworkInput,
  SaveFrameworkTemplateInput,
  Article,
  ArticleStatus,
  ArticleVersion,
  ArticleVersionSource,
  SaveArticleInput,
  ReviewRole, ReviewTask, ReviewOpinion, ReviewProblem, SaveReviewRoleInput, ReviewSeverity, VisualPack, ArticleLayout, LayoutPlatform, WechatPublishChannel, Publication, PublicationStatus,
  Topic,
  TopicSchemaField,
  TopicStatus,
  TopicVersion,
  TopicVersionSource,
  WizardAnswer
} from '../shared/contracts.js'
import { createDefaultTopicSchema, escapeXml } from '../shared/domain.js'

interface ProviderRow {
  id: string
  display_name: string
  protocol: 'openai-compatible'
  base_url: string
  default_model: string
  enabled: number
  is_relay: number
  capabilities_json: string
  has_api_key: number
  created_at: string
  updated_at: string
}

interface ProviderModelRow {
  id: string
  provider_id: string
  model_id: string
  display_name: string
  context_limit: number | null
  output_limit: number | null
  reasoning_variants_json: string
  is_default: number
  enabled: number
  created_at: string
  updated_at: string
}

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

interface ArtifactReferenceRow {
  id: string
  source_type: string
  source_id: string
  source_version_id: string
  source_status_snapshot: AccountStatus
  target_type: string
  target_id: string
  created_at: string
}

interface HotFavoriteRow {
  id: string
  source: string
  source_item_id: string
  title: string
  description: string
  picture_url: string | null
  source_url: string
  source_title: string
  subtitle: string
  source_updated_at: string
  hot_value: string | null
  source_rank: number
  raw_json: string
  account_id: string | null
  status: 'active' | 'archived'
  created_at: string
}

interface HotSourcePreferenceRow {
  source_id: string
  hidden: number
  sort_order: number
  updated_at: string
}

interface TopicSchemaRow {
  id: string
  name: string
  required: number
  sort_order: number
}

interface TopicRow {
  id: string
  seed_keyword: string
  account_ids_json: string
  related_hot_ids_json: string
  status: TopicStatus
  current_version_id: string
  is_in_library: number
  version_count: number
  created_at: string
  updated_at: string
  fields_json: string
  provider_id: string | null
  model: string | null
}

interface TopicVersionRow {
  id: string
  topic_id: string
  version_number: number
  source: TopicVersionSource
  provider_id: string | null
  model: string | null
  fields_json: string
  created_at: string
}

interface SearchServiceRow {
  id: 'doubao-custom'
  display_name: string
  enabled: number
  has_api_key: number
  updated_at: string
}

interface MaterialRow {
  id: string
  kind: 'web' | 'image' | 'text'
  origin: 'doubao_web' | 'doubao_image' | 'manual_text'
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
interface FrameworkTemplateRow { id: string; name: string; sections_json: string; is_default: number; is_system: number; created_at: string; updated_at: string }
interface FrameworkRow { id: string; topic_id: string | null; account_id: string | null; material_ids_json: string; template_id: string | null; manual_topic: string; status: FrameworkStatus; current_version_id: string; version_count: number; sections_json: string; raw_xml: string; provider_id: string | null; model: string | null; created_at: string; updated_at: string }
interface ArticleRow { id: string; framework_id: string | null; account_id: string | null; material_ids_json: string; manual_outline: string; status: ArticleStatus; current_version_id: string; version_count: number; raw_markdown: string; provider_id: string | null; model: string | null; created_at: string; updated_at: string }
interface ArticleVersionRow { id: string; article_id: string; version_number: number; source: ArticleVersionSource; instruction: string | null; provider_id: string | null; model: string | null; raw_markdown: string; created_at: string }
interface ReviewRoleRow { id:string; name:string; system_prompt:string; provider_id:string|null; model:string|null; extraction_tag:string; extraction_occurrence:'first'|'last'; dimensions_json:string; sort_order:number; created_at:string; updated_at:string }
interface ReviewTaskRow { id:string; article_id:string; role_ids_json:string; status:'completed'|'applied'; created_at:string; updated_at:string }
interface ReviewOpinionRow { id:string; task_id:string; role_id:string|null; role_name:string; provider_id:string|null; model:string|null; dimensions_json:string; overall_suggestion:string; raw_xml:string; extraction_matched:number; created_at:string }
interface ReviewProblemRow { id:string; opinion_id:string; position:string; severity:ReviewSeverity; issue:string; suggestion:string; adopted:number; is_manual:number; created_at:string }
interface VisualPackRow { id:string; article_id:string; article_version_id:string; article_status_snapshot:ArticleStatus; provider_id:string; model:string; cover_json:string; inline_images_json:string; release_images_json:string; raw_xml:string; created_at:string }
interface ArticleLayoutRow { id:string; article_id:string; article_version_id:string; article_status_snapshot:ArticleStatus; platform:LayoutPlatform; title:string; html:string; plain_text:string; created_at:string }
interface WechatChannelRow { id:'wechat-official'; display_name:string; app_id:string; enabled:number; has_app_secret:number; updated_at:string }
interface PublicationRow { id:string; article_id:string; article_version_id:string; layout_id:string; channel_id:'wechat-official'; external_draft_id:string|null; status:PublicationStatus; title:string; thumb_media_id:string; published_url:string|null; error_message:string|null; created_at:string; updated_at:string }

export class AppDatabase {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('openai-compatible')),
        base_url TEXT NOT NULL,
        default_model TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_relay INTEGER NOT NULL DEFAULT 0,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_secrets (
        provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
        encrypted_key BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        context_limit INTEGER,
        output_limit INTEGER,
        reasoning_variants_json TEXT NOT NULL DEFAULT '[]',
        is_default INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider_id, model_id)
      );

      INSERT OR IGNORE INTO provider_models (
        id, provider_id, model_id, display_name, reasoning_variants_json,
        is_default, enabled, created_at, updated_at
      )
      SELECT
        lower(hex(randomblob(16))), id, default_model, default_model, '[]',
        1, 1, created_at, updated_at
      FROM providers
      WHERE default_model <> '';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_one_default
        ON provider_models(provider_id) WHERE is_default = 1;

      CREATE TABLE IF NOT EXISTS account_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('draft', 'locked')),
        current_version_id TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_profile_versions (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES account_profiles(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ai', 'manual', 'restore')),
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model TEXT,
        fields_json TEXT NOT NULL,
        wizard_answers_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(profile_id, version_number)
      );

      CREATE TABLE IF NOT EXISTS model_calls (
        id TEXT PRIMARY KEY,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model TEXT NOT NULL,
        modality TEXT NOT NULL DEFAULT 'text',
        latency_ms INTEGER NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        success INTEGER NOT NULL,
        error_kind TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifact_references (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version_id TEXT NOT NULL,
        source_status_snapshot TEXT NOT NULL CHECK (source_status_snapshot IN ('draft', 'locked')),
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source_type, source_version_id, target_type, target_id)
      );

      CREATE TABLE IF NOT EXISTS hot_favorites (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        picture_url TEXT,
        source_url TEXT NOT NULL DEFAULT '',
        source_title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        source_updated_at TEXT NOT NULL,
        hot_value TEXT,
        source_rank INTEGER NOT NULL,
        raw_json TEXT NOT NULL,
        account_id TEXT REFERENCES account_profiles(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        UNIQUE(source, source_item_id)
      );

      CREATE TABLE IF NOT EXISTS hot_favorite_tags (
        favorite_id TEXT NOT NULL REFERENCES hot_favorites(id) ON DELETE CASCADE,
        tag TEXT NOT NULL CHECK (tag IN ('待选题', '已用')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(favorite_id, tag)
      );

      CREATE TABLE IF NOT EXISTS hot_source_preferences (
        source_id TEXT PRIMARY KEY,
        hidden INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_schema_fields (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        required INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        seed_keyword TEXT NOT NULL,
        account_ids_json TEXT NOT NULL DEFAULT '[]',
        related_hot_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('draft', 'locked')),
        current_version_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_versions (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ai', 'manual', 'restore')),
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model TEXT,
        fields_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(topic_id, version_number)
      );

      CREATE TABLE IF NOT EXISTS topic_library (
        topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
        saved_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_services (
        id TEXT PRIMARY KEY CHECK (id = 'doubao-custom'),
        display_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_service_secrets (
        service_id TEXT PRIMARY KEY REFERENCES search_services(id) ON DELETE CASCADE,
        encrypted_key BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('web', 'image', 'text')),
        origin TEXT NOT NULL CHECK (origin IN ('doubao_web', 'doubao_image', 'manual_text')),
        external_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        source_url TEXT,
        source_name TEXT,
        source_note TEXT,
        query TEXT,
        related_topic_id TEXT,
        published_at TEXT,
        authority TEXT,
        relevance_score REAL,
        image_url TEXT,
        image_width INTEGER,
        image_height INTEGER,
        image_shape TEXT,
        watermark TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(origin, external_id)
      );

      CREATE TABLE IF NOT EXISTS framework_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sections_json TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0, is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS frameworks (
        id TEXT PRIMARY KEY, topic_id TEXT, account_id TEXT, material_ids_json TEXT NOT NULL DEFAULT '[]', template_id TEXT,
        manual_topic TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('draft','locked')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS framework_versions (
        id TEXT PRIMARY KEY, framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL, provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL, model TEXT,
        sections_json TEXT NOT NULL, raw_xml TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(framework_id, version_number)
      );
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY, framework_id TEXT REFERENCES frameworks(id) ON DELETE SET NULL,
        account_id TEXT REFERENCES account_profiles(id) ON DELETE SET NULL,
        material_ids_json TEXT NOT NULL DEFAULT '[]', manual_outline TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('draft','locked')), current_version_id TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS article_versions (
        id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('generate','revise','manual','restore')),
        instruction TEXT, provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL, model TEXT,
        raw_markdown TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(article_id, version_number)
      );
      CREATE TABLE IF NOT EXISTS review_roles (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,system_prompt TEXT NOT NULL,provider_id TEXT,model TEXT,extraction_tag TEXT NOT NULL,extraction_occurrence TEXT NOT NULL,dimensions_json TEXT NOT NULL,sort_order INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_tasks (id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,role_ids_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('completed','applied')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_opinions (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE,role_id TEXT,role_name TEXT NOT NULL,provider_id TEXT,model TEXT,dimensions_json TEXT NOT NULL,overall_suggestion TEXT NOT NULL,raw_xml TEXT NOT NULL,extraction_matched INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_problems (id TEXT PRIMARY KEY,opinion_id TEXT NOT NULL REFERENCES review_opinions(id) ON DELETE CASCADE,position TEXT NOT NULL,severity TEXT NOT NULL CHECK(severity IN ('high','medium','low')),issue TEXT NOT NULL,suggestion TEXT NOT NULL,adopted INTEGER NOT NULL,is_manual INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visual_packs (id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,article_version_id TEXT NOT NULL,article_status_snapshot TEXT NOT NULL CHECK(article_status_snapshot IN ('draft','locked')),provider_id TEXT NOT NULL,model TEXT NOT NULL,cover_json TEXT NOT NULL,inline_images_json TEXT NOT NULL,release_images_json TEXT NOT NULL,raw_xml TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS article_layouts (id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,article_version_id TEXT NOT NULL,article_status_snapshot TEXT NOT NULL CHECK(article_status_snapshot IN ('draft','locked')),platform TEXT NOT NULL CHECK(platform IN ('wechat','xiaohongshu','web')),title TEXT NOT NULL,html TEXT NOT NULL,plain_text TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_channels (id TEXT PRIMARY KEY CHECK(id='wechat-official'),display_name TEXT NOT NULL,app_id TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_channel_secrets (channel_id TEXT PRIMARY KEY REFERENCES publish_channels(id) ON DELETE CASCADE,encrypted_secret BLOB NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,article_version_id TEXT NOT NULL,layout_id TEXT NOT NULL REFERENCES article_layouts(id) ON DELETE CASCADE,channel_id TEXT NOT NULL REFERENCES publish_channels(id),external_draft_id TEXT,status TEXT NOT NULL CHECK(status IN ('draft','published','failed')),title TEXT NOT NULL,thumb_media_id TEXT NOT NULL,published_url TEXT,error_message TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);

      CREATE TRIGGER IF NOT EXISTS artifact_references_immutable
      BEFORE UPDATE ON artifact_references
      BEGIN
        SELECT RAISE(ABORT, 'artifact references are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS hot_favorites_snapshot_immutable
      BEFORE UPDATE OF
        source, source_item_id, title, description, picture_url, source_url,
        source_title, subtitle, source_updated_at, hot_value, source_rank, raw_json
      ON hot_favorites
      BEGIN
        SELECT RAISE(ABORT, 'hot favorite snapshots are immutable');
      END;

      CREATE INDEX IF NOT EXISTS idx_account_versions_profile
        ON account_profile_versions(profile_id, version_number DESC);
      CREATE INDEX IF NOT EXISTS idx_model_calls_created
        ON model_calls(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifact_references_source
        ON artifact_references(source_type, source_id, source_version_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_references_target
        ON artifact_references(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_hot_favorites_created
        ON hot_favorites(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_hot_favorites_account
        ON hot_favorites(account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_hot_favorite_tags_tag
        ON hot_favorite_tags(tag, favorite_id);
      CREATE INDEX IF NOT EXISTS idx_topics_updated
        ON topics(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topic_versions_topic
        ON topic_versions(topic_id, version_number DESC);
      CREATE INDEX IF NOT EXISTS idx_materials_created
        ON materials(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_materials_kind
        ON materials(kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_frameworks_updated ON frameworks(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_versions_article ON article_versions(article_id, version_number DESC);
      CREATE INDEX IF NOT EXISTS idx_review_tasks_article ON review_tasks(article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_visual_packs_article ON visual_packs(article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_layouts_article ON article_layouts(article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_publications_article ON publications(article_id, created_at DESC);
    `)
    this.ensureTopicSchema()
    this.ensureSearchService()
    this.ensureWechatPublishChannel()
    this.ensureFrameworkTemplate()
  }

  listProviders(): ProviderSummary[] {
    const rows = this.db
      .prepare(`
        SELECT p.*, CASE WHEN s.provider_id IS NULL THEN 0 ELSE 1 END AS has_api_key
        FROM providers p
        LEFT JOIN provider_secrets s ON s.provider_id = p.id
        ORDER BY p.created_at ASC
      `)
      .all() as unknown as ProviderRow[]
    return rows.map((row) => mapProvider(row, this.listProviderModels(row.id)))
  }

  getProvider(id: string): ProviderSummary | null {
    const row = this.db
      .prepare(`
        SELECT p.*, CASE WHEN s.provider_id IS NULL THEN 0 ELSE 1 END AS has_api_key
        FROM providers p
        LEFT JOIN provider_secrets s ON s.provider_id = p.id
        WHERE p.id = ?
      `)
      .get(id) as ProviderRow | undefined
    return row ? mapProvider(row, this.listProviderModels(row.id)) : null
  }

  saveProvider(input: SaveProviderInput, encryptedKey?: Buffer): ProviderSummary {
    const id = input.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const existing = this.getProvider(id)
    const capabilitiesJson = JSON.stringify(input.capabilities)
    const models = normalizeProviderModels(input.models, input.defaultModel)
    const defaultModel = models.find((model) => model.isDefault)?.modelId
    if (!defaultModel) throw new Error('至少需要一个默认模型')

    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO providers (
          id, display_name, protocol, base_url, default_model, enabled,
          is_relay, capabilities_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          protocol = excluded.protocol,
          base_url = excluded.base_url,
          default_model = excluded.default_model,
          enabled = excluded.enabled,
          is_relay = excluded.is_relay,
          capabilities_json = excluded.capabilities_json,
          updated_at = excluded.updated_at
      `).run(
        id,
        input.displayName.trim(),
        input.protocol,
        normalizeBaseUrl(input.baseUrl),
        defaultModel,
        input.enabled ? 1 : 0,
        input.isRelay ? 1 : 0,
        capabilitiesJson,
        existing?.createdAt ?? now,
        now
      )

      if (encryptedKey) {
        this.db.prepare(`
          INSERT INTO provider_secrets(provider_id, encrypted_key, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(provider_id) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            updated_at = excluded.updated_at
        `).run(id, encryptedKey, now)
      }

      this.db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(id)
      const insertModel = this.db.prepare(`
        INSERT INTO provider_models (
          id, provider_id, model_id, display_name, context_limit, output_limit,
          reasoning_variants_json, is_default, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const model of models) {
        insertModel.run(
          model.id ?? crypto.randomUUID(),
          id,
          model.modelId,
          model.displayName,
          model.contextLimit ?? null,
          model.outputLimit ?? null,
          JSON.stringify(model.reasoningVariants),
          model.isDefault ? 1 : 0,
          model.enabled ? 1 : 0,
          now,
          now
        )
      }
    })
    const saved = this.getProvider(id)
    if (!saved) throw new Error('供应商保存失败')
    return saved
  }

  getEncryptedProviderKey(id: string): Buffer | null {
    const row = this.db
      .prepare('SELECT encrypted_key FROM provider_secrets WHERE provider_id = ?')
      .get(id) as { encrypted_key: Buffer } | undefined
    return row?.encrypted_key ? Buffer.from(row.encrypted_key) : null
  }

  removeProvider(id: string): void {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id)
  }

  listProviderModels(providerId: string): ProviderModel[] {
    const rows = this.db.prepare(`
      SELECT * FROM provider_models
      WHERE provider_id = ?
      ORDER BY is_default DESC, created_at ASC
    `).all(providerId) as unknown as ProviderModelRow[]
    return rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      modelId: row.model_id,
      displayName: row.display_name,
      contextLimit: row.context_limit ?? undefined,
      outputLimit: row.output_limit ?? undefined,
      reasoningVariants: parseJson<string[]>(row.reasoning_variants_json, []),
      isDefault: Boolean(row.is_default),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  listAccounts(): AccountProfileSummary[] {
    const rows = this.db.prepare(`
      SELECT
        p.*,
        (SELECT COUNT(*) FROM account_profile_versions v WHERE v.profile_id = p.id) AS version_count
      FROM account_profiles p
      ORDER BY p.is_current DESC, p.updated_at DESC
    `).all() as unknown as AccountSummaryRow[]
    return rows.map(mapAccountSummary)
  }

  getAccount(id: string): AccountProfile | null {
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
      currentVersionId: row.current_version_id,
      fields: parseJson<AccountField[]>(row.fields_json, []),
      wizardAnswers: parseJson<WizardAnswer[]>(row.wizard_answers_json, []),
      versions: versions.map(mapVersion)
    }
  }

  saveAccount(input: SaveAccountInput): AccountProfile {
    const profileId = input.id ?? crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const existing = input.id ? this.getAccount(input.id) : null
    const versionNumber = existing ? existing.versionCount + 1 : 1
    const fieldsJson = JSON.stringify(input.fields)
    const wizardJson = JSON.stringify(input.wizardAnswers)
    const name = fieldValue(input.fields, '账号名称') || '未命名账号'
    const intro = fieldValue(input.fields, '简介')
    const domain = fieldValue(input.fields, '领域')

    this.transaction(() => {
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
    const saved = this.getAccount(profileId)
    if (!saved) throw new Error('账号保存失败')
    return saved
  }

  setCurrentAccount(id: string): void {
    if (!this.getAccount(id)) throw new Error('账号不存在')
    this.transaction(() => {
      this.db.prepare('UPDATE account_profiles SET is_current = 0').run()
      this.db.prepare('UPDATE account_profiles SET is_current = 1 WHERE id = ?').run(id)
    })
  }

  setAccountLocked(id: string, locked: boolean): AccountProfile {
    const account = this.getAccount(id)
    if (!account) throw new Error('账号不存在')
    this.db.prepare(`
      UPDATE account_profiles SET status = ?, updated_at = ? WHERE id = ?
    `).run(locked ? 'locked' : 'draft', new Date().toISOString(), id)
    const updated = this.getAccount(id)
    if (!updated) throw new Error('账号状态更新失败')
    return updated
  }

  restoreAccountVersion(profileId: string, versionId: string): AccountProfile {
    const version = this.db.prepare(`
      SELECT * FROM account_profile_versions WHERE id = ? AND profile_id = ?
    `).get(versionId, profileId) as VersionRow | undefined
    if (!version) throw new Error('版本不存在')

    return this.saveAccount({
      id: profileId,
      fields: parseJson<AccountField[]>(version.fields_json, []),
      wizardAnswers: parseJson<WizardAnswer[]>(version.wizard_answers_json, []),
      status: 'draft',
      source: 'restore',
      providerId: version.provider_id ?? undefined,
      model: version.model ?? undefined
    })
  }

  removeAccount(id: string): void {
    this.db.prepare('DELETE FROM account_profiles WHERE id = ?').run(id)
  }

  listHotFavorites(): HotFavorite[] {
    const rows = this.db.prepare(`
      SELECT * FROM hot_favorites
      WHERE status = 'active'
      ORDER BY created_at DESC
    `).all() as unknown as HotFavoriteRow[]
    return rows.map((row) => this.mapHotFavorite(row))
  }

  listHotSourcePreferences(): HotSourcePreference[] {
    const rows = this.db.prepare(`
      SELECT * FROM hot_source_preferences ORDER BY sort_order ASC, source_id ASC
    `).all() as unknown as HotSourcePreferenceRow[]
    return rows.map((row) => ({
      sourceId: row.source_id,
      hidden: Boolean(row.hidden),
      sortOrder: row.sort_order,
      updatedAt: row.updated_at
    }))
  }

  saveHotSourcePreferences(
    preferences: Array<{ sourceId: string; hidden: boolean; sortOrder: number }>
  ): HotSourcePreference[] {
    const now = new Date().toISOString()
    this.transaction(() => {
      const upsert = this.db.prepare(`
        INSERT INTO hot_source_preferences(source_id, hidden, sort_order, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          hidden = excluded.hidden,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
      `)
      for (const preference of preferences) {
        upsert.run(
          preference.sourceId,
          preference.hidden ? 1 : 0,
          preference.sortOrder,
          now
        )
      }
    })
    return this.listHotSourcePreferences()
  }

  addHotFavorite(input: {
    hotItem: HotItem
    accountId?: string
    tags?: HotFavoriteTag[]
  }): { favorite: HotFavorite; created: boolean } {
    const existing = this.db.prepare(`
      SELECT * FROM hot_favorites WHERE source = ? AND source_item_id = ?
    `).get(input.hotItem.source, input.hotItem.id) as HotFavoriteRow | undefined
    if (existing) return { favorite: this.mapHotFavorite(existing), created: false }

    if (input.accountId) {
      const account = this.db.prepare('SELECT id FROM account_profiles WHERE id = ?')
        .get(input.accountId)
      if (!account) throw new Error('关联账号不存在')
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const tags = normalizeFavoriteTags(input.tags?.length ? input.tags : ['待选题'])
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO hot_favorites (
          id, source, source_item_id, title, description, picture_url, source_url,
          source_title, subtitle, source_updated_at, hot_value, source_rank,
          raw_json, account_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        id,
        input.hotItem.source,
        input.hotItem.id,
        input.hotItem.title,
        input.hotItem.desc,
        input.hotItem.pic ?? null,
        input.hotItem.url,
        input.hotItem.sourceTitle,
        input.hotItem.subtitle,
        input.hotItem.updateTime,
        input.hotItem.hotValue ?? null,
        input.hotItem.rank,
        input.hotItem.rawJson,
        input.accountId ?? null,
        now
      )
      this.replaceFavoriteTags(id, tags, now)
    })
    const favorite = this.getHotFavorite(id)
    if (!favorite) throw new Error('热点收藏失败')
    return { favorite, created: true }
  }

  updateHotFavoriteTags(id: string, tags: HotFavoriteTag[]): HotFavorite {
    const favorite = this.getHotFavorite(id)
    if (!favorite) throw new Error('收藏不存在')
    this.transaction(() => {
      this.replaceFavoriteTags(id, normalizeFavoriteTags(tags), new Date().toISOString())
    })
    const updated = this.getHotFavorite(id)
    if (!updated) throw new Error('收藏标签更新失败')
    return updated
  }

  removeHotFavorite(id: string): void {
    this.db.prepare('DELETE FROM hot_favorites WHERE id = ?').run(id)
  }

  getTopicSchema(): TopicSchemaField[] {
    const rows = this.db.prepare(`
      SELECT * FROM topic_schema_fields ORDER BY sort_order ASC, name ASC
    `).all() as unknown as TopicSchemaRow[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      required: Boolean(row.required),
      sortOrder: row.sort_order
    }))
  }

  saveTopicSchema(fields: TopicSchemaField[]): TopicSchemaField[] {
    this.transaction(() => {
      this.db.prepare('DELETE FROM topic_schema_fields').run()
      const insert = this.db.prepare(`
        INSERT INTO topic_schema_fields(id, name, required, sort_order) VALUES (?, ?, ?, ?)
      `)
      for (const [index, field] of fields.entries()) {
        insert.run(field.id || crypto.randomUUID(), field.name.trim(), field.required ? 1 : 0, index)
      }
    })
    return this.getTopicSchema()
  }

  resetTopicSchema(): TopicSchemaField[] {
    return this.saveTopicSchema(createDefaultTopicSchema())
  }

  listTopics(libraryOnly = false): Topic[] {
    const rows = this.db.prepare(`
      SELECT
        t.*,
        v.fields_json,
        v.provider_id,
        v.model,
        EXISTS(SELECT 1 FROM topic_library l WHERE l.topic_id = t.id) AS is_in_library,
        (SELECT COUNT(*) FROM topic_versions tv WHERE tv.topic_id = t.id) AS version_count
      FROM topics t
      JOIN topic_versions v ON v.id = t.current_version_id
      ${libraryOnly ? 'JOIN topic_library l ON l.topic_id = t.id' : ''}
      ORDER BY t.updated_at DESC
    `).all() as unknown as TopicRow[]
    return rows.map((row) => this.mapTopic(row))
  }

  getTopic(id: string): Topic | null {
    const row = this.db.prepare(`
      SELECT
        t.*,
        v.fields_json,
        v.provider_id,
        v.model,
        EXISTS(SELECT 1 FROM topic_library l WHERE l.topic_id = t.id) AS is_in_library,
        (SELECT COUNT(*) FROM topic_versions tv WHERE tv.topic_id = t.id) AS version_count
      FROM topics t
      JOIN topic_versions v ON v.id = t.current_version_id
      WHERE t.id = ?
    `).get(id) as TopicRow | undefined
    return row ? this.mapTopic(row) : null
  }

  saveTopic(input: SaveTopicInput): Topic {
    const topicId = input.id ?? crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const existing = input.id ? this.getTopic(input.id) : null
    const versionNumber = existing ? existing.versionCount + 1 : 1
    const fields = Object.fromEntries(
      Object.entries(input.fields).map(([key, value]) => [key.trim(), String(value ?? '').trim()])
    )

    this.transaction(() => {
      if (existing) {
        this.db.prepare(`
          UPDATE topics
          SET seed_keyword = ?, account_ids_json = ?, related_hot_ids_json = ?, status = ?,
              current_version_id = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.seedKeyword.trim(), JSON.stringify([...new Set(input.accountIds)]),
          JSON.stringify([...new Set(input.relatedHotIds)]), input.status, versionId, now, topicId
        )
      } else {
        this.db.prepare(`
          INSERT INTO topics(
            id, seed_keyword, account_ids_json, related_hot_ids_json, status,
            current_version_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          topicId, input.seedKeyword.trim(), JSON.stringify([...new Set(input.accountIds)]),
          JSON.stringify([...new Set(input.relatedHotIds)]), input.status, versionId, now, now
        )
      }

      this.db.prepare(`
        INSERT INTO topic_versions(
          id, topic_id, version_number, source, provider_id, model, fields_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId, topicId, versionNumber, input.source, input.providerId ?? null,
        input.model ?? null, JSON.stringify(fields), now
      )
    })

    const saved = this.getTopic(topicId)
    if (!saved) throw new Error('选题保存失败')
    return saved
  }

  setTopicLocked(id: string, locked: boolean): Topic {
    if (!this.getTopic(id)) throw new Error('选题不存在')
    this.db.prepare('UPDATE topics SET status = ?, updated_at = ? WHERE id = ?')
      .run(locked ? 'locked' : 'draft', new Date().toISOString(), id)
    const updated = this.getTopic(id)
    if (!updated) throw new Error('选题状态更新失败')
    return updated
  }

  setTopicInLibrary(id: string, inLibrary: boolean): Topic {
    if (!this.getTopic(id)) throw new Error('选题不存在')
    if (inLibrary) {
      this.db.prepare(`
        INSERT INTO topic_library(topic_id, saved_at) VALUES (?, ?)
        ON CONFLICT(topic_id) DO NOTHING
      `).run(id, new Date().toISOString())
    } else {
      this.db.prepare('DELETE FROM topic_library WHERE topic_id = ?').run(id)
    }
    const updated = this.getTopic(id)
    if (!updated) throw new Error('选题库状态更新失败')
    return updated
  }

  removeTopic(id: string): void {
    this.db.prepare('DELETE FROM topics WHERE id = ?').run(id)
  }

  getSearchService(): SearchServiceSummary {
    const row = this.db.prepare(`
      SELECT s.id, s.display_name, s.enabled, s.updated_at,
        EXISTS(SELECT 1 FROM search_service_secrets ss WHERE ss.service_id = s.id) AS has_api_key
      FROM search_services s WHERE s.id = 'doubao-custom'
    `).get() as SearchServiceRow | undefined
    if (!row) throw new Error('搜索服务配置不存在')
    return {
      id: row.id,
      displayName: row.display_name,
      enabled: Boolean(row.enabled),
      hasApiKey: Boolean(row.has_api_key),
      updatedAt: row.updated_at
    }
  }

  saveSearchService(input: { enabled: boolean }, encryptedKey?: Buffer): SearchServiceSummary {
    const now = new Date().toISOString()
    this.transaction(() => {
      this.db.prepare(`
        UPDATE search_services SET enabled = ?, updated_at = ? WHERE id = 'doubao-custom'
      `).run(input.enabled ? 1 : 0, now)
      if (encryptedKey) {
        this.db.prepare(`
          INSERT INTO search_service_secrets(service_id, encrypted_key, updated_at)
          VALUES ('doubao-custom', ?, ?)
          ON CONFLICT(service_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, updated_at = excluded.updated_at
        `).run(encryptedKey, now)
      }
    })
    return this.getSearchService()
  }

  getEncryptedSearchServiceKey(): Buffer | null {
    const row = this.db.prepare(`
      SELECT encrypted_key FROM search_service_secrets WHERE service_id = 'doubao-custom'
    `).get() as { encrypted_key: Buffer } | undefined
    return row?.encrypted_key ? Buffer.from(row.encrypted_key) : null
  }

  listMaterials(): Material[] {
    const rows = this.db.prepare('SELECT * FROM materials ORDER BY created_at DESC').all() as unknown as MaterialRow[]
    return rows.map(mapMaterial)
  }

  addSearchMaterial(input: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): {
    material: Material
    created: boolean
  } {
    if (input.externalId) {
      const existing = this.db.prepare(`
        SELECT * FROM materials WHERE origin = ? AND external_id = ?
      `).get(input.origin, input.externalId) as MaterialRow | undefined
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
    const material = this.getMaterial(id)
    if (!material) throw new Error('素材保存失败')
    return { material, created: true }
  }

  addManualMaterial(input: SaveManualMaterialInput): Material {
    const result = this.addSearchMaterial({
      kind: 'text',
      origin: 'manual_text',
      title: input.title.trim(),
      summary: input.summary.trim(),
      sourceUrl: input.sourceUrl?.trim() || undefined,
      sourceNote: input.sourceNote?.trim() || undefined,
      relatedTopicId: input.relatedTopicId
    })
    return result.material
  }

  removeMaterial(id: string): void {
    this.db.prepare('DELETE FROM materials WHERE id = ?').run(id)
  }

  listFrameworkTemplates(): FrameworkTemplate[] {
    return (this.db.prepare('SELECT * FROM framework_templates ORDER BY is_default DESC, updated_at DESC').all() as unknown as FrameworkTemplateRow[]).map(mapFrameworkTemplate)
  }
  saveFrameworkTemplate(input: SaveFrameworkTemplateInput): FrameworkTemplate {
    const id = input.id ?? crypto.randomUUID(), now = new Date().toISOString()
    this.transaction(() => {
      if (input.isDefault) this.db.prepare('UPDATE framework_templates SET is_default = 0').run()
      this.db.prepare(`INSERT INTO framework_templates(id,name,sections_json,is_default,is_system,created_at,updated_at) VALUES(?,?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sections_json=excluded.sections_json,is_default=excluded.is_default,updated_at=excluded.updated_at`).run(id,input.name.trim(),JSON.stringify(input.sections),input.isDefault?1:0,now,now)
    })
    const row = this.db.prepare('SELECT * FROM framework_templates WHERE id=?').get(id) as unknown as FrameworkTemplateRow
    return mapFrameworkTemplate(row)
  }
  listFrameworks(): Framework[] {
    const rows = this.db.prepare(`SELECT f.*,v.sections_json,v.raw_xml,v.provider_id,v.model,(SELECT COUNT(*) FROM framework_versions x WHERE x.framework_id=f.id) version_count FROM frameworks f JOIN framework_versions v ON v.id=f.current_version_id ORDER BY f.updated_at DESC`).all() as unknown as FrameworkRow[]
    return rows.map((row) => ({
      ...mapFramework(row),
      references: this.listArtifactReferencesForTarget('framework', row.id)
    }))
  }
  getFramework(id: string): Framework | null {
    const row = this.db.prepare(`SELECT f.*,v.sections_json,v.raw_xml,v.provider_id,v.model,(SELECT COUNT(*) FROM framework_versions x WHERE x.framework_id=f.id) version_count FROM frameworks f JOIN framework_versions v ON v.id=f.current_version_id WHERE f.id=?`).get(id) as FrameworkRow | undefined
    return row ? {
      ...mapFramework(row),
      references: this.listArtifactReferencesForTarget('framework', row.id)
    } : null
  }
  saveFramework(input: SaveFrameworkInput): Framework {
    const id=input.id??crypto.randomUUID(), versionId=crypto.randomUUID(), now=new Date().toISOString(), existing=input.id?this.getFramework(input.id):null, version=(existing?.versionCount??0)+1, rawXml=serializeFrameworkXml(input.sections)
    this.transaction(()=>{ if(existing) this.db.prepare(`UPDATE frameworks SET topic_id=?,account_id=?,material_ids_json=?,template_id=?,manual_topic=?,status=?,current_version_id=?,updated_at=? WHERE id=?`).run(input.topicId??null,input.accountId??null,JSON.stringify([...new Set(input.materialIds)]),input.templateId??null,input.manualTopic,input.status,versionId,now,id); else this.db.prepare(`INSERT INTO frameworks(id,topic_id,account_id,material_ids_json,template_id,manual_topic,status,current_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,input.topicId??null,input.accountId??null,JSON.stringify([...new Set(input.materialIds)]),input.templateId??null,input.manualTopic,input.status,versionId,now,now); this.db.prepare(`INSERT INTO framework_versions(id,framework_id,version_number,provider_id,model,sections_json,raw_xml,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(versionId,id,version,input.providerId??null,input.model??null,JSON.stringify(input.sections),rawXml,now) })
    return this.getFramework(id)!
  }
  setFrameworkLocked(id: string, locked: boolean): Framework { this.db.prepare('UPDATE frameworks SET status=?,updated_at=? WHERE id=?').run(locked?'locked':'draft',new Date().toISOString(),id); return this.getFramework(id)! }
  removeFramework(id: string): void { this.db.prepare('DELETE FROM frameworks WHERE id=?').run(id) }

  listArticles(): Article[] {
    const rows = this.db.prepare(`SELECT a.*,v.raw_markdown,v.provider_id,v.model,(SELECT COUNT(*) FROM article_versions x WHERE x.article_id=a.id) version_count FROM articles a JOIN article_versions v ON v.id=a.current_version_id ORDER BY a.updated_at DESC`).all() as unknown as ArticleRow[]
    return rows.map((row) => this.mapArticle(row))
  }

  getArticle(id: string): Article | null {
    const row = this.db.prepare(`SELECT a.*,v.raw_markdown,v.provider_id,v.model,(SELECT COUNT(*) FROM article_versions x WHERE x.article_id=a.id) version_count FROM articles a JOIN article_versions v ON v.id=a.current_version_id WHERE a.id=?`).get(id) as unknown as ArticleRow | undefined
    return row ? this.mapArticle(row) : null
  }

  saveArticle(input: SaveArticleInput): Article {
    const id = input.id ?? crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()
    const existing = input.id ? this.getArticle(input.id) : null
    if (input.id && !existing) throw new Error('成稿不存在')
    const version = (existing?.versionCount ?? 0) + 1
    this.transaction(() => {
      if (existing) {
        this.db.prepare(`UPDATE articles SET framework_id=?,account_id=?,material_ids_json=?,manual_outline=?,status=?,current_version_id=?,updated_at=? WHERE id=?`).run(
          input.frameworkId ?? null, input.accountId ?? null, JSON.stringify([...new Set(input.materialIds)]),
          input.manualOutline, input.status, versionId, now, id
        )
      } else {
        this.db.prepare(`INSERT INTO articles(id,framework_id,account_id,material_ids_json,manual_outline,status,current_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
          id, input.frameworkId ?? null, input.accountId ?? null, JSON.stringify([...new Set(input.materialIds)]),
          input.manualOutline, input.status, versionId, now, now
        )
      }
      this.db.prepare(`INSERT INTO article_versions(id,article_id,version_number,source,instruction,provider_id,model,raw_markdown,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        versionId, id, version, input.source, input.instruction ?? null, input.providerId ?? null,
        input.model ?? null, input.rawMarkdown, now
      )
    })
    const saved = this.getArticle(id)
    if (!saved) throw new Error('成稿保存失败')
    return saved
  }

  restoreArticleVersion(articleId: string, versionId: string): Article {
    const current = this.getArticle(articleId)
    const version = this.db.prepare('SELECT * FROM article_versions WHERE id=? AND article_id=?').get(versionId, articleId) as unknown as ArticleVersionRow | undefined
    if (!current || !version) throw new Error('成稿版本不存在')
    return this.saveArticle({
      id: current.id, frameworkId: current.frameworkId, accountId: current.accountId,
      materialIds: current.materialIds, manualOutline: current.manualOutline, status: 'draft',
      rawMarkdown: version.raw_markdown, source: 'restore', instruction: `恢复自版本 ${version.version_number}`,
      providerId: version.provider_id ?? undefined, model: version.model ?? undefined
    })
  }

  setArticleLocked(id: string, locked: boolean): Article {
    if (!this.getArticle(id)) throw new Error('成稿不存在')
    this.db.prepare('UPDATE articles SET status=?,updated_at=? WHERE id=?').run(locked ? 'locked' : 'draft', new Date().toISOString(), id)
    return this.getArticle(id)!
  }

  removeArticle(id: string): void { this.db.prepare('DELETE FROM articles WHERE id=?').run(id) }

  listVisualPacks(articleId?: string): VisualPack[] { const rows=this.db.prepare(`SELECT * FROM visual_packs ${articleId?'WHERE article_id=?':''} ORDER BY created_at DESC`).all(...(articleId?[articleId]:[])) as unknown as VisualPackRow[]; return rows.map(mapVisualPack) }
  saveVisualPack(input:Omit<VisualPack,'id'|'createdAt'>):VisualPack { const id=crypto.randomUUID(),now=new Date().toISOString(); this.db.prepare('INSERT INTO visual_packs(id,article_id,article_version_id,article_status_snapshot,provider_id,model,cover_json,inline_images_json,release_images_json,raw_xml,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,input.articleId,input.articleVersionId,input.articleStatusSnapshot,input.providerId,input.model,JSON.stringify(input.cover),JSON.stringify(input.inlineImages),JSON.stringify(input.releaseImages),input.rawXml,now); return mapVisualPack(this.db.prepare('SELECT * FROM visual_packs WHERE id=?').get(id) as unknown as VisualPackRow) }
  removeVisualPack(id:string):void { this.db.prepare('DELETE FROM visual_packs WHERE id=?').run(id) }
  listArticleLayouts(articleId?:string):ArticleLayout[] { const rows=this.db.prepare(`SELECT * FROM article_layouts ${articleId?'WHERE article_id=?':''} ORDER BY created_at DESC`).all(...(articleId?[articleId]:[])) as unknown as ArticleLayoutRow[]; return rows.map(mapArticleLayout) }
  saveArticleLayout(input:Omit<ArticleLayout,'id'|'createdAt'>):ArticleLayout { const id=crypto.randomUUID(),now=new Date().toISOString();this.db.prepare('INSERT INTO article_layouts(id,article_id,article_version_id,article_status_snapshot,platform,title,html,plain_text,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,input.articleId,input.articleVersionId,input.articleStatusSnapshot,input.platform,input.title,input.html,input.plainText,now);return mapArticleLayout(this.db.prepare('SELECT * FROM article_layouts WHERE id=?').get(id) as unknown as ArticleLayoutRow) }
  removeArticleLayout(id:string):void { this.db.prepare('DELETE FROM article_layouts WHERE id=?').run(id) }
  getWechatPublishChannel():WechatPublishChannel { const row=this.db.prepare("SELECT c.id,c.display_name,c.app_id,c.enabled,EXISTS(SELECT 1 FROM publish_channel_secrets s WHERE s.channel_id=c.id) has_app_secret,c.updated_at FROM publish_channels c WHERE c.id='wechat-official'").get() as unknown as WechatChannelRow;return mapWechatChannel(row) }
  saveWechatPublishChannel(input:{appId:string;enabled:boolean},encryptedSecret?:Buffer):WechatPublishChannel { const now=new Date().toISOString();this.transaction(()=>{this.db.prepare("UPDATE publish_channels SET app_id=?,enabled=?,updated_at=? WHERE id='wechat-official'").run(input.appId,input.enabled?1:0,now);if(encryptedSecret)this.db.prepare("INSERT INTO publish_channel_secrets(channel_id,encrypted_secret,updated_at) VALUES('wechat-official',?,?) ON CONFLICT(channel_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,updated_at=excluded.updated_at").run(encryptedSecret,now)});return this.getWechatPublishChannel() }
  getEncryptedWechatPublishSecret():Buffer|null { const row=this.db.prepare("SELECT encrypted_secret FROM publish_channel_secrets WHERE channel_id='wechat-official'").get() as {encrypted_secret:Buffer}|undefined;return row?.encrypted_secret??null }
  createPublication(input:Omit<Publication,'id'|'createdAt'|'updatedAt'>):Publication { const id=crypto.randomUUID(),now=new Date().toISOString();this.db.prepare('INSERT INTO publications(id,article_id,article_version_id,layout_id,channel_id,external_draft_id,status,title,thumb_media_id,published_url,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.articleId,input.articleVersionId,input.layoutId,input.channelId,input.externalDraftId??null,input.status,input.title,input.thumbMediaId,input.publishedUrl??null,input.errorMessage??null,now,now);return this.getPublication(id)! }
  listPublications():Publication[] { return (this.db.prepare('SELECT * FROM publications ORDER BY created_at DESC').all() as unknown as PublicationRow[]).map(mapPublication) }
  getPublication(id:string):Publication|null { const row=this.db.prepare('SELECT * FROM publications WHERE id=?').get(id) as unknown as PublicationRow|undefined;return row?mapPublication(row):null }
  markPublicationPublished(id:string,publishedUrl:string):Publication { this.db.prepare("UPDATE publications SET status='published',published_url=?,error_message=NULL,updated_at=? WHERE id=?").run(publishedUrl,new Date().toISOString(),id);const row=this.getPublication(id);if(!row)throw new Error('发布记录不存在');return row }

  listReviewRoles(): ReviewRole[] { return (this.db.prepare('SELECT * FROM review_roles ORDER BY sort_order,created_at').all() as unknown as ReviewRoleRow[]).map(mapReviewRole) }
  saveReviewRole(input: SaveReviewRoleInput): ReviewRole { const id=input.id??crypto.randomUUID(), now=new Date().toISOString(); this.db.prepare(`INSERT INTO review_roles(id,name,system_prompt,provider_id,model,extraction_tag,extraction_occurrence,dimensions_json,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,system_prompt=excluded.system_prompt,provider_id=excluded.provider_id,model=excluded.model,extraction_tag=excluded.extraction_tag,extraction_occurrence=excluded.extraction_occurrence,dimensions_json=excluded.dimensions_json,sort_order=excluded.sort_order,updated_at=excluded.updated_at`).run(id,input.name,input.systemPrompt,input.providerId??null,input.model??null,input.extractionTag,input.extractionOccurrence,JSON.stringify(input.dimensions),input.sortOrder,now,now); return mapReviewRole(this.db.prepare('SELECT * FROM review_roles WHERE id=?').get(id) as unknown as ReviewRoleRow) }
  removeReviewRole(id:string):void { this.db.prepare('DELETE FROM review_roles WHERE id=?').run(id) }
  getReviewRole(id:string):ReviewRole|null { const row=this.db.prepare('SELECT * FROM review_roles WHERE id=?').get(id) as unknown as ReviewRoleRow|undefined; return row?mapReviewRole(row):null }
  createReviewTask(articleId:string, roleIds:string[]):ReviewTask { const id=crypto.randomUUID(),now=new Date().toISOString(); this.db.prepare('INSERT INTO review_tasks(id,article_id,role_ids_json,status,created_at,updated_at) VALUES(?,?,?,\'completed\',?,?)').run(id,articleId,JSON.stringify(roleIds),now,now); return this.getReviewTask(id)! }
  addReviewOpinion(input:{taskId:string;role?:ReviewRole;providerId?:string;model?:string;dimensions:string[];overallSuggestion:string;rawXml:string;extractionMatched:boolean;problems:Omit<ReviewProblem,'id'>[]}):ReviewOpinion { const id=crypto.randomUUID(),now=new Date().toISOString(); this.transaction(()=>{this.db.prepare('INSERT INTO review_opinions(id,task_id,role_id,role_name,provider_id,model,dimensions_json,overall_suggestion,raw_xml,extraction_matched,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,input.taskId,input.role?.id??null,input.role?.name??'人工',input.providerId??null,input.model??null,JSON.stringify(input.dimensions),input.overallSuggestion,input.rawXml,input.extractionMatched?1:0,now); for(const p of input.problems)this.db.prepare('INSERT INTO review_problems(id,opinion_id,position,severity,issue,suggestion,adopted,is_manual,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,p.position,p.severity,p.issue,p.suggestion,p.adopted?1:0,p.isManual?1:0,now)}); return this.getReviewOpinion(id)! }
  listReviewTasks(articleId?:string):ReviewTask[] { const rows=this.db.prepare(`SELECT * FROM review_tasks ${articleId?'WHERE article_id=?':''} ORDER BY created_at DESC`).all(...(articleId?[articleId]:[])) as unknown as ReviewTaskRow[]; return rows.map(row=>this.mapReviewTask(row)) }
  getReviewTask(id:string):ReviewTask|null { const row=this.db.prepare('SELECT * FROM review_tasks WHERE id=?').get(id) as unknown as ReviewTaskRow|undefined; return row?this.mapReviewTask(row):null }
  markReviewTaskApplied(id:string):void { this.db.prepare("UPDATE review_tasks SET status='applied',updated_at=? WHERE id=?").run(new Date().toISOString(),id) }
  updateReviewProblem(input:{id:string;position:string;severity:ReviewSeverity;issue:string;suggestion:string;adopted:boolean}):ReviewProblem { this.db.prepare('UPDATE review_problems SET position=?,severity=?,issue=?,suggestion=?,adopted=? WHERE id=?').run(input.position,input.severity,input.issue,input.suggestion,input.adopted?1:0,input.id); return this.getReviewProblem(input.id)! }
  private getReviewOpinion(id:string):ReviewOpinion|null { const row=this.db.prepare('SELECT * FROM review_opinions WHERE id=?').get(id) as unknown as ReviewOpinionRow|undefined; return row?this.mapReviewOpinion(row):null }
  private getReviewProblem(id:string):ReviewProblem|null { const row=this.db.prepare('SELECT * FROM review_problems WHERE id=?').get(id) as unknown as ReviewProblemRow|undefined; return row?mapReviewProblem(row):null }
  private mapReviewOpinion(row:ReviewOpinionRow):ReviewOpinion { return {id:row.id,taskId:row.task_id,roleId:row.role_id??undefined,roleName:row.role_name,providerId:row.provider_id??undefined,model:row.model??undefined,dimensions:parseJson<string[]>(row.dimensions_json,[]),overallSuggestion:row.overall_suggestion,rawXml:row.raw_xml,extractionMatched:Boolean(row.extraction_matched),createdAt:row.created_at,problems:(this.db.prepare('SELECT * FROM review_problems WHERE opinion_id=? ORDER BY created_at').all(row.id) as unknown as ReviewProblemRow[]).map(mapReviewProblem)} }
  private mapReviewTask(row:ReviewTaskRow):ReviewTask { return {id:row.id,articleId:row.article_id,roleIds:parseJson<string[]>(row.role_ids_json,[]),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,opinions:(this.db.prepare('SELECT * FROM review_opinions WHERE task_id=? ORDER BY created_at').all(row.id) as unknown as ReviewOpinionRow[]).map(item=>this.mapReviewOpinion(item))} }

  recordModelCall(input: {
    providerId: string
    model: string
    latencyMs: number
    promptTokens?: number
    completionTokens?: number
    success: boolean
    errorKind?: string
  }): void {
    this.db.prepare(`
      INSERT INTO model_calls (
        id, provider_id, model, modality, latency_ms, prompt_tokens,
        completion_tokens, success, error_kind, created_at
      ) VALUES (?, ?, ?, 'text', ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      input.providerId,
      input.model,
      input.latencyMs,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.success ? 1 : 0,
      input.errorKind ?? null,
      new Date().toISOString()
    )
  }

  createArtifactReference(input: CreateArtifactReferenceInput): ArtifactReference {
    const reference: ArtifactReference = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date().toISOString()
    }
    this.db.prepare(`
      INSERT INTO artifact_references (
        id, source_type, source_id, source_version_id, source_status_snapshot,
        target_type, target_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reference.id,
      reference.sourceType,
      reference.sourceId,
      reference.sourceVersionId,
      reference.sourceStatusSnapshot,
      reference.targetType,
      reference.targetId,
      reference.createdAt
    )
    return reference
  }

  listArtifactReferencesForTarget(targetType: string, targetId: string): ArtifactReference[] {
    const rows = this.db.prepare(`
      SELECT * FROM artifact_references
      WHERE target_type = ? AND target_id = ?
      ORDER BY created_at ASC
    `).all(targetType, targetId) as unknown as ArtifactReferenceRow[]
    return rows.map((row) => ({
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceVersionId: row.source_version_id,
      sourceStatusSnapshot: row.source_status_snapshot,
      targetType: row.target_type,
      targetId: row.target_id,
      createdAt: row.created_at
    }))
  }

  private getHotFavorite(id: string): HotFavorite | null {
    const row = this.db.prepare('SELECT * FROM hot_favorites WHERE id = ?')
      .get(id) as HotFavoriteRow | undefined
    return row ? this.mapHotFavorite(row) : null
  }

  private mapArticle(row: ArticleRow): Article {
    const versions = this.db.prepare('SELECT * FROM article_versions WHERE article_id=? ORDER BY version_number DESC').all(row.id) as unknown as ArticleVersionRow[]
    return {
      id: row.id, frameworkId: row.framework_id ?? undefined, accountId: row.account_id ?? undefined,
      materialIds: parseJson<string[]>(row.material_ids_json, []), manualOutline: row.manual_outline,
      status: row.status, currentVersionId: row.current_version_id, versionCount: Number(row.version_count),
      rawMarkdown: row.raw_markdown, providerId: row.provider_id ?? undefined, model: row.model ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
      versions: versions.map(mapArticleVersion),
      references: this.listArtifactReferencesForTarget('article', row.id)
    }
  }

  private ensureTopicSchema(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM topic_schema_fields').get() as {
      count: number
    }).count
    if (!count) this.saveTopicSchema(createDefaultTopicSchema())
  }

  private ensureSearchService(): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT OR IGNORE INTO search_services(id, display_name, enabled, created_at, updated_at)
      VALUES ('doubao-custom', '豆包搜索 Custom 版', 1, ?, ?)
    `).run(now, now)
  }
  private ensureWechatPublishChannel():void { const now=new Date().toISOString();this.db.prepare("INSERT OR IGNORE INTO publish_channels(id,display_name,app_id,enabled,created_at,updated_at) VALUES('wechat-official','微信公众号','',0,?,?)").run(now,now) }
  private ensureFrameworkTemplate(): void {
    const now=new Date().toISOString()
    this.db.prepare(`INSERT OR IGNORE INTO framework_templates(id,name,sections_json,is_default,is_system,created_at,updated_at) VALUES('system-default','默认三论点框架',?,1,1,?,?)`).run(JSON.stringify(['标题','开头','论点一','论点二','论点三','结尾']),now,now)
  }

  private getMaterial(id: string): Material | null {
    const row = this.db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as MaterialRow | undefined
    return row ? mapMaterial(row) : null
  }

  private mapTopic(row: TopicRow): Topic {
    const versionRows = this.db.prepare(`
      SELECT * FROM topic_versions WHERE topic_id = ? ORDER BY version_number DESC
    `).all(row.id) as unknown as TopicVersionRow[]
    return {
      id: row.id,
      seedKeyword: row.seed_keyword,
      accountIds: parseJson<string[]>(row.account_ids_json, []),
      relatedHotIds: parseJson<string[]>(row.related_hot_ids_json, []),
      status: row.status,
      isInLibrary: Boolean(row.is_in_library),
      currentVersionId: row.current_version_id,
      versionCount: Number(row.version_count),
      fields: parseJson<Record<string, string>>(row.fields_json, {}),
      providerId: row.provider_id ?? undefined,
      model: row.model ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      versions: versionRows.map((version) => ({
        id: version.id,
        topicId: version.topic_id,
        versionNumber: version.version_number,
        source: version.source,
        providerId: version.provider_id ?? undefined,
        model: version.model ?? undefined,
        fields: parseJson<Record<string, string>>(version.fields_json, {}),
        createdAt: version.created_at
      })),
      references: this.listArtifactReferencesForTarget('topic', row.id)
    }
  }

  private mapHotFavorite(row: HotFavoriteRow): HotFavorite {
    const tags = this.db.prepare(`
      SELECT tag FROM hot_favorite_tags WHERE favorite_id = ? ORDER BY created_at ASC
    `).all(row.id) as unknown as Array<{ tag: HotFavoriteTag }>
    return {
      id: row.id,
      hotItem: {
        id: row.source_item_id,
        title: row.title,
        desc: row.description,
        pic: row.picture_url ?? undefined,
        url: row.source_url,
        source: row.source,
        sourceTitle: row.source_title,
        subtitle: row.subtitle,
        updateTime: row.source_updated_at,
        hotValue: row.hot_value ?? undefined,
        rank: row.source_rank,
        rawJson: row.raw_json
      },
      tags: tags.map((item) => item.tag),
      accountId: row.account_id ?? undefined,
      status: row.status,
      createdAt: row.created_at
    }
  }

  private replaceFavoriteTags(id: string, tags: HotFavoriteTag[], now: string): void {
    this.db.prepare('DELETE FROM hot_favorite_tags WHERE favorite_id = ?').run(id)
    const insert = this.db.prepare(`
      INSERT INTO hot_favorite_tags(favorite_id, tag, created_at) VALUES (?, ?, ?)
    `)
    for (const tag of tags) insert.run(id, tag, now)
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const result = operation()
      this.db.exec('COMMIT;')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK;')
      throw error
    }
  }
}

function mapProvider(row: ProviderRow, models: ProviderModel[]): ProviderSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    enabled: Boolean(row.enabled),
    isRelay: Boolean(row.is_relay),
    capabilities: parseJson<CapabilityFlags>(row.capabilities_json, {
      chat: true,
      jsonMode: false,
      streaming: false,
      vision: false,
      image: false
    }),
    models,
    hasApiKey: Boolean(row.has_api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapAccountSummary(row: AccountSummaryRow): AccountProfileSummary {
  return {
    id: row.id,
    name: row.name,
    intro: row.intro,
    domain: row.domain,
    status: row.status,
    isCurrent: Boolean(row.is_current),
    versionCount: Number(row.version_count),
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

function fieldValue(fields: AccountField[], name: string): string {
  return fields.find((field) => field.name.trim() === name)?.value.trim() ?? ''
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeProviderModels(
  inputModels: SaveProviderModelInput[] | undefined,
  fallbackModel: string
): SaveProviderModelInput[] {
  const source = inputModels?.length
    ? inputModels
    : [{
        modelId: fallbackModel,
        displayName: fallbackModel,
        reasoningVariants: [],
        isDefault: true,
        enabled: true
      }]
  const normalized = source.map((model) => ({
    ...model,
    modelId: model.modelId.trim(),
    displayName: model.displayName.trim() || model.modelId.trim(),
    contextLimit: positiveIntegerOrUndefined(model.contextLimit),
    outputLimit: positiveIntegerOrUndefined(model.outputLimit),
    reasoningVariants: [...new Set(model.reasoningVariants.map((item) => item.trim()).filter(Boolean))]
  }))
  const defaultIndex = normalized.findIndex((model) => model.isDefault && model.enabled)
  const fallbackIndex = normalized.findIndex((model) => model.enabled)
  if (defaultIndex < 0 && fallbackIndex >= 0) normalized[fallbackIndex].isDefault = true
  normalized.forEach((model, index) => {
    model.isDefault = index === (defaultIndex >= 0 ? defaultIndex : fallbackIndex)
  })
  return normalized
}

function positiveIntegerOrUndefined(value: number | undefined): number | undefined {
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function normalizeFavoriteTags(tags: HotFavoriteTag[]): HotFavoriteTag[] {
  const allowed = new Set<HotFavoriteTag>(['待选题', '已用'])
  return [...new Set(tags)].filter((tag) => allowed.has(tag))
}

function mapMaterial(row: MaterialRow): Material {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    externalId: row.external_id ?? undefined,
    title: row.title,
    summary: row.summary,
    sourceUrl: row.source_url ?? undefined,
    sourceName: row.source_name ?? undefined,
    sourceNote: row.source_note ?? undefined,
    query: row.query ?? undefined,
    relatedTopicId: row.related_topic_id ?? undefined,
    publishedAt: row.published_at ?? undefined,
    authority: row.authority ?? undefined,
    relevanceScore: row.relevance_score ?? undefined,
    imageUrl: row.image_url ?? undefined,
    imageWidth: row.image_width ?? undefined,
    imageHeight: row.image_height ?? undefined,
    imageShape: row.image_shape ?? undefined,
    watermark: row.watermark ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapFrameworkTemplate(row: FrameworkTemplateRow): FrameworkTemplate {
  return {
    id: row.id,
    name: row.name,
    sections: parseJson<string[]>(row.sections_json, []),
    isDefault: Boolean(row.is_default),
    isSystem: Boolean(row.is_system),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapFramework(row: FrameworkRow): Omit<Framework, 'references'> {
  return {
    id: row.id,
    topicId: row.topic_id ?? undefined,
    accountId: row.account_id ?? undefined,
    materialIds: parseJson<string[]>(row.material_ids_json, []),
    templateId: row.template_id ?? undefined,
    manualTopic: row.manual_topic,
    status: row.status,
    currentVersionId: row.current_version_id,
    isCurrent: true,
    versionCount: Number(row.version_count),
    sections: parseJson<FrameworkSection[]>(row.sections_json, []),
    rawXml: row.raw_xml,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapArticleVersion(row: ArticleVersionRow): ArticleVersion {
  return {
    id: row.id,
    articleId: row.article_id,
    versionNumber: row.version_number,
    source: row.source,
    instruction: row.instruction ?? undefined,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    rawMarkdown: row.raw_markdown,
    createdAt: row.created_at
  }
}
function mapReviewRole(row:ReviewRoleRow):ReviewRole { return {id:row.id,name:row.name,systemPrompt:row.system_prompt,providerId:row.provider_id??undefined,model:row.model??undefined,extractionTag:row.extraction_tag,extractionOccurrence:row.extraction_occurrence,dimensions:parseJson<string[]>(row.dimensions_json,[]),sortOrder:row.sort_order,createdAt:row.created_at,updatedAt:row.updated_at} }
function mapReviewProblem(row:ReviewProblemRow):ReviewProblem { return {id:row.id,position:row.position,severity:row.severity,issue:row.issue,suggestion:row.suggestion,adopted:Boolean(row.adopted),isManual:Boolean(row.is_manual)} }
function mapVisualPack(row:VisualPackRow):VisualPack { return {id:row.id,articleId:row.article_id,articleVersionId:row.article_version_id,articleStatusSnapshot:row.article_status_snapshot,providerId:row.provider_id,model:row.model,cover:parseJson(row.cover_json,{visual:'',prompt:'',overlayText:''}),inlineImages:parseJson(row.inline_images_json,[]),releaseImages:parseJson(row.release_images_json,[]),rawXml:row.raw_xml,createdAt:row.created_at} }
function mapArticleLayout(row:ArticleLayoutRow):ArticleLayout { return {id:row.id,articleId:row.article_id,articleVersionId:row.article_version_id,articleStatusSnapshot:row.article_status_snapshot,platform:row.platform,title:row.title,html:row.html,plainText:row.plain_text,createdAt:row.created_at} }
function mapWechatChannel(row:WechatChannelRow):WechatPublishChannel { return {id:row.id,displayName:row.display_name,appId:row.app_id,enabled:Boolean(row.enabled),hasAppSecret:Boolean(row.has_app_secret),updatedAt:row.updated_at} }
function mapPublication(row:PublicationRow):Publication { return {id:row.id,articleId:row.article_id,articleVersionId:row.article_version_id,layoutId:row.layout_id,channelId:row.channel_id,externalDraftId:row.external_draft_id??undefined,status:row.status,title:row.title,thumbMediaId:row.thumb_media_id,publishedUrl:row.published_url??undefined,errorMessage:row.error_message??undefined,createdAt:row.created_at,updatedAt:row.updated_at} }

function serializeFrameworkXml(sections: FrameworkSection[]): string {
  const body = sections.map((section) => (
    `<${escapeXml(section.name)}>${escapeXml(section.content)}</${escapeXml(section.name)}>`
  )).join('\n')
  return `<框架>\n${body}\n</框架>`
}
