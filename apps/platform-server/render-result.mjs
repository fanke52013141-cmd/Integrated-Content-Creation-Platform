import path from 'node:path'
import { createRequire } from 'node:module'
import { compileRegisteredTheme } from '../../packages/wechat-theme/index.js'
import { compileModernColors, replaceTaskInputsWithStaticSymbols } from '../../poc/server/article-transforms.mjs'
import { inspectArticle } from '../../poc/server/draft-poc.mjs'
import { assertArticleImage, resolveInside } from '../../poc/server/images.mjs'
import { lintHtml } from '../../packages/wechat-quality/index.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireCore = createRequire(path.join(ROOT, 'upstream/doocs-md/packages/core/package.json'))
const { JSDOM } = requireCore('jsdom')

export async function buildPlatformRenderResult({ renderer, markdown, themeId = 'tech-blue', metadata = {}, assetsRoot = path.join(ROOT, 'poc/fixtures') }) {
  const theme = compileRegisteredTheme(themeId)
  const rendered = await renderer.render({
    markdown,
    themeId: 'default',
    customCSS: theme,
    themeOptions: {
      primaryColor: '#0F4C81',
      fontSize: '16px',
      isCiteStatus: true,
      isShowLineNumber: false,
      isMacCodeBlock: false,
      isCountStatus: false,
      legend: 'alt',
    },
  })
  const document = new JSDOM(`<body>${rendered.html}</body>`, { url: 'http://localhost/' }).window.document
  replaceTaskInputsWithStaticSymbols(document.body)
  compileModernColors(document.body)
  const images = []
  for (const [index, image] of [...document.querySelectorAll('img')].entries()) {
    const src = image.getAttribute('src') ?? ''
    const item = { id: `img-${index + 1}`, src }
    if (src.startsWith('assets/')) {
      try {
        const metadata = await assertArticleImage(resolveInside(assetsRoot, src))
        image.setAttribute('data-local-src', src)
        image.setAttribute('data-asset-id', item.id)
        if (metadata.width) image.setAttribute('data-w', String(metadata.width))
        image.setAttribute('data-ratio', metadata.width && metadata.height ? String(metadata.height / metadata.width) : '')
        image.style.maxWidth = '100%'
        image.style.height = 'auto'
        item.metadata = metadata
      }
      catch (error) {
        item.error = error.message
      }
    }
    images.push(item)
  }
  const html = document.body.innerHTML
  const normalizedMetadata = {
    article_type: 'news',
    title: metadata.title ?? '未命名文章',
    author: metadata.author ?? '',
    digest: metadata.digest ?? metadata.summary ?? '',
    content_source_url: metadata.content_source_url,
    thumb: metadata.thumb ?? metadata.cover ?? 'assets/cover-thumb.jpg',
    need_open_comment: 0,
    only_fans_can_comment: 0,
  }
  const [inspection, customLint] = await Promise.all([
    inspectArticle({ fragment: html, metadata: normalizedMetadata, assetsRoot }),
    Promise.resolve(lintHtml(html, { target: 'editor-paste', source: 'api-render' })),
  ])
  return {
    html,
    plainText: rendered.plainText,
    themeId,
    renderer: rendered.metadata,
    metadata: normalizedMetadata,
    images,
    quality: {
      ready: inspection.ready && customLint.valid,
      inspection,
      customLint,
    },
  }
}
