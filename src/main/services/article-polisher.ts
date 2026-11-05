/**
 * 文风体检自动修正循环（Agent 化写作的第一段闭环）。
 *
 * 流程：初检 → 有 medium/high 问题时把体检意见作为修改指令交给模型改写 → 复检，
 * 复检问题数减少才接受（防退化），否则保留原文并停止；最多 POLISH_MAX_ROUNDS 轮。
 * 与评审链路的分工：这里是生成侧的自动兜底（无人工闸门的自动循环），因此
 * - 只允许确定性问题进指令（article-checker 的机器可复现结论，不含模型主观意见）；
 * - 有轮次上限与防退化保护，最坏情况等价于"没开体检"；
 * - 改写调用失败一律优雅降级保留原稿，绝不因体检修正把一次成功生成变成失败。
 */

import { runArticleChecks } from './article-checker.js'
import type { ArticleCheckReport } from './article-checker.js'

export const POLISH_MAX_ROUNDS = 2

export interface PolishRound {
  round: number
  /** 本轮改写前的问题数（medium+high） */
  beforeCount: number
  /** 本轮改写后的问题数 */
  afterCount: number
  /** 改写是否被接受（问题数下降且改写产物合法） */
  improved: boolean
}

export interface PolishOutcome {
  markdown: string
  rounds: PolishRound[]
  /** 结束时的体检报告（基于最终采用的文本） */
  finalReport: ArticleCheckReport
  /** 给人看的一句话轨迹，无需修正时为空串 */
  summary: string
}

export interface PolishDeps {
  /** 按体检意见改写全文；实现方负责模型调用（含 provider/model/maxTokens/超时与重试） */
  callRevise(markdown: string, instruction: string): Promise<string>
}

interface IssueSnapshot {
  report: ArticleCheckReport
  count: number
}

function snapshot(markdown: string): IssueSnapshot {
  const report = runArticleChecks(markdown)
  return { report, count: report.findings.filter((finding) => finding.severity !== 'low').length }
}

export function buildPolishInstruction(report: ArticleCheckReport): string {
  const items = report.findings
    .filter((finding) => finding.severity !== 'low')
    .map((finding, index) => `${index + 1}. 位置：${finding.position}｜问题：${finding.issue}｜建议：${finding.suggestion}`)
  return [
    '以下是确定性文风体检发现的问题，请只修正这些问题：保持内容、结构与信息完全不变，不增删事实与观点，只调整表达。',
    ...items,
    '输出完整 Markdown 成稿（以一级标题开始），不要输出解释或 diff。'
  ].join('\n')
}

export async function polishMarkdown(markdown: string, deps: PolishDeps, maxRounds: number = POLISH_MAX_ROUNDS): Promise<PolishOutcome> {
  let current = markdown
  let state = snapshot(current)
  if (!state.count) return { markdown, rounds: [], finalReport: state.report, summary: '' }

  const rounds: PolishRound[] = []
  for (let round = 1; round <= maxRounds; round += 1) {
    let revised: string
    try {
      revised = normalizePolished(await deps.callRevise(current, buildPolishInstruction(state.report)), current)
    } catch {
      // 改写调用失败或产物不合法：保留当前文本，停止循环（优雅降级，绝不影响生成主流程）
      break
    }
    const next = snapshot(revised)
    const improved = next.count < state.count
    rounds.push({ round, beforeCount: state.count, afterCount: next.count, improved })
    if (!improved) break
    current = revised
    state = next
    if (!state.count) break
  }

  const summary = rounds.length
    ? `文风体检自动修正 ${rounds.length} 轮（${rounds.map((item) => `第${item.round}轮 ${item.beforeCount}→${item.afterCount} 处`).join('，')}）${state.count ? '，仍有遗留可在评审中处理' : '，已达标'}`
    : ''
  return { markdown: current, rounds, finalReport: state.report, summary }
}

/** 改写产物必须是合法成稿；异常时抛错由调用方按"本轮失败"处理 */
function normalizePolished(content: string, fallback: string): string {
  const fenced = content.trim().match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i)?.[1]
  const markdown = (fenced ?? content).trim()
  if (!/^#\s+\S/.test(markdown)) throw new Error('polish output is not a markdown article')
  // 明显截断（比原稿少一大截）视作失败，保留原稿更安全
  if (markdown.length < fallback.length * 0.5) throw new Error('polish output looks truncated')
  return markdown
}
