import { sanitizeHtml } from '../../lib'

export function layoutPreviewDocument(html: string): string {
  const safeHtml = sanitizeHtml(html)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: moliu-asset:; style-src 'unsafe-inline'; font-src data: https:;"><style>html,body{margin:0;padding:0;background:#fff}body{overflow-wrap:anywhere}</style></head><body>${safeHtml}</body></html>`
}
