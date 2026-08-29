import type { ModelGateway } from './model-gateway.js'
import { isCancelledError, type UnifiedRequest, type UnifiedResponse } from './types.js'

export interface CallModelOptions {
  signal?: AbortSignal
  /** 流式增量回调；提供时优先走流式 */
  onDelta?: (delta: string) => void
  /** 流式断线重试前回调（上层应清空已渲染的半截预览） */
  onRetry?: () => void
}

/**
 * 统一的模型调用入口：
 * 1. 提供 onDelta 时优先流式（实时反馈 + 空闲超时 + 可取消）；
 * 2. 流式失败自动整段重试 1 次（onRetry 通知 UI 清空半截预览）；
 * 3. 从未收到任何增量时（如供应商不支持流式）回退到非流式；
 * 4. 用户主动取消（CancelledError）直接上抛，不重试不回退。
 */
export async function callModelWithFallback(
  gateway: ModelGateway,
  request: UnifiedRequest,
  options: CallModelOptions = {}
): Promise<UnifiedResponse> {
  const { signal, onDelta, onRetry } = options
  if (!onDelta) return gateway.chat(request, { signal })
  let receivedDelta = false
  try {
    return await gateway.chatStream(request, (delta) => {
      receivedDelta = true
      onDelta(delta)
    }, {
      signal,
      onRetry: () => {
        receivedDelta = false
        onRetry?.()
      }
    })
  } catch (error) {
    if (isCancelledError(error)) throw error
    if (!receivedDelta) return gateway.chat(request, { signal })
    throw error
  }
}
