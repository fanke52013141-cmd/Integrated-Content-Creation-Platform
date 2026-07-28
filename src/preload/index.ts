import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddHotFavoriteInput,
  AddSearchMaterialInput,
  FilterHotspotsInput,
  GenerateAccountInput,
  GenerateTopicsInput,
  MoliuApi,
  MaterialSearchInput,
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
  SaveReviewRoleInput, StartReviewInput, UpdateReviewProblemInput, AddManualReviewProblemInput,
  UpdateHotFavoriteTagsInput
} from '../shared/contracts.js'

const api: MoliuApi = {
  app: {
    bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
    getDataPath: () => ipcRenderer.invoke('app:data-path')
  },
  providers: {
    presets: () => ipcRenderer.invoke('providers:presets'),
    list: () => ipcRenderer.invoke('providers:list'),
    save: (input: SaveProviderInput) => ipcRenderer.invoke('providers:save', input),
    remove: (id: string) => ipcRenderer.invoke('providers:remove', id),
    test: (id: string) => ipcRenderer.invoke('providers:test', id)
  },
  searchService: {
    get: () => ipcRenderer.invoke('search-service:get'),
    save: (input: SaveSearchServiceInput) => ipcRenderer.invoke('search-service:save', input),
    test: () => ipcRenderer.invoke('search-service:test')
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
    remove: (id: string) => ipcRenderer.invoke('accounts:remove', id)
  },
  hotspots: {
    bootstrap: () => ipcRenderer.invoke('hotspots:bootstrap'),
    saveSourcePreferences: (input: SaveHotSourcePreferencesInput) =>
      ipcRenderer.invoke('hotspots:preferences:save', input),
    refresh: (sourceIds?: string[]) => ipcRenderer.invoke('hotspots:refresh', sourceIds),
    openSource: (url: string) => ipcRenderer.invoke('hotspots:open-source', url),
    listFavorites: () => ipcRenderer.invoke('hotspots:favorites:list'),
    addFavorite: (input: AddHotFavoriteInput) =>
      ipcRenderer.invoke('hotspots:favorites:add', input),
    updateFavoriteTags: (input: UpdateHotFavoriteTagsInput) =>
      ipcRenderer.invoke('hotspots:favorites:update-tags', input),
    removeFavorite: (id: string) => ipcRenderer.invoke('hotspots:favorites:remove', id),
    filter: (input: FilterHotspotsInput) => ipcRenderer.invoke('hotspots:filter', input)
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
    remove: (id: string) => ipcRenderer.invoke('topics:remove', id)
  },
  materials: {
    list: () => ipcRenderer.invoke('materials:list'),
    search: (input: MaterialSearchInput) => ipcRenderer.invoke('materials:search', input),
    addSearchResult: (input: AddSearchMaterialInput) =>
      ipcRenderer.invoke('materials:add-search-result', input),
    addManual: (input: SaveManualMaterialInput) => ipcRenderer.invoke('materials:add-manual', input),
    remove: (id: string) => ipcRenderer.invoke('materials:remove', id)
  },
  frameworks: {
    listTemplates: () => ipcRenderer.invoke('frameworks:templates:list'),
    saveTemplate: (input: SaveFrameworkTemplateInput) => ipcRenderer.invoke('frameworks:templates:save', input),
    list: () => ipcRenderer.invoke('frameworks:list'),
    generate: (input: GenerateFrameworksInput) => ipcRenderer.invoke('frameworks:generate', input),
    save: (input: SaveFrameworkInput) => ipcRenderer.invoke('frameworks:save', input),
    setLocked: (id: string, locked: boolean) => ipcRenderer.invoke('frameworks:set-locked', id, locked),
    remove: (id: string) => ipcRenderer.invoke('frameworks:remove', id)
  },
  articles: {
    list: () => ipcRenderer.invoke('articles:list'),
    get: (id: string) => ipcRenderer.invoke('articles:get', id),
    generate: (input: GenerateArticlesInput) => ipcRenderer.invoke('articles:generate', input),
    revise: (input: ReviseArticleInput) => ipcRenderer.invoke('articles:revise', input),
    save: (input: SaveArticleInput) => ipcRenderer.invoke('articles:save', input),
    restore: (input: RestoreArticleVersionInput) => ipcRenderer.invoke('articles:restore', input),
    setLocked: (id: string, locked: boolean) => ipcRenderer.invoke('articles:set-locked', id, locked),
    remove: (id: string) => ipcRenderer.invoke('articles:remove', id)
  },
  reviews: {
    listRoles: () => ipcRenderer.invoke('reviews:roles:list'),
    saveRole: (input: SaveReviewRoleInput) => ipcRenderer.invoke('reviews:roles:save', input),
    removeRole: (id: string) => ipcRenderer.invoke('reviews:roles:remove', id),
    listTasks: (articleId?: string) => ipcRenderer.invoke('reviews:tasks:list', articleId),
    start: (input: StartReviewInput) => ipcRenderer.invoke('reviews:start', input),
    updateProblem: (input: UpdateReviewProblemInput) => ipcRenderer.invoke('reviews:problems:update', input),
    addManualProblem: (input: AddManualReviewProblemInput) => ipcRenderer.invoke('reviews:problems:add', input),
    apply: (taskId: string, providerId: string, model: string) => ipcRenderer.invoke('reviews:apply', taskId, providerId, model)
  },
  visuals: {
    list: (articleId?: string) => ipcRenderer.invoke('visuals:list', articleId),
    generate: (input) => ipcRenderer.invoke('visuals:generate', input),
    remove: (id: string) => ipcRenderer.invoke('visuals:remove', id)
  },
  layouts: {
    list: (articleId?: string) => ipcRenderer.invoke('layouts:list', articleId),
    create: (input) => ipcRenderer.invoke('layouts:create', input),
    remove: (id: string) => ipcRenderer.invoke('layouts:remove', id)
  },
  publishing: {
    getWechatChannel: () => ipcRenderer.invoke('publishing:wechat:get'),
    saveWechatChannel: (input) => ipcRenderer.invoke('publishing:wechat:save', input),
    testWechatChannel: () => ipcRenderer.invoke('publishing:wechat:test'),
    list: () => ipcRenderer.invoke('publishing:list'),
    pushWechatDraft: (input) => ipcRenderer.invoke('publishing:wechat:push-draft', input),
    update: (input) => ipcRenderer.invoke('publishing:update', input)
  }
}

contextBridge.exposeInMainWorld('moliu', api)
