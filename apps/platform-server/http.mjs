import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

function json(response, status, data) {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function error(response, status, code, message, details) {
  json(response, status, { ok: false, error: { code, message, details } })
}

async function readJson(request, limit = 2_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('请求体超过 2MB 限制')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  }
  catch {
    const error = new Error('请求体不是有效 JSON')
    error.status = 400
    throw error
  }
}

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname)
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const resolved = path.resolve(root, relative)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

export function createPlatformHttpServer({ renderer, delivery, themes, staticRoot, workspace, importer, distributor }) {
  if (!renderer?.render) throw new TypeError('renderer.render is required')
  if (!delivery?.submit || !delivery?.get) throw new TypeError('delivery.submit/get are required')
  if (!Array.isArray(themes)) throw new TypeError('themes must be an array')
  const root = path.resolve(staticRoot)

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json(response, 200, {
          ok: true,
          service: 'integrated-content-platform',
          renderer: 'ready',
          delivery: 'ready',
          accounts: delivery.accounts?.() ?? [],
          workspace: workspace?.health?.() ?? { enabled: false },
        })
      }
      if (url.pathname === '/api/themes' && request.method === 'GET') {
        return json(response, 200, { ok: true, themes })
      }
      if (url.pathname === '/api/render' && request.method === 'POST') {
        const input = await readJson(request)
        if (typeof input.markdown !== 'string' || !input.markdown.trim()) {
          return error(response, 400, 'MARKDOWN_REQUIRED', 'markdown 不能为空')
        }
        const result = await renderer.render(input)
        return json(response, 200, { ok: true, ...result })
      }
      if (url.pathname === '/api/import' && request.method === 'POST') {
        if (!importer) return error(response, 501, 'IMPORT_NOT_CONFIGURED', '内容导入未配置')
        const input = await readJson(request, 10_000_000)
        const result = await importer(input)
        return json(response, 200, { ok: true, ...result })
      }
      if (url.pathname === '/api/distribution/capabilities' && request.method === 'GET') {
        if (!distributor?.capabilities) return error(response, 501, 'DISTRIBUTION_NOT_CONFIGURED', '多平台分发未配置')
        return json(response, 200, { ok: true, capabilities: await distributor.capabilities() })
      }
      if (url.pathname === '/api/distribution' && request.method === 'POST') {
        if (!distributor?.submit) return error(response, 501, 'DISTRIBUTION_NOT_CONFIGURED', '多平台分发未配置')
        const input = await readJson(request)
        const record = await distributor.submit(input)
        return json(response, 202, { ok: true, record })
      }
      if (url.pathname.startsWith('/api/distribution/') && request.method === 'GET') {
        if (!distributor?.get) return error(response, 501, 'DISTRIBUTION_NOT_CONFIGURED', '多平台分发未配置')
        const key = decodeURIComponent(url.pathname.slice('/api/distribution/'.length))
        const record = await distributor.get(key)
        if (!record) return error(response, 404, 'DISTRIBUTION_NOT_FOUND', '分发任务不存在')
        return json(response, 200, { ok: true, record })
      }
      if (url.pathname === '/api/delivery' && request.method === 'POST') {
        const input = await readJson(request)
        if (!input.document || typeof input.document.markdown !== 'string' || !input.document.markdown.trim()) {
          return error(response, 400, 'DOCUMENT_REQUIRED', 'document.markdown 不能为空')
        }
        const record = await delivery.submit(input.document, input.overrides ?? {})
        return json(response, 202, { ok: true, record })
      }
      if (url.pathname.startsWith('/api/delivery/') && request.method === 'GET') {
        const key = decodeURIComponent(url.pathname.slice('/api/delivery/'.length))
        const record = await delivery.get(key)
        if (!record) return error(response, 404, 'DELIVERY_NOT_FOUND', '交付任务不存在')
        return json(response, 200, { ok: true, record })
      }
      if (url.pathname === '/api/workspace/comment' && request.method === 'POST') {
        if (!workspace?.comment) return error(response, 501, 'WORKSPACE_NOT_CONFIGURED', '团队工作区未配置')
        const input = await readJson(request)
        const result = await workspace.comment(input)
        return json(response, 201, { ok: true, result })
      }
      if (url.pathname.startsWith('/api/')) {
        return error(response, 404, 'API_NOT_FOUND', '接口不存在')
      }

      let filePath = safeStaticPath(root, url.pathname)
      if (!filePath) return error(response, 400, 'INVALID_PATH', '非法静态路径')
      let fileStat = await stat(filePath).catch(() => null)
      if (!fileStat?.isFile()) {
        filePath = path.join(root, 'index.html')
        fileStat = await stat(filePath).catch(() => null)
      }
      if (!fileStat?.isFile()) return error(response, 404, 'NOT_FOUND', '文件不存在')
      const content = await readFile(filePath)
      response.writeHead(200, {
        'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
        'content-length': content.length,
        'cache-control': 'no-cache',
      })
      response.end(content)
    }
    catch (cause) {
      const status = cause.status ?? 500
      return error(response, status, cause.code ?? 'INTERNAL_ERROR', cause.message ?? String(cause), cause.details)
    }
  })
}
