import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddAccountMemoryInput,
  AddAccountPlatformInput,
  AddAccountRedlineInput,
  AddHotFavoriteInput,
  AddSearchMaterialInput,
  AddFileMaterialInput,
  FilterHotspotsInput,
  GenerateAccountInput,
  GenerateTopicsInput,
  MoliuApi,
  MaterialSearchInput,
  ProviderDraftTestInput,
  RestoreVersionInput,
  SaveAccountInput,
  SaveHotSourcePreferencesInput,
  SaveTopicInput,
  SaveProviderInput,
  SaveManualMaterialInput,
  SaveSearchServiceInput,
  GenerateFrameworksInput,
  SaveFrameworkInput,
  SaveFrameworkTemplateInput,
  GenerateArticlesInput,
  ReviseArticleInput,
  SaveArticleInput,
  RestoreArticleVersionInput,
  RenameArticleVersionInput,
  SaveReviewRoleInput, StartReviewInput, UpdateReviewProblemInput, AddManualReviewProblemInput,
  StreamEvent,
  GenerationEvent,
  UpdateHotFavoriteTagsInput
} from '../shared/contracts.js'

const api: MoliuApi = {
  app: {
    bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
    getDataPath: () => ipcRenderer.invoke('app:data-path'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    exportArticle: (input: { articleId: string; format: 'markdown' | 'html'; targetDir?: string }) =>
      ipcRenderer.invoke('app:export-article', input),
    exportLayout: (input: { layoutId: string; targetDir?: string }) => ipcRenderer.invoke('app:export-layout', input),
    createBackup: (input?: { targetDir?: string }) => ipcRenderer.invoke('app:backup-create', input),
    restoreBackup: (input: { bundleDir: string }) => ipcRenderer.invoke('app:backup-restore', input),
    listBackups: () => ipcRenderer.invoke('app:backup-list'),
    exportPortableBackup: () => ipcRenderer.invoke('app:backup-export-portable'),
    selectPortableBackup: () => ipcRenderer.invoke('app:backup-select-portable')
  },
  clipboard: {
    writeRichText: (html: string, text: string) => ipcRenderer.invoke('clipboard:writeRichText', { html, text }),
    prepareLayout: (layoutId, mode) => ipcRenderer.invoke('clipboard:prepare-layout', { layoutId, mode })
  },
  generation: {
    cancel: (domain: string) => ipcRenderer.invoke('generation:cancel', domain),
    active: () => ipcRenderer.invoke('generation:active'),
    list: (limit?: number) => ipcRenderer.invoke('generation:list', limit),
    events: (callback: (event: GenerationEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: GenerationEvent): void => callback(data)
      ipcRenderer.on('generation:events', listener)
      return () => ipcRenderer.removeListener('generation:events', listener)
    }
  },
  providers: {
    presets: () => ipcRenderer.invoke('providers:presets'),
    list: () => ipcRenderer.invoke('providers:list'),
    save: (input: SaveProviderInput) => ipcRenderer.invoke('providers:save', input),
    testAndSave: (input: SaveProviderInput) => ipcRenderer.invoke('providers:test-and-save', input),
    remove: (id: string) => ipcRenderer.invoke('providers:remove', id),
    test: (id: string) => ipcRenderer.invoke('providers:test', id),
    testDraft: (input: ProviderDraftTestInput) => ipcRenderer.invoke('providers:test-draft', input),
    logs: (providerId?: string) => ipcRenderer.invoke('providers:logs', providerId)
  },
  searchService: {
    get: () => ipcRenderer.invoke('search-service:get'),
    save: (input: SaveSearchServiceInput) => ipcRenderer.invoke('search-service:save', input),
    test: () => ipcRenderer.invoke('search-service:test')
  },
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    listVersions: (key: string) => ipcRenderer.invoke('prompts:list-versions', key),
    update: (input: { key: string; content: string; note?: string }) =>
      ipcRenderer.invoke('prompts:update', input),
    restore: (input: { key: string; version: number }) =>
      ipcRenderer.invoke('prompts:restore', input),
    reset: (key: string) => ipcRenderer.invoke('prompts:reset', key)
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    get: (id: string) => ipcRenderer.invoke('accounts:get', id),
    generate: (input: GenerateAccountInput) => ipcRenderer.invoke('accounts:generate', input),
    save: (input: SaveAccountInput) => ipcRenderer.invoke('accounts:save', input),
    setCurrent: (id: string) => ipcRenderer.invoke('accounts:set-current', id),
    setLocked: (id: string, locked: boolean) =>
      ipcRenderer.invoke('accounts:set-locked', id, locked),
    restore: (input: RestoreVersionInput) => ipcRenderer.invoke('accounts:restore', input),
    remove: (id: string) => ipcRenderer.invoke('accounts:remove', id),
    listRedlines: (profileId: string) => ipcRenderer.invoke('accounts:redlines:list', profileId),
    addRedline: (input: AddAccountRedlineInput) => ipcRenderer.invoke('accounts:redlines:add', input),
    removeRedline: (id: string) => ipcRenderer.invoke('accounts:redlines:remove', id),
    listPlatformAccounts: (profileId: string) => ipcRenderer.invoke('accounts:platforms:list', profileId),
    addPlatformAccount: (input: AddAccountPlatformInput) => ipcRenderer.invoke('accounts:platforms:add', input),
    removePlatformAccount: (id: string) => ipcRenderer.invoke('accounts:platforms:remove', id),
    listMemories: (profileId: string) => ipcRenderer.invoke('accounts:memories:list', profileId),
    addMemory: (input: AddAccountMemoryInput) => ipcRenderer.invoke('accounts:memories:add', input),
    removeMemory: (id: string) => ipcRenderer.invoke('accounts:memories:remove', id)
  },
  hotspots: {
    bootstrap: () => ipcRenderer.invoke('hotspots:bootstrap'),
    saveSourcePreferences: (input: SaveHotSourcePreferencesInput) =>
      ipcRenderer.invoke('hotspots:preferences:save', input),
    refresh: (sourceIds?: string[]) => ipcRenderer.invoke('hotspots:refresh', sourceIds),
    listFavorites: () => ipcRenderer.invoke('hotspots:favorites:list'),
    addFavorite: (input: AddHotFavoriteInput) =>
      ipcRenderer.invoke('hotspots:favorites:add', input),
    updateFavoriteTags: (input: UpdateHotFavoriteTagsInput) =>
      ipcRenderer.invoke('hotspots:favorites:update-tags', input),
    removeFavorite: (id: string) => ipcRenderer.invoke('hotspots:favorites:remove', id),
    filter: (input: FilterHotspotsInput) => ipcRenderer.invoke('hotspots:filter', input),
    getWeiboStatus: () => ipcRenderer.invoke('hotspots:weibo:status'),
    saveWeiboCookie: (cookie: string) => ipcRenderer.invoke('hotspots:weibo:save', cookie),
    weiboLogin: () => ipcRenderer.invoke('hotspots:weibo:login'),
    clearWeiboCookie: () => ipcRenderer.invoke('hotspots:weibo:clear'),
    onStream: (callback: (event: StreamEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: StreamEvent): void => callback(data)
      ipcRenderer.on('hotspots:stream', listener)
      return () => ipcRenderer.removeListener('hotspots:stream', listener)
    }
  },
  topics: {
    getSchema: () => ipcRenderer.invoke('topics:schema:get'),
    saveSchema: (fields) => ipcRenderer.invoke('topics:schema:save', fields),
    resetSchema: () => ipcRenderer.invoke('topics:schema:reset'),
    list: (libraryOnly?: boolean) => ipcRenderer.invoke('topics:list', libraryOnly),
    generate: (input: GenerateTopicsInput) => ipcRenderer.invoke('topics:generate', input),
    save: (input: SaveTopicInput) => ipcRenderer.invoke('topics:save', input),
    setLocked: (id: string, locked: boolean) => ipcRenderer.invoke('topics:set-locked', id, locked),
    setInLibrary: (id: string, inLibrary: boolean) =>
      ipcRenderer.invoke('topics:set-in-library', id, inLibrary),
    remove: (id: string) => ipcRenderer.invoke('topics:remove', id),
    onStream: (callback: (event: StreamEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: StreamEvent): void => callback(data)
      ipcRenderer.on('topics:stream', listener)
      return () => ipcRenderer.removeListener('topics:stream', listener)
    }
  },
  materials: {
    document: (id) => ipcRenderer.invoke('materials:document', id),
    previewContext: (input) => ipcRenderer.invoke('materials:preview-context', input),
    list: () => ipcRenderer.invoke('materials:list'),
    search: (input: MaterialSearchInput) => ipcRenderer.invoke('materials:search', input),
    addSearchResult: (input: AddSearchMaterialInput) =>
      ipcRenderer.invoke('materials:add-search-result', input),
    addManual: (input: SaveManualMaterialInput) => ipcRenderer.invoke('materials:add-manual', input),
    addFile: (input: AddFileMaterialInput) => ipcRenderer.invoke('materials:add-file', input),
    remove: (id: string) => ipcRenderer.invoke('materials:remove', id),
    usage: () => ipcRenderer.invoke('materials:usage')
  },
  frameworks: {
    listTemplates: () => ipcRenderer.invoke('frameworks:templates:list'),
    saveTemplate: (input: SaveFrameworkTemplateInput) => ipcRenderer.invoke('frameworks:templates:save', input),
    list: () => ipcRenderer.invoke('frameworks:list'),
    generate: (input: GenerateFrameworksInput) => ipcRenderer.invoke('frameworks:generate', input),
    save: (input: SaveFrameworkInput) => ipcRenderer.invoke('frameworks:save', input),
    setLocked: (id: string, locked: boolean) => ipcRenderer.invoke('frameworks:set-locked', id, locked),
    remove: (id: string) => ipcRenderer.invoke('frameworks:remove', id),
    onStream: (callback: (event: StreamEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: StreamEvent): void => callback(data)
      ipcRenderer.on('frameworks:stream', listener)
      return () => ipcRenderer.removeListener('frameworks:stream', listener)
    }
  },
  articles: {
    getSummary: (id) => ipcRenderer.invoke('articles:summary', id),
    list: () => ipcRenderer.invoke('articles:list'),
    listSummaries: (query) => ipcRenderer.invoke('articles:summaries', query),
    get: (id: string) => ipcRenderer.invoke('articles:get', id),
    getDraft: (id) => ipcRenderer.invoke('articles:draft:get', id),
    saveDraft: (input) => ipcRenderer.invoke('articles:draft:save', input),
    discardDraft: (id) => ipcRenderer.invoke('articles:draft:discard', id),
    commitDraft: (id, revision) => ipcRenderer.invoke('articles:draft:commit', id, revision),
    generate: (input: GenerateArticlesInput) => ipcRenderer.invoke('articles:generate', input),
    revise: (input: ReviseArticleInput) => ipcRenderer.invoke('articles:revise', input),
    listRequests: () => ipcRenderer.invoke('articles:requests'),
    retryRequest: (id) => ipcRenderer.invoke('articles:retry-request', id),
    continueResult: (id, index) => ipcRenderer.invoke('articles:continue-result', { id, index }),
    recoverResult: (id, index, markdown) => ipcRenderer.invoke('articles:recover-result', { id, index, markdown }),
    adoptCandidate: (input) => ipcRenderer.invoke('articles:adopt-candidate', input),
    save: (input: SaveArticleInput) => ipcRenderer.invoke('articles:save', input),
    restore: (input: RestoreArticleVersionInput) => ipcRenderer.invoke('articles:restore', input),
    renameVersion: (input: RenameArticleVersionInput) => ipcRenderer.invoke('articles:rename-version', input),
    setLocked: (id: string, locked: boolean) => ipcRenderer.invoke('articles:set-locked', id, locked),
    remove: (id: string) => ipcRenderer.invoke('articles:remove', id),
    onStream: (callback: (event: StreamEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: StreamEvent): void => callback(data)
      ipcRenderer.on('articles:stream', listener)
      return () => ipcRenderer.removeListener('articles:stream', listener)
    }
  },
  reviews: {
    listRoles: () => ipcRenderer.invoke('reviews:roles:list'),
    saveRole: (input: SaveReviewRoleInput) => ipcRenderer.invoke('reviews:roles:save', input),
    removeRole: (id: string) => ipcRenderer.invoke('reviews:roles:remove', id),
    listTasks: (articleId?: string) => ipcRenderer.invoke('reviews:tasks:list', articleId),
    start: (input: StartReviewInput) => ipcRenderer.invoke('reviews:start', input),
    updateProblem: (input: UpdateReviewProblemInput) => ipcRenderer.invoke('reviews:problems:update', input),
    addManualProblem: (input: AddManualReviewProblemInput) => ipcRenderer.invoke('reviews:problems:add', input),
    apply: (taskId: string, providerId: string, model: string, force?: boolean) => ipcRenderer.invoke('reviews:apply', taskId, providerId, model, force),
    onStream: (callback: (event: StreamEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: StreamEvent): void => callback(data)
      ipcRenderer.on('reviews:stream', listener)
      return () => ipcRenderer.removeListener('reviews:stream', listener)
    }
  },
  visuals: {
    createManualPack: (id) => ipcRenderer.invoke('visuals:manual-pack', id),
    list: (articleId?: string) => ipcRenderer.invoke('visuals:list', articleId),
    generate: (input) => ipcRenderer.invoke('visuals:generate', input),
    remove: (id: string) => ipcRenderer.invoke('visuals:remove', id),
    generateImage: (input) => ipcRenderer.invoke('visuals:generate-image', input),
    importImage: (input) => ipcRenderer.invoke('visuals:import-image', input),
    importImageData: (input) => ipcRenderer.invoke('visuals:import-image-data', input),
    listAssets: (packId: string) => ipcRenderer.invoke('visuals:list-assets', packId),
    removeAsset: (id: string) => ipcRenderer.invoke('visuals:remove-asset', id),
    onStream: (callback: (event: StreamEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: StreamEvent): void => callback(data)
      ipcRenderer.on('visuals:stream', listener)
      return () => ipcRenderer.removeListener('visuals:stream', listener)
    }
  },
  layouts: {
    list: (articleId?: string) => ipcRenderer.invoke('layouts:list', articleId),
    themes: () => ipcRenderer.invoke('layouts:themes'),
    genres: () => ipcRenderer.invoke('layouts:genres'),
    // 实时预览：与正式排版同一套渲染，所见即所得
    renderPreview: (input) =>
      ipcRenderer.invoke('layouts:renderPreview', input),
    create: (input) => ipcRenderer.invoke('layouts:create', input),
    remove: (id: string) => ipcRenderer.invoke('layouts:remove', id)
  },
  publishing: {
    getWechatChannel: () => ipcRenderer.invoke('publishing:wechat:get'),
    saveWechatChannel: (input) => ipcRenderer.invoke('publishing:wechat:save', input),
    testWechatChannel: (input) => ipcRenderer.invoke('publishing:wechat:test', input),
    getForm: (id) => ipcRenderer.invoke('publishing:form:get', id),
    saveForm: (input) => ipcRenderer.invoke('publishing:form:save', input),
    preflight: (input) => ipcRenderer.invoke('publishing:preflight', input),
    resolveUnknown: (input) => ipcRenderer.invoke('publishing:resolve-unknown', input),
    retry: (id) => ipcRenderer.invoke('publishing:retry', id),
    list: () => ipcRenderer.invoke('publishing:list'),
    pushWechatDraft: (input) => ipcRenderer.invoke('publishing:wechat:push-draft', input),
    update: (input) => ipcRenderer.invoke('publishing:update', input),
    saveRetro: (input) => ipcRenderer.invoke('publishing:retro', input),
    uploadWechatCover: (input) => ipcRenderer.invoke('publishing:wechat:upload-cover', input)
  }
}

contextBridge.exposeInMainWorld('moliu', api)
