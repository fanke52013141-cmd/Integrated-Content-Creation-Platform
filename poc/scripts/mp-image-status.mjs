import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireChecker = createRequire(path.join(ROOT, 'upstream/verify-article-structure-spec/cli/package.json'))
const puppeteer = requireChecker('puppeteer')
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
try {
  const pages = await browser.pages()
  const page = pages.find(candidate => /appmsg_edit/i.test(candidate.url()))
  if (!page) throw new Error('未找到公众号编辑器页面')
  await page.waitForFunction(() => [...document.images].some(image => image.complete), { timeout: 10_000 }).catch(() => {})
  const result = await page.evaluate(() => [...document.images].map((image, index) => {
    const rect = image.getBoundingClientRect()
    return {
      index: index + 1,
      src: image.getAttribute('src'),
      dataSrc: image.getAttribute('data-src'),
      currentSrc: image.currentSrc,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      visible: rect.width > 0 && rect.height > 0,
    }
  }).filter(image => `${image.dataSrc ?? ''}${image.currentSrc ?? ''}`.includes('sz_mmbiz_png/WOs')))
  await page.evaluate(() => {
    const image = document.querySelector('img[src*="sz_mmbiz_png/WOs"]')
    image?.scrollIntoView({ block: 'center' })
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  await page.screenshot({ path: path.join(ROOT, 'poc/artifacts/live-mp-article.png'), fullPage: false })
  await writeFile(path.join(ROOT, 'poc/artifacts/live-mp-image-status.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
}
finally {
  await browser.disconnect()
}
