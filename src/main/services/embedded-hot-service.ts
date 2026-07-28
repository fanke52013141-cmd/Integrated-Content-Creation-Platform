import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import type { HotServiceStatus } from '../../shared/contracts.js'

const EMBEDDED_VERSION = '2.0.8'

interface RouteRegistryResponse {
  code?: number
  count?: number
}

export class EmbeddedHotService {
  private server?: Server
  private baseUrl?: string
  private startPromise?: Promise<string>
  private routeCount = 0
  private lastError?: string

  async start(): Promise<string> {
    if (this.baseUrl) return this.baseUrl
    if (this.startPromise) return this.startPromise

    this.startPromise = this.startInternal()
    try {
      return await this.startPromise
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : '内置热点服务启动失败'
      this.startPromise = undefined
      throw error
    }
  }

  status(): HotServiceStatus {
    return {
      mode: 'embedded',
      state: this.baseUrl ? 'ready' : this.lastError ? 'error' : 'starting',
      version: EMBEDDED_VERSION,
      routeCount: this.routeCount,
      warning: this.lastError
    }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.baseUrl = undefined
    this.startPromise = undefined
    if (!server) return

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
  }

  private async startInternal(): Promise<string> {
    process.env.USE_LOG_FILE = 'false'
    process.env.CACHE_TTL ??= '1800'
    process.env.REQUEST_TIMEOUT ??= '8000'

    const { default: hotApp } = await import('dailyhot-api/dist/app.js')
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const server = serve(
        {
          fetch: hotApp.fetch,
          hostname: '127.0.0.1',
          port: 0
        },
        (info) => resolve(`http://127.0.0.1:${info.port}`)
      ) as Server
      this.server = server
      server.once('error', reject)
    })

    const response = await fetch(`${baseUrl}/all`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) throw new Error(`内置热点服务健康检查失败（${response.status}）`)
    const registry = await response.json() as RouteRegistryResponse
    if (registry.code !== 200 || !registry.count) {
      throw new Error('内置热点服务没有发现可用数据源')
    }

    this.routeCount = registry.count
    this.lastError = undefined
    this.baseUrl = baseUrl
    return baseUrl
  }
}
