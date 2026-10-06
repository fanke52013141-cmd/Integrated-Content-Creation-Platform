import type { ContentCompletion } from '../../shared/contracts.js'

export function contentCompletion(content: string, finishReason?: string): ContentCompletion {
  if (!content.trim()) return 'invalid'
  if (finishReason === 'length' || finishReason === 'max_tokens') return 'truncated'
  if (finishReason === 'content_filter' || finishReason === 'refusal') return 'blocked'
  if (finishReason === 'stop' || finishReason === 'end_turn') return 'complete'
  return 'unverified'
}

export const completionMessage: Record<ContentCompletion, string> = {
  complete: '', truncated: '输出达到长度上限，内容已保留，请续写或人工补完',
  interrupted: '生成已中断，已收到的内容仍可恢复', blocked: '模型拒绝或过滤了内容，请调整要求',
  unverified: '供应商未返回正常结束标记，请检查内容完整性后另存为草稿', invalid: '模型未返回可用成稿'
}
