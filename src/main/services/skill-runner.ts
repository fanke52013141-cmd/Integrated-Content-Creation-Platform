import type { SkillRoundTrace } from '../../shared/contracts.js'

/**
 * 轻量可控多轮 Skill 执行引擎（借鉴 Pi 极简理念，零重型框架依赖）。
 *
 * 设计原则：
 * 1. 只用于「内容框架 / 文章写作 / 文章排版」三大复杂重环节；
 * 2. 有严格轮次上限（maxRounds）与 AbortSignal 随时取消；
 * 3. 每轮通过本地确定性工具或对抗审查给出真实反馈，仅在结果合法且不退化时采纳；
 * 4. 任何一轮修正失败自动优雅降级保留当前最佳合法产物，绝不因多轮打磨把已成功的初版搞崩。
 */
export interface SkillLoopEvaluation<T> {
  /** 仍需修正的问题数（0 表示已达标，提前结束循环） */
  issueCount: number
  /** 供模型下一轮定向修正的反馈说明 */
  feedback: string
  /** 展示给用户的本轮检查摘要 */
  summary: string
  /** 可选附带给修正函数的结构化诊断 */
  detail?: unknown
  /** 可选覆盖当前最优快照 */
  candidate?: T
}

export interface RunSkillLoopOptions<T> {
  initial: T
  maxRounds: number
  signal?: AbortSignal
  /** 对当前产物执行本地工具检查或对抗评审 */
  evaluate(current: T, round: number): Promise<SkillLoopEvaluation<T>>
  /** 依据本轮反馈定向修正产物 */
  refine(current: T, evaluation: SkillLoopEvaluation<T>, round: number): Promise<T>
  /** 初始阶段展示标签 */
  initialPhase?: string
  initialSummary?: string
}

export interface SkillLoopResult<T> {
  value: T
  trace: SkillRoundTrace[]
  improvedRounds: number
}

export async function runControlledSkillLoop<T>(options: RunSkillLoopOptions<T>): Promise<SkillLoopResult<T>> {
  const trace: SkillRoundTrace[] = []
  let current = options.initial
  let improvedRounds = 0

  if (options.initialSummary) {
    trace.push({
      round: 0,
      phase: options.initialPhase ?? '初版生成',
      summary: options.initialSummary
    })
  }

  let evaluation = await options.evaluate(current, 1)
  trace.push({
    round: 1,
    phase: '检查诊断',
    summary: evaluation.summary,
    issuesFound: evaluation.issueCount
  })

  if (evaluation.issueCount === 0 || options.maxRounds <= 0) {
    return { value: current, trace, improvedRounds }
  }

  for (let round = 1; round <= options.maxRounds; round += 1) {
    if (options.signal?.aborted) break
    let next: T
    try {
      next = await options.refine(current, evaluation, round)
    } catch (error) {
      trace.push({
        round,
        phase: '自动修正',
        summary: `第 ${round} 轮修正未完成，已保留上一版合法结果（${error instanceof Error ? error.message.slice(0, 60) : '模型异常'}）`,
        improved: false
      })
      break
    }

    const nextEval = await options.evaluate(next, round + 1)
    const improved = nextEval.issueCount < evaluation.issueCount
    trace.push({
      round,
      phase: '复检修正',
      summary: improved
        ? `第 ${round} 轮修正生效：问题 ${evaluation.issueCount} → ${nextEval.issueCount}（${nextEval.summary}）`
        : `第 ${round} 轮未改善（${evaluation.issueCount} → ${nextEval.issueCount}），已回退保留更优版本`,
      issuesFound: nextEval.issueCount,
      improved
    })
    if (!improved) break
    current = next
    evaluation = nextEval
    improvedRounds += 1
    if (evaluation.issueCount === 0) break
  }

  return { value: current, trace, improvedRounds }
}
