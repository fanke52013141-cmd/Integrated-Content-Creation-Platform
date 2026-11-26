import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { compareDraftHtml } from '../server/draft-poc.mjs'
import { effectiveImageSources, visibleText } from '../server/visible-text.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireChecker = createRequire(path.join(ROOT, 'upstream/verify-article-structure-spec/cli/package.json'))
const puppeteer = requireChecker('puppeteer')
const command = process.argv[2] ?? 'detect'
const confirmedWrite = process.argv.includes('--confirm-write') && process.env.WECHAT_LIVE_CONFIRM === 'WRITE_CURRENT_MP_EDITOR'

async function save(name, value) {
  await mkdir(path.join(ROOT, 'poc/artifacts'), { recursive: true })
  await writeFile(path.join(ROOT, 'poc/artifacts', name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  try {
    const pages = await browser.pages()
    const candidates = []
    for (const page of pages) {
      if (!page.url().startsWith('https://mp.weixin.qq.com/')) continue
      candidates.push(page)
    }
    if (!candidates.length) throw new Error('POC Chrome 中未找到公众号页面')
    const editorCandidates = candidates.filter(candidate => /appmsg_edit/i.test(candidate.url()))
    const selectable = editorCandidates.length ? editorCandidates : candidates
    const requestedTarget = process.env.POC_MP_TARGET_ID
    const page = requestedTarget
      ? selectable.find(candidate => candidate.target?._targetId === requestedTarget) ?? selectable[0]
      : selectable[0]
    const apiSource = await readFile(path.join(ROOT, 'poc/mp-extension/page-api.js'), 'utf8')
    await page.evaluate(`${apiSource}\nwindow.__pocRunMpOperation = runMpOperation`)

    if (command === 'detect') {
      const result = await page.evaluate(() => window.__pocRunMpOperation({ type: 'detect' }))
      await save('live-mp-detect.json', result)
      console.log(JSON.stringify(result, null, 2))
      if (!result.ok || !result.detected) process.exitCode = 1
      return
    }

    if (command === 'read') {
      const result = await page.evaluate(() => window.__pocRunMpOperation({ type: 'read' }))
      await save('live-mp-backup.json', result)
      console.log(JSON.stringify({ ...result, content: result.content ? `<${result.content.length} characters>` : result.content }, null, 2))
      if (!result.ok) process.exitCode = 1
      return
    }

    if (command === 'write') {
      if (!confirmedWrite) throw new Error('真实写入需要 --confirm-write 且 WECHAT_LIVE_CONFIRM=WRITE_CURRENT_MP_EDITOR')
      const backup = JSON.parse(await readFile(path.join(ROOT, 'poc/artifacts/live-mp-backup.json'), 'utf8'))
      if (!backup.ok || typeof backup.content !== 'string') throw new Error('请先成功执行 read 并保存备份')
      const fragmentName = process.env.POC_MP_FRAGMENT ?? 'article-fragment.html'
      const fragment = await readFile(path.join(ROOT, 'poc/artifacts', fragmentName), 'utf8')
      const result = await page.evaluate(({ expectedBefore, html }) => window.__pocRunMpOperation({
        type: 'set_content',
        expectedBefore,
        html,
        confirmation: 'WRITE_CURRENT_MP_EDITOR',
      }), { expectedBefore: backup.content, html: fragment })
      let comparison = null
      if (result.ok && result.afterContent) {
        comparison = compareDraftHtml(fragment, result.afterContent)
        const sourceVisible = visibleText(fragment)
        const readbackVisible = visibleText(result.afterContent)
        const sourceImages = effectiveImageSources(fragment)
        const readbackImages = effectiveImageSources(result.afterContent)
        const isWeChatUrl = url => /^https:\/\/mmbiz\.qpic\.cn\//i.test(url)
        comparison.visibleTextEqual = sourceVisible === readbackVisible
        comparison.nonWhitespaceEqual = sourceVisible.replace(/\s/g, '') === readbackVisible.replace(/\s/g, '')
        comparison.sourceImages = sourceImages
        comparison.readbackImages = readbackImages
        comparison.imagesValid = sourceImages.length === readbackImages.length
          && sourceImages.every(isWeChatUrl)
          && readbackImages.every(isWeChatUrl)
        comparison.passed = comparison.nonWhitespaceEqual && comparison.imagesValid
      }
      await save('live-mp-result.json', { ...result, comparison })
      console.log(JSON.stringify({
        ok: result.ok && Boolean(comparison?.passed),
        error: result.error,
        writeCalled: result.writeCalled,
        comparison,
        url: result.url,
      }, null, 2))
      if (!result.ok || !comparison?.passed) process.exitCode = 1
      return
    }
    throw new Error(`未知命令 ${command}；仅支持 detect/read/write`)
  }
  finally {
    await browser.disconnect()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
  process.exitCode = 1
})
