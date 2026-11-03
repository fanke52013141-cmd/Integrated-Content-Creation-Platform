import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DreaminaLoginInfo, DreaminaStatus } from '../../shared/contracts.js'
import { GatewayError } from './types.js'

/**
 * 即梦（Dreamina）本机 CLI 适配器。
 *
 * 协议要点（来自 free-creation 的 DREAMINA_CLI_ADAPTER_PLAN 实测）：
 * - 无 Base URL / API Key：登录态由 CLI 持久化在本机（~/.dreamina_cli），按即梦会员额度计费；
 * - 生图：text2image / image2image 提交后拿 submit_id，query_result 轮询 1–3s，
 *   产物 CDN URL 带 x-expires 签名，完成后必须立即下载；
 * - 提交不可重试：CLI 无幂等键，重试会重复扣费；
 * - 刚提交后 query_result 可能瞬时返回 ret=1015，不能判为失败；
 * - 图片分辨率硬下限 2k；比例只有 8 档（21:9…9:16），没有 auto。
 *
 * 白名单：只开放图片 5.0 / 5.0Pro。视频（seedance 全系、VIDU 等）明确不接入，
 * 执行前直接拒绝，避免误用排队的禁用型号。
 */
export const DREAMINA_IMAGE_MODELS = new Set(['5.0', '5.0Pro'])

const DREAMINA_RATIOS = new Set(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'])

/** CLI 安装说明（找不到二进制时给用户的一步步指引） */
export const DREAMINA_INSTALL_HINT = '未检测到即梦 CLI。安装：在 Git Bash 运行 curl -s https://jimeng.jianying.com/cli | bash（Windows 不要用 WSL）；安装后位于 ~/bin/dreamina.exe，也可用环境变量 MOLIU_DREAMINA_PATH 指定路径。'

/** 解析 CLI 可执行文件路径：环境变量优先（用户显式指定，原样使用），其次默认安装位置 */
export function resolveDreaminaCliPath(): string | null {
  const fromEnv = process.env.MOLIU_DREAMINA_PATH?.trim()
  if (fromEnv) return fromEnv
  const executable = process.platform === 'win32' ? 'dreamina.exe' : 'dreamina'
  const candidate = join(homedir(), 'bin', executable)
  return existsSync(candidate) ? candidate : null
}

function requireCliPath(): string {
  const path = resolveDreaminaCliPath()
  if (!path || !existsSync(path)) throw new GatewayError('ProviderConfigError', DREAMINA_INSTALL_HINT)
  return path
}

/** 把 CLI 的常见错误映射为用户可读的提示 */
function mapCliError(raw: string): GatewayError {
  if (/DREAMINA_AUTH_REQUIRED|not\s*logged|未登录|login\s*required/i.test(raw)) {
    return new GatewayError('AuthError', '尚未登录即梦：请在「AI 服务」选择即梦供应商，点击「登录即梦」完成授权')
  }
  if (/AigcComplianceConfirmationRequired/i.test(raw)) {
    return new GatewayError('ProviderError', '该即梦模型需要先在即梦网页端手动生成一次完成合规确认，之后即可在应用内使用')
  }
  if (/DREAMINA_MODEL_DISABLED/i.test(raw)) {
    return new GatewayError('ProviderConfigError', '该即梦型号未开放（仅支持图片 5.0 / 5.0Pro）')
  }
  return new GatewayError('ProviderError', `即梦 CLI 执行失败：${raw.slice(0, 300) || '未输出原因'}`)
}

function runCli(cliPath: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cliPath, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (signal?.aborted) {
        reject(new GatewayError('CancelledError', '已取消本次生成'))
        return
      }
      if (error) {
        const raw = `${stderr || ''}\n${stdout || ''}\n${error.message}`.trim()
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new GatewayError('ProviderConfigError', DREAMINA_INSTALL_HINT))
          return
        }
        if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT' || error.killed) {
          reject(new GatewayError('TimeoutError', `即梦 CLI 超过 ${Math.round(timeoutMs / 1000)} 秒未响应`))
          return
        }
        reject(mapCliError(raw))
        return
      }
      resolve(stdout)
    })
  })
}

