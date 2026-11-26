import { spawn } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createPlatformHttpServer } from '../apps/platform-server/http.mjs'
import { buildPlatformRenderResult } from '../apps/platform-server/render-result.mjs'
import { ChromiumRenderer } from '../packages/wechat-renderer/src/index.mjs'
import { listThemes } from '../packages/wechat-theme/index.js'
import { DeliveryMachine, DraftDeliveryService } from '../packages/wechat-publisher/src/index.mjs'
import {
  createInspectorAdapter,
  createMockAdapters as createAdapterMocks,
  createRendererAdapter,
  FileAssetCache,
  FileDeliveryStore,
} from '../packages/wechat-publisher-adapters/index.mjs'
import { lintHtml } from '../packages/wechat-quality/index.mjs'
import { createWorkspaceService } from '../packages/workspace/src/index.mjs'
import { importContent } from '../packages/content-tools/src/index.mjs'
import { createChannelContractMocks, createWeChatAdapter, DistributionService } from '../packages/distribution/src/index.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const requireRenderer = createRequire(path.join(ROOT, 'packages/wechat-renderer/package.json'))
const puppeteer = requireRenderer('puppeteer')
const APP_URL = process.env.POC_DOOCS_URL ?? 'http://127.0.0.1:5173/md/'
const PORT = Number(process.env.PORT ?? 8780)
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let doocsProcess

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  }
  catch { return false }
}

async function ensureDoocs() {
  if (await reachable(APP_URL)) return
  const pnpmModule = process.env.PNPM_MODULE ?? 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.mjs'
  doocsProcess = spawn(process.execPath, [pnpmModule, '--dir', path.join(ROOT, 'upstream/doocs-md'), 'web', 'dev', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await reachable(APP_URL)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`doocs 未能启动：${APP_URL}`)
}

await ensureDoocs()
const renderer = new ChromiumRenderer({
  puppeteer,
  appUrl: APP_URL,
  executablePath: CHROME,
})
const assetCache = new FileAssetCache({ directory: path.join(ROOT, 'poc/.runtime/asset-cache') })
const adapterMocks = createAdapterMocks({
  cache: assetCache,
  assetsRoot: path.join(ROOT, 'poc/fixtures'),
  lint: (html, options) => lintHtml(html, options),
})
const machine = new DeliveryMachine({
  store: new FileDeliveryStore({ directory: path.join(ROOT, 'poc/.runtime/deliveries') }),
  renderer: createRendererAdapter({
    render: async context => {
      const result = await buildPlatformRenderResult({
        renderer,
        markdown: context.document.markdown,
        themeId: context.theme.id,
        metadata: context.document.metadata,
      })
      return { html: result.html, plainText: result.plainText }
    },
  }),
  inspector: createInspectorAdapter({ lint: (html, options) => lintHtml(html, options) }),
  assets: adapterMocks.assets,
  drafts: adapterMocks.drafts,
  verifier: adapterMocks.verifier,
  retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 50 },
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
})
const deliveryService = new DraftDeliveryService({
  machine,
  theme: { id: 'default', version: '1.0.0' },
  account: { id: 'account-1', credentialRef: 'mock-account' },
  renderer: { id: 'doocs', version: '80b43d495bf51ce5d70dcfb0d73443b306104e76', options: {} },
})
const delivery = {
  submit: (document, overrides = {}) => {
    const normalized = {
      ...document,
      metadata: {
        ...document.metadata,
        title: document.metadata?.title ?? '未命名文章',
        author: document.metadata?.author ?? '',
        digest: document.metadata?.digest ?? document.metadata?.summary ?? '',
      },
      images: document.images ?? [],
      thumbnail: document.thumbnail ?? { id: 'cover', src: 'assets/cover-thumb.jpg' },
    }
    const deliveryOverrides = {
      ...overrides,
      theme: overrides.theme ?? {
        id: document.themeId ?? 'tech-blue',
        version: document.themeVersion ?? '1.0.0',
      },
    }
    return deliveryService.submit(normalized, deliveryOverrides)
  },
  get: key => deliveryService.get(key),
  resume: (key, options) => deliveryService.resume(key, options),
  accounts: () => [{ id: 'account-1', mode: 'mock', draftOnly: true }],
}
const distributionService = new DistributionService({
  adapters: [
    createWeChatAdapter({ service: delivery, mode: 'mock' }),
    ...Object.values(createChannelContractMocks()),
  ],
})
const importer = async input => {
  const data = input.encoding === 'base64' ? Buffer.from(input.data, 'base64') : input.data
  return importContent({
    data,
    format: input.format,
    name: input.name,
    authorization: input.authorization,
  })
}
const distributor = {
  capabilities: async () => ['wechat', 'zhihu', 'juejin', 'csdn', 'toutiao'].map(channel => distributionService.getCapabilities(channel)),
  submit: async input => distributionService.submit({
    channel: input.channel,
    document: input.document,
    account: input.account ?? { id: 'default' },
    target: input.target,
    requestedMode: 'draft',
  }),
  get: key => distributionService.get(key),
}
const workspaceService = createWorkspaceService()
const demoWorkspace = workspaceService.createWorkspace({ name: '内容创作工作区', ownerId: 'owner-demo', ownerDisplayName: '工作区负责人' })
const documentArticles = new Map()
const workspace = {
  health: () => ({ enabled: true, workspaceId: demoWorkspace.id }),
  comment: async ({ documentId = 'untitled-document', body, author, parentId, anchor }) => {
    if (!author || !body) throw new Error('评论人和评论内容不能为空')
    const members = workspaceService.listMembers({ workspaceId: demoWorkspace.id, actorId: 'owner-demo' })
    if (!members.some(member => member.userId === author)) {
      workspaceService.addMember({ workspaceId: demoWorkspace.id, actorId: 'owner-demo', userId: author, role: 'editor', displayName: author })
    }
    let articleId = documentArticles.get(documentId)
    if (!articleId) {
      const article = workspaceService.createArticle({ workspaceId: demoWorkspace.id, actorId: author, title: documentId, body: '' })
      articleId = article.id
      documentArticles.set(documentId, articleId)
    }
    return workspaceService.addComment({ articleId, actorId: author, body, parentId, anchor })
  },
}
const server = createPlatformHttpServer({
  staticRoot: path.join(ROOT, 'apps/editor-web'),
  themes: listThemes(),
  delivery,
  workspace,
  importer,
  distributor,
  renderer: {
    render: input => buildPlatformRenderResult({
      renderer,
      markdown: input.markdown,
      themeId: input.themeId,
      metadata: input.metadata,
      assetsRoot: input.assetsRoot ? path.resolve(ROOT, input.assetsRoot) : undefined,
    }),
  },
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
console.log(`Integrated Content Platform: http://127.0.0.1:${PORT}`)
console.log(`Mode: real Chromium rendering + mock draft delivery (no account network calls)`)

async function shutdown() {
  await new Promise(resolve => server.close(resolve))
  await renderer.close()
  doocsProcess?.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
