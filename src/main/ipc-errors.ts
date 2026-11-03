import { z } from 'zod'

/**
 * IPC 入口统一把 ZodError 转译成一句中文：否则 zod 的 issues 数组会原样
 * 序列化进错误文案（英文 JSON），用户在 toast / 页面内联错误里完全看不懂。
 * 真实联调中触发过两次：公众号「测试当前配置」（appId 为空）与
 * 智能配图「AI 生成配图方案」（模型输出的 priority 不在枚举内）。
 */
const IPC_FIELD_LABELS: Record<string, string> = {
  appId: 'AppID', appSecret: 'AppSecret', digest: '摘要', author: '作者',
  contentSourceUrl: '原文链接', publishedUrl: '发布链接', articleId: '文章',
  layoutId: '排版稿', assetId: '图片资产', goal: '目标', result: '结果', lesson: '教训'
}

function zhIssueMessage(issue: { code: string; message: string; minimum?: number | bigint; maximum?: number | bigint; values?: readonly unknown[] }): string {
  switch (issue.code) {
    case 'too_small':
      return Number(issue.minimum) === 1 ? '不能为空' : `长度不能少于 ${issue.minimum}`
    case 'too_big':
      return `长度不能超过 ${issue.maximum}`
    case 'invalid_value':
      return `仅支持：${(issue.values ?? []).map(String).join(' / ')}`
    case 'invalid_string':
      return /url/i.test(issue.message) ? '需要是有效链接' : issue.message
    default:
      return issue.message
  }
}

export function toFriendlyIpcError(error: unknown): unknown {
  if (!(error instanceof z.ZodError)) return error
  const issue = error.issues[0]
  if (!issue) return new Error('输入校验失败，请检查填写内容')
  const rawPath = issue.path.map(String).join('.')
  const path = IPC_FIELD_LABELS[rawPath] ?? rawPath
  return new Error(`输入校验失败${path ? `（${path}）` : ''}：${zhIssueMessage(issue)}`)
}

/** 包一层 IPC handler：ZodError 出来时变成用户能读懂的一句话 */
export function friendlyIpcAction<A extends unknown[]>(action: (...args: A) => unknown): (...args: A) => unknown {
  return (...args: A) => {
    try {
      const result = action(...args)
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          throw toFriendlyIpcError(error)
        })
      }
      return result
    } catch (error) {
      throw toFriendlyIpcError(error)
    }
  }
}
