import { useState } from 'react'
import { errorMessage } from '../lib'

export function MaterialDocument({ materialId }: { materialId: string }): React.JSX.Element {
  const [document, setDocument] = useState<{ versionId: string; content: string } | null>()
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  async function load() {
    if (document !== undefined) return
    try { setDocument(await window.moliu.materials.document(materialId)) } catch (reason) { setError(errorMessage(reason)) }
  }
  return <details className="material-document" onToggle={event => { if (event.currentTarget.open) void load() }}><summary>查看完整提取文本 / 搜索原文</summary>
    {error ? <p role="alert">{error}</p> : document === undefined ? <p>正在读取…</p> : !document ? <p>旧素材只有已保存的摘录。若曾被截断，请重新上传原文件以补齐全文。</p> : <>
      <p className="micro-copy">共 {document.content.length} 字符 · 位置 {offset}–{Math.min(offset + 10000, document.content.length)} · 版本 {document.versionId.slice(0, 12)}。保存的是提取文本，未保留文件原件。</p>
      <input aria-label="搜索素材原文" value={query} onChange={event => { setQuery(event.target.value); setError('') }} placeholder="检索原文中的词句" />
      <button className="button ghost compact" disabled={!query} onClick={() => { let position = document.content.indexOf(query, offset + 1); if (position < 0) position = document.content.indexOf(query); if (position >= 0) { setOffset(position); setError('') } else setError('全文未找到该词句') }}>查找下一处</button>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{document.content.slice(offset, offset + 10000)}</pre>
      <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 10000))}>上一段</button><button disabled={offset + 10000 >= document.content.length} onClick={() => setOffset(offset + 10000)}>下一段</button>
    </>}
  </details>
}
