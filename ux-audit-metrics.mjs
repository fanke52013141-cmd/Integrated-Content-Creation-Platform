// UX 量化测量 v2：逻辑内联，避免 initScript 注入时序问题。
import { chromium } from 'playwright-core'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = resolve('artifacts/ux-audit')
mkdirSync(outDir, { recursive: true })

const browserExe = (() => {
  for (const r of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const p of [['Google','Chrome','Application','chrome.exe'], ['Microsoft','Edge','Application','msedge.exe']]) {
      const full = join(r, ...p)
      if (existsSync(full)) return full
    }
  }
  return null
})()

const browser = await chromium.launch({
  executablePath: browserExe,
  // file:// 下 ES module 需要此标志，否则被 CORS 拦截导致白屏
  args: ['--allow-file-access-from-files']
})
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(pathToFileURL(resolve('out/renderer/index.html')).href, { waitUntil: 'domcontentloaded' })
// 明确等待应用外壳渲染完成，而不是靠固定 sleep 猜
await page.waitForSelector('.nav-item', { timeout: 30_000 })
await page.waitForFunction(() => !document.querySelector('.boot-screen'), { timeout: 30_000 }).catch(() => {})
await page.waitForTimeout(800)

// 先验证测量函数在真实页面可用
const sanity = await page.evaluate(() => {
  const el = document.querySelector('.nav-item')
  if (!el) return { ok: false, why: 'no nav-item' }
  const cs = getComputedStyle(el)
  return { ok: true, color: cs.color, bg: cs.backgroundColor, fontSize: cs.fontSize }
})
console.log('sanity:', JSON.stringify(sanity))
if (!sanity.ok) { console.error('page not ready'); process.exit(1) }

const PAGES = [
  ['home','创作台'],['accounts','账号定位'],['hotspots','热点洞察'],['topics','选题生成'],
  ['frameworks','内容框架'],['articles','文章创作'],['reviews','内容评审'],['visuals','智能配图'],
  ['layouts','文章排版'],['publishing','发布管理'],['materials','素材库'],['providers','模型网关'],['prompts','提示词']
]

// 完整测量函数（每次 evaluate 内部自包含）
const measure = () => {
  const parseRGB = (c) => {
    if (!c) return null
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(s => s !== '').map(parseFloat)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b)
  }
  const ratio = (fg, bg) => {
    const a = lum(fg), b = lum(bg)
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
  }
  const bgOf = (el) => {
    let n = el
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const c = parseRGB(cs.backgroundColor)
      if (c && c.a >= 0.85) return c
      // 渐变背景无法采样，退到父级
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        const p = parseRGB(cs.backgroundColor)
        if (p && p.a > 0) return p
      }
      n = n.parentElement
    }
    return { r: 255, g: 255, b: 255, a: 1 }
  }
  const blend = (fg, bg) => {
    if (fg.a >= 1) return fg
    return { r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a: 1 }
  }

  const out = { contrast: [], small: [], fonts: [], gaps: [], headings: [], counts: { textNodes: 0, clickable: 0 } }

  const textSel = 'p,span,small,strong,em,b,button,label,a,h1,h2,h3,h4,li,td,th,summary,legend,div'
  for (const el of Array.from(document.querySelectorAll(textSel))) {
    const direct = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!direct) continue
    const txt = (el.textContent || '').trim()
    if (!txt || txt.length > 60) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const op = parseFloat(cs.opacity)
    if (op < 0.4) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    if (rect.bottom < 0 || rect.top > innerHeight + 400) continue
    const fgRaw = parseRGB(cs.color)
    if (!fgRaw) continue
    const bg = bgOf(el)
    const fg = blend(fgRaw, bg)
    const cr = ratio(fg, bg)
    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3.0 : 4.5
    out.counts.textNodes++
    if (cr < need) {
      out.contrast.push({
        text: txt.slice(0, 40), ratio: +cr.toFixed(2), need, size,
        color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 44)
      })
    }
    if (size < 12) out.fonts.push({ text: txt.slice(0, 26), size, cls: (el.className?.toString?.() || '').slice(0, 34) })
  }

  for (const el of Array.from(document.querySelectorAll('button,a[href],[role="button"],input[type="checkbox"],input[type="radio"],select,summary'))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const cls = el.className?.toString?.() || ''
    if (cls.includes('skip-link')) continue
    // 原生 checkbox 常被视觉隐藏，交给 label 承担点击区
    if (el.tagName === 'INPUT' && (cs.opacity === '0' || cs.width === '0px' || cs.height === '0px')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    out.counts.clickable++
    if (r.height < 24 || r.width < 24) {
      out.small.push({
        tag: el.tagName.toLowerCase(), cls: cls.slice(0, 40),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        label: (el.textContent || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 24)
      })
    }
  }

  for (const f of Array.from(document.querySelectorAll('label.field, .field'))) {
    const span = f.querySelector(':scope > span')
    if (!span) continue
    const ctrl = f.querySelector('input:not([type=checkbox]),textarea,select,.select-trigger,.segmented')
    if (!ctrl) continue
    const a = span.getBoundingClientRect(), b = ctrl.getBoundingClientRect()
    out.gaps.push({ label: span.textContent.trim().slice(0, 16), gap: +(b.top - a.bottom).toFixed(1) })
  }

  const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => +h.tagName[1])
  for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i-1] > 1) out.headings.push(`${hs[i-1]}→${hs[i]}`)
  return out
}