/** CLI 输出常带日志前缀，取第一段完整 JSON 解析；解析不了返回 null */
function parseCliJson(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** 安装与登录状态（user_credit 不消耗额度，同时用作登录态探测） */
export async function dreaminaStatus(): Promise<DreaminaStatus> {
  const cliPath = resolveDreaminaCliPath()
  if (!cliPath || !existsSync(cliPath)) return { installed: false, cliPath: '', message: DREAMINA_INSTALL_HINT }
  try {
    const output = await runCli(cliPath, ['user_credit'], 15_000)
    const parsed = parseCliJson(output)
    const totalCredit = typeof parsed?.total_credit === 'number' ? parsed.total_credit : undefined
    if (totalCredit !== undefined || stringField(parsed, 'total_credit')) {
      const creditValue = totalCredit ?? Number.parseFloat(stringField(parsed, 'total_credit') ?? '')
      return {
        installed: true,
        cliPath,
        loggedIn: true,
        totalCredit: Number.isFinite(creditValue) ? creditValue : undefined,
        vipLevel: parsed?.vip_level != null ? String(parsed.vip_level) : undefined
      }
    }
    // 输出里没有额度字段：命令成功但结构未知，保守认为已登录
    if (!/DREAMINA_AUTH_REQUIRED|未登录|login/i.test(output)) return { installed: true, cliPath, loggedIn: true }
    return { installed: true, cliPath, loggedIn: false, message: '尚未登录即梦，请点击「登录即梦」完成授权' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof GatewayError && error.kind === 'AuthError') {
      return { installed: true, cliPath, loggedIn: false, message: error.message }
    }
    return { installed: true, cliPath, loggedIn: false, message: message.slice(0, 300) }
  }
}

/**
 * headless 登录：后台启动 `login --headless`，从输出解析授权链接与设备码后立即返回，
 * 登录流程由 CLI 继续在后台等待浏览器授权；调用方轮询 dreaminaStatus 直到 loggedIn。
 * 应用全程不接触 token。
 */
export function dreaminaLogin(): Promise<DreaminaLoginInfo> {
  const cliPath = requireCliPath()
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, ['login', '--headless'], { windowsHide: true })
    let buffer = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new GatewayError('TimeoutError', '即梦登录 15 秒内未返回授权链接，请确认 CLI 可用后重试'))
        child.kill()
      }
    }, 15_000)
    const onChunk = (chunk: Buffer): void => {
      if (settled) return
      buffer += chunk.toString('utf8')
      const authUrl = /https?:\/\/[^\s"')]+/.exec(buffer)?.[0]
      if (!authUrl) return
      settled = true
      clearTimeout(timer)
      const parsed = parseCliJson(buffer)
      resolve({
        authUrl,
        deviceCode: stringField(parsed, 'device_code'),
        userCode: stringField(parsed, 'user_code')
      })
      // 登录进程继续后台运行等待授权完成，不 kill
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject((error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new GatewayError('ProviderConfigError', DREAMINA_INSTALL_HINT)
        : mapCliError(error.message))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(mapCliError(`login 进程退出（code ${code}）：${buffer.slice(0, 200)}`))
    })
  })
}

export interface DreaminaGenerateInput {
  model: string
  prompt: string
  /** 8 档画幅之一；缺省 1:1 */
  ratio?: string
  /** '2k'（默认，图片质量硬下限）或 '4k' */
  resolution?: string
  /** 图生图的本地参考图绝对路径 */
  referenceImagePath?: string
  signal?: AbortSignal
  onTaskCreated?: (submitId: string) => void
  onProgress?: (progress: number) => void
}

export interface DreaminaGenerateResult {
  base64: string
  model: string
  submitId: string
  remoteUrl: string
}

