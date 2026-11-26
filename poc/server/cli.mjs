import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createDraftFromFiles, inspectArticle, MockWeChatClient, readDefaultPocFiles } from './draft-poc.mjs'
import { WeChatClient } from './wechat-client.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const ARTIFACTS = path.join(ROOT, 'poc/artifacts')

async function writeResult(name, value) {
  await mkdir(ARTIFACTS, { recursive: true })
  await writeFile(path.join(ARTIFACTS, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function loadEnvFile(filePath) {
  const text = await readFile(filePath, 'utf8')
  const result = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || line.trimStart().startsWith('#')) continue
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return result
}

async function main() {
  const command = process.argv[2] ?? 'inspect'
  const input = await readDefaultPocFiles()
  if (command === 'inspect') {
    const report = await inspectArticle(input)
    await writeResult('inspect-report.json', report)
    console.log(JSON.stringify(report, null, 2))
    if (!report.ready) process.exitCode = 1
    return
  }
  if (command === 'mock-draft') {
    const client = new MockWeChatClient()
    const result = await createDraftFromFiles({ client, ...input })
    await writeResult('mock-draft-result.json', { ...result, calls: client.calls })
    console.log(JSON.stringify({ ok: result.ok, mediaId: result.mediaId, comparison: result.comparison, calls: client.calls.length }, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }
  if (command === 'draft') {
    if (!process.argv.includes('--live') || process.env.WECHAT_LIVE_CONFIRM !== 'CREATE_DRAFT') {
      throw new Error('真实草稿需要 --live 且 WECHAT_LIVE_CONFIRM=CREATE_DRAFT；未执行任何网络操作')
    }
    const envPath = process.env.POC_WECHAT_ENV ?? path.join(ROOT, 'poc/.runtime/wechat.env')
    const config = await loadEnvFile(envPath)
    const client = new WeChatClient({
      appId: config.WECHAT_APP_ID,
      appSecret: config.WECHAT_APP_SECRET,
      accessToken: config.WECHAT_ACCESS_TOKEN,
      apiBase: config.WECHAT_API_BASE,
    })
    const result = await createDraftFromFiles({ client, ...input })
    await writeResult('live-draft-result.json', result)
    console.log(JSON.stringify({ ok: result.ok, mediaId: result.mediaId, comparison: result.comparison }, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }
  throw new Error(`未知命令 ${command}；仅支持 inspect/mock-draft/draft。POC 不提供发布或群发命令。`)
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, inspection: error.inspection }, null, 2))
  process.exitCode = 1
})
