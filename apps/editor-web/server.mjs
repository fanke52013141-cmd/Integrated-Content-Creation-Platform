import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

async function bodyBuffer(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2_000_000) throw new Error('请求体超过 2MB 限制')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function createAppServer({ root = process.cwd(), apiOrigin = process.env.API_ORIGIN || '' } = {}) {
  const staticRoot = path.resolve(root)
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!apiOrigin) return sendJson(response, 503, { ok: false, error: { code: 'BACKEND_NOT_CONNECTED', message: '未配置 API_ORIGIN；当前仅提供本地前端能力' } })
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await bodyBuffer(request)
        const upstream = await fetch(new URL(request.url, apiOrigin), {
          method: request.method,
          headers: request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : undefined,
          body
        })
        const text = await upstream.text()
        response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(text)
        return
      }
      const pathname = decodeURIComponent(url.pathname)
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
      const filePath = path.resolve(staticRoot, relative)
      if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${path.sep}`)) return sendJson(response, 400, { ok: false, error: { code: 'INVALID_PATH', message: '非法路径' } })
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat?.isFile()) return sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: '文件不存在' } })
      const content = await readFile(filePath)
      response.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream', 'content-length': content.length, 'cache-control': 'no-cache' })
      response.end(content)
    }
    catch (error) {
      sendJson(response, 500, { ok: false, error: { code: 'APP_SERVER_ERROR', message: error.message || String(error) } })
    }
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173)
  const server = createAppServer({ root: path.dirname(fileURLToPath(import.meta.url)) })
  server.listen(port, '127.0.0.1', () => {
    console.log(`Editor web: http://127.0.0.1:${port}`)
    console.log(process.env.API_ORIGIN ? `Proxying /api to ${process.env.API_ORIGIN}` : 'API_ORIGIN is not configured; /api returns an explicit 503.')
  })
}
