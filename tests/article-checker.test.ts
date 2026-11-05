import { describe, expect, it } from 'vitest'
import { runArticleChecks } from '../src/main/services/article-checker.js'

/**
 * 体检器的可信度测试：与 layout-validator 同一原则——
 * 全部使用故意构造的违规样本，先证明能抓到已知问题，再谈"0 问题"的可信度。
 */

// 无套话、无模板连接词、句长错落、段落适中的样本（低于 8 句，不触发句长均匀度检查）
const cleanMarkdown = [
  '上周帮朋友排查一个老接口，日志里什么都没有，只有一行沉默的超时。',
  '真正的坑埋在半年前的一次重构里，有人把重试次数从三次改成了零，谁也没通知谁，文档还停在旧版本。',
  '这种事没有惊心动魄的地方，却最消耗一个团队的信任。',
  '修复只花十分钟。',
  '找回信任要几个月。',
  '所以我把这次经历写下来，留给下一个遇到沉默超时的人。'
].join('')

describe('确定性文风体检器', () => {
  it('干净样本不产生 medium 及以上问题，判定通过', () => {
    const report = runArticleChecks(cleanMarkdown)
    expect(report.findings.filter((f) => f.severity !== 'low')).toEqual([])
    expect(report.passed).toBe(true)
    expect(report.overall).toContain('未见明显 AI 腔')
  })

  it('抓到套话密集样本（high），锚点能在原文中逐字检索到', () => {
    const paragraph = '总而言之，这个方案很好。综上所述，我们继续推进。值得注意的是，数据在增长。众所周知，效率很重要。毋庸置疑，这是一次机会。在这个快速变化的时代，节奏决定成败。'
    const markdown = paragraph.repeat(5)
    const report = runArticleChecks(markdown)
    const hit = report.findings.find((f) => f.rule === 'cliche-phrases')
    expect(hit).toBeTruthy()
    expect(hit!.severity === 'high' || hit!.severity === 'medium').toBe(true)
    expect(hit!.issue).toContain('总而言之')
    expect(hit!.anchor).toBeTruthy()
    expect(markdown.includes(hit!.anchor!)).toBe(true)
    expect(report.passed).toBe(hit!.severity !== 'high')
  })

  it('抓到连接词过密样本', () => {
    const base = '项目延期了，因此团队开始复盘。然而数据并不支持最初的判断。此外，需求文档也一直缺失。另外，测试环境长期不稳定。因此每个人都在救火。然而没人有时间为根因停下来。'
    const markdown = base.repeat(5)
    const report = runArticleChecks(markdown)
    const hit = report.findings.find((f) => f.rule === 'connective-density')
    expect(hit).toBeTruthy()
    expect(hit!.severity === 'high' || hit!.severity === 'medium').toBe(true)
  })

  it('抓到句长过于均匀（AI 生成节奏）的样本', () => {
    const markdown = Array.from({ length: 10 }, (_, i) => `第${i}批版本上线以后用户数量稳步上升了不少。`).join('')
    const report = runArticleChecks(markdown)
    const hit = report.findings.find((f) => f.rule === 'sentence-uniformity')
    expect(hit).toBeTruthy()
    expect(hit!.severity).toBe('medium')
  })

  it('抓到超长段落并给出原文锚点', () => {
    const markdown = '这一段确实很长而且一直没有分段究竟要读到哪里才是个头谁也说不清楚。'.repeat(12)
    const report = runArticleChecks(markdown)
    const hit = report.findings.find((f) => f.rule === 'long-paragraph')
    expect(hit).toBeTruthy()
    expect(hit!.anchor).toBeTruthy()
    expect(markdown.includes(hit!.anchor!)).toBe(true)
  })

  it('抓到连续同构开头的排比式推进', () => {
    const markdown = '我们上线了新功能。我们修复了旧问题。我们规划了下一个版本。用户看到了变化，团队感到了压力。'
    const report = runArticleChecks(markdown)
    const hit = report.findings.find((f) => f.rule === 'repeated-openings')
    expect(hit).toBeTruthy()
    expect(hit!.issue).toContain('我们')
  })

  it('代码块不参与正文体检', () => {
    const markdown = `${'正常段落。'.repeat(2)}\n\n\`\`\`js\n// 总而言之 这里全是 值得注意的是 因此 然而 首先 其次\nconst x = 1\n\`\`\`\n\n正文到这里结束。`
    const report = runArticleChecks(markdown)
    expect(report.findings.some((f) => f.rule === 'cliche-phrases' && f.severity !== 'low')).toBe(false)
  })

  it('同一输入两次体检结果完全一致（可复现）', () => {
    const a = runArticleChecks(cleanMarkdown)
    const b = runArticleChecks(cleanMarkdown)
    expect(a).toEqual(b)
  })
})
