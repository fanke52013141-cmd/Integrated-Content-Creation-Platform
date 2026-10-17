import { useEffect, useState } from 'react'
import { AlertTriangle, FileUp, LoaderCircle, Upload, X } from 'lucide-react'
import type {
  ContentImportAssociations,
  ContentImportFormat,
  ContentImportKind,
  ContentImportPreview,
  ContentImportResult,
  PickedImportFile
} from '../../../shared/contracts'
import { errorMessage } from '../lib'
import { ModalBase } from './ModalBase'
import type { ToastState } from './Toast'

const FORMAT_OPTIONS: Record<ContentImportKind, Array<{ value: ContentImportFormat; label: string }>> = {
  account: [
    { value: 'markdown', label: '字段文本（字段：值）' },
    { value: 'json', label: 'JSON' }
  ],
  'hot-item': [
    { value: 'markdown', label: '一行一条' },
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' }
  ],
  topic: [
    { value: 'markdown', label: 'Markdown 列表' },
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' }
  ],
  framework: [
    { value: 'markdown', label: 'Markdown 标题' },
    { value: 'json', label: 'JSON' }
  ],
  article: [
    { value: 'markdown', label: 'Markdown' },
    { value: 'json', label: 'JSON' },
    { value: 'html', label: 'HTML（会转成 Markdown）' }
  ],
  review: [
    { value: 'markdown', label: '一行一条' },
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' }
  ],
  'visual-plan': [{ value: 'json', label: 'JSON 方案' }],
  layout: [
    { value: 'html', label: 'HTML（保留结构/内联样式）' },
    { value: 'json', label: 'JSON（title + html）' }
  ],
  'publish-form': [{ value: 'json', label: 'JSON 交付信息' }],
  prompt: [{ value: 'json', label: 'JSON 提示词' }]
}

const KIND_LABEL: Record<ContentImportKind, string> = {
  account: '账号定位',
  'hot-item': '热点',
  topic: '选题',
  framework: '框架',
  article: '文章',
  review: '评审',
  'visual-plan': '配图方案',
  layout: '排版稿',
  'publish-form': '交付信息',
  prompt: '提示词'
}

const VERSIONABLE = new Set<ContentImportKind>(['account', 'topic', 'framework', 'article'])
const MAPPABLE = new Set<ContentImportKind>(['account', 'topic', 'publish-form'])

interface ImportDialogProps {
  open: boolean
  kind: ContentImportKind
  onClose(): void
  onImported(result: ContentImportResult): void
  showToast(toast: ToastState): void
  associations?: ContentImportAssociations
  /** 可选目标字段，用于导入前字段映射 */
  targetFields?: string[]
}

