import { LoaderCircle } from 'lucide-react'

/**
 * 通用流式输出预览组件
 * 用于在 AI 生成过程中实时展示模型逐字输出。
 * 各页面通过条件渲染替换各自的列表/编辑区域。
 */
export function StreamingPreview({ content, label }: { content: string; label: string }): React.JSX.Element {
  return (
    <div className="streaming-preview">
      <header className="streaming-preview-head">
        <div>
          <span className="eyebrow"><LoaderCircle size={14} className="spin" /> STREAMING</span>
          <h2>{label}</h2>
          <p>正在接收模型实时输出…</p>
        </div>
      </header>
      <div className="streaming-preview-body">
        <pre className="streaming-preview-text">{content}<span className="streaming-cursor" /></pre>
      </div>
    </div>
  )
}
