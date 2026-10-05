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

    it('摘要超 128 字报错', () => {
      const v = validateWechatLayout({ html: okHtml, title: 'T', digest: '摘'.repeat(129) })
      expect(v.some((x) => x.rule === 'digest-too-long')).toBe(true)
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

  describe('确定性', () => {
    it('同一输入两次校验结果完全一致', () => {
      const html = '<div><p class="a" style="position:fixed">x</p></div>'
      const a = validateWechatLayout({ html, title: 'T' })
      const b = validateWechatLayout({ html, title: 'T' })
      expect(a).toEqual(b)
    })
  })
})
