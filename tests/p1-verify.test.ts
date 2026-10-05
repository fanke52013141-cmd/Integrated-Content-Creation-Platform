import { describe, expect, it } from 'vitest'
import { renderLayoutMarkdown } from '../src/main/services/article-layout-service.js'

// P1-2 修复效果实测。这四项都是微信平台的硬约束，必须逐条验证而不是假设。
const SRC = [
  '# 测试标题', '',
  '正文含 **加粗** 与 `行内代码`。', '',
  '```javascript',
  'function makeSkill(name) {',
  '  return 1',
  '}',
  '',
  'const x = 1  // 注释',
  '```', '',
  '> 引用', '',
  '| 项目 | 值 |', '| --- | --- |', '| 状态 | 完成 |', '',
  '![示意图](moliu-asset://assets/测试图.png)'
].join('\n')

describe('P1-2 微信兼容性修复', () => {
  const out = renderLayoutMarkdown(SRC, 'wechat', 'wechat-green')

  it('代码块不使用 <pre>（不在微信白名单，会整块散架）', () => {
    expect(out.html).not.toContain('<pre')
    expect(out.html).toContain('background:#1e293b')
  })

  it('不使用 white-space:pre（会渲染出大段空白）', () => {
    expect(out.html).not.toContain('white-space:pre')
  })

  it('剥除 class 与 id（微信强制移除非内联属性）', () => {
    expect(out.html).not.toMatch(/\sclass=/)
    expect(out.html).not.toMatch(/\sid=/)
  })

  it('文字被 <span leaf=""> 包裹（微信正文渲染依赖）', () => {
    expect(out.html).toContain('<span leaf="">')
  })

  it('不产生 <div>（微信会过滤）', () => {
    expect(out.html).not.toContain('<div')
  })

  it('语法高亮色已内联（依赖 hljs 色板，删掉色板会失效）', () => {
    expect(out.html.toLowerCase()).toContain('#c678dd')
  })

  it('图片声明自适应（微信强制 width:100% 会拉伸小图）', () => {
    expect(out.html).toMatch(/<img[^>]*max-width/)
  })

  it('表格与外链脚注仍正常', () => {
    expect(out.html).toContain('<table')
    // 脚注序号在 <sup> 内被 span leaf 包裹（这是正确形态，微信要求文字被 leaf 包裹）
    const linked = renderLayoutMarkdown('# T\n\n见 [链接](https://example.com)', 'wechat', 'wechat-green')
    expect(linked.html).toMatch(/<sup[^>]*>\s*<span leaf="">\[1\]<\/span>\s*<\/sup>/)
  })

  it('外链被转为文末参考链接而非直接可点（微信正文不支持外链）', () => {
    const linked = renderLayoutMarkdown('# T\n\n见 [链接](https://example.com)', 'wechat', 'wechat-green')
    expect(linked.html).toContain('参考链接')
    expect(linked.html).toContain('https://example.com')
  })

  it('无语言标注的代码块也不回退到 <pre>', () => {
    const noLang = renderLayoutMarkdown('# T\n\n```\nplain code\n```', 'wechat', 'wechat-green')
    expect(noLang.html).not.toContain('<pre')
    expect(noLang.html).toContain('plain code')
  })

  it('缩进转为全角空格（避免源码空格被原样渲染）', () => {
    const indented = renderLayoutMarkdown('# T\n\n```\na\n  b\n```', 'wechat', 'wechat-green')
    expect(indented.html).toContain('　b')
  })

  it('小红书平台跳过微信专属处理', () => {
    const xhs = renderLayoutMarkdown(SRC, 'xiaohongshu', 'wechat-green')
    expect(xhs.html).not.toContain('<span leaf="">')
    expect(xhs.plainText).toContain('测试标题')
  })
})
