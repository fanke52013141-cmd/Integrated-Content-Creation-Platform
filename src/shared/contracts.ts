export type ProviderProtocol = 'openai-compatible'

export interface PromptDefSummary {
  key: string
  title: string
  description: string
  activeContent: string
  activeVersion: number
  versionCount: number
  updatedAt: string
}

export interface PromptVersionInfo {
  id: string
  version: number
  content: string
  source: 'builtin' | 'user'
  note: string
  createdAt: string
}

export interface PromptDefBase {
  key: string
  title: string
  description: string
  template: string
}

export interface CapabilityFlags {
  chat: boolean
  jsonMode: boolean
  streaming: boolean
  vision: boolean
  image: boolean
}

export interface ProviderModel {
  id: string
  providerId: string
  modelId: string
  displayName: string
  contextLimit?: number
  outputLimit?: number
  reasoningVariants: string[]
  isDefault: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SaveProviderModelInput {
  id?: string
  modelId: string
  displayName: string
  contextLimit?: number
  outputLimit?: number
  reasoningVariants: string[]
  isDefault: boolean
  enabled: boolean
}

export type ProviderTestStatus = 'success' | 'failure'
/** 连通性验证状态：与"配置已保存"严格区分，避免用已保存冒充已连通 */
export interface ProviderVerification {
  /** 是否已保存访问密钥 */
  configured: boolean
  /** 最近一次验证结果，undefined 表示从未验证 */
  lastTestStatus?: ProviderTestStatus
  lastTestAt?: string
  lastTestError?: string
  /** 密钥就绪 + 最近一次验证成功 + 之后配置未改动 */
  verified: boolean
  /** 验证成功之后又修改过配置，需要重新验证 */
  stale: boolean
}

export interface ProviderSummary {
  id: string
  displayName: string
  protocol: ProviderProtocol
  baseUrl: string
  defaultModel: string
  enabled: boolean
  isRelay: boolean
  capabilities: CapabilityFlags
  models: ProviderModel[]
  hasApiKey: boolean
  verification: ProviderVerification
  createdAt: string
  updatedAt: string
}

export interface SaveProviderInput {
  id?: string
  displayName: string
  protocol: ProviderProtocol
  baseUrl: string
  defaultModel: string
  enabled: boolean
  isRelay: boolean
  capabilities: CapabilityFlags
  models: SaveProviderModelInput[]
  apiKey?: string
}

export interface ProviderPreset {
  id: string
  displayName: string
  baseUrl: string
  defaultModel: string
  capabilities: CapabilityFlags
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  model?: string
  message: string
}

/** 保存前使用表单中的配置直接测试连接（不落库） */
export interface ProviderDraftTestInput {
  /** 已保存连接的 id；提供且未填写新密钥时复用已加密保存的密钥 */
  id?: string
  baseUrl: string
  apiKey?: string
  model?: string
}

/** 单条模型调用日志（含测试连接产生的记录） */
export interface ModelCallLog {
  id: string
  providerId?: string
  model: string
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  success: boolean
  errorKind?: string
  errorMessage?: string
  createdAt: string
}

export interface SearchServiceSummary {
  id: 'doubao-custom'
  displayName: string
  enabled: boolean
  hasApiKey: boolean
  updatedAt: string
}

export interface SaveSearchServiceInput {
  apiKey?: string
  enabled: boolean
}

export interface SearchServiceTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export type AccountStatus = 'draft' | 'locked'

/** 字段来源标注（借鉴 Easel 画像的「可审计来源」） */
export type AccountFieldSource = 'user' | 'ai' | 'restore'

export interface AccountField {
  id: string
  name: string
  value: string
  isDefault: boolean
  /** 该字段值的来源；缺省视为 user */
  source?: AccountFieldSource
}

/** 偏好红线（全阶段强制注入生成 prompt） */
export type AccountRedlineKind = 'do' | 'dont' | 'compliance'

export interface AccountRedline {
  id: string
  profileId: string
  kind: AccountRedlineKind
  content: string
  createdAt: string
}

/** 账号在各平台的身份绑定（画像 × 平台 × 账号名） */
export interface AccountPlatformBinding {
  id: string
  profileId: string
  platform: string
  handle: string
  note: string
  createdAt: string
}

/** 账号长期记忆条目（append-only + 内容哈希去重） */
export interface AccountMemory {
  id: string
  profileId: string
  memoryDate: string
  source: string
  insight: string
  action: string
  createdAt: string
}

export interface AddAccountMemoryResult {
  memory: AccountMemory | null
  created: boolean
}

export interface WizardAnswer {
  questionId: string
  question: string
  answer: string
}

export interface AccountVersion {
  id: string
  profileId: string
  versionNumber: number
  source: 'ai' | 'manual' | 'restore'
  providerId?: string
  model?: string
  fields: AccountField[]
  wizardAnswers: WizardAnswer[]
  createdAt: string
}

export interface AccountProfileSummary {
  id: string
  name: string
  intro: string
  domain: string
  status: AccountStatus
  isCurrent: boolean
  versionCount: number
  /** 定位完整度：非空默认字段占比（0-100） */
  completeness: number
  createdAt: string
  updatedAt: string
}

export interface AccountProfile extends AccountProfileSummary {
  currentVersionId: string
  fields: AccountField[]
  wizardAnswers: WizardAnswer[]
  versions: AccountVersion[]
  redlines: AccountRedline[]
  platformAccounts: AccountPlatformBinding[]
  memories: AccountMemory[]
}

export interface GenerateAccountInput {
  providerId: string
  model?: string
  answers: WizardAnswer[]
  extraContext?: string
}

export interface GenerateAccountResult {
  fields: AccountField[]
  providerId: string
  model: string
  rawContent: string
  latencyMs: number
}

export interface SaveAccountInput {
  id?: string
  fields: AccountField[]
  wizardAnswers: WizardAnswer[]
  status: AccountStatus
  source: 'ai' | 'manual' | 'restore'
  providerId?: string
  model?: string
}

export interface RestoreVersionInput {
  profileId: string
  versionId: string
}

export interface AddAccountRedlineInput {
  profileId: string
  kind: AccountRedlineKind
  content: string
}

export interface AddAccountPlatformInput {
  profileId: string
  platform: string
  handle: string
  note?: string
}

export interface AddAccountMemoryInput {
  profileId: string
  insight: string
  action?: string
  /** 来源标签，如「发布复盘」「用户自述」 */
  source?: string
  /** 记忆所属日期，缺省今天 */
  memoryDate?: string
}

export interface ArtifactReference {
  id: string
  sourceType: string
  sourceId: string
  sourceVersionId: string
  sourceStatusSnapshot: AccountStatus
  targetType: string
  targetId: string
  createdAt: string
}

export interface CreateArtifactReferenceInput {
  sourceType: string
  sourceId: string
  sourceVersionId: string
  sourceStatusSnapshot: AccountStatus
  targetType: string
  targetId: string
}

export type HotServiceState = 'starting' | 'ready' | 'error'

export interface HotServiceStatus {
  mode: 'embedded'
  state: HotServiceState
  version: string
  routeCount: number
  warning?: string
}

export interface HotSource {
  id: string
  path: string
  displayName: string
}

export interface HotItem {
  id: string
  title: string
  desc: string
  pic?: string
  url: string
  source: string
  sourceTitle: string
  subtitle: string
  updateTime: string
  hotValue?: string
  rank: number
  rawJson: string
}

export interface HotSourceResult {
  source: HotSource
  status: 'ready' | 'error'
  subtitle: string
  updateTime: string
  items: HotItem[]
  error?: string
}

export interface HotspotBootstrap {
  service: HotServiceStatus
  sources: HotSource[]
  preferences: HotSourcePreference[]
}

export interface HotSourcePreference {
  sourceId: string
  hidden: boolean
  sortOrder: number
  updatedAt: string
}

export interface SaveHotSourcePreferencesInput {
  preferences: Array<{
    sourceId: string
    hidden: boolean
    sortOrder: number
  }>
}

export type HotFavoriteTag = '待选题' | '已用'
export type HotFavoriteStatus = 'active' | 'archived'

export interface HotFavorite {
  id: string
  hotItem: HotItem
  tags: HotFavoriteTag[]
  accountId?: string
  status: HotFavoriteStatus
  createdAt: string
}

export interface AddHotFavoriteInput {
  hotItem: HotItem
  accountId?: string
  tags?: HotFavoriteTag[]
}

export interface AddHotFavoriteResult {
  favorite: HotFavorite
  created: boolean
}

export interface WeiboSessionStatus {
  configured: boolean
  updatedAt?: string
}

export interface UpdateHotFavoriteTagsInput {
  id: string
  tags: HotFavoriteTag[]
}

export type HotspotFit = 'high' | 'medium' | 'low'

export interface FilterHotspotsInput {
  accountId: string
  providerId: string
  model: string
  items: HotItem[]
}

export interface HotspotFilterAssessment {
  hotItem: HotItem
  fit: HotspotFit
  reason: string
  angle: string
}

export interface FilterHotspotsResult {
  accountId: string
  accountVersionId: string
  providerId: string
  model: string
  latencyMs: number
  assessments: HotspotFilterAssessment[]
}

export type TopicStatus = 'draft' | 'locked'
export type TopicVersionSource = 'ai' | 'manual' | 'restore'

export interface TopicSchemaField {
  id: string
  name: string
  required: boolean
  sortOrder: number
}

export interface TopicVersion {
  id: string
  topicId: string
  versionNumber: number
  source: TopicVersionSource
  providerId?: string
  model?: string
  fields: Record<string, string>
  createdAt: string
}

export interface Topic {
  id: string
  seedKeyword: string
  accountIds: string[]
  relatedHotIds: string[]
  status: TopicStatus
  isInLibrary: boolean
  currentVersionId: string
  versionCount: number
  fields: Record<string, string>
  providerId?: string
  model?: string
  createdAt: string
  updatedAt: string
  versions: TopicVersion[]
  references: ArtifactReference[]
}

export interface SaveTopicInput {
  id?: string
  seedKeyword: string
  accountIds: string[]
  relatedHotIds: string[]
  status: TopicStatus
  source: TopicVersionSource
  fields: Record<string, string>
  providerId?: string
  model?: string
}

export interface GenerateTopicsInput {
  accountId: string
  providerId: string
  model: string
  seedKeyword: string
  relatedHotFavoriteIds: string[]
  count: number
}

export interface GenerateTopicsResult {
  topics: Topic[]
  failed: Array<{ index: number; message: string }>
}

export type MaterialKind = 'web' | 'image' | 'text'
export type MaterialOrigin = 'doubao_web' | 'doubao_image' | 'manual_text' | 'file_upload'

export interface Material {
  id: string
  kind: MaterialKind
  origin: MaterialOrigin
  externalId?: string
  title: string
  summary: string
  sourceUrl?: string
  sourceName?: string
  sourceNote?: string
  query?: string
  relatedTopicId?: string
  publishedAt?: string
  authority?: string
  relevanceScore?: number
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  imageShape?: string
  watermark?: string
  createdAt: string
  updatedAt: string
}

export interface SaveManualMaterialInput {
  title: string
  summary: string
  sourceUrl?: string
  sourceNote?: string
  relatedTopicId?: string
}

export interface MaterialSearchInput {
  query: string
  type: 'web' | 'image'
  count?: number
  timeRange?: 'OneDay' | 'OneWeek' | 'OneMonth' | 'OneYear' | string
  sites?: string
  authorityOnly?: boolean
}

export interface MaterialSearchWebResult {
  id: string
  title: string
  summary: string
  snippet: string
  sourceUrl: string
  sourceName?: string
  publishedAt?: string
  authority?: string
  relevanceScore?: number
}

export interface MaterialSearchImageResult {
  id: string
  title: string
  sourceUrl: string
  sourceName?: string
  publishedAt?: string
  imageUrl: string
  imageWidth?: number
  imageHeight?: number
  imageShape?: string
  watermark?: string
}

export interface MaterialSearchResult {
  query: string
  type: 'web' | 'image'
  results: MaterialSearchWebResult[] | MaterialSearchImageResult[]
  latencyMs: number
  requestId?: string
  logId?: string
}

export interface AddSearchMaterialInput {
  result: MaterialSearchWebResult | MaterialSearchImageResult
  query: string
  relatedTopicId?: string
}

/** 上传文档作为素材（本地解析，txt/md/pdf/docx） */
export interface AddFileMaterialInput {
  fileName: string
  data: ArrayBuffer
  relatedTopicId?: string
}

export type FrameworkStatus = 'draft' | 'locked'
export interface FrameworkTemplate { id: string; name: string; sections: string[]; isDefault: boolean; isSystem: boolean; createdAt: string; updatedAt: string }
export interface FrameworkSection { name: string; content: string }
export interface Framework { id: string; topicId?: string; accountId?: string; materialIds: string[]; templateId?: string; manualTopic: string; status: FrameworkStatus; currentVersionId: string; isCurrent: boolean; versionCount: number; sections: FrameworkSection[]; rawXml: string; providerId?: string; model?: string; createdAt: string; updatedAt: string; references: ArtifactReference[] }
export interface GenerateFrameworksInput { topicId?: string; accountId?: string; materialIds: string[]; templateId: string; manualTopic?: string; providerId: string; model: string; count: number }
export interface GenerateFrameworksResult { frameworks: Framework[]; failed: Array<{ index: number; message: string }> }
export interface SaveFrameworkInput { id?: string; topicId?: string; accountId?: string; materialIds: string[]; templateId?: string; manualTopic: string; status: FrameworkStatus; sections: FrameworkSection[]; providerId?: string; model?: string }
export interface SaveFrameworkTemplateInput { id?: string; name: string; sections: string[]; isDefault: boolean }

export type ArticleStatus = 'draft' | 'locked'
export type ArticleVersionSource = 'generate' | 'revise' | 'manual' | 'restore'
export interface ArticleVersion { id: string; articleId: string; versionNumber: number; source: ArticleVersionSource; instruction?: string; providerId?: string; model?: string; label?: string; rawMarkdown: string; createdAt: string }
export interface Article { id: string; frameworkId?: string; accountId?: string; materialIds: string[]; manualOutline: string; status: ArticleStatus; currentVersionId: string; versionCount: number; rawMarkdown: string; providerId?: string; model?: string; createdAt: string; updatedAt: string; versions: ArticleVersion[]; references: ArtifactReference[] }
export type AccountSelection = { mode: 'inherit' } | { mode: 'none' } | { mode: 'specific'; accountId: string }
export interface GenerateArticlesInput { frameworkId?: string; accountId?: string; accountSelection?: AccountSelection; materialIds: string[]; manualOutline?: string; providerId: string; model: string; count: number }
export interface GenerateArticlesResult { articles: Article[]; failed: Array<{ index: number; message: string }> }
export interface ReviseArticleInput { articleId: string; instruction: string; alignFramework: boolean; providerId: string; model: string; count: number; baseMarkdown?: string; expectedVersionId?: string; draftRevision?: number }
export interface ReviseArticleResult { articles: Article[]; failed: Array<{ index: number; message: string }> }
export interface SaveArticleInput { id?: string; frameworkId?: string; accountId?: string; materialIds: string[]; manualOutline: string; status: ArticleStatus; rawMarkdown: string; source: ArticleVersionSource; instruction?: string; providerId?: string; model?: string; expectedVersionId?: string; draftRevision?: number }
export interface WorkDraft { articleId: string; baseVersionId: string; content: string; revision: number; updatedAt: string }
export interface SaveWorkDraftInput { articleId: string; baseVersionId: string; content: string; expectedRevision?: number }
export type ArticleSummary = Omit<Article, 'versions' | 'references'> & { title: string; hasWorkDraft: boolean; layoutStale: boolean; publicationStatus?: PublicationStatus }
export interface ArticleListQuery { offset?: number; limit?: number; search?: string; status?: ArticleStatus; accountId?: string; dirtyOnly?: boolean }
export interface ArticleListResult { items: ArticleSummary[]; total: number }
export interface RestoreArticleVersionInput { articleId: string; versionId: string }
export interface RenameArticleVersionInput { articleId: string; versionId: string; label: string }
export type ReviewSeverity = 'high' | 'medium' | 'low'
export interface ReviewRole { id: string; name: string; systemPrompt: string; providerId?: string; model?: string; extractionTag: string; extractionOccurrence: 'first' | 'last'; dimensions: string[]; sortOrder: number; createdAt: string; updatedAt: string }
export interface ReviewProblem { id: string; position: string; severity: ReviewSeverity; issue: string; suggestion: string; adopted: boolean; isManual: boolean }
export interface ReviewOpinion { id: string; taskId: string; roleId?: string; roleName: string; providerId?: string; model?: string; dimensions: string[]; problems: ReviewProblem[]; overallSuggestion: string; rawXml: string; extractionMatched: boolean; createdAt: string }
export type ReviewTaskStatus = 'running' | 'completed' | 'partial' | 'failed' | 'applied'
export interface ReviewFailure { roleId: string; roleName: string; message: string }
export interface ReviewTask { id: string; articleId: string; articleVersionId: string; articleVersionNumber: number; roleIds: string[]; status: ReviewTaskStatus; failures: ReviewFailure[]; createdAt: string; updatedAt: string; opinions: ReviewOpinion[] }
export interface SaveReviewRoleInput { id?: string; name: string; systemPrompt: string; providerId?: string; model?: string; extractionTag: string; extractionOccurrence: 'first' | 'last'; dimensions: string[]; sortOrder: number }
export interface StartReviewInput { articleId: string; roleIds: string[]; fallbackProviderId: string; fallbackModel: string }
export interface StartReviewResult { task: ReviewTask; failed: ReviewFailure[] }
export interface UpdateReviewProblemInput { id: string; position: string; severity: ReviewSeverity; issue: string; suggestion: string; adopted: boolean }
export interface AddManualReviewProblemInput { taskId: string; position: string; severity: ReviewSeverity; issue: string; suggestion: string }

export interface VisualCover { visual: string; prompt: string; overlayText: string }
export interface VisualPrompt { location: string; purpose: string; ratio: string; prompt: string; alt: string }
export interface VisualPack { id: string; articleId: string; articleVersionId: string; articleStatusSnapshot: ArticleStatus; providerId: string; model: string; cover: VisualCover; inlineImages: VisualPrompt[]; releaseImages: VisualPrompt[]; rawXml: string; createdAt: string }
export interface GenerateVisualPackInput { articleId: string; providerId: string; model: string; inlineCount: number }

/** 视觉包下的一张具体图片资产（AI 生成或本地导入） */
export type VisualAssetKind = 'cover' | 'inline' | 'release'
export interface VisualAsset {
  id: string
  packId: string
  kind: VisualAssetKind
  /** 槽位序号：cover 固定 0，inline/release 为第几张（0-based） */
  slot: number
  /** 生成/导入时使用的提示词 */
  prompt: string
  /** 相对图片目录的文件名，通过 moliu-asset:// 协议访问 */
  fileName: string
  /** 可直接用于 <img src> 的地址 */
  url: string
  source: 'generated' | 'imported'
  providerId?: string
  model?: string
  size?: string
  /** 上传微信公众号素材库后回填的 media_id */
  wechatMediaId?: string
  wechatUploadedAt?: string
  createdAt: string
}
export interface GenerateVisualAssetInput { packId: string; kind: VisualAssetKind; slot?: number; prompt: string; providerId: string; model: string; size?: string }
export interface ImportVisualAssetInput { packId: string; kind: VisualAssetKind; slot?: number; prompt: string; filePath: string }
/** 渲染层直接上传文件内容（沙箱下拿不到本地路径） */
export interface ImportVisualAssetDataInput { packId: string; kind: VisualAssetKind; slot?: number; prompt: string; fileName: string; data: ArrayBuffer }
export type LayoutPlatform = 'wechat' | 'xiaohongshu' | 'web'
export interface ArticleLayout { id: string; articleId: string; articleVersionId: string; articleStatusSnapshot: ArticleStatus; platform: LayoutPlatform; title: string; html: string; plainText: string; themeId?: string; createdAt: string }
export interface CreateArticleLayoutInput { articleId: string; platform: LayoutPlatform; themeId?: string; /** 自定义主题 CSS（themeId='custom' 时生效，建议选择器以 .mly-body 开头） */ customCss?: string }
/** 排版主题元信息（完整 CSS 在主进程，不经 IPC 传输） */
export interface LayoutThemeInfo { id: string; name: string; description: string; accent: string }
export const CUSTOM_LAYOUT_THEME_ID = 'custom'
export interface WechatPublishChannel { id: 'wechat-official'; displayName: string; appId: string; enabled: boolean; hasAppSecret: boolean; updatedAt: string; lastTestStatus?: 'success' | 'failure'; lastTestAt?: string; lastTestError?: string }
export interface SaveWechatPublishChannelInput { appId: string; appSecret?: string; enabled: boolean }
export type PublicationStatus = 'draft' | 'published' | 'failed' | 'unknown'
export interface PublicationSnapshot { appId: string; html: string; input: PushWechatDraftInput }
export interface Publication { id: string; articleId: string; articleVersionId: string; layoutId: string; channelId: 'wechat-official'; externalDraftId?: string; status: PublicationStatus; title: string; thumbMediaId: string; publishedUrl?: string; errorMessage?: string; retro?: PublicationRetro; createdAt: string; updatedAt: string; snapshot?: PublicationSnapshot }
export interface PushWechatDraftInput { articleId: string; layoutId: string; thumbMediaId?: string; coverAssetId?: string; author?: string; digest?: string; contentSourceUrl?: string; appId?: string }
export interface PublishFormDraft { articleId: string; layoutId: string; appId: string; coverAssetId: string; thumbMediaId: string; author: string; digest: string; contentSourceUrl: string }
export interface DeliveryCheck { ready: boolean; issues: string[]; localImageCount: number; title: string; articleVersionNumber: number; appId: string }
export interface UpdatePublicationInput { id: string; status: 'published'; publishedUrl: string }
/** 发布复盘：人工记录「目标 / 结果 / 经验」，用来喂给账号记忆 */
export interface PublicationRetro { goal: string; result: string; lesson: string; updatedAt: string }
export interface SavePublicationRetroInput { id: string; goal: string; result: string; lesson: string }

export interface AppBootstrap {
  providers: ProviderSummary[]
  searchService: SearchServiceSummary
  accounts: AccountProfileSummary[]
  currentAccountId?: string
}

/** AI 文本生成流式事件（逐 token 推送） */
export interface StreamEvent {
  /** start=开始生成, delta=增量文本, complete=单篇完成, error=失败 */
  phase: 'start' | 'delta' | 'complete' | 'error'
  /** 当前文章在批次中的序号（0-based） */
  index: number
  /** 批次总数 */
  total: number
  /** 增量文本（仅 phase=delta） */
  delta?: string
  /** 错误信息（仅 phase=error） */
  message?: string
}

/** AI 生成所属模块，主进程按此互斥与记台账 */
export type GenerationDomain =
  | 'account'
  | 'hotspot-filter'
  | 'topics'
  | 'frameworks'
  | 'articles'
  | 'reviews'
  | 'visuals'

/** 模块中文标签：顶栏提示、跨页面通知与任务中心共用一份口径 */
export const GENERATION_DOMAIN_LABELS: Record<GenerationDomain, string> = {
  account: '账号定位',
  'hotspot-filter': '热点筛选',
  topics: '选题',
  frameworks: '框架',
  articles: '文章',
  reviews: '评审',
  visuals: '配图'
}

/** 生成任务生命周期事件（主进程广播，供全局任务指示使用） */
export interface GenerationEvent {
  id: string
  domain: GenerationDomain
  status: 'started' | 'done' | 'failed'
  outcome?: GenerationTask['status']
  message?: string
  at: string
}

/** 任务台账里的一条历史记录，跨页面与重启后仍可回看 */
export interface GenerationTask {
  id: string
  domain: GenerationDomain
  label: string
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
  detail: string
  startedAt: string
  finishedAt?: string
  articleId?: string
  resultIds?: string[]
}

/** 本地导出/备份的返回：path 为 null 表示用户取消 */
export interface LocalFileResult {
  path: string | null
}

export interface MoliuApi {
  app: {
    bootstrap(): Promise<AppBootstrap>
    getDataPath(): Promise<string>
    /** 受控打开系统浏览器：主进程只放行 http/https，渲染层不自建窗口 */
    openExternal(url: string): Promise<boolean>
    /** 导出成品到本地：Markdown 或图片内嵌的单文件 HTML，离线可读 */
    exportArticle(input: { articleId: string; format: 'markdown' | 'html'; targetDir?: string }): Promise<LocalFileResult>
    exportLayout(input: { layoutId: string; targetDir?: string }): Promise<LocalFileResult>
    /** 整库备份：数据库快照 + 图片目录 + 校验清单 */
    createBackup(input?: { targetDir?: string }): Promise<{ path: string; checksum: string }>
    restoreBackup(input: { bundleDir: string }): Promise<{ restoredImages: number }>
    listBackups(): Promise<string[]>
  }
  /** 主进程受控剪贴板：一次写入 HTML + 纯文本，粘贴到公众号编辑器时保留样式 */
  clipboard: {
    writeRichText(html: string, text: string): Promise<boolean>
  }
  /** 生成任务：按模块互斥、可取消，并提供全局生命周期事件与历史台账 */
  generation: {
    cancel(domain: GenerationDomain): Promise<{ cancelled: boolean }>
    active(): Promise<GenerationDomain[]>
    list(limit?: number): Promise<GenerationTask[]>
    /** 订阅生成任务 started/done/failed 事件（跨页面提示用） */
    events(callback: (event: GenerationEvent) => void): () => void
  }
  providers: {
    presets(): Promise<ProviderPreset[]>
    list(): Promise<ProviderSummary[]>
    save(input: SaveProviderInput): Promise<ProviderSummary>
    remove(id: string): Promise<void>
    test(id: string): Promise<ProviderTestResult>
    /** 保存前用表单配置测试连接 */
    testDraft(input: ProviderDraftTestInput): Promise<ProviderTestResult>
    /** 查询模型调用日志；providerId 省略时返回全部 */
    logs(providerId?: string): Promise<ModelCallLog[]>
  }
  searchService: {
    get(): Promise<SearchServiceSummary>
    save(input: SaveSearchServiceInput): Promise<SearchServiceSummary>
    test(): Promise<SearchServiceTestResult>
  }
  prompts: {
    list(): Promise<PromptDefSummary[]>
    listVersions(key: string): Promise<PromptVersionInfo[]>
    update(input: { key: string; content: string; note?: string }): Promise<number>
    restore(input: { key: string; version: number }): Promise<number>
    reset(key: string): Promise<number>
  }
  accounts: {
    list(): Promise<AccountProfileSummary[]>
    get(id: string): Promise<AccountProfile | null>
    generate(input: GenerateAccountInput): Promise<GenerateAccountResult>
    save(input: SaveAccountInput): Promise<AccountProfile>
    setCurrent(id: string): Promise<void>
    setLocked(id: string, locked: boolean): Promise<AccountProfile>
    restore(input: RestoreVersionInput): Promise<AccountProfile>
    remove(id: string): Promise<void>
    listRedlines(profileId: string): Promise<AccountRedline[]>
    addRedline(input: AddAccountRedlineInput): Promise<AccountRedline>
    removeRedline(id: string): Promise<void>
    listPlatformAccounts(profileId: string): Promise<AccountPlatformBinding[]>
    addPlatformAccount(input: AddAccountPlatformInput): Promise<AccountPlatformBinding>
    removePlatformAccount(id: string): Promise<void>
    listMemories(profileId: string): Promise<AccountMemory[]>
    addMemory(input: AddAccountMemoryInput): Promise<AddAccountMemoryResult>
    removeMemory(id: string): Promise<void>
  }
  hotspots: {
    bootstrap(): Promise<HotspotBootstrap>
    saveSourcePreferences(input: SaveHotSourcePreferencesInput): Promise<HotSourcePreference[]>
    refresh(sourceIds?: string[]): Promise<HotSourceResult[]>
    listFavorites(): Promise<HotFavorite[]>
    addFavorite(input: AddHotFavoriteInput): Promise<AddHotFavoriteResult>
    updateFavoriteTags(input: UpdateHotFavoriteTagsInput): Promise<HotFavorite>
    removeFavorite(id: string): Promise<void>
    filter(input: FilterHotspotsInput): Promise<FilterHotspotsResult>
    getWeiboStatus(): Promise<WeiboSessionStatus>
    saveWeiboCookie(cookie: string): Promise<WeiboSessionStatus>
    /** 弹出微博官方登录窗口（扫码/手机号），成功后自动保存 Cookie */
    weiboLogin(): Promise<WeiboSessionStatus>
    clearWeiboCookie(): Promise<void>
    /** 订阅热点 AI 筛选的流式事件 */
    onStream(callback: (event: StreamEvent) => void): () => void
  }
  topics: {
    getSchema(): Promise<TopicSchemaField[]>
    saveSchema(fields: TopicSchemaField[]): Promise<TopicSchemaField[]>
    resetSchema(): Promise<TopicSchemaField[]>
    list(libraryOnly?: boolean): Promise<Topic[]>
    generate(input: GenerateTopicsInput): Promise<GenerateTopicsResult>
    save(input: SaveTopicInput): Promise<Topic>
    setLocked(id: string, locked: boolean): Promise<Topic>
    setInLibrary(id: string, inLibrary: boolean): Promise<Topic>
    remove(id: string): Promise<void>
    onStream(callback: (event: StreamEvent) => void): () => void
  }
  materials: {
    list(): Promise<Material[]>
    search(input: MaterialSearchInput): Promise<MaterialSearchResult>
    addSearchResult(input: AddSearchMaterialInput): Promise<{ material: Material; created: boolean }>
    addManual(input: SaveManualMaterialInput): Promise<Material>
    /** 上传本地文档作为素材（txt/md/pdf/docx，本地解析） */
    addFile(input: AddFileMaterialInput): Promise<Material>
    remove(id: string): Promise<void>
    /** 每条素材被哪些文章引用，用于素材选择器与来源回查 */
    usage(): Promise<Record<string, Array<{ id: string; title: string }>>>
  }
  frameworks: {
    listTemplates(): Promise<FrameworkTemplate[]>
    saveTemplate(input: SaveFrameworkTemplateInput): Promise<FrameworkTemplate>
    list(): Promise<Framework[]>
    generate(input: GenerateFrameworksInput): Promise<GenerateFrameworksResult>
    save(input: SaveFrameworkInput): Promise<Framework>
    setLocked(id: string, locked: boolean): Promise<Framework>
    remove(id: string): Promise<void>
    onStream(callback: (event: StreamEvent) => void): () => void
  }
  articles: {
    list(): Promise<Article[]>
    listSummaries(query?: ArticleListQuery): Promise<ArticleListResult>
    get(id: string): Promise<Article | null>
    getDraft(articleId: string): Promise<WorkDraft | null>
    saveDraft(input: SaveWorkDraftInput): Promise<WorkDraft>
    discardDraft(articleId: string): Promise<void>
    commitDraft(articleId: string, revision: number): Promise<Article>
    generate(input: GenerateArticlesInput): Promise<GenerateArticlesResult>
    revise(input: ReviseArticleInput): Promise<ReviseArticleResult>
    save(input: SaveArticleInput): Promise<Article>
    restore(input: RestoreArticleVersionInput): Promise<Article>
    /** §7.4：历史版本除了比较与恢复，还要能被命名，否则几十版之后只能靠版本号认 */
    renameVersion(input: RenameArticleVersionInput): Promise<Article>
    setLocked(id: string, locked: boolean): Promise<Article>
    remove(id: string): Promise<void>
    /** 订阅流式生成事件，返回取消订阅函数 */
    onStream(callback: (event: StreamEvent) => void): () => void
  }
  reviews: {
    listRoles(): Promise<ReviewRole[]>
    saveRole(input: SaveReviewRoleInput): Promise<ReviewRole>
    removeRole(id: string): Promise<void>
    listTasks(articleId?: string): Promise<ReviewTask[]>
    start(input: StartReviewInput): Promise<StartReviewResult>
    updateProblem(input: UpdateReviewProblemInput): Promise<ReviewProblem>
    addManualProblem(input: AddManualReviewProblemInput): Promise<ReviewProblem>
    apply(taskId: string, providerId: string, model: string, force?: boolean): Promise<Article>
    onStream(callback: (event: StreamEvent) => void): () => void
  }
  visuals: {
    list(articleId?: string): Promise<VisualPack[]>
    generate(input: GenerateVisualPackInput): Promise<VisualPack>
    remove(id: string): Promise<void>
    /** 订阅配图生成的流式事件 */
    onStream(callback: (event: StreamEvent) => void): () => void
    /** 用提示词生成一张具体图片 */
    generateImage(input: GenerateVisualAssetInput): Promise<VisualAsset>
    /** 从本地导入一张图片作为资产（供应商不支持生图时的兜底） */
    importImage(input: ImportVisualAssetInput): Promise<VisualAsset>
    /** 直接上传图片内容导入为资产 */
    importImageData(input: ImportVisualAssetDataInput): Promise<VisualAsset>
    listAssets(packId: string): Promise<VisualAsset[]>
    removeAsset(id: string): Promise<void>
  }
  layouts: {
    list(articleId?: string): Promise<ArticleLayout[]>
    /** 可用排版主题清单（内置 + 说明） */
    themes(): Promise<LayoutThemeInfo[]>
    create(input: CreateArticleLayoutInput): Promise<ArticleLayout>
    remove(id: string): Promise<void>
  }
  publishing: {
    getWechatChannel(): Promise<WechatPublishChannel>
    saveWechatChannel(input: SaveWechatPublishChannelInput): Promise<WechatPublishChannel>
    testWechatChannel(input?: SaveWechatPublishChannelInput): Promise<{ ok: boolean; latencyMs: number; message: string }>
    getForm(articleId: string): Promise<PublishFormDraft | null>
    saveForm(input: PublishFormDraft): Promise<void>
    preflight(input: PushWechatDraftInput): Promise<DeliveryCheck>
    retry(publicationId: string): Promise<Publication>
    list(): Promise<Publication[]>
    pushWechatDraft(input: PushWechatDraftInput): Promise<Publication>
    update(input: UpdatePublicationInput): Promise<Publication>
    /** 记录发布复盘（目标/结果/经验），传空即清除 */
    saveRetro(input: SavePublicationRetroInput): Promise<Publication>
    /** 把图片资产上传到公众号素材库，回填 media_id */
    uploadWechatCover(input: { assetId: string }): Promise<VisualAsset>
  }
}

export const DEFAULT_ACCOUNT_FIELD_NAMES = [
  '账号名称',
  '简介',
  '领域',
  '目标受众',
  '写作风格',
  'IP人设',
  '差异化定位',
  '价值主张',
  '选题方向'
] as const

export const WIZARD_QUESTIONS = [
  { id: 'name', question: '这个账号叫什么？', hint: '例如：量子观察者' },
  { id: 'domain', question: '主要做哪个领域？', hint: '例如：科技科普、职场成长、生活方式' },
  { id: 'audience', question: '写给谁看？', hint: '描述读者的年龄、背景、需求或困扰' },
  { id: 'style', question: '希望是什么写作风格或语气？', hint: '例如：轻松幽默、理性克制、故事化表达' },
  { id: 'persona', question: '这个账号扮演什么 IP 角色？', hint: '例如：陪你一起好奇的朋友、经验丰富的教练' },
  { id: 'difference', question: '和同类账号相比，有什么不同？', hint: '说说独特视角、方法或内容边界' },
  { id: 'value', question: '关注后能给读者带来什么？', hint: '一句话描述长期价值' }
] as const

export const DEFAULT_TOPIC_SCHEMA_FIELD_NAMES = [
  '选题主题',
  '切入角度',
  '目标读者',
  '核心观点',
  '情绪基调',
  '拟标题方向',
  '备注'
] as const