/** 提交生图任务并轮询到完成，下载图片转 base64（CDN URL 带过期签名，必须立即下载） */
export async function dreaminaGenerateImage(input: DreaminaGenerateInput): Promise<DreaminaGenerateResult> {
  // 白名单校验先于 CLI 探测：视频等未接入型号在任何机器上都直接拒绝
  if (!DREAMINA_IMAGE_MODELS.has(input.model)) {
    throw new GatewayError('ProviderConfigError', `即梦仅开放图片模型 5.0 / 5.0Pro（本次请求：${input.model}）；视频生成未接入`)
  }
  const cliPath = requireCliPath()
  const ratio = input.ratio && DREAMINA_RATIOS.has(input.ratio) ? input.ratio : '1:1'
  const resolutionType = input.resolution === '4k' ? '4k' : '2k'
  const baseArgs = [
    input.referenceImagePath ? 'image2image' : 'text2image',
    ...(input.referenceImagePath ? ['--images', input.referenceImagePath] : []),
    '--prompt', input.prompt,
    '--model_version', input.model,
    '--resolution_type', resolutionType,
    '--ratio', ratio,
    '--session=0',
    '--poll=0'
  ]
  const startedAt = Date.now()

  // 提交只发一次：CLI 无幂等键，超时/失败重试都会重复扣费
  const submitOutput = await runCli(cliPath, baseArgs, 60_000, input.signal)
  const submit = parseCliJson(submitOutput)
  const submitId = stringField(submit, 'submit_id') ?? /"submit_id"\s*:\s*"([^"]+)"/.exec(submitOutput)?.[1]
  if (!submitId) throw new GatewayError('ProviderError', `即梦提交失败：${submitOutput.slice(0, 200) || '未返回任务号'}`)
  input.onTaskCreated?.(submitId)

  const deadline = Date.now() + 10 * 60_000
  let lastProgress = -1
  while (Date.now() < deadline) {
    if (input.signal?.aborted) throw new GatewayError('CancelledError', '已取消本次生成')
    let queryOutput: string
    try {
      queryOutput = await runCli(cliPath, ['query_result', '--submit_id', submitId], 30_000, input.signal)
    } catch (error) {
      // 刚提交后可能瞬时 1015（get_history_by_ids failed），继续轮询
      if (error instanceof GatewayError && /1015/.test(error.message)) {
        await sleep(1_500)
        continue
      }
      throw error
    }
    const query = parseCliJson(queryOutput)
    const status = stringField(query, 'gen_status') ?? /"gen_status"\s*:\s*"([^"]+)"/.exec(queryOutput)?.[1]
    const progressRaw = query?.progress
    if (typeof progressRaw === 'number' && progressRaw !== lastProgress) {
      lastProgress = progressRaw
      input.onProgress?.(Math.max(0, Math.min(100, progressRaw)))
    }
    if (status === 'success') {
      const resultJson = query?.result_json && typeof query.result_json === 'object' ? query.result_json as Record<string, unknown> : null
      const images = resultJson && Array.isArray(resultJson.images) ? resultJson.images as Array<Record<string, unknown>> : []
      const remoteUrl = stringField(images[0] ?? null, 'image_url')
        ?? /"image_url"\s*:\s*"([^"]+)"/.exec(queryOutput)?.[1]
      if (!remoteUrl) throw new GatewayError('ParseError', '即梦任务完成但未返回图片地址')
      const imageResponse = await fetch(remoteUrl, { signal: input.signal })
      if (!imageResponse.ok) throw new GatewayError('NetworkError', `下载即梦生成图片失败（HTTP ${imageResponse.status}）`)
      const base64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64')
      if (Date.now() - startedAt > 3_000) input.onProgress?.(100)
      return { base64, model: input.model, submitId, remoteUrl }
    }
    if (status === 'fail' || status === 'failed') {
      const reason = stringField(query, 'fail_msg') ?? stringField(query, 'message') ?? '未给出原因'
      throw new GatewayError('ProviderError', `即梦生图任务失败：${reason}`)
    }
    await sleep(1_500)
  }
  throw new GatewayError('TimeoutError', `即梦生图任务超过 10 分钟未完成（任务 ${submitId}，可稍后在即梦 App 查看）`)
}

/** 把远端参考图下载成本地临时文件（image2image 只接受本地路径），用完由调用方清理 */
export async function downloadReferenceImage(url: string): Promise<{ path: string; cleanup(): Promise<void> }> {
  const response = await fetch(url)
  if (!response.ok) throw new GatewayError('NetworkError', `下载参考图失败（HTTP ${response.status}）`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const dir = await mkdtemp(join(tmpdir(), 'moliu-dreamina-ref-'))
  const path = join(dir, 'reference.png')
  await writeFile(path, bytes)
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
