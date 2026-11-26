import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { effectiveImageSources, visibleText } from '../server/visible-text.mjs'
import { listThemes } from '../../packages/wechat-theme/index.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireChecker = createRequire(path.join(ROOT, 'upstream/verify-article-structure-spec/cli/package.json'))
const requireCore = createRequire(path.join(ROOT, 'upstream/doocs-md/packages/core/package.json'))
const puppeteer = requireChecker('puppeteer')
const { JSDOM } = requireCore('jsdom')
const TEST_IMAGE = 'https://mmbiz.qpic.cn/sz_mmbiz_png/WOsCxdtAXDtQWXtgKojxKdmZ4ic5UkzRMYqt9K5o6WmgwXQvAmkbnpfsicTglzzAhdjib7icSwVYS7WZiagJfUwDQVA/640?wx_fmt=png&tp=webp&wxfrom=10005&wx_lazy=1'
const NEW_DRAFT_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&lang=zh_CN'
const previousLiveResult = await readFile(path.join(ROOT, 'poc/artifacts/live-mp-result.json'), 'utf8')
  .then(value => JSON.parse(value))
  .catch(() => null)
const DRAFT_URL = process.env.POC_MP_DRAFT_URL ?? previousLiveResult?.url ?? NEW_DRAFT_URL

function prepareLiveHtml(fragment) {
  const document = new JSDOM(`<body>${fragment}</body>`).window.document
  for (const image of document.querySelectorAll('img')) {
    image.setAttribute('src', TEST_IMAGE)
    image.setAttribute('alt', '微信官方文档测试图片')
    image.removeAttribute('data-local-src')
  }
  return document.body.innerHTML
}

function compare(source, readback) {
  const sourceVisible = visibleText(source)
  const readbackVisible = visibleText(readback)
  const sourceImages = effectiveImageSources(source)
  const readbackImages = effectiveImageSources(readback)
  const isWeChat = url => /^https:\/\/mmbiz\.qpic\.cn\//i.test(url)
  return {
    nonWhitespaceEqual: sourceVisible.replace(/\s/g, '') === readbackVisible.replace(/\s/g, ''),
    visibleTextEqual: sourceVisible === readbackVisible,
    sourceTextCharacters: sourceVisible.length,
    readbackTextCharacters: readbackVisible.length,
    sourceImages,
    readbackImages,
    imagesValid: sourceImages.length === readbackImages.length && sourceImages.every(isWeChat) && readbackImages.every(isWeChat),
  }
}

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const results = []
try {
  const pages = await browser.pages()
  let page = pages.find(candidate => /appmsg_edit/i.test(candidate.url()))
  if (!page) {
    page = pages.find(candidate => candidate.url().startsWith('https://mp.weixin.qq.com/')) ?? await browser.newPage()
    await page.goto(NEW_DRAFT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  }
  if (!/appmsg_edit/i.test(page.url())) throw new Error('未打开可丢弃的公众号测试草稿')
  await page.goto(DRAFT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => Boolean(window.__MP_Editor_JSAPI__), { timeout: 30_000 })
  const apiSource = await readFile(path.join(ROOT, 'poc/mp-extension/page-api.js'), 'utf8')
  await page.evaluate(`${apiSource}\nwindow.__pocRunMpOperation = runMpOperation`)
  const detected = await page.evaluate(() => window.__pocRunMpOperation({ type: 'detect' }))
  if (!detected.ok || !detected.ready || !detected.isNew) throw new Error(`编辑器未就绪：${JSON.stringify(detected)}`)

  for (const theme of listThemes()) {
    const directory = path.join(ROOT, 'poc/artifacts/themes', theme.id)
    const fragment = await readFile(path.join(directory, 'article-fragment.html'), 'utf8')
    const liveHtml = prepareLiveHtml(fragment)
    await writeFile(path.join(directory, 'article-live.html'), liveHtml, 'utf8')
    const backup = await page.evaluate(() => window.__pocRunMpOperation({ type: 'read' }))
    if (!backup.ok) throw new Error(`${theme.id} 写入前读取失败：${JSON.stringify(backup)}`)
    const written = await page.evaluate(({ expectedBefore, html }) => window.__pocRunMpOperation({
      type: 'set_content',
      expectedBefore,
      html,
      confirmation: 'WRITE_CURRENT_MP_EDITOR',
    }), { expectedBefore: backup.content, html: liveHtml })
    if (!written.ok) throw new Error(`${theme.id} 写入失败：${JSON.stringify(written)}`)
    const comparison = compare(liveHtml, written.afterContent)
    const imageStatus = await page.evaluate(() => [...document.images]
      .filter(image => `${image.currentSrc}`.includes('sz_mmbiz_png/WOs'))
      .map(image => ({ currentSrc: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, visible: image.getBoundingClientRect().width > 0 })))
    const result = {
      theme: theme.id,
      version: theme.version,
      passed: comparison.nonWhitespaceEqual && comparison.imagesValid && imageStatus.every(image => image.complete && image.naturalWidth > 0 && image.visible),
      comparison,
      imageStatus,
      writeCalled: written.writeCalled,
      published: false,
      massSent: false,
    }
    await writeFile(path.join(directory, 'live-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    results.push(result)
  }
  const summary = { allPassed: results.every(result => result.passed), themes: results, note: 'Real MP set_content/get_content on a disposable test draft. WeChat-hosted test image. No publish or mass send.' }
  await mkdir(path.join(ROOT, 'poc/artifacts/themes'), { recursive: true })
  await writeFile(path.join(ROOT, 'poc/artifacts/themes/live-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.allPassed) process.exitCode = 1
}
finally {
  await browser.close()
}
