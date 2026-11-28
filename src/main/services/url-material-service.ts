import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import * as cheerio from 'cheerio'
import type { Material } from '../../shared/contracts.js'
import { resolveExternalUrl } from '../../shared/domain.js'
import type { AppDatabase } from '../database.js'

const FETCH_TIMEOUT_MS = 20_000
const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000

/** 拦截本机与内网私网地址，防止 SSRF 探测内网服务 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^::ffff:/, '')
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true
  }
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (isIP(host)) return isPrivateOrReservedIp(host)
  return false
}

export function extractArticleFromHtml(html: string, fallbackUrl: string): { title: string; content: string; siteName: string } {
  const $ = cheerio.load(html)
  $('script, style, noscript, iframe, svg, canvas, form, nav, footer, aside, button').remove()

  const title = (
    $('meta[property="og:title"]').attr('content')
    || $('h1').first().text()
    || $('title').first().text()
    || new URL(fallbackUrl).hostname
  ).replace(/\s+/g, ' ').trim().slice(0, 200)

  const siteName = (
    $('meta[property="og:site_name"]').attr('content')
    || new URL(fallbackUrl).hostname.replace(/^www\./, '')
  ).trim().slice(0, 100)

  // 优先命中常见文章主体容器（含微信公众号 #js_content）
  const container = $('#js_content').length
    ? $('#js_content').first()
    : $('article').length
      ? $('article').first()
      : $('main, [role="main"]').length
        ? $('main, [role="main"]').first()
        : $('body')

  const blocks: string[] = []
  container.find('h1, h2, h3, h4, p, li, blockquote').each((_idx, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text.length >= 2) blocks.push(text)
  })
  const rawContent = blocks.length
    ? blocks.join('\n\n')
    : container.text().replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const content = rawContent.slice(0, MAX_TEXT_CHARS).trim()
  return { title, content, siteName }
}

/**
 * 网页链接抓正文入素材库：服务外部 Deep Research / 深度参考文章导入。
 * 全文存进 workflow 文档存储，供框架与写作阶段按片段溯源消费。
 */
export class UrlMaterialService {
  constructor(
    private readonly database: AppDatabase,
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolveDns: (host: string) => Promise<string[]> = async (host) => {
      const records = await lookup(host, { all: true })
      return records.map((record) => record.address)
    }
  ) {}

  async importFromUrl(input: { url: string; relatedTopicId?: string }): Promise<Material> {
    const parsed = resolveExternalUrl(input.url)
    if (!parsed) throw new Error('请输入有效的 http 或 https 网页链接')
    if (isBlockedHostname(parsed.hostname)) throw new Error('出于安全限制，不允许抓取本机或内网地址')

    if (!isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) {
      try {
        const addresses = await this.resolveDns(parsed.hostname)
        if (addresses.some((addr) => isPrivateOrReservedIp(addr))) {
          throw new Error('目标域名解析到内网地址，已拒绝抓取')
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('内网地址')) throw error
      }
    }

    let response: Response
    try {
      response = await this.fetcher(parsed.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
        }
      })
    } catch {
      throw new Error('抓取网页超时或网络连接失败，请稍后重试或复制正文手动导入')
    }

    if (!response.ok) throw new Error(`网页抓取失败（HTTP ${response.status}），可尝试手动复制正文导入`)
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_HTML_BYTES) throw new Error('网页体积超过 5MB 上限，请保存后按文件导入')

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > MAX_HTML_BYTES) throw new Error('网页体积超过 5MB 上限，请保存后按文件导入')

    const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const { title, content, siteName } = extractArticleFromHtml(html, parsed.toString())
    if (content.length < 30) {
      throw new Error('未能从该网页提取到足够正文（可能需要登录或由前端脚本动态渲染），建议复制正文手动导入')
    }

    const material = this.database.addManualMaterial({
      title: title || siteName,
      summary: content.slice(0, 2000),
      sourceUrl: parsed.toString(),
      sourceNote: `网页抓取 · ${siteName} · 全文 ${content.length} 字符`,
      relatedTopicId: input.relatedTopicId
    })
    this.database.workflow.saveDocument(
      material.id,
      createHash('sha256').update(content).digest('hex'),
      content
    )
    return material
  }
}
