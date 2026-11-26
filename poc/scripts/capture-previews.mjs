import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireChecker = createRequire(path.join(ROOT, 'upstream/verify-article-structure-spec/cli/package.json'))
const puppeteer = requireChecker('puppeteer')
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const THEMES_ROOT = path.join(ROOT, 'poc/artifacts/themes')

async function previewDirectories() {
  const entries = await readdir(THEMES_ROOT, { withFileTypes: true })
  const directories = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(THEMES_ROOT, entry.name)
    await readFile(path.join(directory, 'article-preview.html'))
    directories.push(directory)
  }
  return directories.sort()
}

const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? DEFAULT_CHROME,
  headless: 'new',
  args: ['--disable-dev-shm-usage'],
})
const summary = []
try {
  for (const directory of await previewDirectories()) {
    const page = await browser.newPage()
    const consoleMessages = []
    page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`))
    const previewUrl = pathToFileURL(path.join(directory, 'article-preview.html')).href
    await page.goto(previewUrl, { waitUntil: 'load', timeout: 20_000 })
    await page.evaluate(async () => {
      const images = [...document.images]
      await Promise.all(images.map(image => image.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
          })))
    })
    const images = await page.evaluate(() => [...document.images].map(image => ({
      src: image.currentSrc || image.getAttribute('src'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })))
    const name = path.basename(directory)
    await page.setViewport({ width: 740, height: 900, deviceScaleFactor: 1 })
    await page.screenshot({ path: path.join(directory, 'article-desktop.png'), fullPage: true })
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
    await page.screenshot({ path: path.join(directory, 'article-mobile.png'), fullPage: true })
    const record = {
      theme: name,
      preview: previewUrl,
      screenshots: ['article-desktop.png', 'article-mobile.png'],
      allImagesLoaded: images.every(image => image.complete && image.naturalWidth > 0),
      images,
      consoleMessages,
    }
    await writeFile(path.join(directory, 'capture-manifest.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    summary.push(record)
    await page.close()
  }
  await writeFile(path.join(THEMES_ROOT, 'capture-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(summary.map(item => ({ theme: item.theme, allImagesLoaded: item.allImagesLoaded })), null, 2))
}
finally {
  await browser.close()
}