const report = []
for (const [route, label] of PAGES) {
  await page.evaluate((l) => {
    const t = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent?.trim().endsWith(l))
    if (t) t.click()
  }, label)
  await page.waitForTimeout(1000)
  const d = await page.evaluate(measure)
  report.push({ route, label, ...d })
}

await browser.close()

console.log('='.repeat(74))
console.log('UX 量化测量 v2  视口 1440×900   WCAG 2.1 AA 基线')
console.log('='.repeat(74))

let tc = 0, ts = 0, tf = 0
for (const r of report) {
  tc += r.contrast.length; ts += r.small.length; tf += r.fonts.length
  const bad = r.contrast.length + r.small.length
  console.log(`\n【${r.label}】 文本${r.counts.textNodes} 可点击${r.counts.clickable}  ${bad === 0 ? '✓ 无问题' : `⚠ 对比度${r.contrast.length} 目标${r.small.length}`}${r.headings.length ? ` 标题跳跃${r.headings.length}` : ''}`)
  const seen = new Set()
  for (const x of r.contrast) {
    const k = x.cls + x.color
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`   ⚠ 对比度 ${x.ratio}:1 (需${x.need}) ${x.size}px  ${x.color} on ${x.bg}`)
    console.log(`      "${x.text}"  .${x.cls}`)
  }
  const s2 = new Set()
  for (const x of r.small) {
    const k = x.cls + x.w + x.h
    if (s2.has(k)) continue
    s2.add(k)
    console.log(`   ⚠ 目标 ${x.w}×${x.h}px <${x.tag}> "${x.label}" .${x.cls}`)
  }
  for (const x of r.fonts.slice(0, 4)) console.log(`   · 字号 ${x.size}px "${x.text}" .${x.cls}`)
  const gaps = [...new Set(r.gaps.filter(g => g.gap > 12).map(g => `${g.label}=${g.gap}px`))]
  if (gaps.length) console.log(`   ⚠ 标签间距: ${gaps.slice(0,6).join(', ')}`)
  for (const h of [...new Set(r.headings)]) console.log(`   ⚠ 标题层级跳跃 ${h}`)
}

console.log('\n' + '='.repeat(74))
console.log(`合计：对比度不足 ${tc} 处 · 点击目标过小 ${ts} 处 · 字号<12px ${tf} 处`)
console.log('='.repeat(74))
