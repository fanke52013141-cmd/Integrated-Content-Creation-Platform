import { describe, expect, it } from 'vitest'
import { buildRenderCheckDocument, contrastRatio, ensureDarkSafeAccent, MEASURE_SCRIPT, MOCK_CONTAINER_ID, replaceAccentInHtml, WECHAT_BASE_MOCK_CSS } from '../src/shared/render-measure.js'

/**
 * 渲染测量共享层测试（阶段四）。
 *
 * 测量逻辑的"真机行为"由 scripts/verify-render-check.mjs（Chrome headless）验证；
 * 这里锁定共享层的三件事：文档构造、脚本与预览共用同一环境、脚本包含两类核心检测。
 */

describe('渲染测量共享层', () => {
  it('文档构造：375px 手机宽度 + 基础样式模拟 + 待检内容', () => {
    const doc = buildRenderCheckDocument('<p>正文</p>')
    expect(doc).toContain('width:375px')
    expect(doc).toContain(`<div id="${MOCK_CONTAINER_ID}">`)
    expect(doc).toContain('<p>正文</p>')
  })

  it('基础样式与预览共用同一份（预览与测量环境一致）', () => {
    expect(WECHAT_BASE_MOCK_CSS).toContain(`#${MOCK_CONTAINER_ID} { font-size: 17px;`)
  })

  it('测量脚本包含两类核心检测与豁免逻辑', () => {
    expect(MEASURE_SCRIPT).toContain("rule: 'render-overflow'")
    expect(MEASURE_SCRIPT).toContain("rule: 'render-line-overlap'")
    // 可滚动容器豁免（官方规则 1.4/1.5）
    expect(MEASURE_SCRIPT).toContain("overflowX === 'auto' || overflowX === 'scroll'")
    // 溢出扫描包含容器自身（固定宽子元素的溢出发生在父级）
    expect(MEASURE_SCRIPT).toContain('[container, ...Array.from(container.querySelectorAll')
    // 自身执行（IIFE），Electron executeJavaScript 与验证脚本共用此形态
    expect(MEASURE_SCRIPT.trimEnd().endsWith('})()')).toBe(true)
  })

  it('每类问题最多报 5 条（防超长文章刷屏）', () => {
    expect(MEASURE_SCRIPT).toContain('MAX_PER_RULE = 5')
  })
})

describe('暗色安全强调色兜底（批次 7）', () => {
  it('深色/中间调 accent 在暗底对比不足时自动提亮到达标', () => {
    // 深棕 #7a5c00 在 #191919 上 ≈2.4:1 → 提亮后 ≥3:1
    const result = ensureDarkSafeAccent('#7a5c00')
    expect(result.adjusted).toBe(true)
    expect(result.contrast).toBeGreaterThanOrEqual(3)
    expect(result.color.toLowerCase()).not.toBe('#7a5c00')
  })

  it('已达标或非法色值原样返回', () => {
    // 浅色 accent 在暗底对比充足（13:1 量级），无需调整
    expect(ensureDarkSafeAccent('#ffe082').adjusted).toBe(false)
    expect(ensureDarkSafeAccent('#4285f4').adjusted).toBe(false)
    expect(ensureDarkSafeAccent('not-a-color').adjusted).toBe(false)
  })

  it('replaceAccentInHtml 只替换目标色值', () => {
    const html = '<span style="color: #FFE082">a</span><span style="color:#4285f4">b</span>'
    const replaced = replaceAccentInHtml(html, '#ffe082', '#8d6e00')
    expect(replaced).toContain('#8d6e00')
    expect(replaced).toContain('#4285f4')
    expect(replaced).not.toContain('FFE082')
  })

  it('对比度公式符合已知锚点（黑/白 = 21:1）', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#191919', '#ffffff')).toBeGreaterThan(15)
  })
})
