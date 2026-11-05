import { describe, expect, it } from 'vitest'
import { formatViolations, hasBlockingViolation, validateWechatLayout } from '../src/main/services/layout-validator.js'

/**
 * 校验器自身的可信度测试。
 *
 * 前提：任何量化检测都要先证明自己能抓到已知问题，否则「0 问题」可能只是检测器没加载。
 * 因此这里全部使用**故意构造的违规样本**，而非"看起来正常"的样本。
 */

const okHtml = '<article><h1><span leaf="">标题</span></h1><p><span leaf="">正文内容</span></p></article>'

describe('微信排版合规校验器', () => {
  describe('合规样本不应误报', () => {
    it('标准排版稿无 error', () => {
      const v = validateWechatLayout({ html: okHtml, title: '正常标题' })
      expect(v.filter((x) => x.level === 'error')).toEqual([])
    })

    it('空违规列表的格式化输出友好', () => {
      expect(formatViolations([])).toBe('排版稿符合微信平台要求')
      expect(hasBlockingViolation([])).toBe(false)
    })
  })

  describe('禁用标签', () => {
    it('抓到 <div>', () => {
      const v = validateWechatLayout({ html: '<div>x</div>', title: 'T' })
      expect(v.some((x) => x.rule === 'forbidden-tag:div' && x.level === 'error')).toBe(true)
    })

    it('抓到 <script>', () => {
      const v = validateWechatLayout({ html: '<p>a</p><script>alert(1)</script>', title: 'T' })
      expect(v.some((x) => x.rule === 'forbidden-tag:script')).toBe(true)
    })

    it('抓到残留 <style>', () => {
      const v = validateWechatLayout({ html: '<style>p{color:red}</style><p>a</p>', title: 'T' })
      expect(v.some((x) => x.rule === 'forbidden-tag:style')).toBe(true)
    })

    it('不误报 section / span / p 等白名单标签', () => {
      const html = '<section><p><span leaf="">x</span></p></section>'
      const v = validateWechatLayout({ html, title: 'T' })
      expect(v.filter((x) => x.rule.startsWith('forbidden-tag'))).toEqual([])
    })
  })

  describe('禁用 CSS 声明', () => {
    it.each([
      ['position:fixed', 'position:fixed/absolute/sticky'],
      ['position:absolute', 'position:fixed/absolute/sticky'],
      ['position:sticky', 'position:fixed/absolute/sticky'],
      ['display:grid', 'display:grid'],
      ['float:left', 'float'],
      ['@media print', '@media'],
      ['@keyframes x', '@keyframes']
    ])('抓到 %s', (input, ruleName) => {
      const v = validateWechatLayout({ html: `<p style="${input}">x</p>`, title: 'T' })
      // 三种 position 形态归为同一条规则，用 message 中的名称做断言而非 rule 前缀
      expect(v.some((x) => x.message.includes(ruleName))).toBe(true)
    })

    it('抓到 CSS 变量（微信过滤变量定义，声明值会失效）', () => {
      const v = validateWechatLayout({ html: '<p style="color:var(--brand)">x</p>', title: 'T' })
      const hit = v.find((x) => x.rule === 'forbidden-css:CSS 变量 var(--…)')
      expect(hit?.level).toBe('error')
      expect(hit?.hint).toContain('展开为字面量')
    })

    it('抓到 @font-face 外部字体', () => {
      const v = validateWechatLayout({ html: '<p>x</p>@font-face{font-family:custom}', title: 'T' })
      expect(v.some((x) => x.rule === 'forbidden-css:@font-face 外部字体' && x.level === 'error')).toBe(true)
    })

    it('抓到 !important（微信剥除声明标记，破坏暗黑模式算法，error 级）', () => {
      const v = validateWechatLayout({ html: '<p style="color:red !important">x</p>', title: 'T' })
      const hit = v.find((x) => x.rule === 'forbidden-css:important')
      expect(hit?.level).toBe('error')
      expect(hasBlockingViolation([hit!])).toBe(true)
    })

    it('不误报 var( 但非 CSS 变量的写法', () => {
      const v = validateWechatLayout({ html: '<p style="font-family:var(x)">x</p>', title: 'T' })
      expect(v.filter((x) => x.rule.startsWith('forbidden-css'))).toEqual([])
    })

    it('抓到 white-space:pre（代码块大段空白）', () => {
      const v = validateWechatLayout({ html: '<p style="white-space:pre">a</p>', title: 'T' })
      expect(v.some((x) => x.rule === 'forbidden-css:white-space-pre')).toBe(true)
    })

    it('不误报常规样式', () => {
      const html = '<p style="color:#333;font-size:15px;line-height:1.8;margin:0">x</p>'
      const v = validateWechatLayout({ html, title: 'T' })
      expect(v.filter((x) => x.rule.startsWith('forbidden-css'))).toEqual([])
    })
  })

  describe('图片规则', () => {
    it('抓到非微信图床的外链图（会被微信过滤）', () => {
      const v = validateWechatLayout({ html: '<img src="https://example.com/a.png">', title: 'T' })
      expect(v.some((x) => x.rule === 'image-not-wechat-cdn' && x.level === 'error')).toBe(true)
    })

    it('放行微信图床地址', () => {
      const v = validateWechatLayout({ html: '<img src="https://mmbiz.qpic.cn/mmbiz_png/x/1.png">', title: 'T' })
      expect(v.filter((x) => x.rule === 'image-not-wechat-cdn')).toEqual([])
    })

    it('放行占位与本机协议（生成阶段的正常形态）', () => {
      const html = '<img src="moliu-asset://assets/a.png"><img src="图片URL">'
      const v = validateWechatLayout({ html, title: 'T' })
      expect(v.filter((x) => x.rule === 'image-not-wechat-cdn')).toEqual([])
    })

    it('抓到 width:100% 拉伸风险', () => {
      const v = validateWechatLayout({ html: '<img src="https://mmbiz.qpic.cn/a.png" style="width:100%">', title: 'T' })
      expect(v.some((x) => x.rule === 'image-fixed-width')).toBe(true)
    })

    it('放行 max-width 自适应', () => {
      const v = validateWechatLayout({ html: '<img src="https://mmbiz.qpic.cn/a.png" style="max-width:100%;height:auto">', title: 'T' })
      expect(v.filter((x) => x.rule === 'image-fixed-width')).toEqual([])
    })
  })

  describe('字段长度限制', () => {
    it('空标题报错', () => {
      const v = validateWechatLayout({ html: okHtml, title: '   ' })
      expect(v.some((x) => x.rule === 'title-empty')).toBe(true)
    })

    it('标题超 32 字报错并给出实际字数', () => {
      const v = validateWechatLayout({ html: okHtml, title: '标'.repeat(33) })
      const hit = v.find((x) => x.rule === 'title-too-long')
      expect(hit?.level).toBe('error')
      expect(hit?.message).toContain('33')
    })

    it('标题恰好 32 字通过', () => {
      const v = validateWechatLayout({ html: okHtml, title: '标'.repeat(32) })
      expect(v.filter((x) => x.rule === 'title-too-long')).toEqual([])
    })

    it('摘要超 120 字报错（官方 2026-07 对齐 mp 端）', () => {
      const v = validateWechatLayout({ html: okHtml, title: 'T', digest: '摘'.repeat(121) })
      const hit = v.find((x) => x.rule === 'digest-too-long')
      expect(hit?.level).toBe('error')
      expect(hit?.message).toContain('120')
    })

    it('摘要恰好 120 字通过', () => {
      const v = validateWechatLayout({ html: okHtml, title: 'T', digest: '摘'.repeat(120) })
      expect(v.filter((x) => x.rule === 'digest-too-long')).toEqual([])
    })

    it('正文超 20000 字符报错', () => {
      const v = validateWechatLayout({ html: 'x'.repeat(20_001), title: 'T' })
      expect(v.some((x) => x.rule === 'content-too-long')).toBe(true)
    })
  })

  describe('span leaf 与非内联属性', () => {
    it('文字未包裹时报 warn 而非 error（部分客户端仍可显示）', () => {
      const v = validateWechatLayout({ html: '<p>纯文字</p>', title: 'T' })
      const hit = v.find((x) => x.rule === 'span-leaf-missing')
      expect(hit?.level).toBe('warn')
      expect(hasBlockingViolation(v.filter((x) => x.rule === 'span-leaf-missing'))).toBe(false)
    })

    it('class / id 报 warn', () => {
      const v = validateWechatLayout({ html: '<p class="a" id="b">x</p>', title: 'T' })
      expect(v.some((x) => x.rule === 'non-inline-attr:class')).toBe(true)
      expect(v.some((x) => x.rule === 'non-inline-attr:id')).toBe(true)
    })
  })

  describe('阻断判定与格式化', () => {
    it('存在 error 时hasBlockingViolation 为 true', () => {
      const v = validateWechatLayout({ html: '<div>x</div>', title: 'T' })
      expect(hasBlockingViolation(v)).toBe(true)
    })

    it('仅 warn 不阻断', () => {
      const v = validateWechatLayout({ html: '<p class="a">文字</p>', title: 'T' })
      expect(v.length).toBeGreaterThan(0)
      expect(hasBlockingViolation(v)).toBe(false)
    })

    it('格式化输出区分 error 与 warn', () => {
      const v = validateWechatLayout({ html: '<div><p class="a">文字</p></div>', title: 'T' })
      const text = formatViolations(v)
      expect(text).toContain('1 个问题')
      expect(text).toContain('个提醒')
    })
  })

  describe('结构规范（对齐官方 verify-article-structure-spec）', () => {
    it('抓到冗余嵌套链超过 10 层（微信会自动精简并连带丢样式）', () => {
      // 11 层同名+同样式+单子节点的连续嵌套
      const deep = Array.from({ length: 11 }, () => '<section style="margin:0">').join('')
      const deepClose = Array.from({ length: 11 }, () => '</section>').join('')
      const v = validateWechatLayout({ html: `${deep}${deepClose}`, title: 'T' })
      const hit = v.find((x) => x.rule === 'redundant-nesting')
      expect(hit?.level).toBe('error')
      expect(hit?.message).toContain('11 层')
    })

    it('10 层以内的同名嵌套不误报', () => {
      const deep = Array.from({ length: 10 }, () => '<section style="margin:0">').join('')
      const deepClose = Array.from({ length: 10 }, () => '</section>').join('')
      const v = validateWechatLayout({ html: `${deep}${deepClose}`, title: 'T' })
      expect(v.filter((x) => x.rule === 'redundant-nesting')).toEqual([])
    })

    it('同名但样式不同的嵌套不误报（不同样式引入了新信息）', () => {
      const html = '<section style="margin:0"><section style="padding:0"><section style="color:#333"><p><span leaf="">内容文字</span></p></section></section></section>'
      const v = validateWechatLayout({ html, title: 'T' })
      expect(v.filter((x) => x.rule === 'redundant-nesting')).toEqual([])
    })

    it('抓到 span[leaf] 包裹块级元素（官方"会被编辑器自动删除"级）', () => {
      const v = validateWechatLayout({ html: '<span leaf=""><section><p><span leaf="">x</span></p></section></span>', title: 'T' })
      const hit = v.find((x) => x.rule === 'leaf-block-child')
      expect(hit?.level).toBe('error')
    })

    it('leaf 包裹行内内容不误报', () => {
      const v = validateWechatLayout({ html: '<p><span leaf="">文字 <strong>加粗</strong><img src="https://mmbiz.qpic.cn/a.png"></span></p>', title: 'T' })
      expect(v.filter((x) => x.rule === 'leaf-block-child')).toEqual([])
    })

    it('抓到行高小于字号且文字较长（移动端叠字）', () => {
      const v = validateWechatLayout({ html: '<p style="font-size:16px;line-height:0.9"><span leaf="">这是一段足够长会被微信排成多行的正文文字内容示例</span></p>', title: 'T' })
      const hit = v.find((x) => x.rule === 'line-height-small')
      expect(hit?.level).toBe('error')
    })

    it('短标签行高偏小不误报（官方单行豁免：药丸/按钮多为单行）', () => {
      const v = validateWechatLayout({ html: '<section style="font-size:14px;line-height:1.05"><span leaf="">提示</span></section>', title: 'T' })
      expect(v.filter((x) => x.rule === 'line-height-small')).toEqual([])
    })

    it('行高用无单位数字且 ≥1 时不误报（继承计算正确）', () => {
      const html = '<section style="font-size:16px;line-height:1.8"><p><span leaf="">这是一段正常的正文文字，行高完全继承自外层容器。</span></p></section>'
      const v = validateWechatLayout({ html, title: 'T' })
      expect(v.filter((x) => x.rule === 'line-height-small')).toEqual([])
    })

    it('抓到 text-align:start/end（终端兼容差异）', () => {
      const v = validateWechatLayout({ html: '<p style="text-align:start"><span leaf="">x</span></p>', title: 'T' })
      expect(v.some((x) => x.rule === 'text-align-keyword' && x.level === 'error')).toBe(true)
    })

    it('抓到 height:0 容器含文字（移动端完全不可见）', () => {
      const v = validateWechatLayout({ html: '<section style="height:0"><p><span leaf="">隐藏的文字</span></p></section>', title: 'T' })
      expect(v.some((x) => x.rule === 'height-zero-with-text' && x.level === 'error')).toBe(true)
    })

    it('height:0 但无文字不误报（官方豁免：图片无缝拼接）', () => {
      const v = validateWechatLayout({ html: '<section style="height:0"><img src="https://mmbiz.qpic.cn/a.png"></section>', title: 'T' })
      expect(v.filter((x) => x.rule === 'height-zero-with-text')).toEqual([])
    })

    it('页内锚点告警（id 被剥离后必然失效）', () => {
      const v = validateWechatLayout({ html: '<p><a href="#sec-1"><span leaf="">跳转</span></a></p>', title: 'T' })
      const hit = v.find((x) => x.rule === 'anchor-link-dead')
      expect(hit?.level).toBe('warn')
    })

    it('标准合规样本在结构检查下依然零 error（防误报回归）', () => {
      const html = '<article><section style="margin:0 0 20px"><h2 style="font-size:20px;line-height:1.5"><span leaf="">章节标题</span></h2>' +
        '<p style="font-size:16px;line-height:1.8"><span leaf="">这是一段足够长的正文文字，用来验证行高继承计算不会产生误报。</span></p></section></article>'
      const v = validateWechatLayout({ html, title: 'T' })
      expect(v.filter((x) => x.level === 'error')).toEqual([])
    })
  })

  describe('确定性', () => {
    it('同一输入两次校验结果完全一致', () => {
      const html = '<div><p class="a" style="position:fixed">x</p></div>'
      const a = validateWechatLayout({ html, title: 'T' })
      const b = validateWechatLayout({ html, title: 'T' })
      expect(a).toEqual(b)
    })
  })
})
