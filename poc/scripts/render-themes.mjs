import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { listThemes } from '../../packages/wechat-theme/index.js'
import { inspectArticle } from '../server/draft-poc.mjs'
import { lintHtml } from '../../packages/wechat-quality/index.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const THEMES_ROOT = path.join(ROOT, 'poc/artifacts/themes')
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function run(script, env = {}, args = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`)
}

function escapeHtml(value = '') {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

await run('packages/wechat-theme/scripts/build.mjs')
const results = []
for (const theme of listThemes()) {
  console.log(`\n[theme] ${theme.name} (${theme.id}@${theme.version})`)
  const outputDir = path.posix.join('themes', theme.id)
  const directory = path.join(THEMES_ROOT, theme.id)
  await run('poc/scripts/render.mjs', {
    POC_THEME_CSS: `packages/wechat-theme/dist/${theme.id}.css`,
    POC_OUTPUT_DIR: outputDir,
    POC_MARKDOWN: 'poc/fixtures/theme-poc.md',
  })
  const fragmentPath = path.join(directory, 'article-fragment.html')
  const officialResultPath = path.join(ROOT, 'poc/quality/results/themes', `${theme.id}.json`)
  await run('poc/quality/verify.mjs', {}, [
    fragmentPath,
    `--out=${officialResultPath}`,
    `--executable-path=${CHROME}`,
  ])
  const [fragment, metadataRaw] = await Promise.all([
    readFile(fragmentPath, 'utf8'),
    readFile(path.join(ROOT, 'poc/fixtures/article.json'), 'utf8'),
  ])
  const [inspection, customLint] = await Promise.all([
    inspectArticle({ fragment, metadata: JSON.parse(metadataRaw), assetsRoot: path.join(ROOT, 'poc/fixtures') }),
    Promise.resolve(lintHtml(fragment, { target: 'editor-paste', source: fragmentPath })),
  ])
  await writeFile(path.join(directory, 'inspection.json'), `${JSON.stringify(inspection, null, 2)}\n`, 'utf8')
  await writeFile(path.join(directory, 'custom-lint.json'), `${JSON.stringify(customLint, null, 2)}\n`, 'utf8')
  const [manifest, official] = await Promise.all([
    readFile(path.join(directory, 'render-manifest.json'), 'utf8').then(JSON.parse),
    readFile(officialResultPath, 'utf8').then(JSON.parse),
  ])
  results.push({ ...theme, manifest, official, inspection, customLint, directory })
}

await run('poc/scripts/capture-previews.mjs', { PUPPETEER_EXECUTABLE_PATH: CHROME })
const captures = JSON.parse(await readFile(path.join(THEMES_ROOT, 'capture-summary.json'), 'utf8'))
const captureByTheme = new Map(captures.map(item => [item.theme, item]))
const summary = results.map((result) => {
  const capture = captureByTheme.get(result.id)
  return {
    id: result.id,
    name: result.name,
    version: result.version,
    description: result.description,
    characters: result.manifest.output.characters,
    outputSha256: result.manifest.output.sha256,
    officialValid: result.official.result?.isValid === true,
    violations: result.official.result?.violations ?? [],
    draftReady: result.inspection.ready === true,
    inspectionBlockers: result.inspection.blockers,
    customLintValid: result.customLint.valid === true,
    customLintIssues: result.customLint.issues ?? [],
    allImagesLoaded: capture?.allImagesLoaded === true,
    preview: `poc/artifacts/themes/${result.id}/article-preview.html`,
    desktopScreenshot: `poc/artifacts/themes/${result.id}/article-desktop.png`,
    mobileScreenshot: `poc/artifacts/themes/${result.id}/article-mobile.png`,
  }
})
const allPassed = summary.every(item => item.officialValid && item.draftReady && item.customLintValid && item.allImagesLoaded)
await writeFile(path.join(THEMES_ROOT, 'summary.json'), `${JSON.stringify({ allPassed, themes: summary }, null, 2)}\n`, 'utf8')

const cards = summary.map(item => `<article class="card ${item.officialValid && item.draftReady && item.customLintValid && item.allImagesLoaded ? 'pass' : 'fail'}">
  <div class="meta"><span class="eyebrow">${escapeHtml(item.id)} · v${escapeHtml(item.version)}</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.description)}</p>
  <div class="badges"><span>Official ${item.officialValid ? 'PASS' : 'FAIL'}</span><span>Draft ${item.draftReady ? 'READY' : 'BLOCKED'}</span><span>Lint ${item.customLintValid ? 'PASS' : 'FAIL'}</span><span>Images ${item.allImagesLoaded ? 'PASS' : 'FAIL'}</span><span>${item.characters} chars</span></div>
  <p><a href="${item.id}/article-preview.html">打开实时预览</a> · <a href="${item.id}/article-desktop.png">桌面截图</a> · <a href="${item.id}/article-mobile.png">手机截图</a></p></div>
  <a href="${item.id}/article-preview.html"><img src="${item.id}/article-mobile.png" alt="${escapeHtml(item.name)}手机预览" loading="lazy"></a>
</article>`).join('\n')
const gallery = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>微信主题验收画廊</title><style>
:root{color-scheme:dark;background:#0b1020;color:#eef3ff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#172554 0,#0b1020 42%)}main{max-width:1440px;margin:auto;padding:48px 24px}h1{font-size:clamp(30px,5vw,56px);margin:0 0 12px}.lead{color:#a9b6d3;max-width:760px;line-height:1.75}.summary{display:inline-block;margin:20px 0 32px;padding:10px 16px;border-radius:999px;background:${allPassed ? '#14532d' : '#7f1d1d'};font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:24px}.card{overflow:hidden;border:1px solid #2b3a5e;border-radius:20px;background:#121a30;box-shadow:0 20px 60px #0006}.card.pass{border-top:3px solid #34d399}.card.fail{border-top:3px solid #fb7185}.meta{padding:24px}.eyebrow{color:#7dd3fc;font-size:12px;letter-spacing:.12em;text-transform:uppercase}.meta h2{margin:8px 0}.meta p{color:#aab7d0;line-height:1.65}.badges{display:flex;flex-wrap:wrap;gap:8px}.badges span{padding:5px 9px;border-radius:8px;background:#1e2a47;color:#c8d5ef;font-size:12px}.card a{color:#93c5fd;text-decoration:none}.card> a{display:block;background:#fff}.card img{display:block;width:100%;height:auto}footer{margin-top:28px;color:#8191b0;line-height:1.7}@media(max-width:600px){main{padding:28px 14px}.grid{grid-template-columns:1fr}}</style></head><body><main><span class="eyebrow">WECHAT THEME LAB</span><h1>微信主题验收画廊</h1><p class="lead">同一篇包含列表、代码、表格、图片和脚注的文章，经 doocs 真实 Chromium 渲染、官方结构校验和桌面/手机截图。无需手动复制或逐套生成。</p><div class="summary">${allPassed ? '全部主题通过当前验收' : '存在未通过主题'}</div><section class="grid">${cards}</section><footer>官方 checker 未覆盖的规则仍以 packages/wechat-quality 与真实公众号读回为补充。截图用于预览，不替代真机验证。</footer></main></body></html>`
await writeFile(path.join(THEMES_ROOT, 'index.html'), gallery, 'utf8')
console.log(JSON.stringify({ allPassed, gallery: 'poc/artifacts/themes/index.html', themes: summary.map(item => ({ id: item.id, officialValid: item.officialValid, draftReady: item.draftReady, customLintValid: item.customLintValid, allImagesLoaded: item.allImagesLoaded })) }, null, 2))
if (!allPassed) process.exitCode = 1
