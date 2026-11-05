import { describe, expect, it } from 'vitest'
import { buildPolishInstruction, polishMarkdown, POLISH_MAX_ROUNDS } from '../src/main/services/article-polisher.js'

/**
 * 样本按"medium/high 问题数"分层构造，让循环每轮的问题数可控递减：
 *   dirtyMarkdown        = 套话过密 + 连接词过密 + 句长均匀   → 3 处问题
 *   connectiveOnly       = 连接词过密 + 句长均匀             → 2 处问题
 *   cleanMarkdown        = 干净（句数 < 8 不触发均匀度，无套话/连接词）→ 0 处问题
 */

function dirtyMarkdown(): string {
  const base = '项目延期了，因此团队开始复盘。然而数据并不支持最初的判断。此外，需求文档也一直缺失。另外，测试环境长期不稳定。因此每个人都在救火。然而没人有时间为根因停下来。总而言之，流程需要改进。综上所述，大家都很疲惫。'
  return `# 复盘\n\n${base.repeat(4)}`
}

function connectiveOnlyMarkdown(): string {
  const base = '项目延期了，因此团队开始复盘。然而数据并不支持最初的判断。此外，需求文档也一直缺失。另外，测试环境长期不稳定。因此每个人都在救火。然而没人有时间为根因停下来。'
  return `# 复盘\n\n${base.repeat(4)}`
}

const cleanParagraph = '上周帮朋友排查一个老接口，日志里什么都没有，只有一行沉默的超时。真正的坑埋在半年前的一次重构里，有人把重试次数从三次改成了零，谁也没通知谁，文档还停在旧版本。这种事没有惊心动魄的地方，却最消耗一个团队的信任。'
// 两段 + 长短句交错（末尾两个短句拉高句长变异系数），确保体检 0 处 medium/high 问题
const cleanMarkdown = ['# 标题', '', cleanParagraph, `${cleanParagraph}后来呢？改回来了。`].join('\n\n')

describe('文风体检自动修正循环', () => {
  it('初检达标：不调用改写，无轨迹摘要', async () => {
    let calls = 0
    const outcome = await polishMarkdown(cleanMarkdown, { callRevise: async () => { calls += 1; return cleanMarkdown } })
    expect(calls).toBe(0)
    expect(outcome.rounds).toEqual([])
    expect(outcome.summary).toBe('')
    expect(outcome.finalReport.passed).toBe(true)
  })

  it('不达标：把体检意见作为修改指令回灌，改写改善则接受', async () => {
    const instructions: string[] = []
    const outcome = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async (_markdown, instruction) => {
        instructions.push(instruction)
        return cleanMarkdown
      }
    })
    expect(instructions).toHaveLength(1)
    // 指令携带体检的具体问题与建议，而非笼统"改好一点"
    expect(instructions[0]).toContain('连接词密度')
    expect(instructions[0]).toContain('总而言之')
    expect(outcome.markdown).toBe(cleanMarkdown)
    expect(outcome.rounds[0]).toMatchObject({ round: 1, improved: true })
    expect(outcome.summary).toContain('已达标')
  })

  it('防退化：改写没有减少问题数时保留原稿并停止', async () => {
    let calls = 0
    const outcome = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async () => { calls += 1; return dirtyMarkdown() }
    })
    expect(calls).toBe(1)
    expect(outcome.markdown).toBe(dirtyMarkdown())
    expect(outcome.rounds[0]).toMatchObject({ round: 1, improved: false })
    expect(outcome.summary).toContain('遗留')
  })

  it('轮次上限（默认 2 轮）：逐轮递减直到达标后停止', async () => {
    let calls = 0
    const outcome = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async () => (++calls === 1 ? connectiveOnlyMarkdown() : cleanMarkdown)
    })
    expect(calls).toBe(2)
    expect(outcome.rounds).toHaveLength(POLISH_MAX_ROUNDS)
    expect(outcome.summary).toContain('已达标')
  })

  it('轮次上限（maxRounds=1）：改善一轮后即使仍有遗留也停止', async () => {
    let calls = 0
    const outcome = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async () => { calls += 1; return connectiveOnlyMarkdown() }
    }, 1)
    expect(calls).toBe(1)
    expect(outcome.markdown).toBe(connectiveOnlyMarkdown())
    expect(outcome.summary).toContain('遗留')
  })

  it('改写调用失败：优雅降级保留原稿，不抛错', async () => {
    const outcome = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async () => { throw new Error('网络中断') }
    })
    expect(outcome.markdown).toBe(dirtyMarkdown())
    expect(outcome.summary).toBe('')
  })

  it('改写产物不是合法成稿（缺一级标题/明显截断）：按本轮失败处理，保留原稿', async () => {
    const outcome = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async () => '这只是模型的一句解释，没有成稿结构。'
    })
    expect(outcome.markdown).toBe(dirtyMarkdown())
    expect(outcome.rounds).toEqual([])

    const truncated = await polishMarkdown(dirtyMarkdown(), {
      callRevise: async () => '# 标题\n\n短。'
    })
    expect(truncated.markdown).toBe(dirtyMarkdown())
  })

  it('修正指令只包含 medium/high 问题，不夹带 low 级提醒', () => {
    const report = {
      findings: [
        { rule: 'a', severity: 'high' as const, position: '全文', issue: '高问题', suggestion: '改' },
        { rule: 'b', severity: 'medium' as const, position: '第 1 段', issue: '中问题', suggestion: '改' },
        { rule: 'c', severity: 'low' as const, position: '全文', issue: '低问题', suggestion: '可忽略' }
      ],
      wordCount: 1000,
      metrics: [],
      overall: '',
      passed: false
    }
    const instruction = buildPolishInstruction(report)
    expect(instruction).toContain('高问题')
    expect(instruction).toContain('中问题')
    expect(instruction).not.toContain('低问题')
  })
})
