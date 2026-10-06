import { useRef, useState } from 'react'
import type { VisualAsset } from '../../../shared/contracts'
import { errorMessage } from '../lib'

export function LocalImageImport({ articleId, kind, onImported }: { articleId: string; kind: 'cover' | 'inline'; onImported(asset: VisualAsset): Promise<void> | void }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <span className="local-image-import"><button className="button secondary compact" disabled={!articleId || busy} onClick={() => input.current?.click()}>{busy ? '正在导入…' : kind === 'cover' ? '导入自己的封面' : '导入并插入图片'}</button>
    <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={async event => {
      const files = [...(event.target.files ?? [])]
      event.target.value = ''
      if (!files.length || busy) return
      setBusy(true); setError('')
      try {
        const file = files[0]
        if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，请压缩后再导入')
        const pack = await window.moliu.visuals.createManualPack(articleId)
        const assets = await window.moliu.visuals.listAssets(pack.id)
        const slot = kind === 'cover' ? 0 : Math.max(-1, ...assets.filter(asset => asset.kind === 'inline').map(asset => asset.slot)) + 1
        if (slot > 30) throw new Error('这篇文章已导入 31 个正文图片位置，请到配图页复用或移除已有图片')
        const asset = await window.moliu.visuals.importImageData({ packId: pack.id, kind, slot, fileName: file.name, prompt: file.name, data: await file.arrayBuffer() })
        await onImported(asset)
      } catch (reason) { setError(errorMessage(reason)) }
      finally { setBusy(false) }
    }} />
    {error && <small role="alert">{error}</small>}
  </span>
}
