import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const requireCore = createRequire(path.join(ROOT, 'upstream/doocs-md/packages/core/package.json'))
const { JSDOM } = requireCore('jsdom')
const TEST_IMAGE = 'https://mmbiz.qpic.cn/sz_mmbiz_png/WOsCxdtAXDtQWXtgKojxKdmZ4ic5UkzRMYqt9K5o6WmgwXQvAmkbnpfsicTglzzAhdjib7icSwVYS7WZiagJfUwDQVA/640?wx_fmt=png&tp=webp&wxfrom=10005&wx_lazy=1'
const fragment = await readFile(path.join(ROOT, 'poc/artifacts/article-fragment.html'), 'utf8')
const document = new JSDOM(`<body>${fragment}</body>`).window.document
const images = [...document.querySelectorAll('img')]
if (images.length !== 1) throw new Error(`预期 1 张图片，实际 ${images.length}`)
const image = images[0]
image.setAttribute('src', TEST_IMAGE)
image.setAttribute('alt', '微信官方文档测试图片')
image.removeAttribute('data-local-src')
image.setAttribute('data-w', '1080')
const output = document.body.innerHTML
await writeFile(path.join(ROOT, 'poc/artifacts/article-fragment-live.html'), output, 'utf8')
await writeFile(path.join(ROOT, 'poc/artifacts/live-image.json'), `${JSON.stringify({
  source: 'WeChat official plugin specification example image',
  url: TEST_IMAGE,
  reason: 'The first live write proved that a relative local image has no loadable src after set_content. This second isolated test uses an existing WeChat-hosted image and does not claim to verify local image upload.',
}, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, output: 'poc/artifacts/article-fragment-live.html', images: 1 }, null, 2))
