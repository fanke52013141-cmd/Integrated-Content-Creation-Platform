import { useEffect, useState } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import type { Topic, TopicSchemaField } from '../../../shared/contracts'
import { errorMessage } from '../lib'
import { ModalBase } from './ModalBase'
import type { ToastState } from './Toast'

const FALLBACK_FIELDS = ['选题主题', '核心观点', '读者价值']

interface ManualTopicDialogProps {
  open: boolean
  schema: TopicSchemaField[]
  accountId?: string
  onClose(): void
  onSaved(topic: Topic): void
  showToast(toast: ToastState): void
}

/** 不依赖模型的手动选题：按当前字段模板生成空白表单。 */
export function ManualTopicDialog({ open, schema, accountId, onClose, onSaved, showToast }: ManualTopicDialogProps): React.JSX.Element {
  const names = schema.length ? [...schema].sort((a, b) => a.sortOrder - b.sortOrder).map((field) => field.name) : FALLBACK_FIELDS
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setValues(Object.fromEntries(names.map((name) => [name, ''])))
    setBusy(false)
    setError('')
  }, [open, schema])

  async function save(): Promise<void> {
    const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()]))
    const title = (fields['选题主题'] || Object.values(fields).find(Boolean) || '').trim()
    if (!title) { setError('至少填写“选题主题”或第一个字段'); return }
    if (!fields['选题主题']) fields['选题主题'] = title
    setBusy(true); setError('')
    try {
      const topic = await window.moliu.topics.save({
        seedKeyword: title.slice(0, 300),
        accountIds: accountId ? [accountId] : [],
        relatedHotIds: [],
        status: 'draft',
        source: 'manual',
        fields
      })
      showToast({ type: 'success', message: '手动选题已创建，可继续编辑或锁定' })
      onSaved(topic)
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBase open={open} onClose={onClose} titleId="manual-topic-title" className="manual-topic-dialog">
      <header>
        <div>
          <span className="eyebrow">不依赖模型</span>
          <h2 id="manual-topic-title">手动新建选题</h2>
          <p>只填你现在知道的字段也可以；保存后仍可编辑、锁定和送进框架。</p>
        </div>
        <button className="icon-button" aria-label="关闭手动新建选题" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="manual-topic-body">
        <div className="manual-topic-fields">
          {names.map((name, index) => (
            <label className="field" key={name}>
              <span>{name}{name === '选题主题' ? '' : '（可选）'}</span>
              <textarea
                name={`manualTopic-${name}`}
                data-autofocus={index === 0 ? true : undefined}
                autoComplete="off"
                rows={name === '选题主题' ? 2 : 3}
                value={values[name] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
                placeholder={name === '选题主题' ? '例如：为什么创作者应该先写框架，再写正文？' : '可以先留空，稍后补充'}
              />
            </label>
          ))}
        </div>
        {error && <p className="inline-alert" role="alert">{error}</p>}
      </div>
      <footer>
        <span className="micro-copy">保存为草稿，不会自动锁定或生成框架。</span>
        <div>
          <button className="button secondary" onClick={onClose} disabled={busy}>取消</button>
          <button className="button primary" onClick={() => void save()} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}创建选题
          </button>
        </div>
      </footer>
    </ModalBase>
  )
}
