import { useState } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import type { ReviewSeverity } from '../../../shared/contracts'
import { errorMessage } from '../lib'
import { ModalBase } from './ModalBase'
import type { ToastState } from './Toast'

interface ManualReviewProblemDialogProps {
  taskId: string
  onClose(): void
  onSaved(): Promise<void>
  showToast(toast: ToastState): void
}

/** 人工补充评审问题：AI 之外的意见也能进入同一条采纳/改稿流程。 */
export function ManualReviewProblemDialog({ taskId, onClose, onSaved, showToast }: ManualReviewProblemDialogProps): React.JSX.Element {
  const [position, setPosition] = useState('全文')
  const [severity, setSeverity] = useState<ReviewSeverity>('medium')
  const [issue, setIssue] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(): Promise<void> {
    if (!issue.trim()) { setError('请填写问题'); return }
    setBusy(true); setError('')
    try {
      await window.moliu.reviews.addManualProblem({ taskId, position: position.trim() || '全文', severity, issue: issue.trim(), suggestion: suggestion.trim() || '请人工判断如何修改' })
      showToast({ type: 'success', message: '已添加一条人工评审问题' })
      await onSaved()
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBase open onClose={onClose} titleId="manual-review-problem-title" className="manual-topic-dialog">
      <header>
        <div>
          <span className="eyebrow">AI 之外</span>
          <h2 id="manual-review-problem-title">手动添加评审问题</h2>
          <p>问题会和 AI 意见一样进入采纳与生成改稿流程。</p>
        </div>
        <button className="icon-button" aria-label="关闭手动添加问题" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="manual-topic-body">
        <div className="manual-topic-fields">
          <label className="field"><span>位置（可选）</span><input name="manualReviewPosition" autoComplete="off" value={position} maxLength={200} onChange={(event) => setPosition(event.target.value)} placeholder="例如：第二段 / 全文" /></label>
          <label className="field"><span>严重度</span>
            <select name="manualReviewSeverity" value={severity} onChange={(event) => setSeverity(event.target.value as ReviewSeverity)}>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <label className="field"><span>问题</span><textarea data-autofocus name="manualReviewIssue" autoComplete="off" rows={3} value={issue} maxLength={5000} onChange={(event) => setIssue(event.target.value)} placeholder="具体哪里有问题、读者会怎么误解…" /></label>
          <label className="field"><span>建议（可选）</span><textarea name="manualReviewSuggestion" autoComplete="off" rows={3} value={suggestion} maxLength={5000} onChange={(event) => setSuggestion(event.target.value)} placeholder="希望怎么改；留空时使用通用建议" /></label>
        </div>
        {error && <p className="inline-alert" role="alert">{error}</p>}
      </div>
      <footer>
        <span className="micro-copy">保存后不会自动采纳，可在结果里勾选。</span>
        <div>
          <button className="button secondary" onClick={onClose} disabled={busy}>取消</button>
          <button className="button primary" onClick={() => void save()} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}添加问题
          </button>
        </div>
      </footer>
    </ModalBase>
  )
}
