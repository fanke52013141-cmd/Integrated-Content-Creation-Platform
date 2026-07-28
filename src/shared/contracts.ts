export type ProviderProtocol = 'openai-compatible'

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

export interface AccountField {
  id: string
  name: string
  value: string
  isDefault: boolean
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
  createdAt: string
  updatedAt: string
}

export interface AccountProfile extends AccountProfileSummary {
  currentVersionId: string
  fields: AccountField[]
  wizardAnswers: WizardAnswer[]
  versions: AccountVersion[]
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
export type MaterialOrigin = 'doubao_web' | 'doubao_image' | 'manual_text'

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
export interface ArticleVersion { id: string; articleId: string; versionNumber: number; source: ArticleVersionSource; instruction?: string; providerId?: string; model?: string; rawMarkdown: string; createdAt: string }
export interface Article { id: string; frameworkId?: string; accountId?: string; materialIds: string[]; manualOutline: string; status: ArticleStatus; currentVersionId: string; versionCount: number; rawMarkdown: string; providerId?: string; model?: string; createdAt: string; updatedAt: string; versions: ArticleVersion[]; references: ArtifactReference[] }
export interface GenerateArticlesInput { frameworkId?: string; accountId?: string; materialIds: string[]; manualOutline?: string; providerId: string; model: string; count: number }
export interface GenerateArticlesResult { articles: Article[]; failed: Array<{ index: number; message: string }> }
export interface ReviseArticleInput { articleId: string; instruction: string; alignFramework: boolean; providerId: string; model: string; count: number }
export interface ReviseArticleResult { articles: Article[]; failed: Array<{ index: number; message: string }> }
export interface SaveArticleInput { id?: string; frameworkId?: string; accountId?: string; materialIds: string[]; manualOutline: string; status: ArticleStatus; rawMarkdown: string; source: ArticleVersionSource; instruction?: string; providerId?: string; model?: string }
export interface RestoreArticleVersionInput { articleId: string; versionId: string }
export type ReviewSeverity = 'high' | 'medium' | 'low'
export interface ReviewRole { id: string; name: string; systemPrompt: string; providerId?: string; model?: string; extractionTag: string; extractionOccurrence: 'first' | 'last'; dimensions: string[]; sortOrder: number; createdAt: string; updatedAt: string }
export interface ReviewProblem { id: string; position: string; severity: ReviewSeverity; issue: string; suggestion: string; adopted: boolean; isManual: boolean }
export interface ReviewOpinion { id: string; taskId: string; roleId?: string; roleName: string; providerId?: string; model?: string; dimensions: string[]; problems: ReviewProblem[]; overallSuggestion: string; rawXml: string; extractionMatched: boolean; createdAt: string }
export interface ReviewTask { id: string; articleId: string; roleIds: string[]; status: 'completed' | 'applied'; createdAt: string; updatedAt: string; opinions: ReviewOpinion[] }
export interface SaveReviewRoleInput { id?: string; name: string; systemPrompt: string; providerId?: string; model?: string; extractionTag: string; extractionOccurrence: 'first' | 'last'; dimensions: string[]; sortOrder: number }
export interface StartReviewInput { articleId: string; roleIds: string[]; fallbackProviderId: string; fallbackModel: string }
export interface StartReviewResult { task: ReviewTask; failed: Array<{ roleId: string; message: string }> }
export interface UpdateReviewProblemInput { id: string; position: string; severity: ReviewSeverity; issue: string; suggestion: string; adopted: boolean }
export interface AddManualReviewProblemInput { taskId: string; position: string; severity: ReviewSeverity; issue: string; suggestion: string }

export interface VisualCover { visual: string; prompt: string; overlayText: string }
export interface VisualPrompt { location: string; purpose: string; ratio: string; prompt: string; alt: string }
export interface VisualPack { id: string; articleId: string; articleVersionId: string; articleStatusSnapshot: ArticleStatus; providerId: string; model: string; cover: VisualCover; inlineImages: VisualPrompt[]; releaseImages: VisualPrompt[]; rawXml: string; createdAt: string }
export interface GenerateVisualPackInput { articleId: string; providerId: string; model: string; inlineCount: number }
export type LayoutPlatform = 'wechat' | 'xiaohongshu' | 'web'
export interface ArticleLayout { id: string; articleId: string; articleVersionId: string; articleStatusSnapshot: ArticleStatus; platform: LayoutPlatform; title: string; html: string; plainText: string; createdAt: string }
export interface CreateArticleLayoutInput { articleId: string; platform: LayoutPlatform }
export interface WechatPublishChannel { id: 'wechat-official'; displayName: string; appId: string; enabled: boolean; hasAppSecret: boolean; updatedAt: string }
export interface SaveWechatPublishChannelInput { appId: string; appSecret?: string; enabled: boolean }
export type PublicationStatus = 'draft' | 'published' | 'failed'
export interface Publication { id: string; articleId: string; articleVersionId: string; layoutId: string; channelId: 'wechat-official'; externalDraftId?: string; status: PublicationStatus; title: string; thumbMediaId: string; publishedUrl?: string; errorMessage?: string; createdAt: string; updatedAt: string }
export interface PushWechatDraftInput { articleId: string; layoutId: string; thumbMediaId: string; author?: string; digest?: string; contentSourceUrl?: string }
export interface UpdatePublicationInput { id: string; status: 'published'; publishedUrl: string }

export interface AppBootstrap {
  providers: ProviderSummary[]
  searchService: SearchServiceSummary
  accounts: AccountProfileSummary[]
  currentAccountId?: string
}

export interface MoliuApi {
  app: {
    bootstrap(): Promise<AppBootstrap>
    getDataPath(): Promise<string>
  }
  providers: {
    presets(): Promise<ProviderPreset[]>
    list(): Promise<ProviderSummary[]>
    save(input: SaveProviderInput): Promise<ProviderSummary>
    remove(id: string): Promise<void>
    test(id: string): Promise<ProviderTestResult>
  }
  searchService: {
    get(): Promise<SearchServiceSummary>
    save(input: SaveSearchServiceInput): Promise<SearchServiceSummary>
    test(): Promise<SearchServiceTestResult>
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
  }
  hotspots: {
    bootstrap(): Promise<HotspotBootstrap>
    saveSourcePreferences(input: SaveHotSourcePreferencesInput): Promise<HotSourcePreference[]>
    refresh(sourceIds?: string[]): Promise<HotSourceResult[]>
    openSource(url: string): Promise<void>
    listFavorites(): Promise<HotFavorite[]>
    addFavorite(input: AddHotFavoriteInput): Promise<AddHotFavoriteResult>
    updateFavoriteTags(input: UpdateHotFavoriteTagsInput): Promise<HotFavorite>
    removeFavorite(id: string): Promise<void>
    filter(input: FilterHotspotsInput): Promise<FilterHotspotsResult>
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
  }
  materials: {
    list(): Promise<Material[]>
    search(input: MaterialSearchInput): Promise<MaterialSearchResult>
    addSearchResult(input: AddSearchMaterialInput): Promise<{ material: Material; created: boolean }>
    addManual(input: SaveManualMaterialInput): Promise<Material>
    remove(id: string): Promise<void>
  }
  frameworks: {
    listTemplates(): Promise<FrameworkTemplate[]>
    saveTemplate(input: SaveFrameworkTemplateInput): Promise<FrameworkTemplate>
    list(): Promise<Framework[]>
    generate(input: GenerateFrameworksInput): Promise<GenerateFrameworksResult>
    save(input: SaveFrameworkInput): Promise<Framework>
    setLocked(id: string, locked: boolean): Promise<Framework>
    remove(id: string): Promise<void>
  }
  articles: {
    list(): Promise<Article[]>
    get(id: string): Promise<Article | null>
    generate(input: GenerateArticlesInput): Promise<GenerateArticlesResult>
    revise(input: ReviseArticleInput): Promise<ReviseArticleResult>
    save(input: SaveArticleInput): Promise<Article>
    restore(input: RestoreArticleVersionInput): Promise<Article>
    setLocked(id: string, locked: boolean): Promise<Article>
    remove(id: string): Promise<void>
  }
  reviews: {
    listRoles(): Promise<ReviewRole[]>
    saveRole(input: SaveReviewRoleInput): Promise<ReviewRole>
    removeRole(id: string): Promise<void>
    listTasks(articleId?: string): Promise<ReviewTask[]>
    start(input: StartReviewInput): Promise<StartReviewResult>
    updateProblem(input: UpdateReviewProblemInput): Promise<ReviewProblem>
    addManualProblem(input: AddManualReviewProblemInput): Promise<ReviewProblem>
    apply(taskId: string, providerId: string, model: string): Promise<Article>
  }
  visuals: {
    list(articleId?: string): Promise<VisualPack[]>
    generate(input: GenerateVisualPackInput): Promise<VisualPack>
    remove(id: string): Promise<void>
  }
  layouts: {
    list(articleId?: string): Promise<ArticleLayout[]>
    create(input: CreateArticleLayoutInput): Promise<ArticleLayout>
    remove(id: string): Promise<void>
  }
  publishing: {
    getWechatChannel(): Promise<WechatPublishChannel>
    saveWechatChannel(input: SaveWechatPublishChannelInput): Promise<WechatPublishChannel>
    testWechatChannel(): Promise<{ ok: boolean; latencyMs: number; message: string }>
    list(): Promise<Publication[]>
    pushWechatDraft(input: PushWechatDraftInput): Promise<Publication>
    update(input: UpdatePublicationInput): Promise<Publication>
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
  '价值主张'
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
