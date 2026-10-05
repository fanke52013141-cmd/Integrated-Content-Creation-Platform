// 令牌级修复验证：算出一组候选色值在真实背景上的对比度，选出满足 AA 的最小改动。
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const browserExe = (() => {
  for (const r of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const p of [['Google','Chrome','Application','chrome.exe'], ['Microsoft','Edge','Application','msedge.exe']]) {
      const full = join(r, ...p)
      if (existsSync(full)) return full
    }
  }
  return null
})()

const browser = await chromium.launch({ executablePath: browserExe })
const page = await (await browser.newContext()).newPage()
await page.setContent('<body></body>')

const result = await page.evaluate(() => {
  const hex2rgb = (h) => {
    h = h.replace('#', '')
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
  }
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }
    return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b)
  }
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b)
    return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)
  }

  // 实际使用的背景（取自 tokens.css）
  const bgs = {
    '页面背景 --background': '#f5f5f7',
    '卡片 --surface-solid': '#ffffff',
    '弱表面 --surface-muted': '#f2f2f7',
    '琥珀底 amber-50': '#fff8e8',
    '绿底 green-50': '#ecfcef',
    '蓝底 purple-50': '#eef4ff'
  }
  const fgs = {
    '--text-tertiary 现状': '#86868b',
    '--text-soft 现状': '#aeaeb2',
    '--text-secondary 现状': '#56565c',
    '候选A #6e6e73': '#6e6e73',
    '候选B #66666b': '#66666b',
    '候选C #5f5f64': '#5f5f64',
    '候选D #56565c(同secondary)': '#56565c'
  }
  // 彩色前景
  const colored = {
    '--warning #ff9500 现状': '#ff9500',
    '--success #34c759 现状': '#34c759',
    '--primary #0071e3 现状': '#0071e3'
  }

  const table = {}
  for (const [fname, fhex] of Object.entries(fgs)) {
    table[fname] = {}
    for (const [bname, bhex] of Object.entries(bgs)) {
      table[fname][bname] = +ratio(hex2rgb(fhex), hex2rgb(bhex)).toFixed(2)
    }
  }
  const colorTable = {}
  for (const [fname, fhex] of Object.entries(colored)) {
    colorTable[fname] = {}
    for (const [bname, bhex] of Object.entries(bgs)) {
      colorTable[fname][bname] = +ratio(hex2rgb(fhex), hex2rgb(bhex)).toFixed(2)
    }
  }

  // 暗色模式背景
  const darkBgs = { '暗背景 #0b0b0d': '#0b0b0d', '暗表面 #1c1c1e': '#1c1c1e' }
  const darkFgs = {
    '暗 --text-tertiary #8e8e93': '#8e8e93',
    '暗 --text-soft #636366': '#636366',
    '暗 --warning #ffd60a': '#ffd60a',
    '暗 --success #30d158': '#30d158'
  }
  const darkTable = {}
  for (const [fname, fhex] of Object.entries(darkFgs)) {
    darkTable[fname] = {}
    for (const [bname, bhex] of Object.entries(darkBgs)) {
      darkTable[fname][bname] = +ratio(hex2rgb(fhex), hex2rgb(bhex)).toFixed(2)
    }
  }
  return { table, colorTable, darkTable, bgs: Object.keys(bgs) }
})

const need = 4.5
console.log('='.repeat(96))
console.log('设计令牌对比度验证  (正文 AA 阈值 4.5:1)')
console.log('='.repeat(96))
const cols = result.bgs
console.log('前景 \\ 背景'.padEnd(30) + cols.map(c => c.slice(0, 14).padStart(15)).join(''))
console.log('-'.repeat(96))
for (const [fname, row] of Object.entries(result.table)) {
  console.log(fname.padEnd(30) + cols.map(c => {
    const v = row[c]
    return (v < need ? `${v}✗` : `${v}✓`).padStart(15)
  }).join(''))
}
console.log('\n彩色前景（状态语义色）')
console.log('-'.repeat(96))
for (const [fname, row] of Object.entries(result.colorTable)) {
  console.log(fname.padEnd(30) + cols.map(c => {
    const v = row[c]
    return (v < need ? `${v}✗` : `${v}✓`).padStart(15)
  }).join(''))
}
console.log('\n暗色模式')
console.log('-'.repeat(60))
const dcols = Object.keys(result.darkTable[Object.keys(result.darkTable)[0]])
console.log('前景 \\ 背景'.padEnd(30) + dcols.map(c => c.padStart(15)).join(''))
for (const [fname, row] of Object.entries(result.darkTable)) {
  console.log(fname.padEnd(30) + dcols.map(c => {
    const v = row[c]
    return (v < need ? `${v}✗` : `${v}✓`).padStart(15)
  }).join(''))
}
await browser.close()
