import { useEffect, useState } from 'react'
import type { MaterialContext } from '../../../shared/contracts'
import { errorMessage } from '../lib'

export function MaterialContextPreview({ ids, query, providerId, model, baseText = '' }: { ids: Set<string>; query: string; providerId?: string; model?: string; baseText?: string }): React.JSX.Element {
  const [context, setContext] = useState<MaterialContext>()
  const [error, setError] = useState('')
  const key = [...ids].sort().join(',')
  useEffect(() => {
    let alive = true
    setContext(undefined); setError('')
    const timer = setTimeout(() => {
      if (!key) return
      void window.moliu.materials.previewContext({ ids: key.split(','), query, providerId, model, baseText }).then(result => { if (alive) setContext(result) })
        .catch(reason => { if (alive) setError(errorMessage(reason)) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [key, query, providerId, model, baseText])
  if (!key) return <p className="micro-copy">未选择资料依据。生成后请人工核对事实、数字和引用。</p>
  if (error) return <p className="inline-alert" role="alert">素材预览失败：{error}</p>
  if (!context) return <p className="micro-copy">正在计算素材使用范围…</p>
  return <details className="material-context-preview"><summary>预计使用 {context.fragments.length} 个片段，{context.usedChars} / {context.totalChars} 字符；{context.omittedChars ? `其余 ${context.omittedChars} 字符未进入本次上下文` : '全部进入上下文'}</summary>
    <p className="micro-copy">按主题相关性和模型预算选取。原文完整保留，实际生成记录以任务快照为准。</p>
    {context.fragments.map(fragment => <details key={fragment.id}><summary>{fragment.title} · 原文位置 {fragment.start}–{fragment.end}</summary><p>{fragment.sourceUrl ?? '本地资料，无外部链接'}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{fragment.text}</pre></details>)}
  </details>
}
