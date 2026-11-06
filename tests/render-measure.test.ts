import { describe, expect, it } from 'vitest'
import { buildRenderCheckDocument, MEASURE_SCRIPT, MOCK_CONTAINER_ID, WECHAT_BASE_MOCK_CSS } from '../src/shared/render-measure.js'

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