export function ImportDialog({ open, kind, onClose, onImported, showToast, associations, targetFields }: ImportDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [picked, setPicked] = useState<PickedImportFile | null>(null)
  const [content, setContent] = useState('')
  const [format, setFormat] = useState<ContentImportFormat>(FORMAT_OPTIONS[kind][0].value)
  const [preview, setPreview] = useState<ContentImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [commitMode, setCommitMode] = useState<'create' | 'new-version'>('create')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setMode('file')
    setPicked(null)
    setContent('')
    setFormat(FORMAT_OPTIONS[kind][0].value)
    setPreview(null)
    setMapping({})
    setCommitMode('create')
    setBusy(false)
    setError('')
  }, [open, kind])

  function adoptPreview(parsed: ContentImportPreview): void {
    setPreview(parsed)
    setMapping(Object.fromEntries(parsed.sourceFields.map((field) => [field, field])))
    setCommitMode('create')
  }

  async function chooseFile(): Promise<void> {
    setBusy(true); setError(''); setPreview(null)
    try {
      const file = await window.moliu.imports.pickFile({ kind })
      if (!file) return
      setPicked(file)
      setFormat(file.format)
      const parsed = await window.moliu.imports.preview({ kind, filePath: file.path })
      adoptPreview(parsed)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function parsePaste(): Promise<void> {
    if (!content.trim()) { setError('请先粘贴内容'); return }
    setBusy(true); setError(''); setPreview(null)
    try {
      // 用户粘贴 JSON 时不必先手动切换格式；只在当前类型支持 JSON 时自动识别。
      const looksJson = /^[\[{]/.test(content.trim())
      const effectiveFormat = looksJson && FORMAT_OPTIONS[kind].some((option) => option.value === 'json') ? 'json' : format
      if (effectiveFormat !== format) setFormat(effectiveFormat)
      const parsed = await window.moliu.imports.preview({ kind, content, format: effectiveFormat, fileName: `粘贴内容.${effectiveFormat === 'markdown' ? 'md' : effectiveFormat}` })
      adoptPreview(parsed)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function commit(): Promise<void> {
    if (!preview) return
    if (preview.errors.length || !preview.items.length) return
    setBusy(true); setError('')
    try {
      const result = await window.moliu.imports.commit({ token: preview.token, associations, mode: commitMode, mapping })
      showToast({
        type: result.failed.length ? 'warning' : 'success',
        message: result.failed.length
          ? `导入完成：成功 ${result.created.length} 条，失败 ${result.failed.length} 条`
          : `已导入 ${result.created.length} 条${KIND_LABEL[kind]}`
      })
      onImported(result)
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const canImport = Boolean(preview && preview.items.length && !preview.errors.length)

  return (
    <ModalBase open={open} onClose={onClose} titleId="import-dialog-title" className="import-dialog">
      <header>
        <div>
          <span className="eyebrow">外部内容</span>
          <h2 id="import-dialog-title">导入{KIND_LABEL[kind]}</h2>
          <p>支持其他工具产出的文件或粘贴内容；导入后是新条目，不会覆盖现有内容。</p>
        </div>
        <button className="icon-button" aria-label="关闭导入" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="import-dialog-body">
        <div className="segmented import-source-tabs" role="tablist" aria-label="导入方式">
          <button role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'active' : ''} onClick={() => { setMode('file'); setPreview(null); setError(''); setFormat(FORMAT_OPTIONS[kind][0].value) }}>选择文件</button>
          <button role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'active' : ''} onClick={() => { setMode('paste'); setPreview(null); setError(''); setFormat(FORMAT_OPTIONS[kind][0].value) }}>粘贴内容</button>
        </div>

        {mode === 'file' ? (
          <div className="import-source-panel">
            <button className="import-file-picker" type="button" data-autofocus onClick={() => void chooseFile()} disabled={busy}>
              <Upload size={22} />
              <span>
                <strong>{picked ? picked.name : `选择${KIND_LABEL[kind]}文件`}</strong>
                <small>{picked ? `${Math.max(1, Math.round(picked.size / 1024))} KB · ${picked.format.toUpperCase()}` : 'JSON / Markdown / CSV / DOCX / HTML'}</small>
              </span>
            </button>
            {picked && <p className="micro-copy">文件路径只在主进程使用；这里只显示文件名与解析结果。</p>}
          </div>
        ) : (
          <div className="import-source-panel">
            <label className="field">
              <span>内容格式</span>
              <select value={format} onChange={(event) => setFormat(event.target.value as ContentImportFormat)} aria-label="内容格式">
                {FORMAT_OPTIONS[kind].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>粘贴内容</span>
              <textarea
                name="importContent"
                autoComplete="off"
                rows={8}
                value={content}
                onChange={(event) => { setContent(event.target.value); setPreview(null); setError('') }}
                placeholder={kind === 'article' ? '# 标题\n\n粘贴正文…' : kind === 'framework' ? '# 标题\n\n## 章节\n\n内容…' : '- 选题一\n- 选题二'}
              />
            </label>
          </div>
        )}

        {associations && Object.values(associations).some(Boolean) && (
          <p className="import-association-note">导入后会关联当前账号/选题/框架；可以在详情中随时修改。</p>
        )}

        {error && <p className="inline-alert" role="alert"><AlertTriangle size={14} />{error}</p>}

        {preview && (
          <section className="import-preview" aria-label="导入预览">
            <header>
              <strong>解析结果</strong>
              <span>{preview.items.length} 条 · 来源 {preview.source.tool} / {preview.source.format}</span>
            </header>
            {preview.errors.length > 0 && <p className="inline-alert" role="alert">{preview.errors.join('；')}</p>}
            {preview.warnings.length > 0 && <p className="form-hint">{preview.warnings.join('；')}</p>}
            {preview.items.some((item) => item.existing) && VERSIONABLE.has(kind) && (
              <div className="import-conflict" role="note">
                <strong>{preview.items.filter((item) => item.existing).length} 条同来源内容已存在</strong>
                <label><input type="radio" name="import-mode" checked={commitMode === 'create'} onChange={() => setCommitMode('create')} />始终新建条目</label>
                <label><input type="radio" name="import-mode" checked={commitMode === 'new-version'} onChange={() => setCommitMode('new-version')} />更新为已有条目的新版本</label>
              </div>
            )}
            {MAPPABLE.has(kind) && preview.sourceFields.length > 1 && (
              <details className="import-mapping">
                <summary>字段映射（{preview.sourceFields.length} 个源字段）</summary>
                <div className="import-mapping-grid">
                  {preview.sourceFields.map((field) => {
                    const options = [...new Set([...(targetFields ?? []), ...preview.sourceFields])]
                    return (
                      <label key={field}>
                        <span>{field}</span>
                        <select aria-label={`${field} 映射到`} value={mapping[field] ?? field} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}>
                          <option value="不导入">不导入</option>
                          {options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    )
                  })}
                </div>
              </details>
            )}
            {preview.items.length > 0 && (
              <ol className="import-preview-list">
                {preview.items.slice(0, 12).map((item) => (
                  <li key={item.index}>
                    <strong>{item.index + 1}. {item.title}</strong>
                    {item.fields && <span>{Object.entries(item.fields).slice(0, 3).map(([name, value]) => `${name}：${value}`).join(' · ')}</span>}
                    {item.sections && <span>{item.sections.length} 个章节：{item.sections.slice(0, 4).map((section) => section.name).join(' / ')}</span>}
                    {item.rawMarkdown && <span>{item.rawMarkdown.replace(/^#.*$/gm, '').trim().slice(0, 100)}</span>}
                    {item.hotItem && <span>{item.hotItem.sourceTitle} · {item.hotItem.hotValue || '无热度'} · {item.hotItem.url || '无链接'}</span>}
                    {item.reviewProblems && <span>{item.reviewProblems.length} 条问题：{item.reviewProblems.slice(0, 3).map((problem) => problem.issue).join(' / ')}</span>}
                    {item.visualPlan && <span>封面：{item.visualPlan.cover.prompt.slice(0, 60) || '未填写提示词'} · 文内图 {item.visualPlan.inlineImages.length} 张</span>}
                    {item.layout && <span>{item.layout.title} · {item.layout.plainText.length} 字 · 外部排版 HTML</span>}
                    {item.warnings.length > 0 && <em>{item.warnings.join('；')}</em>}
                  </li>
                ))}
              </ol>
            )}
            {preview.items.length > 12 && <p className="micro-copy">仅显示前 12 条，实际导入 {preview.items.length} 条。</p>}
          </section>
        )}
      </div>

      <footer>
        <span className="micro-copy">导入内容默认为草稿，不会自动锁定或发布。</span>
        <div>
          <button className="button secondary" onClick={onClose} disabled={busy}>取消</button>
          {mode === 'paste' && !preview && (
            <button className="button secondary" onClick={() => void parsePaste()} disabled={busy || !content.trim()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <FileUp size={15} />}解析预览
            </button>
          )}
          {mode === 'file' && !preview && (
            <button className="button secondary" onClick={() => void chooseFile()} disabled={busy}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <FileUp size={15} />}选择并解析
            </button>
          )}
          <button className="button primary" onClick={() => void commit()} disabled={busy || !canImport}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}导入 {preview?.items.length ?? 0} 条
          </button>
        </div>
      </footer>
    </ModalBase>
  )
}
