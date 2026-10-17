import { useEffect, useState } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import { ModalBase } from './ModalBase'
import { errorMessage } from '../lib'

export interface ManualHotInput {
  title: string
  url: string
  source: string
  hotValue: string
  desc: string
}

interface ManualHotDialogProps {
  open: boolean
  onClose(): void
  onSave(input: ManualHotInput): Promise<boolean>
}

/** 手动添加外部热点：不依赖任何热榜源，先记下来再决定怎么用。 */
export function ManualHotDialog({ open, onClose, onSave }: ManualHotDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [source, setSource] = useState('手动添加')
  const [hotValue, setHotValue] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(''); setUrl(''); setSource('手动添加'); setHotValue(''); setDesc(''); setBusy(false); setError('')
  }, [open])

  async function save(): Promise<void> {
    if (!title.trim()) { setError('至少填写标题'); return }
    setBusy(true); setError('')
    try {
      const saved = await onSave({ title: title.trim(), url: url.trim(), source: source.trim() || '手动添加', hotValue: hotValue.trim(), desc: desc.trim() })
      if (saved) onClose()
      else setError('这条热点已经在收藏夹中')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBase open={open} onClose={onClose} titleId="manual-hot-title" className="manual-topic-dialog">
      <header>
        <div>
          <span className="eyebrow">不依赖热榜源</span>
          <h2 id="manual-hot-title">手动添加热点</h2>
          <p>可以只填标题；链接、来源和热度稍后再补。保存后进入收藏夹。</p>
        </div>
        <button className="icon-button" aria-label="关闭手动添加热点" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="manual-topic-body">
        <div className="manual-topic-fields">
          <label className="field"><span>标题</span><input data-autofocus name="manualHotTitle" autoComplete="off" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder="例如：某平台发布新创作者扶持计划" /></label>
          <label className="field"><span>链接（可选）</span><input name="manualHotUrl" autoComplete="off" value={url} maxLength={2000} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
          <label className="field"><span>来源（可选）</span><input name="manualHotSource" autoComplete="off" value={source} maxLength={100} onChange={(event) => setSource(event.target.value)} /></label>
          <label className="field"><span>热度（可选）</span><input name="manualHotValue" autoComplete="off" value={hotValue} maxLength={100} onChange={(event) => setHotValue(event.target.value)} placeholder="例如：9,150 热" /></label>
          <label className="field"><span>摘要（可选）</span><textarea name="manualHotDesc" autoComplete="off" rows={3} value={desc} maxLength={5000} onChange={(event) => setDesc(event.target.value)} placeholder="为什么值得关注、可用于哪个角度…" /></label>
        </div>
        {error && <p className="inline-alert" role="alert">{error}</p>}
      </div>
      <footer>
        <span className="micro-copy">保存为本地收藏，不会请求外部平台。</span>
        <div>
          <button className="button secondary" onClick={onClose} disabled={busy}>取消</button>
          <button className="button primary" onClick={() => void save()} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}加入收藏
          </button>
        </div>
      </footer>
    </ModalBase>
  )
}
